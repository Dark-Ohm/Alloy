//! Generic tar archive analysis.

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;
use crate::fish;
use crate::services::tmp_dir;

pub async fn analyze_tar_archive(path: &PathBuf) -> Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let p = shlex::try_quote(&path_string)?.into_owned();
    let tmp = tmp_dir();

    // List contents AND extract the archive so build_arch_pkg can find files
    let (listing, _, _) = fish::exec_one(&format!("mkdir -p {tmp} && tar -xf {p} -C {tmp} 2>/dev/null; tar -tf {p} 2>/dev/null | head -50")).await?;
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

    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
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