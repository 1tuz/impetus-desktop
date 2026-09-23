use crate::error::{CommandError, CommandResult};
use crate::state::HarnessState;
use impetus_client::protocol::{
    DurableArtifactRef, Event, ExecutionMode, GitDiffPayload, GitStatusSnapshot, IpcRequest,
    IpcResponse, McpTransport, ModelAvailability, ModelProviderHealthLabel, UserPromptIntent,
    WorkspaceDirListing, WorkspaceFileContent, WorkspaceSearchResult,
};
use impetus_client::{HarnessClient, UnixSocketTransport};
use impetus_daemon_control::{ensure_daemon_running_with, DaemonError, DaemonOptions};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// Local read ceiling for path-based upload (matches `save_temp_image`).
/// Daemon `MAX_ARTIFACT_UPLOAD_BYTES` is tighter (8 MiB) and still enforces.
const MAX_LOCAL_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;

/// Wire DTO matching `DurableArtifactRef` / `ArtifactRef` Serialize fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRefDto {
    pub id: String,
    pub byte_count: usize,
}

fn read_upload_file(path: &str, workspace_root: Option<&Path>) -> CommandResult<Vec<u8>> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new("path must not be empty"));
    }
    let pb = PathBuf::from(trimmed);
    if !path_allowed_for_local_read(pb.as_path(), workspace_root) {
        return Err(CommandError::new(
            "upload path outside temp dir / workspace",
        ));
    }
    let meta = std::fs::metadata(&pb).map_err(|e| CommandError::new(e.to_string()))?;
    if !meta.is_file() {
        return Err(CommandError::new(format!(
            "path is not a file: {}",
            pb.display()
        )));
    }
    if meta.len() > MAX_LOCAL_UPLOAD_BYTES {
        return Err(CommandError::new("file too large (max 25MB)"));
    }
    std::fs::read(&pb).map_err(|e| CommandError::new(e.to_string()))
}

fn parse_artifact_dto(dto: ArtifactRefDto) -> CommandResult<DurableArtifactRef> {
    let id = dto.id.trim().to_owned();
    if id.is_empty() {
        return Err(CommandError::new("artifact id must not be empty"));
    }
    Ok(DurableArtifactRef {
        id,
        byte_count: dto.byte_count,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct HelloInfo {
    pub version: u16,
    pub capabilities: Vec<String>,
    pub socket_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDto {
    pub id: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub parent_session_id: Option<String>,
    pub fork_sequence: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusInfo {
    pub connected: bool,
    pub socket_path: String,
    pub session_id: Option<String>,
    pub runtime_status: Option<String>,
}

fn default_app_support_socket() -> String {
    impetus_daemon_control::default_data_root()
        .join("harness.sock")
        .to_string_lossy()
        .into_owned()
}

/// Smoke / CI often leaves `IMPETUS_SOCKET=/tmp/impetus-…`. That path fools the
/// GUI: sock file exists, nothing listens, Start spawns into a dead endpoint.
fn is_ephemeral_smoke_socket(path: &str) -> bool {
    let p = path.trim();
    p.starts_with("/tmp/impetus-") || (p.starts_with("/var/folders/") && p.contains("impetus"))
}

/// Same discovery as CLI/`impetus-daemon-control`, plus smoke-socket ignore so a
/// polluted shell env cannot steer the GUI onto a dead `/tmp/impetus-*` endpoint.
fn default_socket_path() -> String {
    let discovered = impetus_daemon_control::discover_socket_path();
    let as_str = discovered.to_string_lossy();
    if is_ephemeral_smoke_socket(&as_str) {
        return default_app_support_socket();
    }
    as_str.into_owned()
}

/// Connect error text from `UnixSocketTransport::connect` (Hello Incompatible).
fn is_protocol_incompatible_error(err: &str) -> bool {
    err.contains("protocol incompatible")
}

fn parse_uuid(value: &str, label: &str) -> CommandResult<Uuid> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(format!("{label} must not be empty")));
    }
    Uuid::parse_str(trimmed).map_err(|err| CommandError::new(format!("invalid {label}: {err}")))
}

fn require_client(guard: &Option<UnixSocketTransport>) -> CommandResult<&UnixSocketTransport> {
    guard
        .as_ref()
        .ok_or_else(|| CommandError::new("not connected; call harness_hello first"))
}

fn parse_execution_mode(value: &str) -> CommandResult<ExecutionMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "ask" => Ok(ExecutionMode::Ask),
        "plan" => Ok(ExecutionMode::Plan),
        "accept_edits" => Ok(ExecutionMode::AcceptEdits),
        "auto" => Ok(ExecutionMode::Auto),
        "bypass" => Ok(ExecutionMode::Bypass),
        other => Err(CommandError::new(format!(
            "invalid execution mode: {other} (ask|plan|accept_edits|auto|bypass)"
        ))),
    }
}

fn parse_prompt_intent(value: Option<&str>) -> CommandResult<UserPromptIntent> {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("prompt") => Ok(UserPromptIntent::Prompt),
        Some("steer") => Ok(UserPromptIntent::Steer),
        Some("follow_up") | Some("follow-up") | Some("followup") => Ok(UserPromptIntent::FollowUp),
        Some(other) => Err(CommandError::new(format!(
            "invalid prompt intent: {other} (prompt|steer|follow_up)"
        ))),
    }
}

fn mode_wire(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Ask => "ask",
        ExecutionMode::Plan => "plan",
        ExecutionMode::AcceptEdits => "accept_edits",
        ExecutionMode::Auto => "auto",
        ExecutionMode::Bypass => "bypass",
    }
}

async fn abort_live_sub(state: &HarnessState) {
    if let Some(handle) = state.live_sub.lock().await.take() {
        handle.abort();
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionEventsPayload {
    pub session_id: String,
    pub events: Vec<Event>,
}

#[tauri::command]
pub async fn harness_hello(state: State<'_, HarnessState>) -> CommandResult<HelloInfo> {
    let socket_path = default_socket_path();
    let client = UnixSocketTransport::connect(&socket_path).await?;

    // connect() already negotiated hello; call again for version/capabilities DTO
    let hello = match client.hello().await? {
        IpcResponse::Hello {
            version,
            capabilities,
        } => HelloInfo {
            version,
            capabilities,
            socket_path: socket_path.clone(),
        },
        IpcResponse::Incompatible {
            supported_version,
            min_supported,
            client_version,
            upgrade_recommendation,
        } => {
            return Err(CommandError::new(format!(
                "IPC incompatible: client={client_version}, daemon={supported_version} (min={min_supported}). {}",
                upgrade_recommendation.unwrap_or_else(|| "Upgrade the client or daemon.".into())
            )));
        }
        other => {
            return Err(CommandError::new(format!(
                "unexpected hello response: {other:?}"
            )));
        }
    };

    let mut guard = state.client.lock().await;
    *guard = Some(client);
    *state.socket_path.lock().await = socket_path;
    Ok(hello)
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, HarnessState>) -> CommandResult<Vec<SessionDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let sessions = client.list_sessions().await?;
    Ok(sessions
        .into_iter()
        .map(|session| SessionDto {
            id: session.id.to_string(),
            created_at_unix_ms: session.created_at_unix_ms,
            updated_at_unix_ms: session.updated_at_unix_ms,
            parent_session_id: session.parent_session_id.map(|id| id.to_string()),
            fork_sequence: session.fork_sequence,
        })
        .collect())
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, HarnessState>,
    workspace_root: String,
) -> CommandResult<String> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new("workspace_root must not be empty"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(CommandError::new(format!(
            "workspace_root is not a directory: {}",
            path.display()
        )));
    }

    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let session_id = client.create_session(path).await?;
    Ok(session_id.to_string())
}

