use std::collections::HashMap;
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};

use crate::fish;
use crate::models::*;
use crate::services;

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 1 — System readiness
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn check_system_deps() -> SystemDeps {
    SystemDeps {
        pacman: services::check_dep("pacman").await,
        yay: services::check_dep("yay").await,
        debtap: services::check_dep("debtap").await,
        fish: services::check_dep("fish").await,
        pkexec: services::check_dep("pkexec").await,
        makepkg: services::check_dep("makepkg").await,
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fish bridge
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn fish_shot(script: String) -> Result<(String, String, i32), String> {
    fish::exec_one(&script).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fish_stream(
    app: AppHandle,
    cmd_id: String,
    script: String,
    pkexec: bool,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
    let tag = format!("stream-{cmd_id}");
    let app_fwd = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await { let _ = app_fwd.emit(&tag, ev); }
    });
    fish::exec_streaming(&script, pkexec, tx).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Foreign package ingest
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn analyze_package(path: String) -> Result<PackageAnalysis, String> {
    services::analyze_package(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_installation(
    app: AppHandle,
    cmd_id: String,
    path: String,
) -> Result<InstallResult, String> {
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
    let tag = format!("stream-{cmd_id}");
    let app_fwd = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await { let _ = app_fwd.emit(&tag, ev); }
    });

    let result = async {
        let pkg = services::analyze_package(&path).await.map_err(|e| e.to_string())?;
        let _ = tx.send(StreamEvent::Stdout { line: format!("✓ Analyzed: {} v{} ({})", pkg.package_name, pkg.version, pkg.format) }).await;

        // AppImage: copy to ~/.local/share/appimages, create desktop entry
        if pkg.format == "appimage" {
            let appimage_path = match services::install_appimage(&pkg, &tx).await {
                Ok(p) => p,
                Err(e) => {
                    let _ = tx.send(StreamEvent::Error { message: format!("Install failed: {e}") }).await;
                    return Ok(InstallResult {
                        success: false, package_name: pkg.package_name,
                        pkg_path: None, desktop_file: None,
                        messages: vec![format!("Install failed: {e}")],
                    });
                }
            };
            let desktop = services::find_desktop_file(&pkg.package_name).await;
            track_install(&pkg.package_name, &pkg.version, "appimage");
            return Ok(InstallResult {
                success: true, package_name: pkg.package_name,
                pkg_path: Some(appimage_path),
                desktop_file: desktop, messages: vec!["AppImage installed successfully".into()],
            });
        }

        // Pre-built Arch package (.pkg.tar) — install directly
        if pkg.format == "pkg-tar" {
            let pkg_path = std::path::PathBuf::from(&pkg.file_path);
            if let Err(e) = services::install_pkg_file(&pkg_path, &tx).await {
                let _ = tx.send(StreamEvent::Error { message: format!("Install failed: {e}") }).await;
                return Ok(InstallResult {
                    success: false, package_name: pkg.package_name.clone(),
                    pkg_path: Some(pkg.file_path.clone()),
                    desktop_file: None, messages: vec![format!("Install failed: {e}")],
                });
            }
            let desktop = services::find_desktop_file(&pkg.package_name).await;
            track_install(&pkg.package_name, &pkg.version, "pkg-tar");
            return Ok(InstallResult {
                success: true, package_name: pkg.package_name,
                pkg_path: Some(pkg.file_path),
                desktop_file: desktop, messages: vec!["Package installed successfully".into()],
            });
        }

        let pkg_path = match services::build_arch_pkg(&pkg, &tx).await {
            Ok(p) => p,
            Err(e) => {
                let _ = tx.send(StreamEvent::Error { message: format!("Build failed: {e}") }).await;
                return Ok(InstallResult {
                    success: false, package_name: pkg.package_name,
                    pkg_path: None, desktop_file: None,
                    messages: vec![format!("Build failed: {e}")],
                });
            }
        };

        let _ = tx.send(StreamEvent::Stdout { line: format!("✓ Built: {}", pkg_path.display()) }).await;

        if let Err(e) = services::install_pkg_file(&pkg_path, &tx).await {
            let _ = tx.send(StreamEvent::Error { message: format!("Install failed: {e}") }).await;
            return Ok(InstallResult {
                success: false, package_name: pkg.package_name.clone(),
                pkg_path: Some(pkg_path.to_string_lossy().to_string()),
                desktop_file: None, messages: vec![format!("Install failed: {e}")],
            });
        }

        let desktop = services::find_desktop_file(&pkg.package_name).await;
        track_install(&pkg.package_name, &pkg.version, &pkg.format);
        Ok(InstallResult {
            success: true, package_name: pkg.package_name,
            pkg_path: Some(pkg_path.to_string_lossy().to_string()),
            desktop_file: desktop, messages: vec!["Installation complete".into()],
        })
    }.await;

    let code = if result.as_ref().map(|r| r.success).unwrap_or(false) { 0 } else { 1 };
    let _ = tx.send(StreamEvent::Exit { code }).await;
    result
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 3 — Pacman operations
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn pacman_sync() -> Result<(String, String, i32), String> {
    fish::exec_one("pacman -Sy --noconfirm").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pacman_search(query: String) -> Result<(String, String, i32), String> {
    Ok(services::pacman_search(&query).await)
}

#[tauri::command]
pub async fn pacman_info(name: String) -> Result<(String, String, i32), String> {
    Ok(services::pacman_info(&name).await)
}

#[tauri::command]
pub async fn pacman_list_installed() -> Result<(String, String, i32), String> {
    Ok(services::pacman_list_installed().await)
}

macro_rules! stream_cmd {
    ($app:expr, $id:expr, $script:expr, $pkexec:expr) => {{
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
        let tag = format!("stream-{}", $id);
        let app_fwd = $app.clone();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let _ = app_fwd.emit(&tag, ev);
            }
        });
        fish::exec_streaming(&$script, $pkexec, tx).await.map_err(|e| e.to_string())
    }};
    ($app:expr, $id:expr, $script:expr) => {
        stream_cmd!($app, $id, $script, true)
    };
}

#[tauri::command]
pub async fn pacman_install(app: AppHandle, cmd_id: String, packages: Vec<String>) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::install_script(&packages))
}

