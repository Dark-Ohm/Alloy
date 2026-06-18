use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

use crate::fish;
use crate::models::{
    self, load_config, save_config, AppEntry, AppImageEntry, InformantResult, PackageAnalysis,
    PkgbuildReview, StreamEvent,
};

pub async fn check_dep(name: &str) -> models::DepStatus {
    match fish::exec_one(&format!("which {name}")).await {
        Ok((out, _, 0)) => models::DepStatus {
            installed: true,
            path: Some(out.trim().to_string()),
        },
        _ => models::DepStatus::default(),
    }
}

pub async fn analyze_package(path: &str) -> anyhow::Result<PackageAnalysis> {
    let p = PathBuf::from(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let is_appimage = fname.ends_with(".AppImage") || fname.ends_with(".appimage");
    // Pre-built Arch packages (.pkg.tar, .pkg.tar.zst) — install directly with pacman -U
    if fname.contains(".pkg.tar") {
        return analyze_pkg_tar(&p).await;
    }
    match (ext.as_str(), is_appimage) {
        ("deb", _) => analyze_deb(&p).await,
        ("rpm", _) => analyze_rpm(&p).await,
        ("tar" | "gz" | "xz" | "zst" | "bz2", _) => analyze_tar_archive(&p).await,
        (_, true) => analyze_appimage(&p).await,
        (other, _) => anyhow::bail!("Unsupported format: .{other}"),
    }
}

fn sq(s: &str) -> String {
    shlex::try_quote(s).unwrap().into_owned()
}

async fn analyze_deb(path: &PathBuf) -> anyhow::Result<PackageAnalysis> {
    let path_str = path.to_string_lossy().to_string();
    let p = sq(&path_str);
    let tmp = tmp_dir();

    // Write awk script to a file to avoid quoting/escaping issues with fish
    let awk_path = format!("{tmp}/parse_control.awk");
    let awk_src = "/^Package:/ { v = substr($0, index($0,\": \")+2) }\n\
/^Version:/ { e = substr($0, index($0,\": \")+2) }\n\
/^Architecture:/ { a = substr($0, index($0,\": \")+2) }\n\
/^Description:/ { d = substr($0, index($0,\": \")+2) }\n\
/^Installed-Size:/ { s = substr($0, index($0,\": \")+2) }\n\
/^Depends:/ { p = substr($0, index($0,\": \")+2) }\n\
END { print v; print e; print a; print d; print s; print p }\n";
    let _ = std::fs::create_dir_all(&tmp);
    std::fs::write(&awk_path, awk_src).ok();

    // .deb is an ar archive: extract control.tar.* and parse the control file
    // Works without dpkg-deb — uses only ar, tar, and awk
    let script = format!(
        "mkdir -p {tmp} && cd {tmp} && \
         ar x {p} 2>/dev/null && \
         tar xf control.tar.* 2>/dev/null && \
         awk -f {awk_path} control"
    );
    let (ctrl, _, _code) = fish::exec_one(&script).await?;

    let lines: Vec<&str> = ctrl.trim().lines().collect();
    let (name, ver, arch, desc, size_str, deps_str) = if lines.len() >= 3 {
        (
            lines[0].trim().to_string(),
            lines[1].trim().to_string(),
            lines[2].trim().to_string(),
            lines.get(3).unwrap_or(&"").trim().to_string(),
            lines.get(4).unwrap_or(&"0").trim().to_string(),
            lines.get(5).unwrap_or(&"").trim().to_string(),
        )
    } else {
        (
            "unknown".into(),
            "0.0".into(),
            "x86_64".into(),
            String::new(),
            "0".into(),
            String::new(),
        )
    };

    let deps: Vec<String> = deps_str
        .split(',')
        .map(|d| d.split_whitespace().next().unwrap_or("").to_string())
        .filter(|d| !d.is_empty())
        .collect();
    // Installed-Size from control (in KB), fall back to actual .deb file size
    let size_bytes = if size_str != "0" && !size_str.is_empty() {
        size_str.parse::<u64>().unwrap_or(0) * 1024
    } else {
        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    };

    // Extract data archive and look for .desktop files
    let desktop_script = format!(
        "cd {tmp} && tar xf data.tar.* 2>/dev/null && find {tmp} -name '*.desktop' -path '*/applications/*' 2>/dev/null | head -1"
    );
    let (desk_out, _, _) = fish::exec_one(&desktop_script).await?;
    let desktop_file = if !desk_out.trim().is_empty() {
        Some(desk_out.trim().to_string())
    } else {
        None
    };

    Ok(PackageAnalysis {
        format: "deb".into(),
        file_path: path_str,
        package_name: name,
        version: ver,
        description: desc,
        dependencies: deps,
        arch,
        size_bytes,
        extracted_path: Some(tmp),
        desktop_file,
    })
}

async fn analyze_rpm(path: &PathBuf) -> anyhow::Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let p = sq(&path_string);
    let (info, _, code) = fish::exec_one(&format!("rpm -qip {p} 2>/dev/null")).await?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut name = "unknown".to_string();
    let mut ver = "0.0".to_string();
    let mut arch = "x86_64".to_string();
    let mut desc = String::new();
    if code == 0 {
        for line in info.lines() {
            let l = line.trim();
            if l.starts_with("Name") {
                name = l.split(':').nth(1).unwrap_or("unknown").trim().to_string();
            } else if l.starts_with("Version") {
                ver = l.split(':').nth(1).unwrap_or("0.0").trim().to_string();
            } else if l.starts_with("Architecture") {
                arch = l.split(':').nth(1).unwrap_or("x86_64").trim().to_string();
            } else if l.starts_with("Summary") {
                desc = l.split(':').nth(1).unwrap_or("").trim().to_string();
            }
        }
    }
    Ok(PackageAnalysis {
        format: "rpm".into(),
        file_path: path_string,
        package_name: name,
        version: ver,
        description: desc,
        dependencies: vec![],
        arch,
        size_bytes,
        extracted_path: None,
        desktop_file: None,
    })
}

