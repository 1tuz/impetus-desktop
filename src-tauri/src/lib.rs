mod commands;
mod error;
mod state;

use state::HarnessState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must register first so a second launch focuses the existing window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(HarnessState::new())
        .invoke_handler(tauri::generate_handler![
            commands::harness_hello,
            commands::list_sessions,
            commands::create_session,
            commands::send_prompt,
            commands::cancel_session,
            commands::resolve_approval,
            commands::get_approval_detail,
            commands::set_execution_mode,
            commands::get_execution_mode,
            commands::subscribe_session_events,
            commands::unsubscribe_session_events,
            commands::get_status,
            commands::disconnect,
            commands::probe_daemon,
            commands::start_daemon,
            commands::git_current_branch,
            commands::git_list_branches,
            commands::git_checkout_branch,
            commands::list_mcp_servers,
            commands::pick_folder,
            commands::pick_files,
            commands::classify_paths,
            commands::save_temp_image,
            commands::read_image_bytes,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
