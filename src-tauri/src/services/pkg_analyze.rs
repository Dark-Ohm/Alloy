//! Package format analysis utilities.
//!
//! Supports .deb, .rpm, .pkg.tar.*, .tar.*, and .AppImage formats.
//! Extracts metadata (name, version, architecture, dependencies, description)
//! from packages without requiring format-specific tools (dpkg, rpm, etc.).

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;
use crate::fish;

mod deb;
mod rpm;
mod pkg_tar;
mod tar;
mod appimage;

pub use deb::analyze_deb;
pub use rpm::analyze_rpm;
pub use pkg_tar::analyze_pkg_tar;
pub use tar::analyze_tar_archive;
pub use appimage::analyze_appimage;

/// Analyze a package file and extract metadata.
///
/// Determines the package format from the file extension and delegates
/// to the appropriate analyzer.
///
/// # Arguments
/// * `path` - Path to the package file
///
/// # Returns
/// PackageAnalysis containing format, name, version, dependencies, etc.
///
/// # Errors
/// Returns error if format is unsupported or analysis fails.
pub async fn analyze_package(path: &str) -> Result<PackageAnalysis> {
    let p = PathBuf::from(path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let is_appimage = fname.ends_with(".AppImage") || fname.ends_with(".appimage");

    if fname.contains(".pkg.tar") {
        return analyze_pkg_tar(&p).await;
    }

    match (ext.as_str(), is_appimage) {
        ("deb", _) => analyze_deb(&p).await,
        ("rpm", _) => analyze_rpm(&p).await,
        ("tar" | "gz" | "xz" | "zst" | "bz2", _) => analyze_tar_archive(&p).await,
        (_, true) => analyze_appimage(&p).await,
        (other, _) => anyhow::bail!("Unsupported format: .{}", other),
    }
}