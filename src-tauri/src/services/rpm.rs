//! .rpm package analysis.

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;
use crate::fish;

pub async fn analyze_rpm(path: &PathBuf) -> Result<PackageAnalysis> {
    let path_string = path.to_string_lossy().to_string();
    let p = shlex::try_quote(&path_string)?.into_owned();
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