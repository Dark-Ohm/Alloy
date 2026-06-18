//! Package building utilities.

use std::path::PathBuf;
use anyhow::Result;
use tokio::sync::mpsc;
use crate::models::{PackageAnalysis, StreamEvent};
use crate::fish;

pub async fn build_arch_pkg(
    pkg: &PackageAnalysis,
    tx: &mpsc::Sender<StreamEvent>,
) -> Result<PathBuf> {
    let out_dir_str = format!("/tmp/alloy-build-{}", crate::services::now_nanos());
    let _ = std::fs::create_dir_all(&out_dir_str);

    if pkg.format == "tar" {
        let extracted = pkg.extracted_path.as_deref().unwrap_or("/tmp");
        let script = format!("cd {extracted} && PKGDIR={out_dir_str} makepkg --nodeps --noconfirm 2>&1");
        let _ = tx.send(StreamEvent::Stdout { line: format!("Building with makepkg in {extracted}") }).await;
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
        let _ = tx.send(StreamEvent::Stdout { line: "Building package from .rpm...".into() }).await;
        let (stdout, stderr, code) = fish::exec_one(&script).await?;
        let _ = tx.send(StreamEvent::Stdout { line: stdout }).await;
        if code != 0 {
            let _ = tx.send(StreamEvent::Stderr { line: stderr }).await;
            anyhow::bail!("makepkg failed with code {code}");
        }
    } else {
        // .deb - skip debtap, create our own PKGBUILD
        let deb_path = &pkg.file_path;
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
        let _ = tx.send(StreamEvent::Stdout { line: "Building package from .deb...".into() }).await;
        let (stdout, stderr, code) = fish::exec_one(&script).await?;
        let _ = tx.send(StreamEvent::Stdout { line: stdout }).await;
        if code != 0 {
            let _ = tx.send(StreamEvent::Stderr { line: stderr }).await;
            anyhow::bail!("makepkg failed with code {code}");
        }
    }

    for entry in std::fs::read_dir(&out_dir_str)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().ends_with(".pkg.tar.zst") {
            return Ok(entry.path());
        }
    }
    anyhow::bail!("No .pkg.tar.zst produced")
}

pub async fn install_pkg_file(
    pkg_path: &PathBuf,
    tx: &mpsc::Sender<StreamEvent>,
) -> Result<()> {
    let path_string = pkg_path.to_string_lossy().to_string();
    let p = shlex::try_quote(&path_string)?.into_owned();
    let _ = tx.send(StreamEvent::Stdout { line: format!("pkexec pacman -U --noconfirm {p}") }).await;
    let script = format!("echo -e '1\\\ny' | pkexec pacman -U --noconfirm {p}");
    fish::exec_streaming(&script, false, tx.clone()).await?;
    Ok(())
}