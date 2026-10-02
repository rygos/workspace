use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::io::{Read, Write};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

const MAX_TREE_ENTRIES: usize = 5_000;
const MAX_SEARCH_FILES: usize = 2_000;
const MAX_SEARCH_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_READ_CHARACTERS: usize = 16_000;
const MAX_RESULT_LINE_CHARACTERS: usize = 320;
const MAX_RESULTS: usize = 20;
const MAX_INDEX_ENTRIES: usize = 200;
const MAX_STAGING_ENTRIES: usize = 20_000;
const MAX_STAGING_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STAGING_BYTES: u64 = 100 * 1024 * 1024;
const MAX_STAGING_COPIES: usize = 5;
const MAX_STAGING_DIFF_FILES: usize = 100;
const MAX_STAGING_PLUGIN_MANIFEST_BYTES: u64 = 16 * 1024;
const MAX_STAGING_PLUGIN_ENTRYPOINT_BYTES: u64 = 256 * 1024;
const MAX_VALIDATION_OUTPUT_BYTES: usize = 4 * 1024;
const VALIDATION_TIMEOUT_SECONDS: u64 = 120;

#[derive(Default)]
pub struct WorkspaceAccess {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
pub struct StagingSequence(AtomicU64);

#[derive(Default)]
struct CopyStats {
    entries: usize,
    files: usize,
    directories: usize,
    bytes: u64,
}

impl WorkspaceAccess {
    fn root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .map_err(|_| "Der Projektordner ist vorübergehend nicht verfügbar.".to_owned())?
            .clone()
            .ok_or_else(|| "Wähle zuerst einen Projektordner in den Einstellungen aus.".to_owned())
    }
}

#[tauri::command]
pub fn set_workspace_root(path: String, access: State<'_, WorkspaceAccess>) -> Result<String, String> {
    let root = fs::canonicalize(path)
        .map_err(|_| "Der ausgewählte Projektordner ist nicht erreichbar.".to_owned())?;
    if !root.is_dir() {
        return Err("Der ausgewählte Pfad ist kein Ordner.".to_owned());
    }
    let display = root.to_string_lossy().into_owned();
    *access
        .root
        .lock()
        .map_err(|_| "Der Projektordner ist vorübergehend nicht verfügbar.".to_owned())? =
        Some(root);
    Ok(display)
}

#[tauri::command]
pub fn clear_workspace_root(access: State<'_, WorkspaceAccess>) -> Result<(), String> {
    *access
        .root
        .lock()
        .map_err(|_| "Der Projektordner ist vorübergehend nicht verfügbar.".to_owned())? = None;
    Ok(())
}

#[tauri::command]
pub async fn create_staging_copy(
    app: AppHandle,
    access: State<'_, WorkspaceAccess>,
    sequence: State<'_, StagingSequence>,
) -> Result<Value, String> {
    let source = access.root()?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Die Systemzeit ist ungültig.".to_owned())?
        .as_millis();
    let sequence = sequence.0.fetch_add(1, Ordering::Relaxed);
    let id = format!("stage-{timestamp}-{sequence}");
    tauri::async_runtime::spawn_blocking(move || {
        create_staging_copy_sync(app, source, id, timestamp)
    })
    .await
    .map_err(|_| "Die Erstellung der Staging-Kopie wurde unterbrochen.".to_owned())?
}

