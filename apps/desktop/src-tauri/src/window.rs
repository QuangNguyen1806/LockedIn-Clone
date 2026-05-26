use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, Runtime, WebviewWindow};

static CLICK_THROUGH_ENABLED: AtomicBool = AtomicBool::new(false);
static OVERLAY_MODE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_click_through(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    apply_click_through(&app, &window, enabled)
}

#[tauri::command]
pub fn set_overlay_mode(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    OVERLAY_MODE.store(enabled, Ordering::SeqCst);
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    window.set_decorations(!enabled).map_err(|e| e.to_string())?;
    window
        .set_size(if enabled {
            LogicalSize::new(440.0, 720.0)
        } else {
            LogicalSize::new(980.0, 720.0)
        })
        .map_err(|e| e.to_string())?;
    if !enabled {
        let app = window.app_handle();
        apply_click_through(app, &window, false)?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn apply_click_through(app: &AppHandle, window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())?;
    CLICK_THROUGH_ENABLED.store(enabled, Ordering::SeqCst);
    app.emit("click-through-changed", enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn disable_click_through(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    apply_click_through(app, &window, false)
}

pub fn toggle_click_through(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let enabled = CLICK_THROUGH_ENABLED.load(Ordering::SeqCst);
    apply_click_through(app, &window, !enabled)
}

pub fn configure_overlay<R: Runtime>(_window: &WebviewWindow<R>) {}
