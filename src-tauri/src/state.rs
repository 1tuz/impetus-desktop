use impetus_client::UnixSocketTransport;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Shared async harness connection. Client never owns SQLite / Keychain / policy.
pub struct HarnessState {
    pub client: Mutex<Option<UnixSocketTransport>>,
    pub socket_path: Mutex<String>,
    /// Active `subscribe_live` background task — aborted on session switch / disconnect.
    pub live_sub: Mutex<Option<JoinHandle<()>>>,
}

impl HarnessState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            socket_path: Mutex::new(String::new()),
            live_sub: Mutex::new(None),
        }
    }
}

impl Default for HarnessState {
    fn default() -> Self {
        Self::new()
    }
}