#[tauri::command]
pub async fn upload_artifact(
    state: State<'_, HarnessState>,
    session_id: String,
    path: String,
    content_type: Option<String>,
    workspace_root: Option<String>,
) -> CommandResult<ArtifactRefDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let ws = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let bytes = read_upload_file(&path, ws.as_deref())?;
    let content_type = content_type
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());

    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let artifact = client
        .upload_artifact(session_id, &bytes, content_type)
        .await?;
    Ok(ArtifactRefDto {
        id: artifact.id,
        byte_count: artifact.byte_count,
    })
}

#[tauri::command]
pub async fn send_prompt(
    state: State<'_, HarnessState>,
    session_id: String,
    text: String,
    intent: Option<String>,
    artifact: Option<ArtifactRefDto>,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let text = text.trim();
    let artifact = match artifact {
        Some(dto) => Some(parse_artifact_dto(dto)?),
        None => None,
    };
    // Client allows empty text with artifact (label-only paste path in TUI).
    if text.is_empty() && artifact.is_none() {
        return Err(CommandError::new("prompt text must not be empty"));
    }
    let intent = parse_prompt_intent(intent.as_deref())?;

    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let status = client
        .send_message_with_intent(session_id, text.to_owned(), artifact, intent)
        .await?;
    Ok(format!("{status:?}"))
}

#[tauri::command]
pub async fn set_execution_mode(
    state: State<'_, HarnessState>,
    session_id: String,
    mode: String,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let mode = parse_execution_mode(&mode)?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let confirmed = client.set_execution_mode(session_id, mode).await?;
    Ok(mode_wire(confirmed).to_owned())
}

#[tauri::command]
pub async fn get_execution_mode(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let mode = client.get_execution_mode(session_id).await?;
    Ok(mode_wire(mode).to_owned())
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalDetailDto {
    pub approval_id: String,
    pub reason: String,
    pub state: String,
    pub diff_preview: Option<String>,
    pub affected_files: Vec<String>,
    pub estimated_scope: Option<String>,
}

#[tauri::command]
pub async fn get_approval_detail(
    state: State<'_, HarnessState>,
    session_id: String,
    approval_id: String,
) -> CommandResult<ApprovalDetailDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let approval_id = parse_uuid(&approval_id, "approval_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::GetApprovalDetail {
            session_id,
            approval_id,
        })
        .await?
    {
        IpcResponse::ApprovalDetail { detail, .. } => Ok(ApprovalDetailDto {
            approval_id: detail.request.id.to_string(),
            reason: detail.request.reason.clone(),
            state: format!("{:?}", detail.request.state),
            diff_preview: detail.diff_preview.clone(),
            affected_files: detail.affected_files.clone(),
            estimated_scope: detail.estimated_scope.map(|s| format!("{s:?}")),
        }),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected approval detail response: {other:?}"
        ))),
    }
}

/// Serializable child-run snapshot (`IpcResponse::ChildRuns` / `ChildRun`).
#[derive(Debug, Clone, Serialize)]
pub struct ChildRunDto {
    pub child_id: String,
    pub parent_id: String,
    pub role: String,
    pub status: String,
    pub summary: String,
    pub artifact_ref_labels: Vec<String>,
    pub recorded_unix_ms: u64,
}

#[tauri::command]
pub async fn list_child_runs(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<Vec<ChildRunDto>> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::ListChildRuns { session_id })
        .await?
    {
        IpcResponse::ChildRuns { runs, .. } => Ok(runs
            .into_iter()
            .map(|run| ChildRunDto {
                child_id: run.child_id,
                parent_id: run.parent_id,
                role: run.role_label,
                status: run.status.as_str().to_owned(),
                summary: run.summary_label,
                artifact_ref_labels: run.artifact_ref_labels,
                recorded_unix_ms: run.recorded_unix_ms,
            })
            .collect()),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected child runs response: {other:?}"
        ))),
    }
}

#[tauri::command]
pub async fn get_child_run(
    state: State<'_, HarnessState>,
    child_id: String,
) -> CommandResult<ChildRunDto> {
    let child_id = child_id.trim().to_owned();
    if child_id.is_empty() {
        return Err(CommandError::new("child_id must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client.request(IpcRequest::GetChildRun { child_id }).await? {
        IpcResponse::ChildRun { run } => Ok(ChildRunDto {
            child_id: run.child_id,
            parent_id: run.parent_id,
            role: run.role_label,
            status: run.status.as_str().to_owned(),
            summary: run.summary_label,
            artifact_ref_labels: run.artifact_ref_labels,
            recorded_unix_ms: run.recorded_unix_ms,
        }),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected child run response: {other:?}"
        ))),
    }
}