async fn analyze_pkg_tar(path: &PathBuf) -> anyhow::Result<PackageAnalysis> {
    let path_str = path.to_string_lossy().to_string();
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    // Parse name and version from filename: spotify-launcher-0.6.6-1-x86_64.pkg.tar
    let fname = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");
    // Remove trailing .pkg from the stem if present
    let stem = fname.strip_suffix(".pkg").unwrap_or(fname);
    // Extract version: everything after the last two hyphens (arch-rel)
    let parts: Vec<&str> = stem.rsplitn(3, '-').collect();
    let (pkgname, pkgver) = if parts.len() >= 3 {
        (parts[2].to_string(), format!("{}-{}", parts[1], parts[0]))
    } else {
        (stem.to_string(), "0.0".to_string())
    };
    Ok(PackageAnalysis {
        format: "pkg-tar".into(),
        file_path: path_str,
        package_name: pkgname,
        version: pkgver,
        description: "Pre-built Arch package".into(),
        dependencies: vec![],
        arch: "x86_64".into(),
        size_bytes,
        extracted_path: None,
        desktop_file: None,
    })
}

async fn analyze_tar_archive(path: &PathBuf) -> anyhow::Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let p = sq(&path_string);
    let tmp = tmp_dir();
    // List contents AND extract the archive so build_arch_pkg can find files
    let (listing, _, _) = fish::exec_one(&format!(
        "mkdir -p {tmp} && tar -xf {p} -C {tmp} 2>/dev/null; tar -tf {p} 2>/dev/null | head -50"
    ))
    .await?;
    let mut has_pkgbuild = false;
    let mut desktop_file = None;
    for line in listing.lines() {
        let l = line.trim();
        if l.ends_with("PKGBUILD") {
            has_pkgbuild = true;
        } else if l.contains("/applications/") && l.ends_with(".desktop") {
            desktop_file = Some(l.to_string());
        }
    }
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(PackageAnalysis {
        format: "tar".into(),
        file_path: path_string,
        package_name: name,
        version: "0.0".into(),
        description: format!("Tar archive (PKGBUILD: {has_pkgbuild})"),
        dependencies: vec![],
        arch: "any".into(),
        size_bytes,
        extracted_path: Some(tmp),
        desktop_file,
    })
}