fn create_staging_copy_sync(
    app: AppHandle,
    source: PathBuf,
    id: String,
    timestamp: u128,
) -> Result<Value, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    let app_data = fs::canonicalize(app_data)
        .map_err(|_| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    let staging_candidate = app_data.join("staging");
    if source.starts_with(&staging_candidate) || staging_candidate.starts_with(&source) {
        return Err("Der ausgewählte Ordner umfasst den internen Staging-Bereich.".to_owned());
    }
    let staging_root = canonical_staging_root(&app, true)?
        .ok_or_else(|| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    if count_staging_copies(&staging_root)? >= MAX_STAGING_COPIES {
        return Err("Der Staging-Bereich ist voll. Entferne zuerst einen alten Entwurf.".to_owned());
    }

    let destination = staging_root.join(&id);
    fs::create_dir(&destination)
        .map_err(|_| "Der Staging-Ordner konnte nicht angelegt werden.".to_owned())?;
    let project_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Projekt");
    let marker = destination.join(".workshop-stage.json");
    let copying = json!({
        "id": id,
        "projectName": project_name,
        "createdAt": timestamp,
        "filesCopied": 0,
        "directoriesCopied": 0,
        "bytesCopied": 0,
        "status": "copying"
    });
    let marker_bytes = match serde_json::to_vec(&copying) {
        Ok(bytes) => bytes,
        Err(_) => {
            let _ = fs::remove_dir_all(&destination);
            return Err("Der Staging-Eintrag konnte nicht angelegt werden.".to_owned());
        }
    };
    if fs::write(&marker, marker_bytes).is_err() {
        let _ = fs::remove_dir_all(&destination);
        return Err("Der Staging-Eintrag konnte nicht angelegt werden.".to_owned());
    }

    let mut stats = CopyStats::default();
    if copy_workspace_tree(&source, &source, &destination, &mut stats, 0).is_err() {
        let _ = fs::remove_dir_all(&destination);
        return Err("Die Projektkopie überschreitet ein Limit oder enthält nicht lesbare Dateien.".to_owned());
    }
    let record = json!({
        "id": id,
        "projectName": project_name,
        "sourceRoot": source.to_string_lossy(),
        "createdAt": timestamp,
        "filesCopied": stats.files,
        "directoriesCopied": stats.directories,
        "bytesCopied": stats.bytes,
        "status": "complete"
    });
    let metadata_bytes = match serde_json::to_vec(&record) {
        Ok(bytes) => bytes,
        Err(_) => {
            let _ = fs::remove_dir_all(&destination);
            return Err("Der Staging-Eintrag konnte nicht gespeichert werden.".to_owned());
        }
    };
    if fs::write(marker, metadata_bytes).is_err() {
        let _ = fs::remove_dir_all(&destination);
        return Err("Der Staging-Eintrag konnte nicht gespeichert werden.".to_owned());
    }
    Ok(stage_summary(&record))
}

#[tauri::command]
pub fn list_staging_copies(app: AppHandle) -> Result<Vec<Value>, String> {
    let Some(staging_root) = canonical_staging_root(&app, false)? else {
        return Ok(Vec::new());
    };
    let mut copies = Vec::new();
    for entry in fs::read_dir(staging_root)
        .map_err(|_| "Der lokale Staging-Bereich konnte nicht gelesen werden.".to_owned())?
    {
        let entry = entry
            .map_err(|_| "Ein Staging-Eintrag konnte nicht gelesen werden.".to_owned())?;
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
            || !is_staging_id(&entry.file_name().to_string_lossy())
        {
            continue;
        }
        let metadata_path = entry.path().join(".workshop-stage.json");
        let metadata = fs::read(metadata_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        let id = entry.file_name().to_string_lossy().into_owned();
        let Some(mut metadata) = metadata.filter(|metadata| metadata["id"].as_str() == Some(&id)) else {
            copies.push(json!({
                "id": id,
                "projectName": "Unvollständiger Entwurf",
                "createdAt": 0,
                "filesCopied": 0,
                "directoriesCopied": 0,
                "bytesCopied": 0,
                "status": "incomplete"
            }));
            continue;
        };
        if metadata["status"].as_str() == Some("copying") {
            metadata["status"] = json!("incomplete");
        } else if metadata["status"].as_str().is_none() {
            metadata["status"] = json!("complete");
        }
        copies.push(stage_summary(&metadata));
    }
    copies.sort_by(|left, right| {
        right["createdAt"]
            .as_u64()
            .cmp(&left["createdAt"].as_u64())
    });
    copies.truncate(MAX_STAGING_COPIES);
    Ok(copies)
}

#[tauri::command]
pub fn discard_staging_copy(id: String, app: AppHandle) -> Result<(), String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    let root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let target = fs::canonicalize(root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if target.parent() != Some(root.as_path()) || !target.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    fs::remove_dir_all(target).map_err(|_| "Der Staging-Entwurf konnte nicht entfernt werden.".to_owned())
}

#[tauri::command]
pub fn inspect_staging_diff(
    id: String,
    app: AppHandle,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    let selected_root = access.root()?;
    let staging_root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let stage_root = fs::canonicalize(staging_root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if stage_root.parent() != Some(staging_root.as_path()) || !stage_root.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    let metadata = read_stage_metadata(&stage_root, &id)?;
    if metadata["status"].as_str() != Some("complete") {
        return Err("Unvollständige Staging-Kopien können nicht verglichen werden.".to_owned());
    }
    let source = PathBuf::from(
        metadata["sourceRoot"]
            .as_str()
            .ok_or_else(|| "Der Quellordner des Staging-Entwurfs fehlt.".to_owned())?,
    );
    let source = fs::canonicalize(source)
        .map_err(|_| "Der ursprüngliche Projektordner ist nicht mehr erreichbar.".to_owned())?;
    if source != selected_root {
        return Err("Wähle den ursprünglichen Projektordner aus, um diesen Diff zu prüfen.".to_owned());
    }

    let source_files = collect_copyable_files(&source)?;
    let staged_files = collect_copyable_files(&stage_root)?;
    let paths: BTreeSet<String> = source_files
        .keys()
        .chain(staged_files.keys())
        .cloned()
        .collect();
    let mut changes = Vec::new();
    let mut files_compared = 0_usize;
    let mut truncated = false;
    for path in &paths {
        files_compared += 1;
        let original = source_files.get(path);
        let staged = staged_files.get(path);
        let status = match (original, staged) {
            (Some(_), None) => Some("deleted"),
            (None, Some(_)) => Some("added"),
            (Some(original), Some(staged)) => {
                let original_bytes = fs::read(original)
                    .map_err(|_| "Eine Quelldatei konnte nicht gelesen werden.".to_owned())?;
                let staged_bytes = fs::read(staged)
                    .map_err(|_| "Eine Staging-Datei konnte nicht gelesen werden.".to_owned())?;
                (original_bytes != staged_bytes).then_some("modified")
            }
            (None, None) => None,
        };
        if let Some(status) = status {
            if changes.len() >= MAX_STAGING_DIFF_FILES {
                truncated = true;
                break;
            }
            changes.push(json!({
                "path": path,
                "status": status,
                "sourceBytes": original.and_then(|path| fs::metadata(path).ok()).map(|metadata| metadata.len()),
                "stagingBytes": staged.and_then(|path| fs::metadata(path).ok()).map(|metadata| metadata.len())
            }));
        }
    }
    Ok(json!({
        "id": id,
        "projectName": metadata["projectName"],
        "filesCompared": files_compared,
        "changeCount": changes.len(),
        "changes": changes,
        "truncated": truncated
    }))
}

#[tauri::command]
pub fn load_staging_plugin(
    id: String,
    app: AppHandle,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    let selected_root = access.root()?;
    let staging_root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let stage_root = fs::canonicalize(staging_root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if stage_root.parent() != Some(staging_root.as_path()) || !stage_root.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    let metadata = read_stage_metadata(&stage_root, &id)?;
    if metadata["status"].as_str() != Some("complete") {
        return Err("Unvollständige Staging-Kopien können nicht angezeigt werden.".to_owned());
    }
    let source = metadata["sourceRoot"]
        .as_str()
        .ok_or_else(|| "Der Quellordner des Staging-Entwurfs fehlt.".to_owned())?;
    if fs::canonicalize(source).ok().as_ref() != Some(&selected_root) {
        return Err("Wähle den ursprünglichen Projektordner für diese Vorschau aus.".to_owned());
    }

    let manifest_path = resolve_stage_file(&stage_root, Path::new("workshop-plugin.json"))?;
    let manifest_size = fs::metadata(&manifest_path)
        .map_err(|_| "Das Plugin-Manifest konnte nicht gelesen werden.".to_owned())?
        .len();
    if manifest_size > MAX_STAGING_PLUGIN_MANIFEST_BYTES {
        return Err("Das Plugin-Manifest überschreitet 16 KiB.".to_owned());
    }
    let manifest = fs::read_to_string(manifest_path)
        .map_err(|_| "Das Plugin-Manifest enthält keinen lesbaren UTF-8-Text.".to_owned())?;
    let manifest_value: Value = serde_json::from_str(&manifest)
        .map_err(|_| "Das Plugin-Manifest ist kein gültiges JSON.".to_owned())?;
    if manifest_value["entrypoint"].as_str() != Some("plugin.js") {
        return Err(
            "Das Staging-Plugin muss seinen gebündelten Einstieg plugin.js nennen.".to_owned(),
        );
    }

    let entrypoint_path = resolve_stage_file(&stage_root, Path::new("plugin.js"))?;
    let entrypoint_size = fs::metadata(&entrypoint_path)
        .map_err(|_| "Der Plugin-Einstieg konnte nicht gelesen werden.".to_owned())?
        .len();
    if entrypoint_size == 0 || entrypoint_size > MAX_STAGING_PLUGIN_ENTRYPOINT_BYTES {
        return Err("Der Plugin-Einstieg muss zwischen 1 Byte und 256 KiB groß sein.".to_owned());
    }
    let entrypoint = fs::read_to_string(entrypoint_path)
        .map_err(|_| "Der Plugin-Einstieg enthält keinen lesbaren UTF-8-Text.".to_owned())?;
    Ok(json!({ "id": id, "manifest": manifest, "entrypoint": entrypoint }))
}

#[tauri::command]
pub fn create_staging_plugin(
    id: String,
    manifest: String,
    entrypoint: String,
    app: AppHandle,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    if manifest.len() > MAX_STAGING_PLUGIN_MANIFEST_BYTES as usize
        || entrypoint.is_empty()
        || entrypoint.len() > MAX_STAGING_PLUGIN_ENTRYPOINT_BYTES as usize
    {
        return Err("Das Plugin-Artefakt überschreitet die Größenlimits.".to_owned());
    }
    let manifest_value: Value = serde_json::from_str(&manifest)
        .map_err(|_| "Das Plugin-Manifest ist kein gültiges JSON.".to_owned())?;
    let plugin_id = manifest_value["id"]
        .as_str()
        .filter(|value| is_plugin_id(value))
        .ok_or_else(|| "Die Plugin-ID ist ungültig.".to_owned())?;
    let name = manifest_value["name"]
        .as_str()
        .filter(|value| !value.trim().is_empty() && value.len() <= 80)
        .ok_or_else(|| "Der Plugin-Name ist ungültig.".to_owned())?;
    let version = manifest_value["version"]
        .as_str()
        .filter(|value| value.len() <= 80)
        .ok_or_else(|| "Die Plugin-Version ist ungültig.".to_owned())?;
    if manifest_value["entrypoint"].as_str() != Some("plugin.js") {
        return Err("Das Plugin-Manifest muss plugin.js als Einstieg verwenden.".to_owned());
    }
    let permissions = manifest_value["permissions"]
        .as_array()
        .ok_or_else(|| "Die Plugin-Berechtigungen sind ungültig.".to_owned())?;
    if permissions.iter().any(|permission| permission.as_str() != Some("storage"))
        || permissions.len() > 1
    {
        return Err("Die Vorschau unterstützt nur keine Berechtigung oder storage.".to_owned());
    }

    let selected_root = access.root()?;
    let staging_root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let stage_root = fs::canonicalize(staging_root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if stage_root.parent() != Some(staging_root.as_path()) || !stage_root.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    let metadata = read_stage_metadata(&stage_root, &id)?;
    if metadata["status"].as_str() != Some("complete") {
        return Err("Unvollständige Staging-Kopien können nicht bearbeitet werden.".to_owned());
    }
    let source = metadata["sourceRoot"]
        .as_str()
        .ok_or_else(|| "Der Quellordner des Staging-Entwurfs fehlt.".to_owned())?;
    if fs::canonicalize(source).ok().as_ref() != Some(&selected_root) {
        return Err("Wähle den ursprünglichen Projektordner für diesen Entwurf aus.".to_owned());
    }

    let manifest_path = resolve_stage_file(&stage_root, Path::new("workshop-plugin.json"))?;
    let entrypoint_path = resolve_stage_file(&stage_root, Path::new("plugin.js"))?;
    if manifest_path.exists() || entrypoint_path.exists() {
        return Err("Ein Plugin-Artefakt ist bereits vorhanden; vorhandene Dateien werden nicht überschrieben.".to_owned());
    }
    write_new_artifact(&entrypoint_path, entrypoint.as_bytes())?;
    if let Err(error) = write_new_artifact(&manifest_path, manifest.as_bytes()) {
        match fs::remove_file(&entrypoint_path) {
            Ok(()) => return Err(error),
            Err(cleanup_error) => {
                return Err(format!("{error} Der unvollständige Plugin-Einstieg konnte nicht entfernt werden: {cleanup_error}"));
            }
        }
    }
    Ok(json!({
        "id": id,
        "pluginId": plugin_id,
        "name": name,
        "version": version,
        "manifestBytes": manifest.len(),
        "entrypointBytes": entrypoint.len()
    }))
}

fn write_new_artifact(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Das Plugin-Artefakt ist bereits vorhanden oder konnte nicht angelegt werden.".to_owned())?;
    if let Err(error) = file.write_all(contents) {
        drop(file);
        match fs::remove_file(path) {
            Ok(()) => return Err(format!("Das Plugin-Artefakt konnte nicht geschrieben werden: {error}")),
            Err(cleanup_error) => return Err(format!("Das Plugin-Artefakt konnte nicht geschrieben werden: {error}; Teildatei konnte nicht entfernt werden: {cleanup_error}")),
        }
    }
    Ok(())
}

fn is_plugin_id(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some('a'..='z'))
        && value.len() >= 2
        && value.len() <= 63
        && chars.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
}

#[tauri::command]
pub fn apply_staging_edit(
    id: String,
    path: String,
    expected_content: Option<String>,
    content: String,
    app: AppHandle,
) -> Result<Value, String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    if content.len() > MAX_FILE_BYTES as usize {
        return Err("Der neue Dateiinhalt überschreitet 256 KiB.".to_owned());
    }
    let relative = safe_relative_path(&path)?;
    if !is_text_source(&relative)
        || relative.file_name().and_then(|name| name.to_str()).is_some_and(is_secret_file)
        || relative.file_name().and_then(|name| name.to_str()) == Some(".workshop-stage.json")
        || relative.components().filter_map(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        }).any(is_ignored_directory)
    {
        return Err("Der Pfad ist kein erlaubter Quelltextpfad.".to_owned());
    }
    let staging_root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let stage_root = fs::canonicalize(staging_root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if stage_root.parent() != Some(staging_root.as_path()) || !stage_root.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    let metadata = read_stage_metadata(&stage_root, &id)?;
    if metadata["status"].as_str() != Some("complete") {
        return Err("Unvollständige Staging-Kopien können nicht bearbeitet werden.".to_owned());
    }
    let target = resolve_stage_file(&stage_root, &relative)?;
    let (operation, bytes_written) = match expected_content {
        Some(expected) => {
            if expected.is_empty() {
                return Err("Die erwartete Textstelle darf nicht leer sein.".to_owned());
            }
            let current = fs::read_to_string(&target)
                .map_err(|_| "Die Staging-Datei enthält keinen lesbaren UTF-8-Text.".to_owned())?;
            if current.matches(&expected).count() != 1 {
                return Err("Die erwartete Textstelle muss genau einmal in der Datei vorkommen.".to_owned());
            }
            let updated = current.replacen(&expected, &content, 1);
            if updated.len() > MAX_FILE_BYTES as usize {
                return Err("Die bearbeitete Datei überschreitet 256 KiB.".to_owned());
            }
            let bytes_written = updated.len();
            fs::write(&target, updated.as_bytes())
                .map_err(|_| "Die Staging-Datei konnte nicht geändert werden.".to_owned())?;
            ("modified", bytes_written)
        }
        None => {
            if target.exists() {
                return Err("Die neue Datei existiert bereits in der Staging-Kopie.".to_owned());
            }
            fs::write(&target, content.as_bytes())
                .map_err(|_| "Die neue Staging-Datei konnte nicht angelegt werden.".to_owned())?;
            ("added", content.len())
        }
    };
    Ok(json!({ "id": id, "path": normalized_path(&relative), "operation": operation, "bytesWritten": bytes_written }))
}

#[tauri::command]
pub async fn validate_staging_copy(
    id: String,
    gates: Vec<String>,
    app: AppHandle,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    if !is_staging_id(&id) {
        return Err("Die Staging-ID ist ungültig.".to_owned());
    }
    if gates.is_empty()
        || gates.len() > 3
        || gates.iter().any(|gate| !matches!(gate.as_str(), "build" | "check" | "test"))
        || gates.iter().collect::<BTreeSet<_>>().len() != gates.len()
    {
        return Err("Wähle eindeutige Validierungsschritte aus build, check und test.".to_owned());
    }
    let selected_root = access.root()?;
    let staging_root = canonical_staging_root(&app, false)?
        .ok_or_else(|| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    let stage_root = fs::canonicalize(staging_root.join(&id))
        .map_err(|_| "Der Staging-Entwurf wurde nicht gefunden.".to_owned())?;
    if stage_root.parent() != Some(staging_root.as_path()) || !stage_root.is_dir() {
        return Err("Der Staging-Entwurf liegt außerhalb des Staging-Bereichs.".to_owned());
    }
    let metadata = read_stage_metadata(&stage_root, &id)?;
    if metadata["status"].as_str() != Some("complete") {
        return Err("Unvollständige Staging-Kopien können nicht validiert werden.".to_owned());
    }
    let source = metadata["sourceRoot"]
        .as_str()
        .ok_or_else(|| "Der Quellordner des Staging-Entwurfs fehlt.".to_owned())?;
    if fs::canonicalize(source).ok().as_ref() != Some(&selected_root) {
        return Err("Wähle den ursprünglichen Projektordner aus, um diese Kopie zu validieren.".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || run_staging_validation(id, stage_root, gates))
        .await
        .map_err(|_| "Die Staging-Validierung wurde unterbrochen.".to_owned())?
}

fn run_staging_validation(id: String, stage_root: PathBuf, gates: Vec<String>) -> Result<Value, String> {
    let package = stage_root.join("package.json");
    let package_metadata = fs::symlink_metadata(&package)
        .map_err(|_| "In der Staging-Kopie wurde keine package.json gefunden.".to_owned())?;
    if !package_metadata.is_file() || package_metadata.file_type().is_symlink() {
        return Err("Die package.json in der Staging-Kopie ist kein regulärer Datei-Eintrag.".to_owned());
    }
    let mut results = Vec::with_capacity(gates.len());
    for gate in gates {
        let (args, display) = match gate.as_str() {
            "build" => (vec!["run", "build"], "bun run build"),
            "check" => (vec!["run", "check"], "bun run check"),
            "test" => (vec!["test"], "bun test"),
            _ => return Err("Unbekannter Validierungsschritt.".to_owned()),
        };
        results.push(run_validation_gate(&stage_root, &gate, display, &args)?);
    }
    let passed = results.iter().all(|result| result["status"] == "passed");
    Ok(json!({ "id": id, "passed": passed, "results": results }))
}

fn run_validation_gate(stage_root: &Path, gate: &str, command: &str, args: &[&str]) -> Result<Value, String> {
    let mut process = Command::new("bun");
    process
        .args(args)
        .current_dir(stage_root)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "SYSTEMROOT",
        "WINDIR", "APPDATA", "LOCALAPPDATA", "XDG_CACHE_HOME",
    ] {
        if let Some(value) = std::env::var_os(key) {
            process.env(key, value);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }
    let mut child = process.spawn()
        .map_err(|_| "Bun konnte nicht gestartet werden. Installiere Bun oder prüfe den PATH.".to_owned())?;
    let stdout = child.stdout.take().ok_or_else(|| "Die Validierungsausgabe konnte nicht gelesen werden.".to_owned())?;
    let stderr = child.stderr.take().ok_or_else(|| "Die Validierungsausgabe konnte nicht gelesen werden.".to_owned())?;
    let stdout_reader = thread::spawn(move || read_capped_output(stdout));
    let stderr_reader = thread::spawn(move || read_capped_output(stderr));
    let started = std::time::Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed().as_secs() < VALIDATION_TIMEOUT_SECONDS => thread::sleep(std::time::Duration::from_millis(100)),
            Ok(None) => {
                timed_out = true;
                terminate_validation_process(&mut child);
                break child.wait().map_err(|_| "Der Validierungsprozess konnte nicht beendet werden.".to_owned())?;
            }
            Err(_) => return Err("Der Validierungsprozess konnte nicht überwacht werden.".to_owned()),
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    let output = format!("{}{}", String::from_utf8_lossy(&stdout), String::from_utf8_lossy(&stderr));
    let output = redact_validation_output(&output);
    let state = if timed_out { "timed_out" } else if status.success() { "passed" } else { "failed" };
    Ok(json!({
        "gate": gate,
        "command": command,
        "status": state,
        "exitCode": status.code(),
        "durationMs": started.elapsed().as_millis(),
        "output": output,
        "outputTruncated": stdout.len() + stderr.len() >= MAX_VALIDATION_OUTPUT_BYTES
    }))
}

fn terminate_validation_process(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("kill").args(["-KILL", &process_group]).status();
    }
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &pid]).status();
    }
    let _ = child.kill();
}

fn read_capped_output(mut stream: impl Read) -> Vec<u8> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = MAX_VALIDATION_OUTPUT_BYTES.saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    }
    captured
}

