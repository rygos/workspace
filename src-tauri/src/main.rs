#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod workspace;

use workspace::{
    apply_staging_edit, clear_workspace_root, create_staging_copy, discard_staging_copy,
    create_staging_plugin, inspect_staging_diff, inspect_workspace, list_staging_copies,
    load_staging_plugin, read_workspace_file,
    search_workspace, set_workspace_root, validate_staging_copy, StagingSequence, WorkspaceAccess,
};

fn main() {
    let builder = tauri::Builder::default()
        .manage(WorkspaceAccess::default())
        .manage(StagingSequence::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(feature = "wdio")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    #[cfg(all(debug_assertions, feature = "wdio"))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let result = builder
        .invoke_handler(tauri::generate_handler![
            set_workspace_root,
            clear_workspace_root,
            create_staging_copy,
            list_staging_copies,
            discard_staging_copy,
            inspect_staging_diff,
            load_staging_plugin,
            create_staging_plugin,
            apply_staging_edit,
            validate_staging_copy,
            inspect_workspace,
            search_workspace,
            read_workspace_file
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("Workshop konnte nicht gestartet werden: {error}");
        std::process::exit(1);
    }
}
