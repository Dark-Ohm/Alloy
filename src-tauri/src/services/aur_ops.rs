//! AUR operations via yay.

use anyhow::Result;
use crate::models::PkgbuildReview;
use crate::fish;

/// Search AUR packages.
pub async fn yay_search(q: &str) -> (String, String, i32) {
    let e = shlex::try_quote(q)?.into_owned();
    fish::exec_one(&format!("yay -Ss {e}")).await.unwrap_or_default()
}

/// Generate install script for yay (AUR + official).
pub fn yay_install_script(p: &[String]) -> String {
    format!(
        "yay -S --noconfirm --needed {}",
        p.iter()
            .map(|s| shlex::try_quote(s.as_str()).unwrap().into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    )
}

/// Combined upgrade script (official + AUR).
pub fn upgrade_stream_script() -> String {
    "env LC_ALL=C yay -Syu --noconfirm".into()
}

/// Clean orphaned AUR packages.
pub fn yay_clean_orphans_script() -> String {
    "yay -Yc --noconfirm".into()
}

/// Fetch and parse PKGBUILD from AUR.
pub async fn fetch_pkgbuild(pkg: &str) -> Result<PkgbuildReview> {
    let e = shlex::try_quote(pkg)?.into_owned();
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
        anyhow::bail!("Failed to fetch PKGBUILD: {}", if err.is_empty() { &out } else { &err });
    }
    let content = out.trim().to_string();
    if content.is_empty() {
        anyhow::bail!("PKGBUILD is empty or package not found in AUR");
    }
    Ok(PkgbuildReview { package_name: pkg.to_string(), content })
}

/// Dependency tree (forward - what a package depends on).
pub async fn pactree_forward(pkg: &str) -> (String, String, i32) {
    let e = shlex::try_quote(pkg)?.into_owned();
    fish::exec_one(&format!("pactree {e} 2>/dev/null")).await.unwrap_or_default()
}

/// Dependency tree (reverse - what depends on a package).
pub async fn pactree_reverse(pkg: &str) -> (String, String, i32) {
    let e = shlex::try_quote(pkg)?.into_owned();
    fish::exec_one(&format!("pactree -r {e} 2>/dev/null")).await.unwrap_or_default()
}