fn redact_validation_output(output: &str) -> String {
    let mut redacted = String::with_capacity(output.len().min(MAX_VALIDATION_OUTPUT_BYTES));
    let mut redact_next = false;
    for token in output.split_whitespace() {
        let clean = token.trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '-');
        if redact_next || (clean.starts_with("sk-") && clean.len() >= 10) {
            redacted.push_str(&token.replace(clean, "[GEHEIMNIS ENTFERNT]"));
        } else {
            redacted.push_str(token);
        }
        redact_next = token.eq_ignore_ascii_case("Bearer");
        redacted.push(' ');
    }
    redacted.chars().take(MAX_VALIDATION_OUTPUT_BYTES).collect()
}

fn resolve_stage_file(stage_root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut current = stage_root.to_path_buf();
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err("Der Dateipfad muss relativ zum Staging-Ordner sein.".to_owned());
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink()
                    || (index + 1 < components.len() && !metadata.is_dir())
                    || (index + 1 == components.len() && !metadata.is_file())
                {
                    return Err("Der Staging-Pfad enthält einen Link oder ungültigen Dateityp.".to_owned());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && index + 1 == components.len() => {
                let parent = current.parent().ok_or_else(|| "Der Staging-Pfad ist ungültig.".to_owned())?;
                let canonical_parent = fs::canonicalize(parent)
                    .map_err(|_| "Der übergeordnete Staging-Ordner ist nicht erreichbar.".to_owned())?;
                if !canonical_parent.starts_with(stage_root) {
                    return Err("Der Staging-Pfad liegt außerhalb des Entwurfs.".to_owned());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err("Der übergeordnete Staging-Ordner existiert nicht.".to_owned());
            }
            Err(_) => return Err("Der Staging-Pfad konnte nicht geprüft werden.".to_owned()),
        }
    }
    Ok(current)
}

