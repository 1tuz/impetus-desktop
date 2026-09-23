use serde::Serialize;
use std::env;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct TerminalEnvDto {
    pub default_shell: String,
    pub shells: Vec<String>,
    pub home_dir: Option<String>,
}

/// Local OS probe for default shell / home — not daemon PTY logic.
#[tauri::command]
pub fn terminal_env() -> TerminalEnvDto {
    let default_shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut shells: Vec<String> = Vec::new();
    let candidates = [
        default_shell.as_str(),
        "/bin/zsh",
        "/bin/bash",
        "/bin/sh",
    ];
    for c in candidates {
        if Path::new(c).is_file() && !shells.iter().any(|s| s == c) {
            shells.push(c.to_string());
        }
    }
    if shells.is_empty() {
        shells.push("/bin/zsh".into());
    }
    let home_dir = env::var("HOME").ok().filter(|s| !s.is_empty());
    TerminalEnvDto {
        default_shell,
        shells,
        home_dir,
    }
}
