use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tauri::State;

use crate::engine_paths;

fn append_model_log(message: &str) {
    let log_dir = crate::app_paths::app_root_dir().join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let line = format!("[{}] [model] {}\n", timestamp, message);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("galaxy-app.log"))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[derive(Clone)]
pub struct LlamaState {
    pub process: Arc<Mutex<Option<Child>>>,
    pub session: Arc<Mutex<Option<ModelSession>>>,
    pub profiles: Arc<Mutex<HashMap<String, ObservedLoadProfile>>>,
    pub transition_lock: Arc<Mutex<()>>,
}

#[derive(Clone)]
pub struct ModelSession {
    pub model_path: String,
    pub model_name: String,
    pub context_size: u32,
    pub threads: u32,
    pub preferred_gpu_layers: u32,
    pub active_gpu_layers: u32,
    pub reduced_gpu_layers: u32,
    pub requested_gpu_layers: u32,
    pub has_vision: bool,
}

#[derive(Clone, Debug)]
pub struct ObservedLoadProfile {
    pub applied_gpu_layers: u32,
    pub offload_mmproj_to_gpu: bool,
    pub offload_kv_to_gpu: bool,
    pub fit_target_mb: Option<u32>,
}

#[derive(serde::Serialize)]
pub struct ModelStatus {
    pub status: String,
    pub message: String,
    pub has_vision: bool,
    pub model_name: String,
    pub model_path: String,
    pub gpu_layers: u32,
}

#[derive(serde::Serialize)]
pub struct ModelLoadStatus {
    pub state: String,
    pub message: String,
    pub progress: u8,
}

#[derive(serde::Serialize)]
pub struct LoadedModelMemoryStatus {
    pub label: String,
    pub available: bool,
    pub percent: u8,
    pub summary: String,
}

#[derive(serde::Serialize)]
pub struct ModelLibraryEntry {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub has_vision: bool,
}

#[derive(Clone, Debug)]
struct MemoryPlacementPlan {
    applied_gpu_layers: u32,
    offload_mmproj_to_gpu: bool,
    offload_kv_to_gpu: bool,
    fit_target_mb: Option<u32>,
}

fn load_profile_key(model_path: &str, context_size: u32, requested_gpu_layers: u32) -> String {
    format!("{model_path}|{context_size}|{requested_gpu_layers}")
}

fn find_mmproj_path(model_path: &Path) -> Option<PathBuf> {
    let parent = model_path.parent()?;
    let entries = std::fs::read_dir(parent).ok()?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.contains("mmproj") && name.ends_with(".gguf") {
            return Some(entry.path());
        }
    }

    None
}

fn model_looks_multimodal(model_path: &Path) -> bool {
    if find_mmproj_path(model_path).is_some() {
        return true;
    }

    let name = model_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    [
        "llava",
        "minicpm",
        "moondream",
        "qwen2-vl",
        "qwen2.5-vl",
        "qwen-vl",
        "gemma-3",
        "gemma3",
        "vision",
        "-vl",
        "_vl",
    ]
    .iter()
    .any(|needle| name.contains(needle))
}

fn model_sidecar_yml_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("yml")
}