#[tauri::command]
pub async fn fork_session(
    state: State<'_, HarnessState>,
    session_id: String,
    up_to_sequence: u64,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let new_id = client.fork_session(session_id, up_to_sequence).await?;
    Ok(new_id.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckpointDto {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub sequence: u64,
    pub created_at_unix_ms: u64,
}

#[tauri::command]
pub async fn list_checkpoints(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<Vec<CheckpointDto>> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let checkpoints = client.list_checkpoints(session_id).await?;
    Ok(checkpoints
        .into_iter()
        .map(|c| CheckpointDto {
            id: c.id.to_string(),
            session_id: c.session_id.to_string(),
            name: c.name,
            sequence: c.sequence,
            created_at_unix_ms: c.created_at_unix_ms,
        })
        .collect())
}

/// Start (or replace) a background `subscribe_live` loop. Emits `harness://events`.
#[tauri::command]
pub async fn subscribe_session_events(
    app: AppHandle,
    state: State<'_, HarnessState>,
    session_id: String,
    after_seq: Option<u64>,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let after_seq = after_seq.unwrap_or(0);

    abort_live_sub(&state).await;

    let mut subscription = {
        let guard = state.client.lock().await;
        let client = require_client(&guard)?;
        client.subscribe_live(session_id, after_seq).await?
    };

    let session_key = session_id.to_string();
    let handle = tokio::spawn(async move {
        while let Ok(events) = subscription.next_events().await {
            let payload = SessionEventsPayload {
                session_id: session_key.clone(),
                events,
            };
            if app.emit("harness://events", &payload).is_err() {
                break;
            }
        }
    });

    *state.live_sub.lock().await = Some(handle);
    Ok(())
}

/// Stop the active live subscription (if any).
#[tauri::command]
pub async fn unsubscribe_session_events(state: State<'_, HarnessState>) -> CommandResult<()> {
    abort_live_sub(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_session(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let status = client.cancel(session_id).await?;
    Ok(format!("{status:?}"))
}

#[tauri::command]
pub async fn resolve_approval(
    state: State<'_, HarnessState>,
    session_id: String,
    approval_id: String,
    accept: bool,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let approval_id = parse_uuid(&approval_id, "approval_id")?;

    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .resolve_approval(session_id, approval_id, accept)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_status(
    state: State<'_, HarnessState>,
    session_id: Option<String>,
) -> CommandResult<StatusInfo> {
    let socket_path = state.socket_path.lock().await.clone();
    let guard = state.client.lock().await;
    let Some(client) = guard.as_ref() else {
        return Ok(StatusInfo {
            connected: false,
            socket_path,
            session_id: None,
            runtime_status: None,
        });
    };

    let (session_id, runtime_status) = if let Some(raw) = session_id {
        let id = parse_uuid(&raw, "session_id")?;
        let status = client.resume_session(id).await?;
        (Some(id.to_string()), Some(format!("{status:?}")))
    } else {
        (None, None)
    };

    Ok(StatusInfo {
        connected: true,
        socket_path,
        session_id,
        runtime_status,
    })
}

#[tauri::command]
pub async fn disconnect(state: State<'_, HarnessState>) -> CommandResult<()> {
    abort_live_sub(&state).await;
    let mut guard = state.client.lock().await;
    *guard = None;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonProbe {
    pub socket_path: String,
    pub socket_exists: bool,
    pub reachable: bool,
    pub detail: String,
    /// How this daemon was started from Desktop: `mock` | `provider` | `acp` | `unknown`.
    /// Probe of an already-running process cannot know the provider — returns `unknown`.
    pub provider_kind: String,
    /// `ok` | `missing` | `stale` | `incompatible` | `other` — guides Start unlink policy.
    pub failure_kind: String,
}

fn probe_with(
    socket_path: String,
    socket_exists: bool,
    reachable: bool,
    detail: String,
    provider_kind: &str,
    failure_kind: &str,
) -> DaemonProbe {
    DaemonProbe {
        socket_path,
        socket_exists,
        reachable,
        detail,
        provider_kind: provider_kind.to_owned(),
        failure_kind: failure_kind.to_owned(),
    }
}

/// Local socket probe only — no Accessibility, no Full Disk, no TCC prompts.
async fn probe_daemon_inner() -> DaemonProbe {
    let socket_path = default_socket_path();
    let path = PathBuf::from(&socket_path);
    let socket_exists = path.exists();
    if !socket_exists {
        return probe_with(
            socket_path,
            false,
            false,
            "socket missing — runtime will start on ensure".into(),
            "unknown",
            "missing",
        );
    }

    match UnixSocketTransport::connect(&socket_path).await {
        Ok(_) => probe_with(
            socket_path,
            true,
            true,
            "daemon reachable".into(),
            "unknown",
            "ok",
        ),
        Err(err) => {
            let msg = err.to_string();
            let kind = if is_protocol_incompatible_error(&msg) {
                "incompatible"
            } else {
                "stale"
            };
            probe_with(
                socket_path,
                true,
                false,
                format!("socket present but connect failed: {msg}"),
                "unknown",
                kind,
            )
        }
    }
}

#[tauri::command]
pub async fn probe_daemon() -> CommandResult<DaemonProbe> {
    Ok(probe_daemon_inner().await)
}

/// Resolve `impetusd` for ensure:
/// env override → next to `current_exe` (bundled) → sibling debug/release → PATH.
fn resolve_impetusd_bin() -> CommandResult<PathBuf> {
    for key in ["IMPETUSD_BIN", "IMPETUS_IMPETUSD_PATH"] {
        if let Ok(path) = std::env::var(key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                let pb = PathBuf::from(trimmed);
                if pb.is_file() {
                    return Ok(pb);
                }
                return Err(CommandError::new(format!(
                    "{key} is set but not a file: {trimmed}"
                )));
            }
        }
    }

    // Production .app: Tauri externalBin lands next to the desktop executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("impetusd");
            if bundled.is_file() {
                return Ok(bundled);
            }
        }
    }

    // Dev: sibling impetus build (same layout as path-dep crates).
    let sibling_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../impetus/target");
    for rel in ["release/impetusd", "debug/impetusd"] {
        let candidate = sibling_root.join(rel);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    which_impetusd().ok_or_else(|| {
        CommandError::new(
            "impetusd not found — set IMPETUSD_BIN, build sibling impetus, or install on PATH",
        )
    })
}

fn which_impetusd() -> Option<PathBuf> {
    let output = Command::new("which").arg("impetusd").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if path.is_empty() {
        return None;
    }
    let pb = PathBuf::from(path);
    pb.is_file().then_some(pb)
}

fn resolve_profile_path(raw: Option<String>, label: &str) -> CommandResult<Option<PathBuf>> {
    let Some(s) = raw.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(&s);
    if !path.is_file() {
        return Err(CommandError::new(format!("{label} is not a file: {s}")));
    }
    Ok(Some(path))
}

/// Data dir for shared daemon-control — socket parent, else platform default.
fn runtime_data_dir(socket_path: &str) -> PathBuf {
    Path::new(socket_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(impetus_daemon_control::default_data_root)
}

fn map_daemon_error(err: DaemonError) -> CommandError {
    let failure = match &err {
        DaemonError::Incompatible { .. } => "incompatible",
        DaemonError::BinaryMissing { .. } => "missing_binary",
        DaemonError::StartupTimeout { .. }
        | DaemonError::DaemonExited { .. }
        | DaemonError::LockBusyTimeout { .. } => "timeout",
        DaemonError::HelloFailed { .. } => "stale",
        _ => "other",
    };
    CommandError::new(format!("runtime ensure failed ({failure}): {err}"))
}

/// UI orchestration only: resolve binary + optional profiles, then delegate
/// flock / stale socket / readiness to [`impetus_daemon_control`].
async fn ensure_runtime_inner(
    provider_profile: Option<String>,
    acp_profile: Option<String>,
) -> CommandResult<DaemonProbe> {
    let existing = probe_daemon_inner().await;
    if existing.reachable {
        return Ok(DaemonProbe {
            detail: format!(
                "runtime already reachable (provider_kind={})",
                existing.provider_kind
            ),
            ..existing
        });
    }

    let provider_path = resolve_profile_path(provider_profile, "provider_profile")?;
    let acp_path = resolve_profile_path(acp_profile, "acp_profile")?;
    if provider_path.is_some() && acp_path.is_some() {
        return Err(CommandError::new(
            "pass only one of provider_profile or acp_profile",
        ));
    }

    let (provider_kind, kind_label) = if let Some(ref p) = provider_path {
        ("provider", format!("provider-profile {}", p.display()))
    } else if let Some(ref p) = acp_path {
        ("acp", format!("acp-profile {}", p.display()))
    } else {
        (
            "mock",
            "mock provider (no profile — not a real AI backend)".to_owned(),
        )
    };

    let socket_path = existing.socket_path.clone();
    // Never unlink a live incompatible daemon — shared control also refuses.
    if existing.failure_kind == "incompatible" {
        return Err(CommandError::new(format!(
            "runtime protocol incompatible — upgrade Desktop or impetusd: {}",
            existing.detail
        )));
    }

    let bin = resolve_impetusd_bin()?;
    let data_dir = runtime_data_dir(&socket_path);
    let opts = DaemonOptions::new(PathBuf::from(&socket_path), data_dir.clone(), bin.clone());

    let provider_path_spawn = provider_path.clone();
    let acp_path_spawn = acp_path.clone();
    let bin_spawn = bin.clone();
    ensure_daemon_running_with(&opts, move |socket, data| {
        let mut cmd = Command::new(&bin_spawn);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("IMPETUS_SOCKET", socket)
            .env("IMPETUS_DATA_DIR", data);
        if let Some(ref p) = provider_path_spawn {
            cmd.arg("--provider-profile").arg(p);
        }
        if let Some(ref p) = acp_path_spawn {
            cmd.arg("--acp-profile").arg(p);
        }
        let child = cmd.spawn().map_err(|source| DaemonError::SpawnFailed {
            path: bin_spawn.clone(),
            source,
        })?;
        Ok(Some(child))
    })
    .await
    .map_err(map_daemon_error)?;

    let probe = probe_daemon_inner().await;
    if probe.reachable {
        return Ok(probe_with(
            probe.socket_path,
            probe.socket_exists,
            true,
            format!(
                "started {} — {} — runtime reachable",
                bin.display(),
                kind_label
            ),
            provider_kind,
            "ok",
        ));
    }

    Ok(probe_with(
        probe.socket_path,
        probe.socket_exists,
        probe.reachable,
        format!(
            "ensure via impetus-daemon-control ({}) but socket not ready: {}",
            kind_label, probe.detail
        ),
        provider_kind,
        if probe.reachable {
            "ok"
        } else if probe.socket_exists {
            "stale"
        } else {
            "missing"
        },
    ))
}

/// Ensure `impetusd` is reachable (lazy-start). Preferred product entry.
#[tauri::command]
pub async fn ensure_runtime(
    provider_profile: Option<String>,
    acp_profile: Option<String>,
) -> CommandResult<DaemonProbe> {
    ensure_runtime_inner(provider_profile, acp_profile).await
}

/// Recovery / Advanced alias for [`ensure_runtime`].
#[tauri::command]
pub async fn start_daemon(
    provider_profile: Option<String>,
    acp_profile: Option<String>,
) -> CommandResult<DaemonProbe> {
    ensure_runtime_inner(provider_profile, acp_profile).await
}

fn branch_display_name(name: Option<&String>, detached: bool) -> String {
    match (name, detached) {
        (Some(n), false) if !n.is_empty() => n.clone(),
        _ => "HEAD".to_owned(),
    }
}

fn model_health_label(health: &ModelProviderHealthLabel) -> String {
    match health {
        ModelProviderHealthLabel::Unknown => "unknown".into(),
        ModelProviderHealthLabel::Healthy => "healthy".into(),
        ModelProviderHealthLabel::Unavailable { .. } => "unavailable".into(),
    }
}

fn model_availability_label(availability: &ModelAvailability) -> String {
    match availability {
        ModelAvailability::Available => "available".into(),
        ModelAvailability::Unavailable => "unavailable".into(),
        ModelAvailability::Unknown => "unknown".into(),
    }
}

fn mcp_transport_hint(transport: Option<McpTransport>, connected: bool) -> String {
    let base = match transport {
        Some(McpTransport::Stdio) => "stdio",
        Some(McpTransport::Http) => "http",
        Some(McpTransport::Sse) => "sse",
        None => "unknown",
    };
    if connected {
        format!("{base}:connected")
    } else {
        base.to_owned()
    }
}

/// Current branch via daemon Git IPC (`GetCurrentBranch`).
#[tauri::command]
pub async fn git_current_branch(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let branch = client
        .get_current_branch(session_id)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(branch_display_name(branch.name.as_ref(), branch.detached))
}

/// Local branches via daemon Git IPC (`ListBranches`).
#[tauri::command]
pub async fn git_list_branches(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<Vec<String>> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let branches = client
        .list_branches(session_id)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(branches.into_iter().map(|b| b.name).collect())
}

fn validate_branch_name(branch: &str) -> CommandResult<&str> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(CommandError::new("branch must not be empty"));
    }
    if branch.starts_with('-') {
        return Err(CommandError::new("invalid branch name"));
    }
    Ok(branch)
}

/// Switch branch via daemon Git IPC (`SwitchBranch`).
#[tauri::command]
pub async fn git_checkout_branch(
    state: State<'_, HarnessState>,
    session_id: String,
    branch: String,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let branch = validate_branch_name(&branch)?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let current = client
        .switch_branch(session_id, branch.to_owned())
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(branch_display_name(current.name.as_ref(), current.detached))
}

/// Create branch via daemon Git IPC (`CreateBranch`) — never local `git`.
#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, HarnessState>,
    session_id: String,
    branch: String,
    checkout: Option<bool>,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let branch = validate_branch_name(&branch)?;
    let checkout = checkout.unwrap_or(true);
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let current = client
        .create_branch(session_id, branch.to_owned(), checkout)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(branch_display_name(current.name.as_ref(), current.detached))
}

/// Working-tree status via daemon Git IPC (`GitStatus`).
#[tauri::command]
pub async fn git_status(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<GitStatusSnapshot> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .git_status(session_id)
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

/// Unified working-tree patch via daemon Git IPC (`GetDiff`).
#[tauri::command]
pub async fn get_diff(
    state: State<'_, HarnessState>,
    session_id: String,
    base_ref: Option<String>,
) -> CommandResult<GitDiffPayload> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .get_diff(session_id, base_ref)
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

/// Single-path patch via daemon Git IPC (`GetFileDiff`).
#[tauri::command]
pub async fn get_file_diff(
    state: State<'_, HarnessState>,
    session_id: String,
    path: String,
    base_ref: Option<String>,
) -> CommandResult<GitDiffPayload> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let path = path.trim();
    if path.is_empty() {
        return Err(CommandError::new("path must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .get_file_diff(session_id, PathBuf::from(path), base_ref)
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

/// List workspace-relative directory via daemon Files IPC (`ListWorkspaceDir`).
#[tauri::command]
pub async fn list_workspace_dir(
    state: State<'_, HarnessState>,
    session_id: String,
    path: Option<String>,
) -> CommandResult<WorkspaceDirListing> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let rel = path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .unwrap_or(".");
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .list_workspace_dir(session_id, PathBuf::from(rel))
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

/// Read workspace text file via daemon Files IPC (`ReadWorkspaceFile`).
#[tauri::command]
pub async fn read_workspace_file(
    state: State<'_, HarnessState>,
    session_id: String,
    path: String,
    max_bytes: Option<usize>,
) -> CommandResult<WorkspaceFileContent> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let path = path.trim();
    if path.is_empty() {
        return Err(CommandError::new("path must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .read_workspace_file(session_id, PathBuf::from(path), max_bytes)
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

/// Recursive text search via daemon Files IPC (`SearchWorkspaceFiles`).
#[tauri::command]
pub async fn search_workspace_files(
    state: State<'_, HarnessState>,
    session_id: String,
    path: Option<String>,
    pattern: String,
) -> CommandResult<WorkspaceSearchResult> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err(CommandError::new("pattern must not be empty"));
    }
    let rel = path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .unwrap_or(".");
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client
        .search_workspace_files(session_id, PathBuf::from(rel), pattern.to_owned())
        .await
        .map_err(|err| CommandError::new(err.to_string()))
}

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionDto {
    pub pty_id: u64,
    pub owner_session_id: String,
    pub state: String,
    pub command: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyOutputDto {
    pub pty_id: u64,
    pub data: Vec<u8>,
    pub dropped_total: u64,
    pub eof: bool,
}

fn pty_state_label(state: &impetus_client::protocol::PtySessionState) -> String {
    use impetus_client::protocol::PtySessionState;
    match state {
        PtySessionState::Starting => "starting".into(),
        PtySessionState::Running { pid } => format!("running:{pid}"),
        PtySessionState::Detached { pid } => format!("detached:{pid}"),
        PtySessionState::Exited { exit_code } => match exit_code {
            Some(code) => format!("exited:{code}"),
            None => "exited".into(),
        },
        PtySessionState::Failed { reason } => format!("failed:{reason}"),
    }
}

fn pty_session_dto(view: impetus_client::PtySessionView) -> PtySessionDto {
    PtySessionDto {
        pty_id: view.pty_id,
        owner_session_id: view.owner_session_id.to_string(),
        state: pty_state_label(&view.state),
        command: view.command,
        cols: view.cols,
        rows: view.rows,
    }
}

/// Spawn a daemon-owned PTY bound to `session_id` (owner ACL on every op).
#[tauri::command]
pub async fn pty_start(
    state: State<'_, HarnessState>,
    session_id: String,
    command: String,
    args: Option<Vec<String>>,
    working_dir: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> CommandResult<PtySessionDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let command = command.trim();
    if command.is_empty() {
        return Err(CommandError::new("command must not be empty"));
    }
    let working_dir = working_dir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let view = client
        .pty_start(
            session_id,
            command.to_owned(),
            args.unwrap_or_default(),
            working_dir,
            cols,
            rows,
        )
        .await?;
    Ok(pty_session_dto(view))
}

#[tauri::command]
pub async fn pty_attach(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
) -> CommandResult<PtySessionDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let view = client.pty_attach(session_id, pty_id).await?;
    Ok(pty_session_dto(view))
}

#[tauri::command]
pub async fn pty_input(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
    data: Vec<u8>,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    if data.is_empty() {
        return Ok(());
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client.pty_input(session_id, pty_id, &data).await?;
    Ok(())
}

#[tauri::command]
pub async fn pty_output(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
    max_bytes: Option<usize>,
) -> CommandResult<PtyOutputDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let chunk = client.pty_output(session_id, pty_id, max_bytes).await?;
    Ok(PtyOutputDto {
        pty_id: chunk.pty_id,
        data: chunk.data,
        dropped_total: chunk.dropped_total,
        eof: chunk.eof,
    })
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    if cols == 0 || rows == 0 {
        return Err(CommandError::new("cols and rows must be > 0"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client.pty_resize(session_id, pty_id, cols, rows).await?;
    Ok(())
}

#[tauri::command]
pub async fn pty_detach(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client.pty_detach(session_id, pty_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn pty_terminate(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
) -> CommandResult<()> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    client.pty_terminate(session_id, pty_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn pty_status(
    state: State<'_, HarnessState>,
    session_id: String,
    pty_id: u64,
) -> CommandResult<PtySessionDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let view = client.pty_status(session_id, pty_id).await?;
    Ok(pty_session_dto(view))
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerDto {
    pub id: String,
    pub name: String,
    pub transport_hint: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelProviderDto {
    pub provider_id: String,
    pub model_id: String,
    pub health: String,
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_display_name: Option<String>,
    pub availability: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_tiers: Vec<String>,
    pub reasoning: bool,
}

fn mcp_servers_to_dto(
    servers: Vec<impetus_client::protocol::McpServerStatus>,
) -> Vec<McpServerDto> {
    servers
        .into_iter()
        .map(|s| McpServerDto {
            id: s.id,
            name: s.name,
            transport_hint: mcp_transport_hint(s.transport, s.connected),
            connected: s.connected,
        })
        .collect()
}

/// Daemon MCP catalog (`ListMcpServers`) — no local config parse.
#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, HarnessState>) -> CommandResult<Vec<McpServerDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let servers = client
        .list_mcp_servers()
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(mcp_servers_to_dto(servers))
}

/// Reload daemon MCP catalog (`ReloadMcpServers`) — returns fresh list.
#[tauri::command]
pub async fn reload_mcp_servers(
    state: State<'_, HarnessState>,
) -> CommandResult<Vec<McpServerDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    // Raw request: works on pinned client before HarnessClient::reload_mcp_servers lands.
    match client
        .request(IpcRequest::ReloadMcpServers)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::McpServers { servers } => Ok(mcp_servers_to_dto(servers)),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected ReloadMcpServers response: {other:?}"
        ))),
    }
}

/// Registered model providers (`ListModels`) — ids + health; no secrets.
#[tauri::command]
pub async fn list_models(state: State<'_, HarnessState>) -> CommandResult<Vec<ModelProviderDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let providers = client
        .list_models()
        .await
        .map_err(|err| CommandError::new(err.to_string()))?;
    Ok(providers
        .into_iter()
        .map(|p| ModelProviderDto {
            provider_display_name: p.provider_display_name,
            model_display_name: p.model_display_name,
            availability: model_availability_label(&p.availability),
            reasoning_efforts: p.reasoning_efforts,
            default_reasoning_effort: p.default_reasoning_effort,
            service_tiers: p.service_tiers,
            reasoning: p.capabilities.reasoning,
            provider_id: p.provider_id,
            model_id: p.model_id,
            health: model_health_label(&p.health),
            is_default: p.is_default,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionModelDto {
    pub provider_id: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
}

/// Current session model selection (`GetSessionModel`).
#[tauri::command]
pub async fn get_session_model(
    state: State<'_, HarnessState>,
    session_id: String,
) -> CommandResult<SessionModelDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::GetSessionModel { session_id })
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::SessionModel { selection, .. } => Ok(SessionModelDto {
            provider_id: selection.provider_id,
            model_id: selection.model_id,
            reasoning_effort: selection.reasoning_effort,
            service_tier: selection.service_tier,
        }),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected GetSessionModel response: {other:?}"
        ))),
    }
}

/// Override session model / reasoning (`SetSessionModel`).
#[tauri::command]
pub async fn set_session_model(
    state: State<'_, HarnessState>,
    session_id: String,
    provider_id: String,
    model_id: String,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
) -> CommandResult<SessionModelDto> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let provider_id = provider_id.trim().to_owned();
    let model_id = model_id.trim().to_owned();
    if provider_id.is_empty() || model_id.is_empty() {
        return Err(CommandError::new("provider_id and model_id required"));
    }
    let reasoning_effort = reasoning_effort
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    let service_tier = service_tier
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::SetSessionModel {
            session_id,
            provider_id,
            model_id,
            reasoning_effort,
            service_tier,
            provider_options: serde_json::Value::Null,
        })
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::SessionModel { selection, .. } => Ok(SessionModelDto {
            provider_id: selection.provider_id,
            model_id: selection.model_id,
            reasoning_effort: selection.reasoning_effort,
            service_tier: selection.service_tier,
        }),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected SetSessionModel response: {other:?}"
        ))),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionPackageDto {
    pub id: String,
    pub name: String,
    pub version: String,
    pub extension_api_version: u32,
    pub source: String,
    pub phase: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub compatible: bool,
}

#[allow(clippy::too_many_arguments)] // mirrors ExtensionPackageInfo fields without client re-export
fn map_extension_package(
    id: String,
    name: String,
    version: String,
    extension_api_version: u32,
    source: String,
    phase: String,
    capabilities: Vec<String>,
    permissions: Vec<String>,
    last_error: Option<String>,
    compatible: bool,
) -> ExtensionPackageDto {
    ExtensionPackageDto {
        id,
        name,
        version,
        extension_api_version,
        source,
        phase,
        capabilities,
        permissions,
        last_error,
        compatible,
    }
}

/// Daemon extension inventory (`ListExtensionPackages`) — no local manifest read.
#[tauri::command]
pub async fn list_extension_packages(
    state: State<'_, HarnessState>,
) -> CommandResult<Vec<ExtensionPackageDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::ListExtensionPackages)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackages { packages } => Ok(packages
            .into_iter()
            .map(|p| {
                map_extension_package(
                    p.id,
                    p.name,
                    p.version,
                    p.extension_api_version,
                    p.source,
                    p.phase,
                    p.capabilities,
                    p.permissions,
                    p.last_error,
                    p.compatible,
                )
            })
            .collect()),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected ListExtensionPackages response: {other:?}"
        ))),
    }
}