pub async fn build_arch_pkg(
    pkg: &PackageAnalysis,
    tx: &mpsc::Sender<StreamEvent>,
) -> anyhow::Result<PathBuf> {
    let out_dir_str = format!("/tmp/alloy-build-{}", now_nanos());
    let _ = std::fs::create_dir_all(&out_dir_str);
    if pkg.format == "tar" {
        let extracted = pkg.extracted_path.as_deref().unwrap_or("/tmp");
        let script =
            format!("cd {extracted} && PKGDIR={out_dir_str} makepkg --nodeps --noconfirm 2>&1");
        let _ = tx
            .send(StreamEvent::Stdout {
                line: format!("Building with makepkg in {extracted}"),
            })
            .await;
        let (stdout, stderr, code) = fish::exec_one(&script).await?;
        let _ = tx.send(StreamEvent::Stdout { line: stdout }).await;
        if code != 0 {
            let _ = tx.send(StreamEvent::Stderr { line: stderr }).await;
            anyhow::bail!("makepkg failed with code {code}");
        }
    } else if pkg.format == "rpm" {
        let rpm_path = &pkg.file_path;
        let pkgver_sanitized = pkg.version.replace('-', "_");
        let script = format!(
            "mkdir -p '{out_dir_str}'\n\
             cd '{out_dir_str}'\n\
             rpm2cpio '{rpm_path}' | cpio -idm 2>/dev/null\n\
             mkdir -p src && cp -r usr opt etc var src/ 2>/dev/null; true\n\
             printf '%s\\n' 'pkgname=\"{pkgname}\"' 'pkgver=\"{pkgver_sanitized}\"' 'pkgrel=1' 'pkgdesc=\"{desc}\"' 'arch=(x86_64)' 'license=(unknown)' 'options=(!strip)' 'package() {{' '  cp -r \"$srcdir\"/* \"$pkgdir\"/' '}}' > PKGBUILD\n\
             makepkg -e --nodeps --noconfirm 2>&1\n",
            pkgname = pkg.package_name,
            pkgver_sanitized = pkgver_sanitized,
            desc = pkg.description.replace('\n', " ").replace('"', "\\\""),
        );
        let _ = tx
            .send(StreamEvent::Stdout {
                line: "Building package from .rpm...".into(),
            })
            .await;
        let (stdout, stderr, code) = fish::exec_one(&script).await?;
        let _ = tx.send(StreamEvent::Stdout { line: stdout }).await;
        if code != 0 {
            let _ = tx.send(StreamEvent::Stderr { line: stderr }).await;
            anyhow::bail!("makepkg failed with code {code}");
        }
    } else {
        let deb_path = &pkg.file_path;
        // Skip debtap entirely — create our own PKGBUILD with sanitized version,
        // extract the .deb data archive, and run makepkg directly.
        let pkgver_sanitized = pkg.version.replace('-', "_");
        let script = format!(
            "mkdir -p '{out_dir_str}'\n\
             cd '{out_dir_str}'\n\
             ar x '{deb_path}' 2>/dev/null\n\
             mkdir -p src && tar xf data.tar.* -C src 2>/dev/null\n\
             rm -f control.tar.* data.tar.* debian-binary\n\
             for f in (find src/usr/bin -maxdepth 1 -type f 2>/dev/null)\n\
               set name (basename $f)\n\
               set orig (find src/opt -name \"$name.sh\" -o -name \"$name\" -type f 2>/dev/null | head -1)\n\
               if test -n \"$orig\"\n\
                 rm $f\n\
                 set rel (string replace \"src/usr/bin\" \"/usr/bin\" $f)\n\
                 set target (string replace \"src\" \"\" $orig)\n\
                 ln -s $target $f\n\
               end\n\
             end\n\
             printf '%s\\n' 'pkgname=\"{pkgname}\"' 'pkgver=\"{pkgver_sanitized}\"' 'pkgrel=1' 'pkgdesc=\"{desc}\"' 'arch=(x86_64)' 'license=(unknown)' 'options=(!strip)' 'package() {{' '  cp -r \"$srcdir\"/* \"$pkgdir\"/' '}}' > PKGBUILD\n\
             makepkg -e --nodeps --noconfirm 2>&1\n",
            pkgname = pkg.package_name,
            pkgver_sanitized = pkgver_sanitized,
            desc = pkg.description.replace('\n', " ").replace('"', "\\\""),
        );
        let _ = tx
            .send(StreamEvent::Stdout {
                line: "Building package from .deb...".into(),
            })
            .await;
        let (stdout, stderr, code) = fish::exec_one(&script).await?;
        let _ = tx.send(StreamEvent::Stdout { line: stdout }).await;
        if code != 0 {
            let _ = tx.send(StreamEvent::Stderr { line: stderr }).await;
            anyhow::bail!("makepkg failed with code {code}");
        }
    }
    for entry in std::fs::read_dir(&out_dir_str)? {
        let entry = entry?;
        if entry
            .file_name()
            .to_string_lossy()
            .ends_with(".pkg.tar.zst")
        {
            return Ok(entry.path());
        }
    }
    anyhow::bail!("No .pkg.tar.zst produced")
}

pub async fn install_pkg_file(
    pkg_path: &Path,
    tx: &mpsc::Sender<StreamEvent>,
) -> anyhow::Result<()> {
    let path_string = pkg_path.to_string_lossy().to_string();
    let p = sq(&path_string);
    let _ = tx
        .send(StreamEvent::Stdout {
            line: format!("pkexec pacman -U --noconfirm {p}"),
        })
        .await;
    // Pipe input to auto-answer provider selection (pick 1st) and dependency conflicts (skip)
    let script = format!("echo -e '1\\ny' | pkexec pacman -U --noconfirm {p}");
    fish::exec_streaming(&script, false, tx.clone()).await?;
    Ok(())
}

pub async fn find_desktop_file(pkg_name: &str) -> Option<String> {
    let e = sq(pkg_name);
    let (out, _, code) = fish::exec_one(&format!(
        "find /usr/share/applications -name '*{e}*.desktop' -type f 2>/dev/null | head -1"
    ))
    .await
    .ok()?;
    let t = out.trim().to_string();
    if code == 0 && !t.is_empty() {
        Some(t)
    } else {
        None
    }
}

pub async fn pacman_search(q: &str) -> (String, String, i32) {
    let e = sq(q);
    fish::exec_one(&format!("pacman -Ss {e}"))
        .await
        .unwrap_or_default()
}
pub async fn pacman_info(n: &str) -> (String, String, i32) {
    let e = sq(n);
    fish::exec_one(&format!("pacman -Si {e}"))
        .await
        .unwrap_or_default()
}
pub async fn pacman_list_installed() -> (String, String, i32) {
    fish::exec_one("pacman -Q").await.unwrap_or_default()
}
pub fn upgrade_script() -> String {
    "env LC_ALL=C pacman -Syu --noconfirm".into()
}