fn model_id_from_file_name(file_name: &str) -> String {
    let stem = file_name
        .strip_suffix(".gguf")
        .or_else(|| file_name.strip_suffix(".GGUF"))
        .unwrap_or(file_name);
    stem.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn yaml_plain_value(value: &str) -> String {
    value
        .replace('\\', "/")
        .replace('\r', " ")
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn jan_model_relative_path(root: &Path, path: &Path) -> String {
    let relative_path = path.strip_prefix(root).unwrap_or(path);
    let base = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("models");
    format!(
        "llamacpp/models/{}/{}",
        yaml_plain_value(base),
        yaml_plain_value(&relative_path.to_string_lossy())
    )
}

fn ensure_model_sidecar_yml(root: &Path, model_path: &Path) -> Result<Option<PathBuf>, String> {
    let sidecar_path = model_sidecar_yml_path(model_path);
    if sidecar_path.exists() {
        return Ok(Some(sidecar_path));
    }

    let file_name = model_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Model file name is not valid Unicode.".to_string())?;
    let model_id = model_path
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .map(yaml_plain_value)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| model_id_from_file_name(file_name));
    let model_size_bytes = std::fs::metadata(model_path)
        .map_err(|e| format!("Could not read model file metadata: {}", e))?
        .len();
    let mmproj_path = find_mmproj_path(model_path);
    let mmproj_size_bytes = mmproj_path
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let total_size_bytes = model_size_bytes.saturating_add(mmproj_size_bytes);
    let mut content = String::new();
    content.push_str("embedding: false\n");
    if let Some(mmproj_path) = mmproj_path {
        content.push_str(&format!(
            "mmproj_path: {}\n",
            jan_model_relative_path(root, &mmproj_path)
        ));
    }
    content.push_str(&format!(
        "model_path: {}\n",
        jan_model_relative_path(root, model_path)
    ));
    content.push_str(&format!("name: {}\n", yaml_plain_value(&model_id)));
    content.push_str(&format!("size_bytes: {}\n", total_size_bytes));

    std::fs::write(&sidecar_path, content)
        .map_err(|e| format!("Could not create model sidecar YAML: {}", e))?;
    Ok(Some(sidecar_path))
}

fn summarize_load_from_log(log_text: &str) -> ModelLoadStatus {
    let meaningful_line = log_text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.starts_with("request: GET /health")
                && !line.starts_with("request: OPTIONS")
        })
        .unwrap_or("Launching model process...");

    if let Some(line) = log_text.lines().rev().map(str::trim).find(|line| {
        let lower = line.to_lowercase();
        !line.is_empty()
            && (lower.starts_with("error:")
                || lower.contains(" failed")
                || lower.contains("invalid argument")
                || lower.contains("unknown model architecture")
                || lower.contains("not supported"))
    }) {
        return ModelLoadStatus {
            state: "error".to_string(),
            message: line.to_string(),
            progress: 100,
        };
    }

    if log_text.contains("main: server is listening") {
        return ModelLoadStatus {
            state: "ready".to_string(),
            message: "Model loaded. Server is ready.".to_string(),
            progress: 100,
        };
    }

    if log_text.contains("main: model loaded") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: "Model loaded. Starting server...".to_string(),
            progress: 95,
        };
    }

    if log_text.contains("warming up the model") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: "Warming up model...".to_string(),
            progress: 85,
        };
    }

    if log_text.contains("llama_init_from_model:") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: meaningful_line.to_string(),
            progress: 70,
        };
    }

    if log_text.contains("load_tensors:") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: meaningful_line.to_string(),
            progress: 55,
        };
    }

    if log_text.contains("llama_model_loader:") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: "Reading model metadata...".to_string(),
            progress: 30,
        };
    }

    if log_text.contains("main: loading model") {
        return ModelLoadStatus {
            state: "loading".to_string(),
            message: "Loading model into memory...".to_string(),
            progress: 10,
        };
    }

    ModelLoadStatus {
        state: "starting".to_string(),
        message: meaningful_line.to_string(),
        progress: 5,
    }
}