/// Detail for one package (`GetExtensionPackage`).
#[tauri::command]
pub async fn get_extension_package(
    state: State<'_, HarnessState>,
    id: String,
) -> CommandResult<ExtensionPackageDto> {
    let id = id.trim().to_owned();
    if id.is_empty() {
        return Err(CommandError::new("id must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::GetExtensionPackage { id })
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackage { package: p } => Ok(map_extension_package(
            p.id,
            p.name,
            p.version,
            p.extension_api_version,
            p.source,
            p.phase,
            p.capabilities,
            p.permissions,
            p.last_error,
            p.compatible,
        )),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected GetExtensionPackage response: {other:?}"
        ))),
    }
}

/// Enable package (`EnableExtensionPackage`).
#[tauri::command]
pub async fn enable_extension_package(
    state: State<'_, HarnessState>,
    id: String,
) -> CommandResult<ExtensionPackageDto> {
    let id = id.trim().to_owned();
    if id.is_empty() {
        return Err(CommandError::new("id must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::EnableExtensionPackage { id })
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackage { package: p } => Ok(map_extension_package(
            p.id,
            p.name,
            p.version,
            p.extension_api_version,
            p.source,
            p.phase,
            p.capabilities,
            p.permissions,
            p.last_error,
            p.compatible,
        )),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected EnableExtensionPackage response: {other:?}"
        ))),
    }
}