pub fn install_script(p: &[String]) -> String {
    format!(
        "pacman -Syu --noconfirm --needed {}",
        p.iter()
            .map(|s| sq(s.as_str()))
            .collect::<Vec<_>>()
            .join(" ")
    )
}
pub fn remove_script(p: &[String]) -> String {
    format!(
        "pacman -Rns --noconfirm {}",
        p.iter()
            .map(|s| sq(s.as_str()))
            .collect::<Vec<_>>()
            .join(" ")
    )
}
pub fn upgrade_stream_script() -> String {
    "env LC_ALL=C yay -Syu --noconfirm".into()
}
pub fn yay_install_script(p: &[String]) -> String {
    format!(
        "yay -S --noconfirm --needed {}",
        p.iter()
            .map(|s| sq(s.as_str()))
            .collect::<Vec<_>>()
            .join(" ")
    )
}
pub fn yay_clean_orphans_script() -> String {
    "yay -Yc --noconfirm".into()
}

// ═══════════════════════════════════════════════════════════════════════════
//  Safety: Upgrade Preview & Protection
// ═══════════════════════════════════════════════════════════════════════════

pub async fn preview_upgrade() -> anyhow::Result<String> {
    let (out, _, _) = fish::exec_one("pacman -Syu --print 2>/dev/null").await?;
    Ok(out)
}

pub async fn preview_yay_upgrade() -> anyhow::Result<String> {
    // yay -Qu needs sudo to sync databases. Use pacman -Qu as fallback
    // which works if databases are already synced (they usually are).
    let (out, _, code) = fish::exec_one("pacman -Qu 2>/dev/null").await?;
    if code == 0 && !out.trim().is_empty() {
        return Ok(out);
    }
    // If no output, databases might need syncing - return helpful message
    Ok("Package database will be synced during upgrade.\nClick 'Confirm & Upgrade' to see the full package list.".into())
}

pub async fn check_for_downgrades() -> anyhow::Result<Vec<String>> {
    // This needs sudo to sync databases. Return empty if it fails.
    let (out, _, code) =
        fish::exec_one("pacman -Syu --print 2>/dev/null | grep -i 'downgrading'").await?;
    if code != 0 {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(String::from)
        .collect())
}

pub async fn create_pre_upgrade_snapshot() -> anyhow::Result<String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();

    // Try snapper first
    let (_, _, which_code) = fish::exec_one("which snapper 2>/dev/null").await?;
    if which_code == 0 {
        let snap_name = format!("pre-upgrade-{}", timestamp);
        let (_, _, code) = fish::exec_one(&format!(
            "pkexec snapper -c root create --description '{}' --cleanup-number 5 2>&1",
            snap_name
        ))
        .await?;
        if code == 0 {
            return Ok(format!("Created snapper snapshot: {}", snap_name));
        }
    }

    // Try btrfs snapshot
    let (fstype_out, _, _) = fish::exec_one("stat -f -c %T / 2>/dev/null").await?;
    if fstype_out.trim() == "btrfs" {
        let snap_dir = format!("/.snapshots/pre-upgrade-{}", timestamp);
        let (_, _, code) = fish::exec_one(&format!(
            "pkexec btrfs subvolume snapshot / '{}' 2>&1",
            snap_dir
        ))
        .await?;
        if code == 0 {
            return Ok(format!("Created btrfs snapshot: {}", snap_dir));
        }
    }

    // Try timeshift
    let (_, _, which_code) = fish::exec_one("which timeshift 2>/dev/null").await?;
    if which_code == 0 {
        let (_, _, code) =
            fish::exec_one("pkexec timeshift --create --comments 'Pre-upgrade snapshot' 2>&1")
                .await?;
        if code == 0 {
            return Ok("Created timeshift snapshot".to_string());
        }
    }

    anyhow::bail!("No snapshot tool available (install snapper, timeshift, or use btrfs)")
}

/// Detect if kernel-related packages are in the upgrade list
/// Returns list of kernel packages that will be upgraded
pub async fn check_kernel_packages() -> anyhow::Result<Vec<String>> {
    // This needs sudo to sync databases. Return empty if it fails.
    let (out, _, code) = fish::exec_one(
        "pacman -Syu --print 2>/dev/null | grep -E '^(linux|linux-zen|linux-lts|linux-hardened|linux-cachyos|linux-headers|nvidia|nvidia-dkms|nvidia-utils|mhwd-nvidia)'"
    ).await?;
    if code != 0 {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            // Extract package name (first column)
            l.split_whitespace().next().unwrap_or("").to_string()
        })
        .filter(|s| !s.is_empty())
        .collect())
}

/// Check if DKMS modules are installed (need rebuild after kernel upgrade)
pub async fn check_dkms_modules() -> anyhow::Result<Vec<String>> {
    let (out, _, code) = fish::exec_one("dkms status 2>/dev/null").await?;
    if code != 0 || out.trim().is_empty() {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty() && l.contains(':'))
        .map(|l| l.trim().to_string())
        .collect())
}

/// Get current kernel version
pub async fn get_current_kernel() -> anyhow::Result<String> {
    let (out, _, _) = fish::exec_one("uname -r").await?;
    Ok(out.trim().to_string())
}

pub async fn yay_search(q: &str) -> (String, String, i32) {
    let e = sq(q);
    fish::exec_one(&format!("yay -Ss {e}"))
        .await
        .unwrap_or_default()
}