fn stop_running_process(process: &mut Option<Child>) {
    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn shutdown_model_process(state: &LlamaState) {
    let _transition_guard = state.transition_lock.lock().unwrap();
    let mut process_guard = state.process.lock().unwrap();
    stop_running_process(&mut process_guard);

    if let Ok(mut session_guard) = state.session.lock() {
        *session_guard = None;
    }
}

fn query_process_working_set_mb(process_id: u32) -> Option<u64> {
    let script = format!(
        "$p = Get-Process -Id {} -ErrorAction Stop; [math]::Round($p.WorkingSet64 / 1MB)",
        process_id
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .ok()
}

fn file_size_mb(path: &Path) -> Option<u64> {
    let bytes = std::fs::metadata(path).ok()?.len();
    Some((bytes as f64 / (1024.0 * 1024.0)).round() as u64)
}

fn query_total_vram_mb() -> Option<u32> {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .and_then(|value| value.parse::<u32>().ok())
}

fn reserved_vram_mb(total_vram_mb: u32) -> u64 {
    match total_vram_mb {
        0..=8192 => 1024,
        8193..=12288 => 1536,
        _ => 2048,
    }
}

fn estimate_kv_cache_mb(model_size_mb: u64, context_size: u32) -> u64 {
    let model_size_gb = model_size_mb as f64 / 1024.0;
    let mb_per_token = (model_size_gb * 0.12).clamp(0.35, 1.25);
    ((context_size as f64) * mb_per_token).round() as u64
}

fn plan_from_observed_profile(
    profile: &ObservedLoadProfile,
    requested_gpu_layers: u32,
) -> MemoryPlacementPlan {
    MemoryPlacementPlan {
        applied_gpu_layers: profile.applied_gpu_layers.min(requested_gpu_layers),
        offload_mmproj_to_gpu: profile.offload_mmproj_to_gpu,
        offload_kv_to_gpu: profile.offload_kv_to_gpu,
        fit_target_mb: profile.fit_target_mb,
    }
}

fn plan_memory_placement_with_vram(
    total_vram_mb: u32,
    model_size_mb: u64,
    context_size: u32,
    requested_gpu_layers: u32,
) -> MemoryPlacementPlan {
    if total_vram_mb == 0 || requested_gpu_layers == 0 {
        return MemoryPlacementPlan {
            applied_gpu_layers: requested_gpu_layers,
            offload_mmproj_to_gpu: false,
            offload_kv_to_gpu: false,
            fit_target_mb: None,
        };
    }

    let reserve_mb = reserved_vram_mb(total_vram_mb);
    let kv_cache_mb = estimate_kv_cache_mb(model_size_mb, context_size);

    // Default policy: keep projector on CPU so the main model gets first claim on VRAM.
    let offload_mmproj_to_gpu = false;
    let available_after_model_reserve = (total_vram_mb as u64).saturating_sub(reserve_mb);

    // KV stays on GPU only if the weight estimate still leaves comfortable headroom.
    let projected_with_gpu_kv = model_size_mb
        .saturating_add(kv_cache_mb)
        .saturating_add(reserve_mb);
    let offload_kv_to_gpu = projected_with_gpu_kv <= total_vram_mb as u64;

    let kv_budget_mb = if offload_kv_to_gpu { kv_cache_mb } else { 0 };
    let available_for_weights_mb = available_after_model_reserve.saturating_sub(kv_budget_mb);

    let applied_gpu_layers = if model_size_mb == 0 || available_for_weights_mb >= model_size_mb {
        requested_gpu_layers
    } else if available_for_weights_mb < 256 {
        0
    } else {
        let ratio = (available_for_weights_mb as f64 / model_size_mb as f64).clamp(0.05, 1.0);
        ((requested_gpu_layers as f64 * ratio).floor() as u32)
            .max(1)
            .min(requested_gpu_layers)
    };

    MemoryPlacementPlan {
        applied_gpu_layers,
        offload_mmproj_to_gpu,
        offload_kv_to_gpu,
        fit_target_mb: Some(reserve_mb as u32),
    }
}

fn plan_memory_placement(
    model_path: &Path,
    context_size: u32,
    requested_gpu_layers: u32,
) -> MemoryPlacementPlan {
    let total_vram_mb = query_total_vram_mb().unwrap_or(0);
    let model_size_mb = file_size_mb(model_path).unwrap_or(0);
    plan_memory_placement_with_vram(
        total_vram_mb,
        model_size_mb,
        context_size,
        requested_gpu_layers,
    )
}

fn parse_log_offloaded_layers(log_text: &str) -> Option<u32> {
    log_text.lines().find_map(|line| {
        let marker = "offloaded ";
        let start = line.find(marker)? + marker.len();
        let rest = &line[start..];
        let end = rest.find('/')?;
        rest[..end].trim().parse::<u32>().ok()
    })
}

fn parse_log_fit_target_mb(log_text: &str) -> Option<u32> {
    log_text.lines().find_map(|line| {
        let marker = ">=";
        let start = line.find(marker)? + marker.len();
        let rest = line[start..].trim();
        let end = rest.find("MiB")?;
        rest[..end].trim().parse::<u32>().ok()
    })
}

fn parse_observed_load_profile(log_text: &str) -> Option<ObservedLoadProfile> {
    let applied_gpu_layers = parse_log_offloaded_layers(log_text)?;
    let offload_kv_to_gpu = !log_text.contains("CPU KV buffer size");
    let offload_mmproj_to_gpu = if log_text.contains("CLIP using CPU backend") {
        false
    } else if log_text.contains("CLIP using CUDA backend") {
        true
    } else {
        false
    };

    Some(ObservedLoadProfile {
        applied_gpu_layers,
        offload_mmproj_to_gpu,
        offload_kv_to_gpu,
        fit_target_mb: parse_log_fit_target_mb(log_text),
    })
}

fn build_model_command(
    server_path: &Path,
    model_path: &Path,
    context_size: u32,
    threads: u32,
    gpu_layers: u32,
    engine_dir: &Path,
    observed_profile: Option<&ObservedLoadProfile>,
) -> Result<(Command, bool, MemoryPlacementPlan), String> {
    let server_supports_mmproj = engine_paths::supports_mmproj(server_path);
    if model_looks_multimodal(model_path) && !server_supports_mmproj {
        let build = engine_paths::build_number(server_path)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Err(format!(
            "The current engine build ({}) does not support multimodal server loading. Updating to the latest runtime engine is required.",
            build
        ));
    }

    let server_help = engine_paths::read_server_help(server_path).unwrap_or_default();
    let placement = observed_profile
        .map(|profile| plan_from_observed_profile(profile, gpu_layers))
        .unwrap_or_else(|| plan_memory_placement(model_path, context_size, gpu_layers));

    let mut command = Command::new(server_path);
    command.current_dir(engine_dir);
    command
        .arg("-m")
        .arg(model_path)
        .arg("-c")
        .arg(context_size.to_string())
        .arg("-t")
        .arg(threads.max(1).to_string())
        .arg("-ngl")
        .arg(placement.applied_gpu_layers.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("8080");

    if server_help.contains("--parallel") {
        command.arg("--parallel").arg("1");
    }
    if server_help.contains("--jinja") {
        command.arg("--jinja");
    }
    if server_help.contains("--reasoning") {
        command.arg("--reasoning").arg("auto");
    }
    if server_help.contains("--cache-ram") {
        command.arg("--cache-ram").arg("512");
    }
    if server_help.contains("--fit") {
        command.arg("--fit").arg("on");
    }
    if let Some(target_mb) = placement.fit_target_mb {
        if server_help.contains("--fit-target") {
            command.arg("--fit-target").arg(target_mb.to_string());
        }
    }
    if !placement.offload_kv_to_gpu && server_help.contains("--no-kv-offload") {
        command.arg("--no-kv-offload");
    }

    let mut has_vision = false;
    if let Some(mmproj_path) = find_mmproj_path(model_path) {
        command.arg("--mmproj").arg(mmproj_path);
        if !placement.offload_mmproj_to_gpu && server_help.contains("--no-mmproj-offload") {
            command.arg("--no-mmproj-offload");
        }
        has_vision = true;
    }

    Ok((command, has_vision, placement))
}

fn relaunch_model(
    process_guard: &mut Option<Child>,
    model_path: &str,
    context_size: u32,
    threads: u32,
    gpu_layers: u32,
    observed_profile: Option<&ObservedLoadProfile>,
) -> Result<(bool, u32), String> {
    let server_path = engine_paths::llama_server_path()
        .map_err(|e| format!("Failed to resolve engine path: {}", e))?;
    let engine_dir = server_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "Failed to resolve engine directory.".to_string())?;

    if !server_path.exists() {
        return Err(
            "Engine not found. Please wait for the background download to finish, or restart the app."
                .to_string(),
        );
    }

    let log_path = engine_paths::engine_log_path()
        .map_err(|e| format!("Failed to resolve log path: {}", e))?;
    let log_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("Failed to create log file: {}", e))?;
    let err_file = log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone log file: {}", e))?;

    stop_running_process(process_guard);

    let model_path_buf = PathBuf::from(model_path);
    let (mut command, has_vision, placement) = build_model_command(
        &server_path,
        &model_path_buf,
        context_size,
        threads,
        gpu_layers,
        &engine_dir,
        observed_profile,
    )?;
    command.stdout(std::process::Stdio::from(log_file));
    command.stderr(std::process::Stdio::from(err_file));
    crate::process_util::hide_window(&mut command);

    append_model_log(&format!(
        "launch requested model={} context={} threads={} requested_gpu_layers={} applied_gpu_layers={} has_vision={} engine={} log={}",
        model_path,
        context_size,
        threads.max(1),
        gpu_layers,
        placement.applied_gpu_layers,
        has_vision,
        server_path.display(),
        log_path.display()
    ));

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start llama-server.exe: {}", e))?;
    append_model_log(&format!(
        "process started pid={} model={}",
        child.id(),
        model_path
    ));
    *process_guard = Some(child);
    Ok((has_vision, placement.applied_gpu_layers))
}

fn collect_gguf_files(root: &Path, current: &Path, found: &mut Vec<ModelLibraryEntry>) {
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_gguf_files(root, &path, found);
            continue;
        }

        let is_gguf = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false);
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();

        if !is_gguf || file_name.contains("mmproj") {
            continue;
        }

        if let Err(error) = ensure_model_sidecar_yml(root, &path) {
            eprintln!(
                "Could not create model sidecar YAML for {}: {}",
                path.display(),
                error
            );
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        let mut folder_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or_else(|| {
                path.file_name()
                    .unwrap_or_default()
                    .to_str()
                    .unwrap_or_default()
            })
            .to_string();
        if let Some(index) = folder_name.find('-') {
            folder_name.truncate(index);
        }

        found.push(ModelLibraryEntry {
            path: path.to_string_lossy().to_string(),
            name: folder_name,
            relative_path,
            has_vision: model_looks_multimodal(&path),
        });
    }
}

