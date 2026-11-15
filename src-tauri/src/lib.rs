//! Pit Wall Pomodoro: native shell.
//!
//! Almost all of the app lives in TypeScript. Rust only sets up the two
//! windows (the floating car pet and the Pit Wall panel), the plugins, and a
//! one-second heartbeat that keeps the timer honest even when the pet's
//! webview is being throttled by the system.

use std::{thread, time::Duration};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

const PET: &str = "pet";
const PANEL: &str = "panel";

/// Show the Pit Wall panel if it is hidden, hide it if it is showing.
#[tauri::command]
fn toggle_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        if panel.is_visible().unwrap_or(false) {
            let _ = panel.hide();
        } else {
            let _ = panel.show();
            let _ = panel.unminimize();
            let _ = panel.set_focus();
        }
    }
}

#[tauri::command]
fn show_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.show();
        let _ = panel.unminimize();
        let _ = panel.set_focus();
    }
}

/// Show or hide the floating car. The timer keeps running either way.
#[tauri::command]
fn set_pet_visible(app: AppHandle, visible: bool) {
    if let Some(pet) = app.get_webview_window(PET) {
        let _ = if visible { pet.show() } else { pet.hide() };
    }
}

#[tauri::command]
fn pet_visible(app: AppHandle) -> bool {
    app.get_webview_window(PET)
        .and_then(|pet| pet.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            toggle_panel,
            show_panel,
            set_pet_visible,
            pet_visible,
            quit_app
        ])
        .on_window_event(|window, event| {
            // Closing the Pit Wall only hides it. The timer lives in the pet
            // window, so it carries on; closing the pet itself quits the app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == PANEL {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(1));
                let _ = handle.emit_to(PET, "heartbeat", ());
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pit Wall Pomodoro");

    app.run(|_app, _event| {
        // Clicking the Dock icon brings a hidden car back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            if let Some(pet) = _app.get_webview_window(PET) {
                let _ = pet.show();
            }
        }
    });
}