fn stage_summary(metadata: &Value) -> Value {
    json!({
        "id": metadata["id"],
        "projectName": metadata["projectName"],
        "createdAt": metadata["createdAt"],
        "filesCopied": metadata["filesCopied"],
        "directoriesCopied": metadata["directoriesCopied"],
        "bytesCopied": metadata["bytesCopied"],
        "status": metadata["status"]
    })
}

fn read_stage_metadata(stage_root: &Path, expected_id: &str) -> Result<Value, String> {
    let metadata = fs::read(stage_root.join(".workshop-stage.json"))
        .map_err(|_| "Der Staging-Eintrag konnte nicht gelesen werden.".to_owned())?;
    let metadata: Value = serde_json::from_slice(&metadata)
        .map_err(|_| "Der Staging-Eintrag ist ungültig.".to_owned())?;
    if metadata["id"].as_str() != Some(expected_id) {
        return Err("Die Staging-ID stimmt nicht mit dem Eintrag überein.".to_owned());
    }
    Ok(metadata)
}

fn collect_copyable_files(root: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut directories = vec![(root.to_path_buf(), 0_usize)];
    let mut files = BTreeMap::new();
    let mut entries_seen = 0_usize;
    let mut bytes_seen = 0_u64;
    while let Some((directory, depth)) = directories.pop() {
        if depth > 128 {
            return Err("Die Ordnerstruktur ist zu tief.".to_owned());
        }
        for entry in fs::read_dir(directory)
            .map_err(|_| "Ein Projektordner konnte nicht gelesen werden.".to_owned())?
        {
            entries_seen += 1;
            if entries_seen > MAX_STAGING_ENTRIES {
                return Err("Die Dateiliste überschreitet die Staging-Grenze.".to_owned());
            }
            let entry = entry.map_err(|_| "Ein Projektelement konnte nicht gelesen werden.".to_owned())?;
            let file_type = entry
                .file_type()
                .map_err(|_| "Ein Projektelement konnte nicht geprüft werden.".to_owned())?;
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let Some(name_text) = name.to_str() else {
                continue;
            };
            if file_type.is_dir() {
                if !is_ignored_directory(name_text) {
                    directories.push((entry.path(), depth + 1));
                }
            } else if file_type.is_file()
                && !is_secret_file(name_text)
                && name_text != ".workshop-stage.json"
            {
                let path = fs::canonicalize(entry.path())
                    .map_err(|_| "Eine Projektdatei konnte nicht geprüft werden.".to_owned())?;
                if !path.starts_with(root) {
                    continue;
                }
                let size = fs::metadata(&path)
                    .map_err(|_| "Eine Projektdatei konnte nicht geprüft werden.".to_owned())?
                    .len();
                if size > MAX_STAGING_FILE_BYTES
                    || bytes_seen.saturating_add(size) > MAX_STAGING_BYTES
                {
                    return Err("Das Größenlimit für den Diff wurde überschritten.".to_owned());
                }
                bytes_seen += size;
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| "Ein Projektelement liegt außerhalb des Projektordners.".to_owned())?;
                files.insert(normalized_path(relative), path);
            }
        }
    }
    Ok(files)
}

