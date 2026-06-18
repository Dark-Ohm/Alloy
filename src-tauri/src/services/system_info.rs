//! Safety: Upgrade preview, kernel/DKMS checks, informant news, snapshots.

use anyhow::Result;
use crate::fish;

/// Preview pacman upgrade (official repos only).
pub async fn preview_upgrade() -> Result<String> {
    let (out, _, _) = fish::exec_one("pacman -Syu --print 2>/dev/null").await?;
    Ok(out)
}

/// Preview yay upgrade (AUR + official).
pub async fn preview_yay_upgrade() -> Result<String> {
    let (out, _, code) = fish::exec_one("pacman -Qu 2>/dev/null").await?;
    if code == 0 && !out.trim().is_empty() {
        return Ok(out);
    }
    Ok("Package database will be synced during upgrade.\nClick 'Confirm & Upgrade' to see the full package list.".into())
}

/// Check for package downgrades in the upgrade.
pub async fn check_for_downgrades() -> Result<Vec<String>> {
    let (out, _, code) = fish::exec_one(
        "pacman -Syu --print 2>/dev/null | grep -i 'downgrading'"
    ).await?;
    if code != 0 {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(String::from)
        .collect())
}

/// Create a pre-upgrade snapshot (snapper, btrfs, or timeshift).
pub async fn create_pre_upgrade_snapshot() -> Result<String> {
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
        )).await?;
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
        )).await?;
        if code == 0 {
            return Ok(format!("Created btrfs snapshot: {}", snap_dir));
        }
    }

    // Try timeshift
    let (_, _, which_code) = fish::exec_one("which timeshift 2>/dev/null").await?;
    if which_code == 0 {
        let (_, _, code) = fish::exec_one(
            "pkexec timeshift --create --comments 'Pre-upgrade snapshot' 2>&1"
        ).await?;
        if code == 0 {
            return Ok("Created timeshift snapshot".to_string());
        }
    }

    anyhow::bail!("No snapshot tool available (install snapper, timeshift, or use btrfs)")
}

/// Detect kernel-related packages in upgrade list.
pub async fn check_kernel_packages() -> Result<Vec<String>> {
    let (out, _, code) = fish::exec_one(
        "pacman -Syu --print 2>/dev/null | grep -E '^(linux|linux-zen|linux-lts|linux-hardened|linux-cachyos|linux-headers|nvidia|nvidia-dkms|nvidia-utils|mhwd-nvidia)'"
    ).await?;
    if code != 0 {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.split_whitespace().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// Check for DKMS modules that need rebuild after kernel upgrade.
pub async fn check_dkms_modules() -> Result<Vec<String>> {
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

/// Get current kernel version.
pub async fn get_current_kernel() -> Result<String> {
    let (out, _, _) = fish::exec_one("uname -r").await?;
    Ok(out.trim().to_string())
}

/// Check informant (Arch Linux news) for breaking updates.
pub async fn check_informant_news() -> Result<crate::models::InformantResult> {
    let (_which_out, _, which_code) = fish::exec_one("which informant 2>/dev/null").await?;
    if which_code != 0 {
        return Ok(crate::models::InformantResult {
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
        format!("{} unread news entries. Read them before upgrading!", entries.len())
    } else {
        "No unread news. Safe to upgrade.".into()
    };
    Ok(crate::models::InformantResult {
        informant_available: true,
        has_unread,
        entries,
        message,
    })
}

/// Mark all informant news as read.
pub async fn informant_read_all() -> Result<()> {
    let (_, _, code) = fish::exec_one("informant read --all 2>&1").await?;
    if code != 0 {
        anyhow::bail!("Failed to mark news as read");
    }
    Ok(())
}

/// paccache clean script (keep N versions).
pub fn paccache_clean_script(k: i32) -> String {
    format!("paccache -r -k {k}")
}

/// paccache clean uninstalled packages.
pub fn paccache_clean_uninstalled_script() -> String {
    "paccache -ruk0".into()
}

/// Scan for .pacnew/.pacsave files.
pub async fn scan_pacnew() -> Result<Vec<String>> {
    let (out, _, _) = fish::exec_one(
        "find / -name '*.pacnew' -o -name '*.pacsave' 2>/dev/null"
    ).await?;
    Ok(out.lines().map(String::from).collect())
}

/// Get pacman cache disk usage.
pub async fn disk_usage() -> Result<String> {
    let (out, _, _) = fish::exec_one("du -sh /var/cache/pacman/pkg 2>/dev/null").await?;
    Ok(out.trim().to_string())
}

/// List foreign (AUR/manual) packages.
pub async fn list_foreign_packages() -> Result<Vec<(String, String)>> {
    let (out, _, code) = fish::exec_one("pacman -Qm").await?;
    if code != 0 {
        return Ok(vec![]);
    }
    Ok(out
        .lines()
        .filter_map(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            if parts.len() >= 2 {
                Some((parts[0].to_string(), parts[1].to_string()))
            } else {
                None
            }
        })
        .collect())
}