fn update_observed_profile_from_log(state: &LlamaState, log_text: &str) {
    let Some(observed) = parse_observed_load_profile(log_text) else {
        return;
    };

    let session_snapshot = {
        let session_guard = state.session.lock().unwrap();
        session_guard.clone()
    };

    let Some(session) = session_snapshot else {
        return;
    };

    let key = load_profile_key(
        &session.model_path,
        session.context_size,
        session.requested_gpu_layers,
    );
    {
        let mut profiles_guard = state.profiles.lock().unwrap();
        profiles_guard.insert(key, observed.clone());
        profiles_guard.insert(
            load_profile_key(
                &session.model_path,
                session.context_size,
                observed.applied_gpu_layers,
            ),
            observed.clone(),
        );
    }

    let mut session_guard = state.session.lock().unwrap();
    if let Some(current) = session_guard.as_mut() {
        current.active_gpu_layers = observed.applied_gpu_layers;
        if current.requested_gpu_layers >= current.preferred_gpu_layers {
            current.preferred_gpu_layers = observed.applied_gpu_layers;
            current.reduced_gpu_layers =
                current.reduced_gpu_layers.min(current.preferred_gpu_layers);
        } else if current.requested_gpu_layers <= current.reduced_gpu_layers {
            current.reduced_gpu_layers = observed.applied_gpu_layers;
        }
    }
}

