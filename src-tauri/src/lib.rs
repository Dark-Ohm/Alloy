mod commands;
mod fish;
mod models;
mod services;

use tauri::{Manager, Emitter, menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton}};

pub fn run() {
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    // Install polkit policy for fish if not present
    let policy_path = "/usr/share/polkit-1/actions/com.github.alloy.fish.policy";
    if !std::path::Path::new(policy_path).exists() {
        let policy_content = include_str!("../policies/com.github.alloy.fish.policy");
        if let Ok(mut tmp) = std::fs::File::create("/tmp/com.github.alloy.fish.policy") {
            use std::io::Write;
            let _ = tmp.write_all(policy_content.as_bytes());
            drop(tmp);
            let _ = std::process::Command::new("pkexec")
                .args(["cp", "/tmp/com.github.alloy.fish.policy", policy_path])
                .status();
            let _ = std::fs::remove_file("/tmp/com.github.alloy.fish.policy");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_system_deps,
            commands::fish_shot,
            commands::fish_stream,
            commands::analyze_package,
            commands::execute_installation,
            commands::pacman_sync,
            commands::pacman_search,
            commands::pacman_info,
            commands::pacman_list_installed,
            commands::pacman_upgrade,
            commands::pacman_install,
            commands::pacman_remove,
            commands::yay_search,
            commands::yay_install,
            commands::yay_upgrade_combined,
            commands::yay_clean_orphans,
            commands::yay_fetch_pkgbuild,
            commands::pactree_forward,
            commands::pactree_reverse,
            commands::check_informant,
            commands::informant_read_all,
            commands::preview_upgrade,
            commands::preview_yay_upgrade,
            commands::check_for_downgrades,
            commands::create_pre_upgrade_snapshot,
            commands::check_kernel_packages,
            commands::check_dkms_modules,
            commands::get_current_kernel,
            commands::paccache_clean,
            commands::paccache_clean_uninstalled,
            commands::pacman_key_init,
            commands::pacman_key_populate,
            commands::pacman_key_refresh,
            commands::scan_pacnew,
            commands::disk_usage,
            commands::get_config,
            commands::set_config,
            commands::install_appimage,
            commands::list_appimages,
            commands::remove_appimage,
            commands::debtap_needs_init,
            commands::debtap_init,
            commands::cleanup_tmp,
            commands::create_alloy_desktop_entry,
            commands::list_apps,
            commands::launch_app,
            commands::list_foreign_packages,
            commands::list_tracked_packages,
            commands::remove_tracked_package,
            commands::minimize_to_tray,
            commands::check_for_updates,
            commands::resolve_icon,
        ])
        .setup(|app| {
            // Create tray menu
            let show = MenuItem::with_id(app, "show", "Show Alloy", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check_updates, &quit])?;

            // Build tray icon
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Alloy — Arch Package Dropper")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "check_updates" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = app_handle.emit("check-updates", ());
                            });
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Alloy");
}