pub async fn fetch_pkgbuild(pkg: &str) -> anyhow::Result<PkgbuildReview> {
    let e = sq(pkg);
    let script = format!(
        "set tmpd (mktemp -d); cd $tmpd; yay -G {e} 2>&1; set ycode $status; \
         if test $ycode -eq 0; and test -f $tmpd/{e}/PKGBUILD; \
           cat $tmpd/{e}/PKGBUILD; \
         else; \
           echo ''; \
         end; \
         rm -rf $tmpd"
    );
    let (out, err, code) = fish::exec_one(&script).await?;
    if code != 0 {
        anyhow::bail!(
            "Failed to fetch PKGBUILD: {}",
            if err.is_empty() { &out } else { &err }
        );
    }
    let content = out.trim().to_string();
    if content.is_empty() {
        anyhow::bail!("PKGBUILD is empty or package not found in AUR");
    }
    Ok(PkgbuildReview {
        package_name: pkg.to_string(),
        content,
    })
}

pub fn paccache_clean_script(k: i32) -> String {
    format!("paccache -r -k {k}")
}
pub fn paccache_clean_uninstalled_script() -> String {
    "paccache -ruk0".into()
}
pub fn get_config() -> HashMap<String, serde_json::Value> {
    load_config()
}
pub fn set_config(s: &str, k: &str, v: serde_json::Value) {
    let mut c = load_config();
    let e = c
        .entry(s.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if let Some(m) = e.as_object_mut() {
        m.insert(k.to_string(), v);
    }
    save_config(&c);
}

pub async fn pactree_forward(pkg: &str) -> (String, String, i32) {
    let e = sq(pkg);
    fish::exec_one(&format!("pactree {e} 2>/dev/null"))
        .await
        .unwrap_or_default()
}

pub async fn pactree_reverse(pkg: &str) -> (String, String, i32) {
    let e = sq(pkg);
    fish::exec_one(&format!("pactree -r {e} 2>/dev/null"))
        .await
        .unwrap_or_default()
}

pub async fn check_informant_news() -> anyhow::Result<InformantResult> {
    let (_which_out, _, which_code) = fish::exec_one("which informant 2>/dev/null").await?;
    if which_code != 0 {
        return Ok(InformantResult {
            informant_available: false,
            has_unread: false,
            entries: vec![],
            message: "informant not installed. Install it with: yay -S informant".into(),
        });
    }
    let (out, err, code) = fish::exec_one("informant check 2>&1").await?;
    let combined = format!("{out}\n{err}");
    let has_unread = code != 0;
    let mut entries = Vec::new();
    if has_unread {
        for line in combined.lines() {
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            if !t.starts_with("There are") && !t.starts_with("No ") && !t.starts_with("Error") {
                entries.push(t.to_string());
            }
        }
    }
    let message = if has_unread {
        format!(
            "{} unread news entries. Read them before upgrading!",
            entries.len()
        )
    } else {
        "No unread news. Safe to upgrade.".into()
    };
    Ok(InformantResult {
        informant_available: true,
        has_unread,
        entries,
        message,
    })
}

pub async fn informant_read_all() -> anyhow::Result<()> {
    let (_, _, code) = fish::exec_one("informant read --all 2>&1").await?;
    if code != 0 {
        anyhow::bail!("Failed to mark news as read");
    }
    Ok(())
}

fn tmp_dir() -> String {
    format!("/tmp/alloy-{}", now_nanos())
}
fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

// ═══════════════════════════════════════════════════════════════════════════
//  AppImage management
// ═══════════════════════════════════════════════════════════════════════════

fn apps_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".local/share/appimages")
}

fn desktop_dir() -> PathBuf {
    let data = std::env::var("XDG_DATA_HOME")
        .unwrap_or_else(|_| format!("{}/.local/share", std::env::var("HOME").unwrap_or_default()));
    PathBuf::from(data).join("applications")
}

/// Try to extract an icon from an AppImage and register it under the user's
/// icon theme dir so the generated desktop entry can reference it by name.
/// Returns the icon theme name on success, or `None` to fall back to a generic icon.
///
/// Uses the AppImage runtime's own `--appimage-extract <pattern>` (no FUSE and no
/// `squashfs-tools` needed); it pulls only the matching files into `./squashfs-root/`.
fn extract_appimage_icon(appimage_path: &PathBuf) -> Option<String> {
    let icon_name = format!("alloy-{}", appimage_path.file_stem()?.to_str()?);

    // Scratch dir for the partial extraction. The AppImage must be executable —
    // install_appimage() has already chmod'd the copy to 0755 before calling us.
    let work = PathBuf::from(format!("/tmp/alloy-appimage-icons/{icon_name}"));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).ok()?;

    // `.DirIcon` is the conventional AppImage icon; also grab any root-level
    // png/svg as a fallback for images whose .DirIcon is a dangling symlink.
    for pattern in [".DirIcon", "*.png", "*.svg"] {
        let _ = std::process::Command::new(appimage_path)
            .current_dir(&work)
            .args(["--appimage-extract", pattern])
            .output();
    }

    let root = work.join("squashfs-root");
    let mut candidates: Vec<PathBuf> = vec![root.join(".DirIcon")];
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            let p = e.path();
            if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                if ext.eq_ignore_ascii_case("png") || ext.eq_ignore_ascii_case("svg") {
                    candidates.push(p);
                }
            }
        }
    }
    let src = candidates.into_iter().find(|p| {
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false)
    })?;

    let is_svg = src
        .extension()
        .and_then(|x| x.to_str())
        .map(|e| e.eq_ignore_ascii_case("svg"))
        .unwrap_or(false);
    let (size_dir, ext) = if is_svg {
        ("scalable", "svg")
    } else {
        ("256x256", "png")
    };

    // Install under the user's hicolor theme — no root required, and it matches
    // the dirs scanned by resolve_icon_data_uri() / the Applications tab.
    let home = std::env::var("HOME").ok()?;
    let dest_dir = PathBuf::from(home).join(format!(".local/share/icons/hicolor/{size_dir}/apps"));
    std::fs::create_dir_all(&dest_dir).ok()?;
    let dest = dest_dir.join(format!("{icon_name}.{ext}"));
    let copied = std::fs::copy(&src, &dest).is_ok();
    let _ = std::fs::remove_dir_all(&work);

    if copied {
        Some(icon_name)
    } else {
        None
    }
}