#[tauri::command]
pub fn scan_model_folder(folder_path: String) -> Result<Vec<ModelLibraryEntry>, String> {
    let folder = PathBuf::from(folder_path);
    if !folder.exists() {
        return Err("The selected model folder does not exist anymore.".to_string());
    }
    if !folder.is_dir() {
        return Err("Choose a folder that contains your GGUF models.".to_string());
    }

    let mut found = Vec::new();
    collect_gguf_files(&folder, &folder, &mut found);
    found.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(found)
}

#[tauri::command]
pub fn get_model_load_status(state: State<'_, LlamaState>) -> ModelLoadStatus {
    let log_path = match engine_paths::engine_log_path() {
        Ok(path) => path,
        Err(e) => {
            return ModelLoadStatus {
                state: "error".to_string(),
                message: format!("Failed to resolve log path: {}", e),
                progress: 100,
            };
        }
    };
    let log_text = std::fs::read_to_string(&log_path).unwrap_or_default();
    let mut process_guard = state.process.lock().unwrap();

    if let Some(child) = process_guard.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                *process_guard = None;
                if let Ok(mut session_guard) = state.session.lock() {
                    *session_guard = None;
                }
                append_model_log(&format!("process exited status={}", status));

                let summary = summarize_load_from_log(&log_text);
                if summary.state == "ready" {
                    update_observed_profile_from_log(state.inner(), &log_text);
                    return summary;
                }

                return ModelLoadStatus {
                    state: "error".to_string(),
                    message: if status.success() {
                        summary.message
                    } else {
                        format!("Model process exited early. {}", summary.message)
                    },
                    progress: 100,
                };
            }
            Ok(None) => {
                let summary = summarize_load_from_log(&log_text);
                if summary.state == "ready" {
                    update_observed_profile_from_log(state.inner(), &log_text);
                }
                return summary;
            }
            Err(e) => {
                return ModelLoadStatus {
                    state: "error".to_string(),
                    message: format!("Failed to poll model process: {}", e),
                    progress: 100,
                };
            }
        }
    }

    if log_text.is_empty() {
        ModelLoadStatus {
            state: "idle".to_string(),
            message: "No model is loading.".to_string(),
            progress: 0,
        }
    } else {
        ModelLoadStatus {
            state: "idle".to_string(),
            message: "No active model process. Load the brain again before chatting.".to_string(),
            progress: 0,
        }
    }
}

#[tauri::command]
pub fn get_loaded_model_memory_status(state: State<'_, LlamaState>) -> LoadedModelMemoryStatus {
    let process_id = {
        let process_guard = state.process.lock().unwrap();
        process_guard.as_ref().map(|child| child.id())
    };

    let Some(process_id) = process_id else {
        return LoadedModelMemoryStatus {
            label: "LOADED RAM".to_string(),
            available: false,
            percent: 0,
            summary: "No model".to_string(),
        };
    };

    match query_process_working_set_mb(process_id) {
        Some(working_set_mb) => LoadedModelMemoryStatus {
            label: "LOADED RAM".to_string(),
            available: true,
            percent: ((working_set_mb as f32 / 32768.0) * 100.0)
                .round()
                .clamp(1.0, 100.0) as u8,
            summary: format!("{} MB", working_set_mb),
        },
        None => LoadedModelMemoryStatus {
            label: "LOADED RAM".to_string(),
            available: false,
            percent: 0,
            summary: "Unknown".to_string(),
        },
    }
}