fn copy_workspace_tree(
    source_root: &Path,
    source: &Path,
    destination: &Path,
    stats: &mut CopyStats,
    depth: usize,
) -> Result<(), String> {
    if depth > 128 {
        return Err("Die Ordnerstruktur ist zu tief.".to_owned());
    }
    for entry in fs::read_dir(source)
        .map_err(|_| "Ein Projektordner konnte nicht gelesen werden.".to_owned())?
    {
        stats.entries += 1;
        if stats.entries > MAX_STAGING_ENTRIES {
            return Err("Zu viele Einträge.".to_owned());
        }
        let entry = entry.map_err(|_| "Ein Projektelement konnte nicht gelesen werden.".to_owned())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Ein Projektelement konnte nicht geprüft werden.".to_owned())?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let Some(name_text) = name.to_str() else {
            continue;
        };
        if file_type.is_dir() {
            if is_ignored_directory(name_text) {
                continue;
            }
            let target = destination.join(&name);
            fs::create_dir(&target)
                .map_err(|_| "Ein Staging-Unterordner konnte nicht angelegt werden.".to_owned())?;
            stats.directories += 1;
            copy_workspace_tree(source_root, &entry.path(), &target, stats, depth + 1)?;
        } else if file_type.is_file()
            && !is_secret_file(name_text)
            && name_text != ".workshop-stage.json"
        {
            let resolved = fs::canonicalize(entry.path())
                .map_err(|_| "Eine Projektdatei konnte nicht geprüft werden.".to_owned())?;
            if !resolved.starts_with(source_root) {
                continue;
            }
            let size = fs::metadata(&resolved)
                .map_err(|_| "Eine Projektdatei konnte nicht geprüft werden.".to_owned())?
                .len();
            if size > MAX_STAGING_FILE_BYTES || stats.bytes.saturating_add(size) > MAX_STAGING_BYTES {
                return Err("Das Größenlimit wurde überschritten.".to_owned());
            }
            fs::copy(&resolved, destination.join(&name))
                .map_err(|_| "Eine Projektdatei konnte nicht kopiert werden.".to_owned())?;
            stats.files += 1;
            stats.bytes += size;
        }
    }
    Ok(())
}