/// Disable package (`DisableExtensionPackage`).
#[tauri::command]
pub async fn disable_extension_package(
    state: State<'_, HarnessState>,
    id: String,
) -> CommandResult<ExtensionPackageDto> {
    let id = id.trim().to_owned();
    if id.is_empty() {
        return Err(CommandError::new("id must not be empty"));
    }
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::DisableExtensionPackage { id })
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackage { package: p } => Ok(map_extension_package(
            p.id,
            p.name,
            p.version,
            p.extension_api_version,
            p.source,
            p.phase,
            p.capabilities,
            p.permissions,
            p.last_error,
            p.compatible,
        )),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected DisableExtensionPackage response: {other:?}"
        ))),
    }
}

/// Reload packages from disk (`ReloadExtensionPackages`) then list.
#[tauri::command]
pub async fn reload_extension_packages(
    state: State<'_, HarnessState>,
) -> CommandResult<Vec<ExtensionPackageDto>> {
    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    match client
        .request(IpcRequest::ReloadExtensionPackages)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackagesReloaded { .. } => {}
        IpcResponse::Error { message, .. } => return Err(CommandError::new(message)),
        other => {
            return Err(CommandError::new(format!(
                "unexpected ReloadExtensionPackages response: {other:?}"
            )));
        }
    }
    match client
        .request(IpcRequest::ListExtensionPackages)
        .await
        .map_err(|err| CommandError::new(err.to_string()))?
    {
        IpcResponse::ExtensionPackages { packages } => Ok(packages
            .into_iter()
            .map(|p| {
                map_extension_package(
                    p.id,
                    p.name,
                    p.version,
                    p.extension_api_version,
                    p.source,
                    p.phase,
                    p.capabilities,
                    p.permissions,
                    p.last_error,
                    p.compatible,
                )
            })
            .collect()),
        IpcResponse::Error { message, .. } => Err(CommandError::new(message)),
        other => Err(CommandError::new(format!(
            "unexpected ListExtensionPackages after reload: {other:?}"
        ))),
    }
}

