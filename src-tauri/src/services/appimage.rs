//! AppImage analysis.

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;
use crate::fish;

pub async fn analyze_appimage(path: &PathBuf) -> Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown");
    let p = shlex::try_quote(&path_string)?.into_owned();

    // Try to get version via --appimage-version
    let version = fish::exec_one(&format!("{p} --appimage-version 2>/dev/null || echo ''"))
        .await
        .map(|(out, _, _)| out.trim().to_string())
        .unwrap_or_else(|_| "0.0".to_string());

    // Try to get dependencies via file command
    let (file_out, _, _) = fish::exec_one(&format!("file -b {p} 2>/dev/null")).await?;
    let arch = if file_out.contains("x86-64") { "x86_64" } else { "unknown" };

    Ok(PackageAnalysis {
        format: "appimage".into(),
        file_path: path_string,
        package_name: fname.trim_end_matches(".AppImage").trim_end_matches(".appimage").to_string(),
        version: if version.is_empty() { "0.0".into() } else { version },
        description: "AppImage application".into(),
        dependencies: vec![],
        arch: arch.into(),
        size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        extracted_path: None,
        desktop_file: None,
    })
}