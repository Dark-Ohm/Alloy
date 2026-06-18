//! pacman operations (search, info, install scripts).

use anyhow::Result;
use crate::fish;

/// Search official repositories.
pub async fn pacman_search(q: &str) -> (String, String, i32) {
    let e = shlex::try_quote(q)?.into_owned();
    fish::exec_one(&format!("pacman -Ss {e}")).await.unwrap_or_default()
}

/// Get package info from official repositories.
pub async fn pacman_info(n: &str) -> (String, String, i32) {
    let e = shlex::try_quote(n)?.into_owned();
    fish::exec_one(&format!("pacman -Si {e}")).await.unwrap_or_default()
}

/// List installed packages.
pub async fn pacman_list_installed() -> (String, String, i32) {
    fish::exec_one("pacman -Q").await.unwrap_or_default()
}

/// Generate install script for pacman.
pub fn install_script(p: &[String]) -> String {
    format!(
        "pacman -Syu --noconfirm --needed {}",
        p.iter().map(|s| shlex::try_quote(s.as_str()).unwrap().into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    )
}

/// Generate remove script for pacman.
pub fn remove_script(p: &[String]) -> String {
    format!(
        "pacman -Rns --noconfirm {}",
        p.iter().map(|s| shlex::try_quote(s.as_str()).unwrap().into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    )
}

/// Full system upgrade script.
pub fn upgrade_script() -> String {
    "env LC_ALL=C pacman -Syu --noconfirm".into()
}

/// Sync package databases.
pub async fn pacman_sync() -> Result<(String, String, i32), String> {
    fish::exec_one("pacman -Sy --noconfirm").await.map_err(|e| e.to_string())
}