#[tauri::command]
pub fn start_model(
    state: State<'_, LlamaState>,
    model_path: String,
    context_size: u32,
    threads: u32,
    gpu_layers: u32,
    reduced_gpu_layers: u32,
) -> ModelStatus {
    start_model_state(
        state.inner(),
        model_path,
        context_size,
        threads,
        gpu_layers,
        reduced_gpu_layers,
    )
}

pub fn active_model_path_if_running(state: &LlamaState) -> Option<String> {
    let process_running = state
        .process
        .lock()
        .ok()
        .and_then(|mut guard| {
            guard.as_mut().map(|child| {
                child
                    .try_wait()
                    .map(|status| status.is_none())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if !process_running {
        return None;
    }
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|session| session.model_path.clone()))
}

pub fn start_model_state(
    state: &LlamaState,
    model_path: String,
    context_size: u32,
    threads: u32,
    gpu_layers: u32,
    reduced_gpu_layers: u32,
) -> ModelStatus {
    let model_path_buf = PathBuf::from(&model_path);
    let mut model_name = model_path_buf
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| {
            model_path_buf
                .file_name()
                .unwrap_or_default()
                .to_str()
                .unwrap_or_default()
        })
        .to_string();
    if let Some(index) = model_name.find('-') {
        model_name.truncate(index);
    }
    let _transition_guard = state.transition_lock.lock().unwrap();
    let mut process_guard = state.process.lock().unwrap();
    let process_is_running = if let Some(child) = process_guard.as_mut() {
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(status)) => {
                append_model_log(&format!(
                    "existing process exited before start request status={}",
                    status
                ));
                *process_guard = None;
                false
            }
            Err(error) => {
                append_model_log(&format!(
                    "could not poll existing process before start request error={}",
                    error
                ));
                false
            }
        }
    } else {
        false
    };
    if process_is_running {
        if let Ok(session_guard) = state.session.lock() {
            if let Some(session) = session_guard.as_ref() {
                if session.model_path == model_path
                    && session.context_size == context_size
                    && session.threads == threads.max(1)
                {
                    append_model_log(&format!(
                        "start request reused running process model={} active_gpu_layers={} requested_gpu_layers={}",
                        model_path, session.active_gpu_layers, gpu_layers
                    ));
                    return ModelStatus {
                        status: "success".to_string(),
                        message: format!("Model is already running: {}", session.model_name),
                        has_vision: session.has_vision,
                        model_name: session.model_name.clone(),
                        model_path: session.model_path.clone(),
                        gpu_layers: session.active_gpu_layers,
                    };
                }
            }
        }
    }
    let cached_profile = {
        let profiles_guard = state.profiles.lock().unwrap();
        profiles_guard
            .get(&load_profile_key(&model_path, context_size, gpu_layers))
            .cloned()
    };

    match relaunch_model(
        &mut process_guard,
        &model_path,
        context_size,
        threads,
        gpu_layers,
        cached_profile.as_ref(),
    ) {
        Ok((has_vision, applied_gpu_layers)) => {
            let reduced_gpu_layers = reduced_gpu_layers.min(applied_gpu_layers);
            let mut session_guard = state.session.lock().unwrap();
            *session_guard = Some(ModelSession {
                model_path: model_path.clone(),
                model_name: model_name.clone(),
                context_size,
                threads: threads.max(1),
                preferred_gpu_layers: applied_gpu_layers,
                active_gpu_layers: applied_gpu_layers,
                reduced_gpu_layers,
                requested_gpu_layers: gpu_layers,
                has_vision,
            });

            ModelStatus {
                status: "success".to_string(),
                message: format!("Started model: {}", model_name),
                has_vision,
                model_name,
                model_path,
                gpu_layers: applied_gpu_layers,
            }
        }
        Err(message) if message.contains("does not support multimodal") => ModelStatus {
            status: "engine_update_required".to_string(),
            message,
            has_vision: false,
            model_name,
            model_path,
            gpu_layers,
        },
        Err(message) => ModelStatus {
            status: "error".to_string(),
            message,
            has_vision: false,
            model_name,
            model_path,
            gpu_layers,
        },
    }
}

