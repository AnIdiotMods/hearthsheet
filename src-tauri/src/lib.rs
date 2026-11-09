// Hearthsheet: the whole app is the web front end in ../src. The native side only opens the
// window and provides file dialogs and file access (for importing and exporting XML and fonts).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Hearthsheet");
}