fn count_staging_copies(root: &Path) -> Result<usize, String> {
    let mut count = 0;
    for entry in fs::read_dir(root)
        .map_err(|_| "Der lokale Staging-Bereich konnte nicht gelesen werden.".to_owned())?
    {
        let entry = entry
            .map_err(|_| "Ein Staging-Eintrag konnte nicht gelesen werden.".to_owned())?;
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
            && is_staging_id(&entry.file_name().to_string_lossy())
        {
            count += 1;
        }
    }
    Ok(count)
}

fn canonical_staging_root(app: &AppHandle, create: bool) -> Result<Option<PathBuf>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    let staging = app_data.join("staging");
    if create {
        fs::create_dir_all(&staging)
            .map_err(|_| "Der lokale Staging-Bereich konnte nicht angelegt werden.".to_owned())?;
    } else if !staging.exists() {
        return Ok(None);
    }
    let app_data = fs::canonicalize(app_data)
        .map_err(|_| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    let staging = fs::canonicalize(staging)
        .map_err(|_| "Der lokale Staging-Bereich ist nicht verfügbar.".to_owned())?;
    if staging.parent() != Some(app_data.as_path()) {
        return Err("Der lokale Staging-Bereich liegt außerhalb des Anwendungsordners.".to_owned());
    }
    Ok(Some(staging))
}

