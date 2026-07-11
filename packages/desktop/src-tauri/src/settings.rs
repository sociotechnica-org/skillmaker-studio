//! Persisted app settings: just the remembered workspace path, stored as
//! a plain JSON file in the app's data directory (`<appDataDir>/settings.json`
//! -- `~/Library/Application Support/studio.skillmaker.desktop/settings.json`
//! on macOS). No `tauri-plugin-store` dependency: the shape is one
//! optional string, and a hand-rolled read/write keeps the Rust surface
//! (and the dependency tree) smaller for something this small. Revisit if
//! settings grow beyond "remember one path".

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Serialize, Deserialize)]
struct SettingsFile {
    workspace: Option<PathBuf>,
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

/// Returns the remembered workspace path, but only if it still exists on
/// disk (a workspace folder can move/be deleted between launches).
pub fn load_remembered_workspace(app_data_dir: &Path) -> Option<PathBuf> {
    let contents = std::fs::read(settings_path(app_data_dir)).ok()?;
    let settings: SettingsFile = serde_json::from_slice(&contents).ok()?;
    settings.workspace.filter(|path| path.is_dir())
}

pub fn remember_workspace(app_data_dir: &Path, workspace: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let settings = SettingsFile {
        workspace: Some(workspace.to_path_buf()),
    };
    let json = serde_json::to_vec_pretty(&settings).expect("SettingsFile always serializes");
    std::fs::write(settings_path(app_data_dir), json)
}