#[tauri::command]
pub fn prepare_model_for_aux_task(state: State<'_, LlamaState>) -> ModelStatus {
    prepare_model_for_aux_task_state(state.inner())
}

pub fn prepare_model_for_aux_task_state(state: &LlamaState) -> ModelStatus {
    let _transition_guard = state.transition_lock.lock().unwrap();
    let session = {
        let session_guard = state.session.lock().unwrap();
        session_guard.clone()
    };

    let Some(session) = session else {
        return ModelStatus {
            status: "info".to_string(),
            message: "No active model to adjust.".to_string(),
            has_vision: false,
            model_name: String::new(),
            model_path: String::new(),
            gpu_layers: 0,
        };
    };

    if session.active_gpu_layers <= session.reduced_gpu_layers {
        return ModelStatus {
            status: "success".to_string(),
            message: "Model is already in low-power mode.".to_string(),
            has_vision: session.has_vision,
            model_name: session.model_name,
            model_path: session.model_path,
            gpu_layers: session.active_gpu_layers,
        };
    }

    let mut process_guard = state.process.lock().unwrap();
    let cached_profile = {
        let profiles_guard = state.profiles.lock().unwrap();
        profiles_guard
            .get(&load_profile_key(
                &session.model_path,
                session.context_size,
                session.reduced_gpu_layers,
            ))
            .cloned()
    };
    match relaunch_model(
        &mut process_guard,
        &session.model_path,
        session.context_size,
        session.threads,
        session.reduced_gpu_layers,
        cached_profile.as_ref(),
    ) {
        Ok((has_vision, applied_gpu_layers)) => {
            let mut session_guard = state.session.lock().unwrap();
            if let Some(current) = session_guard.as_mut() {
                current.active_gpu_layers = applied_gpu_layers;
                current.requested_gpu_layers = session.reduced_gpu_layers;
                current.has_vision = has_vision;
            }

            ModelStatus {
                status: "success".to_string(),
                message: "Graphics power shifted for an extra task.".to_string(),
                has_vision,
                model_name: session.model_name,
                model_path: session.model_path,
                gpu_layers: applied_gpu_layers,
            }
        }
        Err(message) => ModelStatus {
            status: "error".to_string(),
            message,
            has_vision: session.has_vision,
            model_name: session.model_name,
            model_path: session.model_path,
            gpu_layers: session.active_gpu_layers,
        },
    }
}

#[tauri::command]
pub fn restore_model_after_aux_task(state: State<'_, LlamaState>) -> ModelStatus {
    restore_model_after_aux_task_state(state.inner())
}

pub fn restore_model_after_aux_task_state(state: &LlamaState) -> ModelStatus {
    let _transition_guard = state.transition_lock.lock().unwrap();
    let session = {
        let session_guard = state.session.lock().unwrap();
        session_guard.clone()
    };

    let Some(session) = session else {
        return ModelStatus {
            status: "info".to_string(),
            message: "No active model to restore.".to_string(),
            has_vision: false,
            model_name: String::new(),
            model_path: String::new(),
            gpu_layers: 0,
        };
    };

    if session.active_gpu_layers >= session.preferred_gpu_layers {
        return ModelStatus {
            status: "success".to_string(),
            message: "Model is already back in chat mode.".to_string(),
            has_vision: session.has_vision,
            model_name: session.model_name,
            model_path: session.model_path,
            gpu_layers: session.active_gpu_layers,
        };
    }

    let mut process_guard = state.process.lock().unwrap();
    let cached_profile = {
        let profiles_guard = state.profiles.lock().unwrap();
        profiles_guard
            .get(&load_profile_key(
                &session.model_path,
                session.context_size,
                session.preferred_gpu_layers,
            ))
            .cloned()
    };
    match relaunch_model(
        &mut process_guard,
        &session.model_path,
        session.context_size,
        session.threads,
        session.preferred_gpu_layers,
        cached_profile.as_ref(),
    ) {
        Ok((has_vision, applied_gpu_layers)) => {
            let mut session_guard = state.session.lock().unwrap();
            if let Some(current) = session_guard.as_mut() {
                current.preferred_gpu_layers = applied_gpu_layers;
                current.active_gpu_layers = applied_gpu_layers;
                current.reduced_gpu_layers = current.reduced_gpu_layers.min(applied_gpu_layers);
                current.requested_gpu_layers = session.preferred_gpu_layers;
                current.has_vision = has_vision;
            }

            ModelStatus {
                status: "success".to_string(),
                message: "Chat mode restored.".to_string(),
                has_vision,
                model_name: session.model_name,
                model_path: session.model_path,
                gpu_layers: applied_gpu_layers,
            }
        }
        Err(message) => ModelStatus {
            status: "error".to_string(),
            message,
            has_vision: session.has_vision,
            model_name: session.model_name,
            model_path: session.model_path,
            gpu_layers: session.active_gpu_layers,
        },
    }
}

