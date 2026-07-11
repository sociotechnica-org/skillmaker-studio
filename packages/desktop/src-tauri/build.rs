use std::{env, fs, path::PathBuf};

/// Beyond the standard `tauri_build::build()` (which copies the
/// target-triple-named sidecar binary from `binaries/` into the cargo
/// target dir per `bundle.externalBin`), `cargo tauri dev` needs a
/// `viewer-dist/` directory sitting *next to that copied sidecar binary*
/// too -- `packages/cli/src/server/ViewerDist.ts`'s execPath-relative
/// ancestor walk looks for a directory literally named `viewer-dist` in
/// an ancestor of the running binary's own directory. In dev, the sidecar
/// lands in `target/debug/` (see `tauri-plugin-shell`'s
/// `relative_command_path`, which resolves sidecars relative to
/// `current_exe()`'s directory); `tauri_build::build()` only copies the
/// binary itself, not arbitrary directories, so we copy `viewer-dist`
/// there ourselves. The release `.app` bundle case is handled instead by
/// `bundle.macOS.files` in `tauri.conf.json`, which places it at
/// `Contents/MacOS/viewer-dist` -- sibling to the bundled sidecar -- as
/// part of `tauri build`'s bundling step (this build.rs does not run
/// again at that point).
fn copy_viewer_dist_next_to_dev_sidecar() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let src = manifest_dir.join("binaries").join("viewer-dist");
    if !src.exists() {
        // Sidecar staging (scripts/prepare-desktop-sidecar.sh) hasn't run
        // yet -- nothing to copy. `cargo tauri dev`/`build` will still
        // compile; running the sidecar just won't find its viewer assets
        // until the prepare script has been run once.
        println!(
            "cargo:warning=skillmaker-desktop: {} not found; run scripts/prepare-desktop-sidecar.sh (after `bun run build:dist`) before launching the sidecar",
            src.display()
        );
        return;
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    // OUT_DIR is `<target>/<profile>/build/<pkg>-<hash>/out`; the sidecar
    // (and this crate's own dev binary) live in `<target>/<profile>`.
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .expect("OUT_DIR shallower than expected")
        .to_path_buf();

    let dest = profile_dir.join("viewer-dist");
    let _ = fs::remove_dir_all(&dest);
    if let Err(error) = copy_dir_recursive(&src, &dest) {
        println!(
            "cargo:warning=skillmaker-desktop: failed to copy viewer-dist into {}: {error}",
            dest.display()
        );
    }

    println!("cargo:rerun-if-changed={}", src.display());
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_path = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

fn main() {
    copy_viewer_dist_next_to_dev_sidecar();
    tauri_build::build();
}
