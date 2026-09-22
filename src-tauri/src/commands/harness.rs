use crate::error::{CommandError, CommandResult};
use crate::state::HarnessState;
use impetus_client::protocol::{Event, ExecutionMode, IpcRequest, IpcResponse, UserPromptIntent};
use impetus_client::{HarnessClient, UnixSocketTransport};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

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
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    format!("{home}/Library/Application Support/Impetus/harness.sock")
}

/// Smoke / CI often leaves `IMPETUS_SOCKET=/tmp/impetus-…`. That path fools the
/// GUI: sock file exists, nothing listens, Start spawns into a dead endpoint.
fn is_ephemeral_smoke_socket(path: &str) -> bool {
    let p = path.trim();
    p.starts_with("/tmp/impetus-")
        || (p.starts_with("/var/folders/") && p.contains("impetus"))
}

fn default_socket_path() -> String {
    if let Ok(path) = std::env::var("IMPETUS_SOCKET") {
        let trimmed = path.trim();
        if !trimmed.is_empty() && !is_ephemeral_smoke_socket(trimmed) {
            return trimmed.to_owned();
        }
    }
    default_app_support_socket()
}

/// Drop a sock inode that exists but accepts no connect — blocks bind + probe.
fn remove_stale_socket(socket_path: &str) {
    let path = PathBuf::from(socket_path);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
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
            client_version,
            upgrade_recommendation,
        } => {
            return Err(CommandError::new(format!(
                "IPC incompatible: client={client_version}, daemon={supported_version}. {}",
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
pub async fn send_prompt(
    state: State<'_, HarnessState>,
    session_id: String,
    text: String,
    intent: Option<String>,
) -> CommandResult<String> {
    let session_id = parse_uuid(&session_id, "session_id")?;
    let text = text.trim();
    if text.is_empty() {
        return Err(CommandError::new("prompt text must not be empty"));
    }
    let intent = parse_prompt_intent(intent.as_deref())?;

    let guard = state.client.lock().await;
    let client = require_client(&guard)?;
    let status = client
        .send_message_with_intent(session_id, text.to_owned(), None, intent)
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
}

/// Local socket probe only — no Accessibility, no Full Disk, no TCC prompts.
async fn probe_daemon_inner() -> DaemonProbe {
    let socket_path = default_socket_path();
    let path = PathBuf::from(&socket_path);
    let socket_exists = path.exists();
    if !socket_exists {
        return DaemonProbe {
            socket_path,
            socket_exists: false,
            reachable: false,
            detail: "socket missing — start impetusd (or: impetus ui / task daemon)".into(),
        };
    }

    match UnixSocketTransport::connect(&socket_path).await {
        Ok(_) => DaemonProbe {
            socket_path,
            socket_exists: true,
            reachable: true,
            detail: "daemon reachable".into(),
        },
        Err(err) => DaemonProbe {
            socket_path,
            socket_exists: true,
            reachable: false,
            detail: format!("socket present but connect failed: {err}"),
        },
    }
}

#[tauri::command]
pub async fn probe_daemon() -> CommandResult<DaemonProbe> {
    Ok(probe_daemon_inner().await)
}

fn resolve_impetusd_bin() -> CommandResult<PathBuf> {
    if let Ok(path) = std::env::var("IMPETUSD_BIN") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let pb = PathBuf::from(trimmed);
            if pb.is_file() {
                return Ok(pb);
            }
            return Err(CommandError::new(format!(
                "IMPETUSD_BIN is set but not a file: {trimmed}"
            )));
        }
    }

    // CARGO_MANIFEST_DIR = src-tauri; sibling layout matches impetus-client path-dep.
    let sibling_root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../impetus/target");
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

/// Spawn detached `impetusd` (mock provider, no TCC/Keychain), then poll socket ~5s.
#[tauri::command]
pub async fn start_daemon() -> CommandResult<DaemonProbe> {
    let existing = probe_daemon_inner().await;
    if existing.reachable {
        return Ok(DaemonProbe {
            detail: "daemon already reachable".into(),
            ..existing
        });
    }

    let socket_path = existing.socket_path.clone();
    // Stale inode: file present, nothing listens → child cannot bind, probe lies.
    if existing.socket_exists {
        remove_stale_socket(&socket_path);
    }

    let bin = resolve_impetusd_bin()?;
    // Child must listen where we probe — ignore inherited smoke IMPETUS_* .
    Command::new(&bin)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("IMPETUS_SOCKET", &socket_path)
        .env_remove("IMPETUS_DATA_DIR")
        .spawn()
        .map_err(|err| CommandError::new(format!("failed to spawn {}: {err}", bin.display())))?;

    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let probe = probe_daemon_inner().await;
        if probe.reachable {
            return Ok(DaemonProbe {
                detail: format!("started {} — daemon reachable", bin.display()),
                ..probe
            });
        }
    }

    let probe = probe_daemon_inner().await;
    Ok(DaemonProbe {
        detail: format!(
            "spawned {} but socket not ready yet: {}",
            bin.display(),
            probe.detail
        ),
        ..probe
    })
}

fn require_git_root(workspace_root: &str) -> CommandResult<PathBuf> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new("workspace_root must not be empty"));
    }
    let root = PathBuf::from(trimmed);
    if !root.is_dir() {
        return Err(CommandError::new(format!(
            "workspace_root is not a directory: {}",
            root.display()
        )));
    }
    let git_dir = root.join(".git");
    if !git_dir.exists() {
        return Err(CommandError::new(format!(
            "not a git repository: {}",
            root.display()
        )));
    }
    Ok(root)
}