fn is_staging_id(value: &str) -> bool {
    value
        .strip_prefix("stage-")
        .is_some_and(|suffix| suffix.split('-').count() == 2 && suffix.split('-').all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())))
}

fn is_secret_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let env_file = lower == ".env" || (lower.starts_with(".env.") && !matches!(lower.as_str(), ".env.example" | ".env.sample" | ".env.template"));
    env_file
        || matches!(lower.as_str(), ".npmrc" | ".netrc" | ".pypirc" | "credentials" | "credentials.json" | "secrets.json" | "id_rsa" | "id_ed25519" | "id_ecdsa" | "id_dsa" | "service-account.json")
        || matches!(Path::new(&lower).extension().and_then(|value| value.to_str()), Some("pem" | "key" | "p12" | "pfx"))
}

#[tauri::command]
pub fn inspect_workspace(
    limit: usize,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    if !(1..=MAX_INDEX_ENTRIES).contains(&limit) {
        return Err("Die Projektübersicht darf höchstens 200 Einträge enthalten.".to_owned());
    }

    let root = access.root()?;
    let project_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Projekt");
    let (mut files, truncated) = collect_files(&root)?;
    files.sort();

    let mut extension_counts = BTreeMap::<String, usize>::new();
    let mut directories = BTreeSet::<String>::new();
    let mut indexed_files = Vec::with_capacity(files.len());
    for path in &files {
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| "Ein Projektelement liegt außerhalb des Projektordners.".to_owned())?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_owned();
        *extension_counts.entry(extension.clone()).or_default() += 1;
        for parent in relative.ancestors().skip(1).filter(|parent| !parent.as_os_str().is_empty()) {
            directories.insert(normalized_path(parent));
        }
        indexed_files.push(json!({
            "path": normalized_path(relative),
            "extension": extension
        }));
    }

    let files_returned = indexed_files.len().min(limit);
    indexed_files.truncate(limit);
    let directories_indexed = directories.len();
    let directories: Vec<String> = directories.into_iter().take(limit).collect();
    let directories_returned = directories.len();
    Ok(json!({
        "projectName": project_name,
        "filesIndexed": files.len(),
        "filesReturned": files_returned,
        "directoriesIndexed": directories_indexed,
        "directoriesReturned": directories_returned,
        "directories": directories,
        "extensionCounts": extension_counts,
        "files": indexed_files,
        "truncated": truncated
            || files_returned < files.len()
            || directories_returned < directories_indexed
    }))
}

