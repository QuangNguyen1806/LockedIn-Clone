mod window;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
fn shortcut_modifiers() -> Modifiers {
    Modifiers::SUPER | Modifiers::SHIFT
}

#[cfg(not(target_os = "macos"))]
fn shortcut_modifiers() -> Modifiers {
    Modifiers::CONTROL | Modifiers::SHIFT
}

fn register_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let toggle_click_through = Shortcut::new(Some(shortcut_modifiers()), Code::KeyL);
    let disable_click_through = Shortcut::new(Some(shortcut_modifiers()), Code::KeyI);
    let hide_window = Shortcut::new(Some(shortcut_modifiers()), Code::KeyW);
    let quit_app = Shortcut::new(Some(shortcut_modifiers()), Code::KeyQ);

    app.global_shortcut().on_shortcut(toggle_click_through, {
        let handle = handle.clone();
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = window::toggle_click_through(&handle);
            }
        }
    })?;

    app.global_shortcut().on_shortcut(disable_click_through, {
        let handle = handle.clone();
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = window::disable_click_through(&handle);
            }
        }
    })?;

    app.global_shortcut().on_shortcut(hide_window, {
        let handle = handle.clone();
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = window::hide_window(handle.clone());
            }
        }
    })?;

    app.global_shortcut().on_shortcut(quit_app, {
        let handle = handle.clone();
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                handle.exit(0);
            }
        }
    })?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            window::set_click_through,
            window::set_overlay_mode,
            window::hide_window,
            window::show_window,
            window::quit_app,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show LockedIn", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide LockedIn", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit LockedIn", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("tray icon missing");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("LockedIn Copilot")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = window::show_window(app.clone());
                    }
                    "hide" => {
                        let _ = window::hide_window(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            register_shortcuts(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