#[tauri::command]
pub async fn pacman_remove(app: AppHandle, cmd_id: String, packages: Vec<String>) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::remove_script(&packages))
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 4 — Yay orchestrator
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn yay_search(query: String) -> Result<(String, String, i32), String> {
    Ok(services::yay_search(&query).await)
}

#[tauri::command]
pub async fn yay_install(app: AppHandle, cmd_id: String, packages: Vec<String>) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::yay_install_script(&packages), false)
}

#[tauri::command]
pub async fn yay_upgrade_combined(app: AppHandle, cmd_id: String) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::upgrade_stream_script(), false)
}

#[tauri::command]
pub async fn pacman_upgrade(app: AppHandle, cmd_id: String) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::upgrade_script())
}

#[tauri::command]
pub async fn yay_clean_orphans(app: AppHandle, cmd_id: String) -> Result<(), String> {
    stream_cmd!(app, cmd_id, services::yay_clean_orphans_script(), false)
}

#[tauri::command]
pub async fn yay_fetch_pkgbuild(package: String) -> Result<PkgbuildReview, String> {
    services::fetch_pkgbuild(&package).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dependency Tree (pactree)
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn pactree_forward(package: String) -> Result<String, String> {
    let (out, _, _) = services::pactree_forward(&package).await;
    Ok(out)
}

#[tauri::command]
pub async fn pactree_reverse(package: String) -> Result<String, String> {
    let (out, _, _) = services::pactree_reverse(&package).await;
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Informant / Breaking-Update Prevention
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn check_informant() -> Result<InformantResult, String> {
    services::check_informant_news().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn informant_read_all() -> Result<(), String> {
    services::informant_read_all().await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Safety: Upgrade Preview & Protection
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn preview_upgrade() -> Result<String, String> {
    services::preview_upgrade().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_yay_upgrade() -> Result<String, String> {
    services::preview_yay_upgrade().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_for_downgrades() -> Result<Vec<String>, String> {
    services::check_for_downgrades().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_pre_upgrade_snapshot() -> Result<String, String> {
    services::create_pre_upgrade_snapshot().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_kernel_packages() -> Result<Vec<String>, String> {
    services::check_kernel_packages().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_dkms_modules() -> Result<Vec<String>, String> {
    services::check_dkms_modules().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_current_kernel() -> Result<String, String> {
    services::get_current_kernel().await.map_err(|e| e.to_string())
}

//  Maintenance
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn paccache_clean(keep: i32) -> Result<(String, String, i32), String> {
    fish::exec_one(&services::paccache_clean_script(keep)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn paccache_clean_uninstalled() -> Result<(String, String, i32), String> {
    fish::exec_one(&services::paccache_clean_uninstalled_script()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pacman_key_init() -> Result<(String, String, i32), String> {
    fish::exec_one("pkexec pacman-key --init").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pacman_key_populate() -> Result<(String, String, i32), String> {
    fish::exec_one("pkexec pacman-key --populate archlinux").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pacman_key_refresh() -> Result<(String, String, i32), String> {
    fish::exec_one("pkexec pacman-key --refresh-keys").await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_pacnew() -> Result<Vec<String>, String> {
    let (out, _, _) = fish::exec_one("find / -name '*.pacnew' -o -name '*.pacsave' 2>/dev/null")
        .await.map_err(|e| e.to_string())?;
    Ok(out.lines().map(String::from).collect())
}

#[tauri::command]
pub async fn disk_usage() -> Result<String, String> {
    let (out, _, _) = fish::exec_one("du -sh /var/cache/pacman/pkg 2>/dev/null")
        .await.map_err(|e| e.to_string())?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub async fn list_foreign_packages() -> Result<Vec<(String, String)>, String> {
    let (out, _, code) = fish::exec_one("pacman -Qm").await.map_err(|e| e.to_string())?;
    if code != 0 { return Ok(vec![]); }
    Ok(out.lines().filter_map(|l| {
        let parts: Vec<&str> = l.split_whitespace().collect();
        if parts.len() >= 2 { Some((parts[0].to_string(), parts[1].to_string())) } else { None }
    }).collect())
}

#[tauri::command]
pub async fn list_tracked_packages() -> Result<Vec<(String, String, String)>, String> {
    Ok(list_tracked_installs())
}

#[tauri::command]
pub async fn remove_tracked_package(app: AppHandle, cmd_id: String, name: String) -> Result<(), String> {
    // Check if it's an AppImage
    let appimages = services::list_managed_appimages().await.unwrap_or_default();
    if appimages.iter().any(|a| a.name == name) {
        services::remove_appimage(&name).await.map_err(|e| e.to_string())?;
    } else {
        stream_cmd!(app, cmd_id, services::remove_script(&[name.clone()]))?;
    }
    track_remove(&name);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Config
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_config() -> Result<HashMap<String, serde_json::Value>, String> {
    Ok(services::get_config())
}

#[tauri::command]
pub async fn set_config(section: String, key: String, value: serde_json::Value) -> Result<(), String> {
    services::set_config(&section, &key, value);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  AppImage management
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn install_appimage(
    app: AppHandle,
    cmd_id: String,
    path: String,
) -> Result<InstallResult, String> {
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
    let tag = format!("stream-{cmd_id}");
    let app_fwd = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await { let _ = app_fwd.emit(&tag, ev); }
    });

    let result = async {
        let pkg = services::analyze_package(&path).await.map_err(|e| e.to_string())?;
        let _ = tx.send(StreamEvent::Stdout { line: format!("✓ Analyzed: {} v{} ({})", pkg.package_name, pkg.version, pkg.format) }).await;

        let appimage_path = match services::install_appimage(&pkg, &tx).await {
            Ok(p) => p,
            Err(e) => {
                let _ = tx.send(StreamEvent::Error { message: format!("Install failed: {e}") }).await;
                return Ok(InstallResult {
                    success: false, package_name: pkg.package_name,
                    pkg_path: None, desktop_file: None,
                    messages: vec![format!("Install failed: {e}")],
                });
            }
        };

        Ok(InstallResult {
            success: true,
            package_name: pkg.package_name.clone(),
            pkg_path: Some(appimage_path.clone()),
            desktop_file: Some(appimage_path),
            messages: vec!["AppImage installed successfully".into()],
        })
    }.await;

    let code = if result.as_ref().map(|r| r.success).unwrap_or(false) { 0 } else { 1 };
    let _ = tx.send(StreamEvent::Exit { code }).await;
    result
}

#[tauri::command]
pub async fn list_appimages() -> Result<Vec<AppImageEntry>, String> {
    services::list_managed_appimages().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_appimage(name: String) -> Result<(), String> {
    services::remove_appimage(&name).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  debtap / maintenance
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn debtap_needs_init() -> Result<bool, String> {
    Ok(services::debtap_needs_init().await)
}

#[tauri::command]
pub async fn debtap_init(app: AppHandle, cmd_id: String) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(512);
    let tag = format!("stream-{cmd_id}");
    let app_fwd = app.clone();
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await { let _ = app_fwd.emit(&tag, ev); }
    });
    services::debtap_init(&tx).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_tmp() -> Result<(), String> {
    let (tx, _rx) = mpsc::channel::<StreamEvent>(512);
    services::cleanup_tmp_alloy(&tx).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Applications Launcher
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn list_apps() -> Result<Vec<AppEntry>, String> {
    services::list_apps().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn launch_app(desktop_path: String) -> Result<(), String> {
    use tokio::process::Command;

    let status = Command::new("dex")
        .arg(&desktop_path)
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if !status.success() {
        // Try gtk-launch as fallback
        let fname = std::path::Path::new(&desktop_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let _ = Command::new("gtk-launch")
            .arg(&fname)
            .status()
            .await;
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Create Alloy desktop entry
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn create_alloy_desktop_entry() -> Result<String, String> {
    services::create_alloy_desktop_entry().map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tray / Window Management
// ═══════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn minimize_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    let (out, _, code) = fish::exec_one("yay -Qu 2>/dev/null | head -1").await
        .map_err(|e| e.to_string())?;
    let has_updates = code == 0 && !out.trim().is_empty();
    
    // Emit event for tray icon to show indicator
    let _ = app.emit("update-status", serde_json::json!({ "has_updates": has_updates }));
    Ok(has_updates)
}

#[tauri::command]
pub async fn resolve_icon(name: String) -> Result<Option<String>, String> {
    Ok(services::resolve_icon_data_uri(&name))
}

//  AUR Malware Check

#[tauri::command]
pub async fn security_scan_installed() -> Result<Vec<String>, String> {
    let compromised: Vec<&str> = include_str!("../assets/compromised_packages.txt")
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    let compromised_set: std::collections::HashSet<&str> = compromised.iter().copied().collect();

    let (out, _, _) = crate::fish::exec_one("pacman -Qmq 2>/dev/null").await.map_err(|e| e.to_string())?;
    let infected: Vec<String> = out.lines()
        .filter(|l| !l.is_empty())
        .filter(|pkg| compromised_set.contains(*pkg))
        .map(String::from)
        .collect();
    Ok(infected)
}

#[tauri::command]
pub async fn security_scan_log() -> Result<Vec<String>, String> {
    let compromised: Vec<&str> = include_str!("../assets/compromised_packages.txt")
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    let compromised_set: std::collections::HashSet<&str> = compromised.iter().copied().collect();

    let (out, _, _) = crate::fish::exec_one("sh -c 'timeout 10 grep -E \"^\\[2026-06-(09|10|11|12)\\].*\\[ALPM\\] (installed|upgraded|reinstalled)\" /var/log/pacman.log 2>/dev/null'").await.map_err(|e| e.to_string())?;
    let hits: Vec<String> = out.lines()
        .filter(|l| {
            if let Some(pos) = l.find("[ALPM] ") {
                let after = &l[pos + 7..];
                let parts: Vec<&str> = after.splitn(3, ' ').collect();
                if parts.len() >= 2 {
                    return compromised_set.contains(parts[1]);
                }
            }
            false
        })
        .map(String::from)
        .collect();
    Ok(hits)
}

#[tauri::command]
pub async fn check_package_security(package: String) -> Result<PackageSecurityInfo, String> {
    let compromised = crate::malware_check::is_compromised(&package);
    let total = crate::malware_check::compromised_count();
    Ok(PackageSecurityInfo {
        package,
        compromised,
        known_compromised_count: total,
    })
}