fn git_output(root: &Path, args: &[&str]) -> CommandResult<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|err| CommandError::new(format!("git failed to start: {err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(CommandError::new(if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[tauri::command]
pub async fn git_current_branch(workspace_root: String) -> CommandResult<String> {
    let root = require_git_root(&workspace_root)?;
    git_output(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
}

#[tauri::command]
pub async fn git_list_branches(workspace_root: String) -> CommandResult<Vec<String>> {
    let root = require_git_root(&workspace_root)?;
    let raw = git_output(&root, &["branch", "--format=%(refname:short)"])?;
    Ok(raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

#[tauri::command]
pub async fn git_checkout_branch(workspace_root: String, branch: String) -> CommandResult<String> {
    let root = require_git_root(&workspace_root)?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(CommandError::new("branch must not be empty"));
    }
    // Block option-flag injection; allow normal names like feature/foo.
    if branch.starts_with('-') {
        return Err(CommandError::new("invalid branch name"));
    }
    git_output(&root, &["checkout", branch])?;
    Ok(branch.to_owned())
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerDto {
    pub id: String,
    pub transport_hint: String,
}

/// Honest desktop MCP surface: read local Codex/desktop config — no daemon ListMcp IPC.
fn parse_mcp_servers_toml(text: &str) -> Vec<McpServerDto> {
    let mut servers: Vec<McpServerDto> = Vec::new();
    let mut current_id: Option<String> = None;
    let mut current_hint = String::from("unknown");

    fn flush(servers: &mut Vec<McpServerDto>, id: &mut Option<String>, hint: &mut String) {
        if let Some(prev) = id.take() {
            if !servers.iter().any(|s| s.id == prev) {
                servers.push(McpServerDto {
                    id: prev,
                    transport_hint: std::mem::replace(hint, "unknown".into()),
                });
            } else {
                *hint = "unknown".into();
            }
        }
    }

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('[') {
            if let Some(header) = rest.strip_suffix(']') {
                if let Some(name) = header.strip_prefix("mcp_servers.") {
                    let id = name.split('.').next().unwrap_or(name).trim();
                    if id.is_empty() {
                        continue;
                    }
                    if current_id.as_deref() != Some(id) {
                        flush(&mut servers, &mut current_id, &mut current_hint);
                        if !servers.iter().any(|s| s.id == id) {
                            current_id = Some(id.to_owned());
                            current_hint = "unknown".into();
                        }
                    }
                    continue;
                }
            }
            flush(&mut servers, &mut current_id, &mut current_hint);
            continue;
        }

        if current_id.is_none() {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if key == "command" && current_hint == "unknown" {
                current_hint = format!("stdio:{value}");
            } else if key == "url" {
                current_hint = format!("http:{value}");
            } else if key == "transport" && current_hint == "unknown" {
                current_hint = value.to_owned();
            }
        }
    }

    flush(&mut servers, &mut current_id, &mut current_hint);
    servers
}

fn mcp_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(extra) = std::env::var("IMPETUS_MCP_CONFIG") {
        let trimmed = extra.trim();
        if !trimmed.is_empty() {
            paths.push(PathBuf::from(trimmed));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(home).join(".codex/config.toml"));
    }
    paths
}

#[tauri::command]
pub async fn list_mcp_servers() -> CommandResult<Vec<McpServerDto>> {
    let mut by_id: Vec<McpServerDto> = Vec::new();
    for path in mcp_config_paths() {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for server in parse_mcp_servers_toml(&text) {
            if !by_id.iter().any(|s| s.id == server.id) {
                by_id.push(server);
            }
        }
    }
    Ok(by_id)
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

/// Read image bytes for composer thumbnail (avoids asset-protocol scope issues).
#[tauri::command]
pub async fn read_image_bytes(path: String) -> CommandResult<Vec<u8>> {
    let pb = PathBuf::from(path.trim());
    let ext = pb
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| CommandError::new("not an image path"))?;
    normalize_image_ext(ext)?;
    let meta = std::fs::metadata(&pb).map_err(|e| CommandError::new(e.to_string()))?;
    if meta.len() > 25 * 1024 * 1024 {
        return Err(CommandError::new("image too large (max 25MB)"));
    }
    std::fs::read(&pb).map_err(|e| CommandError::new(e.to_string()))
}

fn normalize_image_ext(ext: &str) -> CommandResult<String> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    const ALLOWED: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(CommandError::new("unsupported image type"));
    }
    Ok(ext)
}

/// Open a URL / prefs pane only after explicit user click. Never auto-prompt TCC.
#[tauri::command]
pub async fn open_external(url: String) -> CommandResult<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(CommandError::new("url must not be empty"));
    }
    // Allow only http(s) and macOS prefs / file schemes for setup "later" links.
    let ok = url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("x-apple.systempreferences:")
        || url.starts_with("file://");
    if !ok {
        return Err(CommandError::new(
            "refusing to open URL (allowed: http(s), x-apple.systempreferences, file)",
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
    fn default_socket_respects_stable_env() {
        // ponytail: env mutate is process-global; fine for one unit smoke
        let previous = std::env::var("IMPETUS_SOCKET").ok();
        // SAFETY: single-threaded test; restore env after assertion
        unsafe {
            std::env::set_var("IMPETUS_SOCKET", "/tmp/stable-harness.sock");
        }
        assert_eq!(default_socket_path(), "/tmp/stable-harness.sock");
        match previous {
            Some(value) => unsafe {
                std::env::set_var("IMPETUS_SOCKET", value);
            },
            None => unsafe {
                std::env::remove_var("IMPETUS_SOCKET");
            },
        }
    }

    #[test]
    fn default_socket_ignores_smoke_tmp_env() {
        let previous = std::env::var("IMPETUS_SOCKET").ok();
        unsafe {
            std::env::set_var("IMPETUS_SOCKET", "/tmp/impetus-cr-0LbE/harness.sock");
        }
        let got = default_socket_path();
        assert!(
            got.ends_with("Library/Application Support/Impetus/harness.sock"),
            "smoke IMPETUS_SOCKET must fall back to app-support, got {got}"
        );
        match previous {
            Some(value) => unsafe {
                std::env::set_var("IMPETUS_SOCKET", value);
            },
            None => unsafe {
                std::env::remove_var("IMPETUS_SOCKET");
            },
        }
    }

    #[test]
    fn ephemeral_smoke_socket_detect() {
        assert!(is_ephemeral_smoke_socket("/tmp/impetus-cr-0LbE/harness.sock"));
        assert!(!is_ephemeral_smoke_socket("/tmp/stable-harness.sock"));
    }

    #[test]
    fn parse_uuid_rejects_empty() {
        assert!(parse_uuid("  ", "session_id").is_err());
    }

    #[test]
    fn parse_mcp_servers_headers() {
        let text = r#"
[mcp_servers.context7]
command = "npx"

[mcp_servers.docs]
url = "https://example.com/mcp"

[other]
x = 1
"#;
        let servers = parse_mcp_servers_toml(text);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].id, "context7");
        assert!(servers[0].transport_hint.starts_with("stdio:"));
        assert_eq!(servers[1].id, "docs");
        assert!(servers[1].transport_hint.starts_with("http:"));
    }
}
