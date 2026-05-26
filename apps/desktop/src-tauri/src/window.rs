use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow};
use tauri_plugin_store::StoreExt;

static CLICK_THROUGH_ENABLED: AtomicBool = AtomicBool::new(false);

const STORE_PATH: &str = "overlay-settings.json";
const OVERLAY_LABEL: &str = "overlay";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlaySettings {
    pub x: f64,
    pub y: f64,
    pub corner: String,
    pub opacity: f64,
    pub visual_profile: String,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            x: 24.0,
            y: 24.0,
            corner: "top-right".to_string(),
            opacity: 0.45,
            visual_profile: "discrete".to_string(),
        }
    }
}

fn overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "overlay window not found".to_string())
}

fn load_settings(app: &AppHandle) -> Result<OverlaySettings, String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    if let Some(value) = store.get("settings") {
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())
    } else {
        Ok(OverlaySettings::default())
    }
}

fn save_settings(app: &AppHandle, settings: &OverlaySettings) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|e| e.to_string())?;
    store.set(
        "settings",
        serde_json::to_value(settings).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

fn apply_overlay_position(window: &WebviewWindow, settings: &OverlaySettings) -> Result<(), String> {
    window
        .set_position(LogicalPosition::new(settings.x, settings.y))
        .map_err(|e| e.to_string())
}

pub fn configure_overlay(window: &WebviewWindow) -> Result<(), String> {
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    let window = overlay_window(&app)?;
    let settings = load_settings(&app)?;
    apply_overlay_position(&window, &settings)?;
    configure_overlay(&window)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit("overlay-opacity-changed", settings.opacity)
        .map_err(|e| e.to_string())?;
    app.emit("overlay-profile-changed", settings.visual_profile)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Ok(window) = overlay_window(&app) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_overlay_opacity(app: AppHandle, opacity: f64) -> Result<(), String> {
    let clamped = opacity.clamp(0.2, 1.0);
    let mut settings = load_settings(&app)?;
    settings.opacity = clamped;
    save_settings(&app, &settings)?;
    app.emit("overlay-opacity-changed", clamped)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_overlay_clickthrough(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = overlay_window(&app)?;
    apply_click_through(&app, &window, enabled)
}

#[tauri::command]
pub fn set_overlay_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = overlay_window(&app)?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let mut settings = load_settings(&app)?;
    settings.x = x;
    settings.y = y;
    save_settings(&app, &settings)?;
    Ok(())
}

#[tauri::command]
pub fn get_overlay_bounds(app: AppHandle) -> Result<OverlayBounds, String> {
    let window = overlay_window(&app)?;
    let pos = window
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    Ok(OverlayBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

#[tauri::command]
pub fn snap_overlay(app: AppHandle, corner: String) -> Result<(), String> {
    let window = overlay_window(&app)?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "monitor not found".to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let screen = monitor.size().to_logical::<f64>(scale);
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);

    let margin = 16.0;
    let (x, y) = match corner.as_str() {
        "top-left" => (pos.x + margin, pos.y + margin),
        "bottom-left" => (pos.x + margin, pos.y + screen.height - size.height - margin),
        "bottom-right" => (
            pos.x + screen.width - size.width - margin,
            pos.y + screen.height - size.height - margin,
        ),
        _ => (
            pos.x + screen.width - size.width - margin,
            pos.y + margin,
        ),
    };

    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let mut settings = load_settings(&app)?;
    settings.x = x;
    settings.y = y;
    settings.corner = corner;
    save_settings(&app, &settings)?;
    Ok(())
}

#[tauri::command]
pub fn set_overlay_visual_profile(app: AppHandle, profile: String) -> Result<(), String> {
    let mut settings = load_settings(&app)?;
    settings.visual_profile = profile.clone();
    save_settings(&app, &settings)?;
    app.emit("overlay-profile-changed", profile)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_overlay_settings(app: AppHandle) -> Result<OverlaySettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    apply_click_through(&app, &window, enabled)
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
pub fn hide_all_windows(app: AppHandle) -> Result<(), String> {
    hide_window(app.clone())?;
    hide_overlay(app)?;
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
    let window = overlay_window(app).or_else(|_| {
        app.get_webview_window("main")
            .ok_or_else(|| "window not found".to_string())
    })?;
    apply_click_through(app, &window, false)
}

pub fn toggle_click_through(app: &AppHandle) -> Result<(), String> {
    let window = overlay_window(app).or_else(|_| {
        app.get_webview_window("main")
            .ok_or_else(|| "window not found".to_string())
    })?;
    let enabled = CLICK_THROUGH_ENABLED.load(Ordering::SeqCst);
    apply_click_through(app, &window, !enabled)
}

pub fn restore_overlay_on_startup(app: &AppHandle) -> Result<(), String> {
    if let Ok(window) = overlay_window(app) {
        let settings = load_settings(app)?;
        apply_overlay_position(&window, &settings)?;
        configure_overlay(&window)?;
    }
    Ok(())
}
