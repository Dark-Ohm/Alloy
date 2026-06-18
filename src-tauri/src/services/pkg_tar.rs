//! Pre-built Arch package (.pkg.tar.*) analysis.

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;

pub async fn analyze_pkg_tar(path: &PathBuf) -> Result<PackageAnalysis> {
    let path_str = path.to_string_lossy().to_string();
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let fname = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown");
    let stem = fname.strip_suffix(".pkg").unwrap_or(fname);
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