/// Classify dropped filesystem paths (dir vs file) for chat drag-and-drop.
#[tauri::command]
pub async fn classify_paths(paths: Vec<String>) -> CommandResult<Vec<DroppedPathInfo>> {
    Ok(paths
        .into_iter()
        .map(|path| {
            let pb = PathBuf::from(&path);
            DroppedPathInfo {
                path,
                is_dir: pb.is_dir(),
            }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct DroppedPathInfo {
    pub path: String,
    pub is_dir: bool,
}

/// Native multi-file picker — attaches real FS paths (unlike HTML file input names).
#[tauri::command]
pub async fn pick_files() -> CommandResult<Vec<String>> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Attach files")
        .pick_files()
        .await;
    Ok(files
        .map(|handles| {
            handles
                .into_iter()
                .map(|h| h.path().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default())
}

/// Native folder picker — no manual path typing for workspace.
#[tauri::command]
pub async fn pick_folder() -> CommandResult<Option<String>> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Choose project folder")
        .pick_folder()
        .await;
    Ok(folder.map(|handle| handle.path().to_string_lossy().into_owned()))
}

/// Persist a pasted clipboard image so send can mention a real path.
#[tauri::command]
pub async fn save_temp_image(bytes: Vec<u8>, ext: String) -> CommandResult<String> {
    if bytes.is_empty() {
        return Err(CommandError::new("empty image"));
    }
    // ponytail: ceiling — 25MB paste; upgrade to streaming upload when harness has attach IPC.
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(CommandError::new("image too large (max 25MB)"));
    }
    let ext = normalize_image_ext(&ext)?;
    let name = format!("impetus-paste-{}.{}", Uuid::new_v4(), ext);
    let path = std::env::temp_dir().join(name);
    std::fs::write(&path, &bytes).map_err(|e| CommandError::new(e.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// True when `path` resolves under `root` (both canonicalized).
fn path_is_under(path: &Path, root: &Path) -> bool {
    match (path.canonicalize(), root.canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r),
        _ => false,
    }
}

/// Local FS jail for image thumbs + path-based upload: temp always; optional workspace.
fn path_allowed_for_local_read(path: &Path, workspace_root: Option<&Path>) -> bool {
    if path_is_under(path, &std::env::temp_dir()) {
        return true;
    }
    if let Some(ws) = workspace_root {
        if !ws.as_os_str().is_empty() && path_is_under(path, ws) {
            return true;
        }
    }
    false
}

/// Image reads jail: temp dir always; optional workspace root when provided.
fn path_allowed_for_image_read(path: &Path, workspace_root: Option<&Path>) -> bool {
    path_allowed_for_local_read(path, workspace_root)
}

/// Read image bytes for composer thumbnail (avoids asset-protocol scope issues).
/// Optional `workspace_root`: when `None`, only paths under `temp_dir()` are allowed.
#[tauri::command]
pub async fn read_image_bytes(
    path: String,
    workspace_root: Option<String>,
) -> CommandResult<Vec<u8>> {
    let pb = PathBuf::from(path.trim());
    let ext = pb
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| CommandError::new("not an image path"))?;
    normalize_image_ext(ext)?;
    let ws = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if !path_allowed_for_image_read(pb.as_path(), ws.as_deref()) {
        return Err(CommandError::new("image path outside temp dir / workspace"));
    }
    let meta = std::fs::metadata(&pb).map_err(|e| CommandError::new(e.to_string()))?;
    if meta.len() > 25 * 1024 * 1024 {
        return Err(CommandError::new("image too large (max 25MB)"));
    }
    std::fs::read(&pb).map_err(|e| CommandError::new(e.to_string()))
}

fn normalize_image_ext(ext: &str) -> CommandResult<String> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    // Align with JS `IMAGE_EXT` / `toPreviewableImage` (HEIC via createImageBitmap).
    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(CommandError::new("unsupported image type"));
    }
    Ok(ext)
}

fn file_url_to_path(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    let path = if let Some(p) = rest.strip_prefix("localhost") {
        p
    } else {
        rest
    };
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

/// Allowlist for `open_external`: https + macOS prefs; `file://` only when
/// `allow_file` and path under temp or optional workspace.
fn open_external_url_allowed(url: &str, allow_file: bool, workspace_root: Option<&Path>) -> bool {
    if url.starts_with("https://") || url.starts_with("x-apple.systempreferences:") {
        return true;
    }
    if allow_file && url.starts_with("file://") {
        if let Some(path) = file_url_to_path(url) {
            if path_is_under(&path, &std::env::temp_dir()) {
                return true;
            }
            if let Some(ws) = workspace_root {
                if !ws.as_os_str().is_empty() && path_is_under(&path, ws) {
                    return true;
                }
            }
        }
    }
    false
}

/// Open a URL / prefs pane only after explicit user click. Never auto-prompt TCC.
/// `allow_file` defaults false — FE that only passes `url` stays safe.
#[tauri::command]
pub async fn open_external(
    url: String,
    allow_file: Option<bool>,
    workspace_root: Option<String>,
) -> CommandResult<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(CommandError::new("url must not be empty"));
    }
    let allow_file = allow_file.unwrap_or(false);
    let ws = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if !open_external_url_allowed(url, allow_file, ws.as_deref()) {
        return Err(CommandError::new(
            "refusing to open URL (allowed: https, x-apple.systempreferences; file only with allow_file under temp/workspace)",
        ));
    }
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|err| CommandError::new(format!("open failed: {err}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_runtime_delegates_lifecycle_to_daemon_control() {
        let src = include_str!("harness.rs");
        let prod_end = src.find("\n#[cfg(test)]").unwrap_or(src.len());
        let prod = &src[..prod_end];
        assert!(
            prod.contains("ensure_daemon_running_with"),
            "Desktop must call shared ensure_daemon_running_with"
        );
        assert!(
            prod.contains("DaemonOptions::new"),
            "Desktop must build DaemonOptions"
        );
        assert!(
            !prod.contains("libc::flock") && !prod.contains("OpenOptions::new()"),
            "Desktop must not duplicate flock / spawn.lock create"
        );
        assert!(
            !prod.contains("create_new(true)"),
            "Desktop must not create daemon.spawn.lock itself"
        );
    }

    #[test]
    fn default_socket_env_stable_vs_smoke() {
        // ponytail: env mutate is process-global — keep cases in one test
        // so parallel lib tests cannot race IMPETUS_SOCKET / IMPETUS_DATA_DIR.
        let previous_socket = std::env::var("IMPETUS_SOCKET").ok();
        let previous_data = std::env::var("IMPETUS_DATA_DIR").ok();
        unsafe {
            std::env::remove_var("IMPETUS_DATA_DIR");
            std::env::set_var("IMPETUS_SOCKET", "/tmp/stable-harness.sock");
        }
        assert_eq!(default_socket_path(), "/tmp/stable-harness.sock");
        unsafe {
            std::env::set_var("IMPETUS_SOCKET", "/tmp/impetus-cr-0LbE/harness.sock");
        }
        let got = default_socket_path();
        assert!(
            got.ends_with("Library/Application Support/Impetus/harness.sock"),
            "smoke IMPETUS_SOCKET must fall back to app-support, got {got}"
        );
        unsafe {
            std::env::remove_var("IMPETUS_SOCKET");
            std::env::set_var("IMPETUS_DATA_DIR", "/tmp/impetus-data-dir-test");
        }
        assert_eq!(
            default_socket_path(),
            "/tmp/impetus-data-dir-test/harness.sock",
            "IMPETUS_DATA_DIR must match Core discover_socket_path"
        );
        match previous_socket {
            Some(value) => unsafe {
                std::env::set_var("IMPETUS_SOCKET", value);
            },
            None => unsafe {
                std::env::remove_var("IMPETUS_SOCKET");
            },
        }
        match previous_data {
            Some(value) => unsafe {
                std::env::set_var("IMPETUS_DATA_DIR", value);
            },
            None => unsafe {
                std::env::remove_var("IMPETUS_DATA_DIR");
            },
        }
    }

    #[test]
    fn ephemeral_smoke_socket_detect() {
        assert!(is_ephemeral_smoke_socket(
            "/tmp/impetus-cr-0LbE/harness.sock"
        ));
        assert!(!is_ephemeral_smoke_socket("/tmp/stable-harness.sock"));
    }

    #[test]
    fn parse_uuid_rejects_empty() {
        assert!(parse_uuid("  ", "session_id").is_err());
    }

    #[test]
    fn read_upload_file_rejects_empty_path() {
        assert!(read_upload_file("", None).is_err());
        assert!(read_upload_file("   ", None).is_err());
    }

    #[test]
    fn protocol_incompatible_error_detected() {
        assert!(is_protocol_incompatible_error(
            "harness protocol incompatible: client=13 supported=12 (upgrade)"
        ));
        assert!(!is_protocol_incompatible_error(
            "socket present but connect failed: Connection refused"
        ));
    }

    #[test]
    fn parse_artifact_dto_rejects_empty_id() {
        assert!(parse_artifact_dto(ArtifactRefDto {
            id: "  ".into(),
            byte_count: 1,
        })
        .is_err());
    }

    #[test]
    fn branch_display_name_detached_is_head() {
        assert_eq!(branch_display_name(None, true), "HEAD");
        assert_eq!(branch_display_name(Some(&"main".into()), false), "main");
    }

    #[test]
    fn mcp_transport_hint_formats() {
        assert_eq!(
            mcp_transport_hint(Some(McpTransport::Stdio), true),
            "stdio:connected"
        );
        assert_eq!(mcp_transport_hint(None, false), "unknown");
    }

    #[test]
    fn parse_execution_mode_accepts_wire_values() {
        assert!(matches!(
            parse_execution_mode("ask"),
            Ok(ExecutionMode::Ask)
        ));
        assert!(matches!(
            parse_execution_mode("plan"),
            Ok(ExecutionMode::Plan)
        ));
        assert!(matches!(
            parse_execution_mode("ACCEPT_EDITS"),
            Ok(ExecutionMode::AcceptEdits)
        ));
        assert!(matches!(
            parse_execution_mode(" auto "),
            Ok(ExecutionMode::Auto)
        ));
        assert!(matches!(
            parse_execution_mode("bypass"),
            Ok(ExecutionMode::Bypass)
        ));
        assert!(parse_execution_mode("nope").is_err());
        assert!(parse_execution_mode("").is_err());
    }

    #[test]
    fn parse_prompt_intent_defaults_and_aliases() {
        assert!(matches!(
            parse_prompt_intent(None),
            Ok(UserPromptIntent::Prompt)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("")),
            Ok(UserPromptIntent::Prompt)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("prompt")),
            Ok(UserPromptIntent::Prompt)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("steer")),
            Ok(UserPromptIntent::Steer)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("follow-up")),
            Ok(UserPromptIntent::FollowUp)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("follow_up")),
            Ok(UserPromptIntent::FollowUp)
        ));
        assert!(matches!(
            parse_prompt_intent(Some("followup")),
            Ok(UserPromptIntent::FollowUp)
        ));
        assert!(parse_prompt_intent(Some("yolo")).is_err());
    }

    #[test]
    fn normalize_image_ext_allows_heic_and_common() {
        assert_eq!(normalize_image_ext("PNG").unwrap(), "png");
        assert_eq!(normalize_image_ext("jpg").unwrap(), "jpg");
        assert_eq!(normalize_image_ext("JPEG").unwrap(), "jpeg");
        assert_eq!(normalize_image_ext("gif").unwrap(), "gif");
        assert_eq!(normalize_image_ext("webp").unwrap(), "webp");
        assert_eq!(normalize_image_ext("bmp").unwrap(), "bmp");
        assert_eq!(normalize_image_ext(".heic").unwrap(), "heic");
        assert_eq!(normalize_image_ext(" HEIC ").unwrap(), "heic");
        assert_eq!(normalize_image_ext("heif").unwrap(), "heif");
        assert!(normalize_image_ext("tiff").is_err());
        assert!(normalize_image_ext("exe").is_err());
        assert!(normalize_image_ext("").is_err());
    }

    #[test]
    fn open_external_url_allowed_https_ok_rejects_schemes() {
        assert!(open_external_url_allowed(
            "https://example.com",
            false,
            None
        ));
        assert!(open_external_url_allowed(
            "https://example.com/path?q=1#frag",
            false,
            None
        ));
        assert!(!open_external_url_allowed(
            "http://example.com",
            false,
            None
        ));
        assert!(!open_external_url_allowed(
            "javascript:alert(1)",
            false,
            None
        ));
        assert!(!open_external_url_allowed(
            "javascript:alert(1)",
            true,
            None
        ));
        assert!(!open_external_url_allowed("data:text/html,hi", false, None));
        assert!(!open_external_url_allowed("ftp://example.com", false, None));
        assert!(!open_external_url_allowed("about:blank", false, None));
        assert!(open_external_url_allowed(
            "x-apple.systempreferences:com.apple.preference.security",
            false,
            None
        ));
    }

    #[test]
    fn open_external_url_allowed_file_needs_allow_and_jail() {
        assert!(!open_external_url_allowed(
            "file:///etc/passwd",
            false,
            None
        ));
        assert!(!open_external_url_allowed("file:///etc/passwd", true, None));

        let temp = std::env::temp_dir();
        let temp_file = temp.join("impetus-open-external-test.txt");
        std::fs::write(&temp_file, b"x").expect("write temp file");
        let file_url = format!("file://{}", temp_file.display());
        assert!(!open_external_url_allowed(&file_url, false, None));
        assert!(open_external_url_allowed(&file_url, true, None));
        let _ = std::fs::remove_file(&temp_file);

        // Workspace must sit outside temp_dir — temp is always allowed when allow_file.
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/harness-open-external");
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).expect("mkdir ws");
        let inside = ws.join("doc.txt");
        std::fs::write(&inside, b"in").expect("write inside");
        let inside_url = format!("file://{}", inside.display());
        assert!(!open_external_url_allowed(&inside_url, false, Some(&ws)));
        assert!(open_external_url_allowed(&inside_url, true, Some(&ws)));
        assert!(!open_external_url_allowed(
            "file:///etc/passwd",
            true,
            Some(&ws)
        ));
        let other = base.join("other");
        std::fs::create_dir_all(&other).expect("mkdir other");
        let escape = other.join("escape.txt");
        std::fs::write(&escape, b"out").expect("write escape");
        let escape_url = format!("file://{}", escape.display());
        assert!(!open_external_url_allowed(&escape_url, true, Some(&ws)));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn path_is_under_jails_to_root() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/harness-path-is-under");
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("root");
        std::fs::create_dir_all(&root).expect("mkdir root");
        let inside = root.join("nested");
        std::fs::create_dir_all(&inside).expect("mkdir nested");
        let file = inside.join("a.txt");
        std::fs::write(&file, b"x").expect("write");

        assert!(path_is_under(&file, &root));
        assert!(path_is_under(&inside, &root));
        assert!(path_is_under(&root, &root));

        let sibling = base.join("sibling");
        std::fs::create_dir_all(&sibling).expect("mkdir sibling");
        let outside = sibling.join("b.txt");
        std::fs::write(&outside, b"y").expect("write outside");
        assert!(!path_is_under(&outside, &root));
        assert!(!path_is_under(Path::new("/etc/passwd"), &root));
        assert!(!path_is_under(Path::new("/no/such/path/ever"), &root));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn path_allowed_for_image_read_temp_or_workspace() {
        let temp = std::env::temp_dir();
        let temp_img = temp.join("impetus-img-jail-test.png");
        std::fs::write(&temp_img, b"png").expect("write temp img");
        assert!(path_allowed_for_image_read(&temp_img, None));
        assert!(path_allowed_for_image_read(&temp_img, Some(Path::new(""))));

        // Outside temp: only allowed when workspace_root covers the path.
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/harness-img-jail");
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).expect("mkdir ws");
        let ws_img = ws.join("shot.heic");
        std::fs::write(&ws_img, b"heic").expect("write ws img");
        assert!(!path_allowed_for_image_read(&ws_img, None));
        assert!(path_allowed_for_image_read(&ws_img, Some(&ws)));

        let other = base.join("other");
        std::fs::create_dir_all(&other).expect("mkdir other");
        let escape = other.join("leak.png");
        std::fs::write(&escape, b"x").expect("write escape");
        assert!(!path_allowed_for_image_read(&escape, Some(&ws)));

        let _ = std::fs::remove_file(&temp_img);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_branch_name_rejects_leading_dash() {
        assert!(validate_branch_name("-rf").is_err());
        assert!(validate_branch_name("--force").is_err());
        assert!(validate_branch_name("").is_err());
        assert!(validate_branch_name("   ").is_err());
        assert_eq!(validate_branch_name(" feature/x ").unwrap(), "feature/x");
        assert_eq!(validate_branch_name("main").unwrap(), "main");
        assert_eq!(
            validate_branch_name("feat/issue-42").unwrap(),
            "feat/issue-42"
        );
    }
}