#[tauri::command]
pub fn search_workspace(
    query: String,
    limit: usize,
    access: State<'_, WorkspaceAccess>,
) -> Result<Value, String> {
    let query = query.trim();
    if !(2..=160).contains(&query.chars().count()) || !(1..=MAX_RESULTS).contains(&limit) {
        return Err("Die Suche erwartet 2–160 Zeichen und höchstens 20 Treffer.".to_owned());
    }

    let root = access.root()?;
    let (files, mut truncated) = collect_files(&root)?;
    let needle = query.to_lowercase();
    let mut total_bytes = 0_u64;
    let mut scanned = 0_usize;
    let mut matches = Vec::new();

    for path in files {
        if scanned >= MAX_SEARCH_FILES {
            truncated = true;
            break;
        }
        let size = fs::metadata(&path)
            .map_err(|_| "Eine Projektdatei konnte nicht gelesen werden.".to_owned())?
            .len();
        if size > MAX_FILE_BYTES {
            continue;
        }
        total_bytes = total_bytes.saturating_add(size);
        if total_bytes > MAX_SEARCH_BYTES {
            truncated = true;
            break;
        }
        scanned += 1;

        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => continue,
            Err(_) => return Err("Eine Projektdatei konnte nicht gelesen werden.".to_owned()),
        };
        for (line_number, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                let relative = path
                    .strip_prefix(&root)
                    .map_err(|_| "Ein Suchtreffer liegt außerhalb des Projektordners.".to_owned())?;
                matches.push(json!({
                    "path": normalized_path(relative),
                    "line": line_number + 1,
                    "text": line.chars().take(MAX_RESULT_LINE_CHARACTERS).collect::<String>()
                }));
                if matches.len() >= limit {
                    truncated = true;
                    break;
                }
            }
        }
        if matches.len() >= limit {
            break;
        }
    }

    Ok(json!({ "query": query, "matches": matches, "filesScanned": scanned, "truncated": truncated }))
}

#[tauri::command]
pub fn read_workspace_file(path: String, access: State<'_, WorkspaceAccess>) -> Result<Value, String> {
    let root = access.root()?;
    let relative = safe_relative_path(&path)?;
    let resolved = fs::canonicalize(root.join(relative))
        .map_err(|_| "Die angeforderte Projektdatei ist nicht erreichbar.".to_owned())?;
    if !resolved.starts_with(&root) || !is_text_source(&resolved) {
        return Err("Die Datei liegt außerhalb des Projektordners oder ist kein lesbarer Quelltext.".to_owned());
    }
    let size = fs::metadata(&resolved)
        .map_err(|_| "Die angeforderte Projektdatei ist nicht erreichbar.".to_owned())?
        .len();
    if size > MAX_FILE_BYTES {
        return Err("Die Projektdatei überschreitet das Leselimit von 256 KiB.".to_owned());
    }
    let content = fs::read_to_string(&resolved)
        .map_err(|_| "Die angeforderte Datei enthält keinen lesbaren UTF-8-Text.".to_owned())?;
    let truncated = content.chars().count() > MAX_READ_CHARACTERS;
    let content = content.chars().take(MAX_READ_CHARACTERS).collect::<String>();
    Ok(json!({ "path": normalized_path(&safe_relative_path(&path)?), "content": content, "truncated": truncated }))
}

fn collect_files(root: &Path) -> Result<(Vec<PathBuf>, bool), String> {
    let mut directories = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut entries_seen = 0_usize;

    while let Some(directory) = directories.pop() {
        let entries = fs::read_dir(directory)
            .map_err(|_| "Ein Projektordner konnte nicht durchsucht werden.".to_owned())?;
        for entry in entries {
            entries_seen += 1;
            if entries_seen > MAX_TREE_ENTRIES {
                return Ok((files, true));
            }
            let entry = entry.map_err(|_| "Ein Projektordner konnte nicht durchsucht werden.".to_owned())?;
            let file_type = entry
                .file_type()
                .map_err(|_| "Ein Projektelement konnte nicht geprüft werden.".to_owned())?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !is_ignored_directory(&entry.file_name().to_string_lossy()) {
                    directories.push(entry.path());
                }
            } else if file_type.is_file() && is_text_source(&entry.path()) {
                files.push(entry.path());
                if files.len() >= MAX_SEARCH_FILES {
                    return Ok((files, true));
                }
            }
        }
    }

    Ok((files, false))
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let parsed = Path::new(path);
    if parsed.as_os_str().is_empty()
        || parsed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Der Dateipfad muss relativ zum Projektordner sein.".to_owned());
    }
    Ok(parsed.to_path_buf())
}

fn is_ignored_directory(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | "dist" | "build" | ".cache")
}

fn is_text_source(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some(
            "ts" | "tsx" | "js" | "jsx" | "rs" | "json" | "md" | "css" | "html" | "toml"
                | "yaml" | "yml" | "py" | "go" | "java" | "kt" | "swift" | "c" | "h"
                | "cpp" | "hpp" | "cs" | "rb" | "php" | "sh" | "sql" | "xml" | "txt"
                | "vue" | "svelte" | "astro" | "graphql" | "proto"
        )
    )
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