#[tauri::command]
pub fn stop_model(state: State<'_, LlamaState>) -> ModelStatus {
    stop_model_state(state.inner())
}

pub fn stop_model_state(state: &LlamaState) -> ModelStatus {
    let _transition_guard = state.transition_lock.lock().unwrap();
    let mut process_guard = state.process.lock().unwrap();
    stop_running_process(&mut process_guard);

    let mut session_guard = state.session.lock().unwrap();
    let session = session_guard.take();

    if let Some(session) = session {
        ModelStatus {
            status: "success".to_string(),
            message: "Model stopped".to_string(),
            has_vision: session.has_vision,
            model_name: session.model_name,
            model_path: session.model_path,
            gpu_layers: session.active_gpu_layers,
        }
    } else {
        ModelStatus {
            status: "info".to_string(),
            message: "No model running".to_string(),
            has_vision: false,
            model_name: String::new(),
            model_path: String::new(),
            gpu_layers: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        estimate_kv_cache_mb, jan_model_relative_path, model_id_from_file_name,
        parse_observed_load_profile, plan_memory_placement_with_vram, reserved_vram_mb,
        yaml_plain_value,
    };
    use std::path::Path;

    #[test]
    fn kv_estimate_grows_with_context() {
        let short_ctx = estimate_kv_cache_mb(4_096, 4_096);
        let long_ctx = estimate_kv_cache_mb(4_096, 8_192);
        assert!(long_ctx > short_ctx);
    }

    #[test]
    fn weights_first_policy_disables_gpu_kv_under_pressure() {
        let plan = plan_memory_placement_with_vram(12_288, 7_500, 8_192, 40);
        assert!(!plan.offload_kv_to_gpu);
        assert_eq!(plan.offload_mmproj_to_gpu, false);
        assert_eq!(plan.fit_target_mb, Some(reserved_vram_mb(12_288) as u32));
    }

    #[test]
    fn gpu_layers_trim_when_weight_budget_is_tight() {
        let plan = plan_memory_placement_with_vram(8_192, 7_400, 4_096, 40);
        assert!(plan.applied_gpu_layers < 40);
    }

    #[test]
    fn parses_observed_profile_from_engine_log() {
        let log = "\
load_tensors: offloaded 43/43 layers to GPU\n\
llama_kv_cache:        CPU KV buffer size =   512.00 MiB\n\
clip_ctx: CLIP using CPU backend\n\
common_params_fit_impl: will leave 6774 >= 1536 MiB of free device memory, no changes needed\n";
        let observed = parse_observed_load_profile(log).expect("profile should parse");
        assert_eq!(observed.applied_gpu_layers, 43);
        assert!(!observed.offload_kv_to_gpu);
        assert!(!observed.offload_mmproj_to_gpu);
        assert_eq!(observed.fit_target_mb, Some(1536));
    }

    #[test]
    fn yaml_plain_value_normalizes_paths() {
        assert_eq!(yaml_plain_value(r"folder\model.gguf"), "folder/model.gguf");
    }

    #[test]
    fn model_id_from_file_name_keeps_common_model_chars() {
        assert_eq!(
            model_id_from_file_name("MiniCPM-V-4_6-Thinking-F16.gguf"),
            "MiniCPM-V-4_6-Thinking-F16"
        );
    }

    #[test]
    fn jan_relative_path_matches_model_folder_shape() {
        assert_eq!(
            jan_model_relative_path(
                Path::new(r"D:\Models\gemma-4-E4B-it-Q6_K"),
                Path::new(r"D:\Models\gemma-4-E4B-it-Q6_K\model.gguf")
            ),
            "llamacpp/models/gemma-4-E4B-it-Q6_K/model.gguf"
        );
    }

    #[test]
    fn model_folder_name_is_plain_yaml_name() {
        let folder_name = Path::new(r"D:\Models\gemma-4-E4B-it-Q6_K")
            .file_name()
            .and_then(|value| value.to_str())
            .map(yaml_plain_value)
            .unwrap();
        assert_eq!(folder_name, "gemma-4-E4B-it-Q6_K");
    }
}
