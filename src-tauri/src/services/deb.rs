//! .deb package analysis.

use std::path::PathBuf;
use anyhow::Result;
use crate::models::PackageAnalysis;
use crate::fish;
use crate::services::tmp_dir;

pub async fn analyze_deb(path: &PathBuf) -> Result<PackageAnalysis> {
    let path_str = path.to_string_lossy().to_string();
    let p = shlex::try_quote(&path_str)?.into_owned();
    let tmp = tmp_dir();

    // Write awk script to a file to avoid quoting/escaping issues with fish
    let awk_path = format!("{tmp}/parse_control.awk");
    let awk_src = r#"/^Package:/ { v = substr($0, index($0,": ")+2) }
/^Version:/ { e = substr($0, index($0,": ")+2) }
/^Architecture:/ { a = substr($0, index($0,": ")+2) }
/^Description:/ { d = substr($0, index($0,": ")+2) }
/^Installed-Size:/ { s = substr($0, index($0,": ")+2) }
/^Depends:/ { p = substr($0, index($0,": ")+2) }
END { print v; print e; print a; print d; print s; print p }"#;
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
        ("unknown".into(), "0.0".into(), "x86_64".into(), String::new(), "0".into(), String::new())
    };

    let deps: Vec<String> = deps_str
        .split(',')
        .map(|d| d.trim().split_whitespace().next().unwrap_or("").to_string())
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