async fn analyze_appimage(path: &PathBuf) -> anyhow::Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let p = sq(&path_string);

    let (file_out, _, code) = fish::exec_one(&format!("file -b {p} 2>/dev/null")).await?;
    if code != 0 || (!file_out.contains("AppImage") && !path_string.ends_with(".AppImage")) {
        anyhow::bail!("Not a valid AppImage file");
    }

    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let (version, _, _) = fish::exec_one(&format!("{p} --appimage-version 2>/dev/null || echo ''"))
        .await
        .unwrap_or_default();

    Ok(PackageAnalysis {
        format: "appimage".into(),
        file_path: path_string,
        package_name: name.clone(),
        version: version.trim().to_string(),
        description: format!("Portable AppImage: {name} — no conversion needed"),
        dependencies: vec![],
        arch: "x86_64".into(),
        size_bytes,
        extracted_path: None,
        desktop_file: None,
    })
}

pub async fn install_appimage(
    pkg: &PackageAnalysis,
    tx: &mpsc::Sender<StreamEvent>,
) -> anyhow::Result<String> {
    let dest_dir = apps_dir();
    std::fs::create_dir_all(&dest_dir)?;

    let src = PathBuf::from(&pkg.file_path);
    let dest = dest_dir.join(format!("{}.AppImage", pkg.package_name));

    let _ = tx
        .send(StreamEvent::Stdout {
            line: format!("→ Copying to {}/", dest_dir.display()),
        })
        .await;
    std::fs::copy(&src, &dest)?;

    let _ = tx
        .send(StreamEvent::Stdout {
            line: "→ Setting executable permission...".into(),
        })
        .await;
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&dest)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&dest, perms)?;

    let d_dir = desktop_dir();
    std::fs::create_dir_all(&d_dir)?;

    let desktop_path = d_dir.join(format!("alloy-{}.desktop", pkg.package_name));
    let exec_path = dest.to_string_lossy().to_string();
    // Try to extract icon from AppImage, fall back to appimage-generic
    let icon_name = extract_appimage_icon(&dest).unwrap_or_else(|| "appimage-generic".to_string());
    let desktop_content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={name}\n\
         Exec={exec}\n\
         Icon={icon}\n\
         Categories=Utility;\n\
         Comment=Managed by Alloy — Arch Package Dropper\n",
        name = pkg.package_name,
        exec = &exec_path,
        icon = icon_name,
    );
    std::fs::write(&desktop_path, desktop_content)?;

    let _ = tx
        .send(StreamEvent::Stdout {
            line: format!("✓ Created desktop entry: {}", desktop_path.display()),
        })
        .await;

    if let Ok(()) = std::process::Command::new("update-desktop-database")
        .arg(d_dir.to_string_lossy().as_ref())
        .output()
        .map(|_| ())
    {
        let _ = tx
            .send(StreamEvent::Stdout {
                line: "✓ Updated desktop database".into(),
            })
            .await;
    }

    Ok(dest.to_string_lossy().to_string())
}

pub async fn list_managed_appimages() -> anyhow::Result<Vec<AppImageEntry>> {
    let d_dir = desktop_dir();
    let mut entries = vec![];
    if !d_dir.exists() {
        return Ok(entries);
    }

    for entry in std::fs::read_dir(&d_dir)? {
        let entry = entry?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with("alloy-") && fname.ends_with(".desktop") {
            let content = std::fs::read_to_string(entry.path())?;
            let app_name = fname
                .strip_prefix("alloy-")
                .and_then(|s| s.strip_suffix(".desktop"))
                .unwrap_or("unknown");
            let exec_line = content
                .lines()
                .find(|l| l.starts_with("Exec="))
                .map(|l| l[5..].to_string())
                .unwrap_or_default();
            entries.push(AppImageEntry {
                name: app_name.to_string(),
                desktop_path: entry.path().to_string_lossy().to_string(),
                exec_path: exec_line,
            });
        }
    }
    Ok(entries)
}

