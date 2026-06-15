use tauri::{Manager, Runtime};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};

pub fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main").unwrap();
    
    TrayIconBuilder::with_app(app)
        .icon(app.default_window_icon().unwrap())
        .tooltip("Alloy — Arch Package Dropper")
        .menu(tauri::menu::Menu::os_default(&app))
        .on_event(move |tray: tauri::tray::TrayIcon, event: TrayIconEvent| {
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                    if let Some(win) = tray.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                TrayIconEvent::DoubleClick { .. } => {
                    if let Some(win) = tray.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                _ => {}
            }
        })
        .build()?;
    
    Ok(())
}
