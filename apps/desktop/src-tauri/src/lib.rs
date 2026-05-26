mod window;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
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

#[cfg(target_os = "macos")]
fn quit_modifiers() -> Modifiers {
    Modifiers::SUPER
}

#[cfg(not(target_os = "macos"))]
fn quit_modifiers() -> Modifiers {
    Modifiers::CONTROL
}

fn register_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let toggle_click_through = Shortcut::new(Some(shortcut_modifiers()), Code::KeyL);
    let disable_click_through = Shortcut::new(Some(shortcut_modifiers()), Code::KeyI);
    let hide_window = Shortcut::new(Some(shortcut_modifiers()), Code::KeyW);
    let mark_question = Shortcut::new(Some(shortcut_modifiers()), Code::KeyM);
    let quit_app = Shortcut::new(Some(quit_modifiers()), Code::KeyQ);

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
                let _ = window::hide_all_windows(handle.clone());
            }
        }
    })?;

    app.global_shortcut().on_shortcut(mark_question, {
        let handle = handle.clone();
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = handle.emit("coach/mark-question", ());
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            window::show_overlay,
            window::hide_overlay,
            window::set_overlay_opacity,
            window::set_overlay_clickthrough,
            window::set_overlay_position,
            window::get_overlay_bounds,
            window::snap_overlay,
            window::set_overlay_visual_profile,
            window::get_overlay_settings,
            window::set_click_through,
            window::hide_window,
            window::show_window,
            window::hide_all_windows,
            window::quit_app,
        ])
        .setup(|app| {
            let show_app = MenuItem::with_id(app, "show_app", "Show App", true, None::<&str>)?;
            let show_overlay =
                MenuItem::with_id(app, "show_overlay", "Show Overlay", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide All", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit LockedIn", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_app, &show_overlay, &hide_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("tray icon missing");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("LockedIn Copilot")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_app" => {
                        let _ = window::show_window(app.clone());
                    }
                    "show_overlay" => {
                        let _ = window::show_overlay(app.clone());
                    }
                    "hide" => {
                        let _ = window::hide_all_windows(app.clone());
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
                                let _ = window::hide_all_windows(app.clone());
                            } else {
                                let _ = window::show_window(app.clone());
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

            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = window::configure_overlay(&overlay);
                overlay.on_window_event(|event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                });
            }

            let _ = window::restore_overlay_on_startup(app.handle());
            register_shortcuts(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