pub async fn remove_appimage(name: &str) -> anyhow::Result<()> {
    let app_file = apps_dir().join(format!("{name}.AppImage"));
    if app_file.exists() {
        std::fs::remove_file(&app_file)?;
    }

    let desk = desktop_dir().join(format!("alloy-{name}.desktop"));
    if desk.exists() {
        std::fs::remove_file(&desk)?;
    }

    let _ = std::process::Command::new("update-desktop-database")
        .arg(desktop_dir().to_string_lossy().as_ref())
        .output();

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  debtap first-run initialization
// ═══════════════════════════════════════════════════════════════════════════

pub async fn debtap_needs_init() -> bool {
    let (out, _, code) = fish::exec_one("debtap -u --help 2>/dev/null || debtap 2>&1 | head -5")
        .await
        .unwrap_or_default();
    code != 0 || out.contains("run as root") || out.contains("update")
}

pub async fn debtap_init(tx: &mpsc::Sender<StreamEvent>) -> anyhow::Result<()> {
    let _ = tx
        .send(StreamEvent::Stdout {
            line: "→ Initializing debtap (first-run setup)...".into(),
        })
        .await;
    let _ = tx
        .send(StreamEvent::Stdout {
            line: "→ Running: debtap -u (this downloads package metadata)".into(),
        })
        .await;
    fish::exec_streaming("pkexec debtap -u", false, tx.clone()).await?;
    let _ = tx
        .send(StreamEvent::Stdout {
            line: "✓ debtap initialized successfully".into(),
        })
        .await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  Cleanup temporary build artifacts
// ═══════════════════════════════════════════════════════════════════════════

pub async fn cleanup_tmp_alloy(tx: &mpsc::Sender<StreamEvent>) -> anyhow::Result<()> {
    let _ = tx
        .send(StreamEvent::Stdout {
            line: "→ Cleaning temporary build artifacts...".into(),
        })
        .await;
    let (out, _, _) = fish::exec_one(
        "find /tmp -maxdepth 1 -name 'alloy-*' -type d -mmin +60 -exec rm -rf {} + 2>/dev/null; echo 'done'"
    ).await.unwrap_or_default();
    let _ = tx
        .send(StreamEvent::Stdout {
            line: format!("✓ Cleanup complete: {}", out.trim()),
        })
        .await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
//  List all installed applications from desktop files
// ═══════════════════════════════════════════════════════════════════════════

pub async fn list_apps() -> anyhow::Result<Vec<AppEntry>> {
    let mut entries = vec![];

    // Scan user applications
    let user_dir = desktop_dir();
    if user_dir.exists() {
        scan_desktop_dir(&user_dir, &mut entries)?;
    }

    // Scan system applications
    let system_dirs = ["/usr/share/applications", "/usr/local/share/applications"];
    for dir in &system_dirs {
        let sys_path = std::path::Path::new(dir);
        if sys_path.exists() {
            scan_desktop_dir(sys_path, &mut entries)?;
        }
    }

    // Deduplicate by name (user entries take priority)
    let mut seen = HashMap::new();
    for entry in entries {
        seen.entry(entry.name.clone()).or_insert(entry);
    }
    let mut deduped: Vec<AppEntry> = seen.into_values().collect();
    deduped.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(deduped)
}

fn scan_desktop_dir(dir: &std::path::Path, entries: &mut Vec<AppEntry>) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.ends_with(".desktop") {
            continue;
        }
        let content = std::fs::read_to_string(entry.path())?;
        let name_line = content
            .lines()
            .find(|l| l.starts_with("Name="))
            .map(|l| l[5..].to_string())
            .unwrap_or_else(|| fname.replace(".desktop", ""));
        let exec_line = content
            .lines()
            .find(|l| l.starts_with("Exec="))
            .map(|l| l[5..].to_string())
            .unwrap_or_default();
        let icon_line = content
            .lines()
            .find(|l| l.starts_with("Icon="))
            .map(|l| l[5..].to_string())
            .unwrap_or_else(|| "application-x-executable".to_string());
        let categories_line = content
            .lines()
            .find(|l| l.starts_with("Categories="))
            .map(|l| l[11..].to_string())
            .unwrap_or_default();
        let no_display = content.lines().any(|l| l.starts_with("NoDisplay=true"));
        let hidden = content.lines().any(|l| l.starts_with("Hidden=true"));
        if no_display || hidden {
            continue;
        }
        let icon_data_uri = resolve_icon_data_uri(&icon_line);
        let category = categorize(&categories_line);
        entries.push(AppEntry {
            name: name_line,
            desktop_path: entry.path().to_string_lossy().to_string(),
            exec_path: exec_line,
            icon: icon_line,
            icon_data_uri,
            category,
        });
    }
    Ok(())
}

/// Map a freedesktop `Categories=` value to one of the four user-facing buckets,
/// falling back to "Other". Buckets are checked by priority (Gaming > Media >
/// Productivity > Tools), not by the order tags appear — so e.g. Steam, which is
/// `Network;FileTransfer;Game`, is classified as Gaming rather than Productivity.
fn categorize(categories: &str) -> String {
    let cats: Vec<&str> = categories
        .split(';')
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .collect();
    let has = |group: &[&str]| cats.iter().any(|c| group.contains(c));

    if has(&["Game"]) {
        "Gaming"
    } else if has(&[
        "AudioVideo",
        "Audio",
        "Video",
        "Graphics",
        "Player",
        "Photography",
        "Music",
        "Recorder",
        "TV",
    ]) {
        "Media"
    } else if has(&[
        "Office",
        "Development",
        "IDE",
        "TextEditor",
        "WebBrowser",
        "Network",
        "Email",
        "Finance",
        "Calendar",
        "Spreadsheet",
        "WordProcessor",
        "Presentation",
        "Chat",
        "InstantMessaging",
    ]) {
        "Productivity"
    } else if has(&[
        "Utility",
        "System",
        "Settings",
        "Accessibility",
        "Security",
        "Archiving",
        "Compression",
        "FileManager",
        "TerminalEmulator",
        "PackageManager",
        "Monitor",
        "HardwareSettings",
    ]) {
        "Tools"
    } else {
        "Other"
    }
    .to_string()
}

/// Resolve a desktop-entry `Icon=` value (absolute path or theme icon name) to a
/// base64 `data:` URI. Returns `None` if no suitable file is found.
pub fn resolve_icon_data_uri(icon: &str) -> Option<String> {
    let icon = icon.trim();
    if icon.is_empty() {
        return None;
    }

    // Absolute path straight from the desktop file.
    if icon.starts_with('/') {
        return read_icon_file(&PathBuf::from(icon));
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let base_dirs = [
        format!("{home}/.local/share/icons"),
        "/usr/share/icons".to_string(),
        "/usr/local/share/icons".to_string(),
    ];
    let themes = [
        "hicolor",
        "Papirus",
        "Papirus-Dark",
        "Papirus-Light",
        "breeze",
        "breeze-dark",
        "Adwaita",
        "gnome",
        "elementary",
    ];
    // Prefer SVG (scalable, crisp & small), then a tile-friendly size, large→small.
    let size_dirs = [
        "scalable", "128x128", "96x96", "64x64", "48x48", "256x256", "32x32",
    ];
    let exts = ["svg", "png", "xpm"];

    for base in &base_dirs {
        for theme in &themes {
            for size in &size_dirs {
                for ext in &exts {
                    let p = PathBuf::from(base)
                        .join(theme)
                        .join(size)
                        .join("apps")
                        .join(format!("{icon}.{ext}"));
                    if p.is_file() {
                        if let Some(uri) = read_icon_file(&p) {
                            return Some(uri);
                        }
                    }
                }
            }
        }
    }

    // Flat fallback directories (no theme/size structure).
    for dir in ["/usr/share/pixmaps", "/usr/local/share/pixmaps"] {
        for ext in &exts {
            let p = PathBuf::from(dir).join(format!("{icon}.{ext}"));
            if p.is_file() {
                if let Some(uri) = read_icon_file(&p) {
                    return Some(uri);
                }
            }
        }
    }

    None
}

/// Read an icon file and encode it as a `data:` URI, skipping files that are
/// missing, too large, or of an unknown type.
fn read_icon_file(path: &PathBuf) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > 256 * 1024 {
        return None;
    }
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("xpm") => "image/x-xpixmap",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    Some(format!("data:{mime};base64,{}", b64_encode(&bytes)))
}

/// Minimal standard-alphabet base64 encoder (avoids pulling in a crate).
fn b64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

// ═══════════════════════════════════════════════════════════════════════════
//  Create desktop entry for Alloy itself
// ═══════════════════════════════════════════════════════════════════════════

pub fn create_alloy_desktop_entry() -> anyhow::Result<String> {
    let desktop_content = "[Desktop Entry]\nType=Application\nName=Alloy\nComment=Arch Package Dropper\nExec=alloy %U\nIcon=alloy\nTerminal=false\nCategories=System;PackageManager;\n";

    let d_dir = desktop_dir();
    std::fs::create_dir_all(&d_dir)?;

    let desktop_path = d_dir.join("alloy.desktop");
    std::fs::write(&desktop_path, desktop_content)?;

    // Try to update desktop database
    let _ = std::process::Command::new("update-desktop-database")
        .arg(d_dir.to_string_lossy().as_ref())
        .output();

    Ok(desktop_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorize_buckets_by_priority_not_tag_order() {
        // Steam lists Network (Productivity) before Game — Gaming must still win.
        assert_eq!(categorize("Network;FileTransfer;Game;"), "Gaming");
        // Lutris: Game wins over PackageManager (Tools).
        assert_eq!(categorize("Game;PackageManager;"), "Gaming");
    }

    #[test]
    fn categorize_maps_each_bucket() {
        assert_eq!(categorize("Game;"), "Gaming");
        assert_eq!(categorize("Qt;KDE;AudioVideo;Player;Video;"), "Media");
        assert_eq!(categorize("Qt;KDE;Development;TextEditor;"), "Productivity");
        assert_eq!(categorize("Network;WebBrowser;"), "Productivity");
        assert_eq!(categorize("Qt;KDE;Utility;Archiving;Compression;"), "Tools");
        assert_eq!(categorize("System;FileTools;FileManager;"), "Tools");
    }

    #[test]
    fn categorize_falls_back_to_other() {
        assert_eq!(categorize(""), "Other");
        assert_eq!(categorize("Qt;KDE;"), "Other"); // no recognized main category
    }
}
