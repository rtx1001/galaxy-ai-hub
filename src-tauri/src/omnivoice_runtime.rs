use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use tauri::State;

use crate::assistant_runtime::{
    prepare_voice_sample_for_omnivoice_path, transcribe_prepared_voice_sample_path,
    AudioSynthesisResult, VoiceSetupStatus,
};

#[derive(Clone)]
pub struct OmniVoiceRuntimeState {
    pub status: Arc<Mutex<VoiceSetupStatus>>,
    pub synthesis_lock: Arc<tokio::sync::Mutex<()>>,
    sidecar: Arc<Mutex<Option<OmniVoiceSidecar>>>,
}

impl Default for OmniVoiceRuntimeState {
    fn default() -> Self {
        Self {
            status: Arc::new(Mutex::new(VoiceSetupStatus {
                state: "idle".to_string(),
                message: "Voice playback engine is waiting.".to_string(),
                progress: 0,
                ready: false,
            })),
            synthesis_lock: Arc::new(tokio::sync::Mutex::new(())),
            sidecar: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Clone)]
struct OmniVoiceCppModelChoice {
    model_path: PathBuf,
    codec_path: PathBuf,
    quant: &'static str,
}

struct OmniVoiceSidecar {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<Vec<u8>>,
    model_path: PathBuf,
    codec_path: PathBuf,
    voice_sample_path: Option<String>,
    language: String,
    ref_text_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
pub struct OmniVoiceVramEstimate {
    pub required_mb: u32,
    pub model_mb: u32,
    pub overhead_mb: u32,
}

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn assistant_runtime_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime")
}

fn omnivoice_runtime_dir() -> PathBuf {
    assistant_runtime_dir().join("voice-tts")
}

fn omnivoice_cache_dir() -> PathBuf {
    omnivoice_runtime_dir().join("cache")
}

fn omnivoice_models_dir() -> PathBuf {
    omnivoice_runtime_dir().join("models")
}

fn omnivoice_cpp_models_dir() -> PathBuf {
    omnivoice_models_dir().join("omnivoice.cpp")
}

fn omnivoice_cpp_output_dir() -> PathBuf {
    omnivoice_cache_dir().join("cpp-out")
}

fn omnivoice_tts_executable_path() -> PathBuf {
    let bundled = omnivoice_runtime_dir()
        .join("bin")
        .join("omnivoice-tts.exe");
    if bundled.exists() {
        bundled
    } else {
        app_root_dir()
            .join("src-tauri")
            .join("engine")
            .join("omnivoice-tts.exe")
    }
}

fn ensure_dirs() -> Result<(), String> {
    std::fs::create_dir_all(omnivoice_runtime_dir())
        .map_err(|e| format!("Could not prepare the OmniVoice runtime folder: {}", e))?;
    std::fs::create_dir_all(omnivoice_cache_dir())
        .map_err(|e| format!("Could not prepare the OmniVoice cache folder: {}", e))?;
    std::fs::create_dir_all(omnivoice_models_dir())
        .map_err(|e| format!("Could not prepare the OmniVoice model folder: {}", e))?;
    std::fs::create_dir_all(omnivoice_cpp_models_dir())
        .map_err(|e| format!("Could not prepare the OmniVoice GGUF model folder: {}", e))?;
    std::fs::create_dir_all(omnivoice_cpp_output_dir())
        .map_err(|e| format!("Could not prepare the OmniVoice GGUF output folder: {}", e))?;
    Ok(())
}

fn collect_gguf_files(current: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_gguf_files(&path, found);
            continue;
        }
        let is_gguf = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false);
        if is_gguf {
            found.push(path);
        }
    }
}

fn choose_cpp_model() -> Option<OmniVoiceCppModelChoice> {
    let root = omnivoice_cpp_models_dir();
    let mut files = Vec::new();
    collect_gguf_files(&root, &mut files);
    if files.is_empty() {
        return None;
    }
    files.sort();

    let file_name = |path: &PathBuf| {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    let pick_pair = |quant_token: &str, quant: &'static str| {
        let base = files.iter().find(|path| {
            let name = file_name(path);
            name.contains("omnivoice-base") && name.contains(quant_token)
        })?;
        let codec = files.iter().find(|path| {
            let name = file_name(path);
            (name.contains("omnivoice-tokenizer") || name.contains("omnivoice-codec"))
                && name.contains(quant_token)
        })?;
        Some(OmniVoiceCppModelChoice {
            model_path: base.clone(),
            codec_path: codec.clone(),
            quant,
        })
    };

    pick_pair("q8_0", "Q8_0")
        .or_else(|| pick_pair("q4_k_m", "Q4_K_M"))
        .or_else(|| pick_pair("bf16", "BF16"))
        .or_else(|| pick_pair("f32", "F32"))
}

fn set_status(state: &OmniVoiceRuntimeState, status: VoiceSetupStatus) {
    if let Ok(mut guard) = state.status.lock() {
        *guard = status;
    }
}

fn current_status(state: &OmniVoiceRuntimeState) -> VoiceSetupStatus {
    state
        .status
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(VoiceSetupStatus {
            state: "error".to_string(),
            message: "Voice playback status is unavailable.".to_string(),
            progress: 100,
            ready: false,
        })
}

fn set_ready_status(state: &OmniVoiceRuntimeState, choice: &OmniVoiceCppModelChoice) {
    let file_name = choice
        .model_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("model.gguf");
    set_status(
        state,
        VoiceSetupStatus {
            state: "ready".to_string(),
            message: format!(
                "Voice playback engine is ready (omnivoice.cpp, {}, {}).",
                file_name, choice.quant
            ),
            progress: 100,
            ready: true,
        },
    );
}

fn infer_omnivoice_language(text: &str) -> &'static str {
    if text.chars().any(|ch| {
        let code = ch as u32;
        matches!(
            code,
            0x0102
                | 0x0103
                | 0x00C2
                | 0x00E2
                | 0x0110
                | 0x0111
                | 0x00CA
                | 0x00EA
                | 0x00D4
                | 0x00F4
                | 0x01A0
                | 0x01A1
                | 0x01AF
                | 0x01B0
        ) || (0x1EA0..=0x1EF9).contains(&code)
    }) {
        "Vietnamese"
    } else if text
        .chars()
        .any(|ch| ('\u{0E00}'..='\u{0E7F}').contains(&ch))
    {
        "Thai"
    } else if text
        .chars()
        .any(|ch| ('\u{3040}'..='\u{30FF}').contains(&ch))
    {
        "Japanese"
    } else if text
        .chars()
        .any(|ch| ('\u{4E00}'..='\u{9FFF}').contains(&ch))
    {
        "Chinese"
    } else if text
        .chars()
        .any(|ch| ('\u{AC00}'..='\u{D7AF}').contains(&ch))
    {
        "Korean"
    } else {
        "English"
    }
}

fn cpp_ref_text_path(output_path: &Path) -> PathBuf {
    output_path.with_extension("ref.txt")
}

fn sidecar_ref_text_path() -> PathBuf {
    omnivoice_cache_dir().join("omnivoice-sidecar-ref.txt")
}

fn stop_sidecar(sidecar: &mut Option<OmniVoiceSidecar>) {
    if let Some(mut current) = sidecar.take() {
        let _ = current.child.kill();
        let _ = current.child.wait();
        if let Some(path) = current.ref_text_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn request_text_for_streaming(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed
        .chars()
        .last()
        .map(|ch| ".!?。！？…".contains(ch))
        .unwrap_or(false)
    {
        format!("{}\n", trimmed)
    } else {
        format!("{}.\n", trimmed)
    }
}

fn start_sidecar(
    choice: &OmniVoiceCppModelChoice,
    request_text: &str,
    voice_sample_path: Option<String>,
) -> Result<OmniVoiceSidecar, String> {
    let language = infer_omnivoice_language(request_text).to_string();
    let mut command = Command::new(omnivoice_tts_executable_path());
    command
        .arg("--model")
        .arg(&choice.model_path)
        .arg("--codec")
        .arg(&choice.codec_path)
        .arg("--lang")
        .arg(&language)
        .arg("-o")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut ref_text_path = None;
    if let Some(sample_path) = voice_sample_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let prepared_path = prepare_voice_sample_for_omnivoice_path(sample_path);
        let ref_text = transcribe_prepared_voice_sample_path(&prepared_path)?;
        let path = sidecar_ref_text_path();
        std::fs::write(&path, ref_text)
            .map_err(|e| format!("Could not prepare OmniVoice sidecar reference text: {}", e))?;
        command
            .arg("--ref-wav")
            .arg(prepared_path)
            .arg("--ref-text")
            .arg(&path);
        ref_text_path = Some(path);
    }

    let current_dir = omnivoice_tts_executable_path()
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(app_root_dir);
    let mut child = command
        .current_dir(current_dir)
        .spawn()
        .map_err(|e| format!("Could not start the OmniVoice sidecar: {}", e))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open OmniVoice sidecar input.".to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open OmniVoice sidecar output.".to_string())?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(OmniVoiceSidecar {
        child,
        stdin,
        rx,
        model_path: choice.model_path.clone(),
        codec_path: choice.codec_path.clone(),
        voice_sample_path,
        language,
        ref_text_path,
    })
}

fn sidecar_matches(
    sidecar: &mut OmniVoiceSidecar,
    choice: &OmniVoiceCppModelChoice,
    voice_sample_path: &Option<String>,
    language: &str,
) -> bool {
    if sidecar.child.try_wait().ok().flatten().is_some() {
        return false;
    }
    sidecar.model_path == choice.model_path
        && sidecar.codec_path == choice.codec_path
        && &sidecar.voice_sample_path == voice_sample_path
        && sidecar.language == language
}

fn synthesize_with_sidecar(
    state: &OmniVoiceRuntimeState,
    choice: &OmniVoiceCppModelChoice,
    request_text: &str,
    voice_sample_path: Option<String>,
) -> Result<Vec<u8>, String> {
    let language = infer_omnivoice_language(request_text).to_string();
    let mut guard = state
        .sidecar
        .lock()
        .map_err(|_| "Voice sidecar is unavailable.".to_string())?;

    let reuse = guard
        .as_mut()
        .map(|sidecar| sidecar_matches(sidecar, choice, &voice_sample_path, &language))
        .unwrap_or(false);
    if !reuse {
        stop_sidecar(&mut guard);
        *guard = Some(start_sidecar(
            choice,
            request_text,
            voice_sample_path.clone(),
        )?);
    }

    let sidecar = guard
        .as_mut()
        .ok_or_else(|| "Voice sidecar did not start.".to_string())?;
    sidecar
        .stdin
        .write_all(request_text_for_streaming(request_text).as_bytes())
        .and_then(|_| sidecar.stdin.flush())
        .map_err(|e| format!("Could not send text to the OmniVoice sidecar: {}", e))?;

    let mut bytes = Vec::new();
    let first_chunk = sidecar
        .rx
        .recv_timeout(Duration::from_secs(180))
        .map_err(|_| "The OmniVoice sidecar did not return audio in time.".to_string())?;
    bytes.extend(first_chunk);
    loop {
        match sidecar.rx.recv_timeout(Duration::from_millis(1200)) {
            Ok(chunk) => bytes.extend(chunk),
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if bytes.is_empty() {
        Err("The OmniVoice sidecar returned empty audio.".to_string())
    } else {
        Ok(bytes)
    }
}

fn ensure_omnivoice_ready(
    state: &OmniVoiceRuntimeState,
) -> Result<OmniVoiceCppModelChoice, String> {
    ensure_dirs()?;
    if !omnivoice_tts_executable_path().exists() {
        let error = format!(
            "OmniVoice GGUF engine was not found. Expected {}.",
            omnivoice_tts_executable_path().to_string_lossy()
        );
        set_status(
            state,
            VoiceSetupStatus {
                state: "error".to_string(),
                message: error.clone(),
                progress: 100,
                ready: false,
            },
        );
        return Err(error);
    }

    let Some(choice) = choose_cpp_model() else {
        let error = format!(
            "No OmniVoice GGUF base/tokenizer pair was found in {}.",
            omnivoice_cpp_models_dir().to_string_lossy()
        );
        set_status(
            state,
            VoiceSetupStatus {
                state: "error".to_string(),
                message: error.clone(),
                progress: 100,
                ready: false,
            },
        );
        return Err(error);
    };

    set_ready_status(state, &choice);
    Ok(choice)
}

pub fn shutdown_omnivoice_process(state: &OmniVoiceRuntimeState) {
    if let Ok(mut guard) = state.sidecar.lock() {
        stop_sidecar(&mut guard);
    }
}

#[tauri::command]
pub fn prepare_omnivoice_engine(state: State<'_, OmniVoiceRuntimeState>) -> VoiceSetupStatus {
    let _ = ensure_omnivoice_ready(state.inner());
    current_status(state.inner())
}

#[tauri::command]
pub fn get_omnivoice_engine_status(state: State<'_, OmniVoiceRuntimeState>) -> VoiceSetupStatus {
    current_status(state.inner())
}

#[tauri::command]
pub fn estimate_omnivoice_vram_need(
    state: State<'_, OmniVoiceRuntimeState>,
) -> Result<OmniVoiceVramEstimate, String> {
    let choice = ensure_omnivoice_ready(state.inner())?;
    let model_bytes = std::fs::metadata(&choice.model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        + std::fs::metadata(&choice.codec_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
    let model_mb = ((model_bytes + 1024 * 1024 - 1) / (1024 * 1024)) as u32;
    let overhead_mb = 1536;
    Ok(OmniVoiceVramEstimate {
        required_mb: model_mb.saturating_add(overhead_mb).max(3072),
        model_mb,
        overhead_mb,
    })
}

#[tauri::command]
pub async fn stop_omnivoice_engine(
    state: State<'_, OmniVoiceRuntimeState>,
) -> Result<VoiceSetupStatus, String> {
    shutdown_omnivoice_process(state.inner());
    set_status(
        state.inner(),
        VoiceSetupStatus {
            state: "idle".to_string(),
            message: "Voice playback engine is waiting.".to_string(),
            progress: 0,
            ready: false,
        },
    );
    Ok(current_status(state.inner()))
}

#[tauri::command]
pub async fn synthesize_speech(
    state: State<'_, OmniVoiceRuntimeState>,
    text: String,
    voice_sample_path: Option<String>,
    use_sidecar: Option<bool>,
) -> Result<AudioSynthesisResult, String> {
    synthesize_speech_with_state(
        state.inner().clone(),
        text,
        voice_sample_path,
        use_sidecar.unwrap_or(false),
    )
    .await
}

pub async fn synthesize_speech_with_state(
    state: OmniVoiceRuntimeState,
    text: String,
    voice_sample_path: Option<String>,
    use_sidecar: bool,
) -> Result<AudioSynthesisResult, String> {
    let _synthesis_guard = state.synthesis_lock.lock().await;
    let request_text = text.trim();
    if request_text.is_empty() {
        return Err("The speech text is empty.".to_string());
    }

    let choice = ensure_omnivoice_ready(&state)?;
    if use_sidecar {
        let sidecar_result = tokio::task::spawn_blocking({
            let state = state.clone();
            let choice = choice.clone();
            let request_text = request_text.to_string();
            let voice_sample_path = voice_sample_path.clone();
            move || synthesize_with_sidecar(&state, &choice, &request_text, voice_sample_path)
        })
        .await
        .map_err(|e| format!("Voice sidecar task failed: {}", e));

        match sidecar_result {
            Ok(Ok(bytes)) => {
                set_ready_status(&state, &choice);
                return Ok(AudioSynthesisResult {
                    audio_base64: BASE64.encode(bytes),
                    mime_type: "audio/wav".to_string(),
                });
            }
            Ok(Err(error)) | Err(error) => {
                if let Ok(mut guard) = state.sidecar.lock() {
                    stop_sidecar(&mut guard);
                }
                eprintln!(
                    "OmniVoice sidecar failed, falling back to one-shot: {}",
                    error
                );
            }
        }
    }

    let output_path = omnivoice_cpp_output_dir().join(format!(
        "omnivoice-{}.wav",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0)
    ));
    let ref_text_path = cpp_ref_text_path(&output_path);

    let mut command = Command::new(omnivoice_tts_executable_path());
    command
        .arg("--model")
        .arg(&choice.model_path)
        .arg("--codec")
        .arg(&choice.codec_path)
        .arg("--lang")
        .arg(infer_omnivoice_language(request_text))
        .arg("-o")
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(sample_path) = voice_sample_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let prepared_path = prepare_voice_sample_for_omnivoice_path(sample_path);
        let ref_text = tokio::task::spawn_blocking({
            let prepared_path = prepared_path.clone();
            move || transcribe_prepared_voice_sample_path(&prepared_path)
        })
        .await
        .map_err(|e| format!("Voice transcription task failed: {}", e))??;
        std::fs::write(&ref_text_path, ref_text)
            .map_err(|e| format!("Could not prepare OmniVoice GGUF reference text: {}", e))?;
        command
            .arg("--ref-wav")
            .arg(prepared_path)
            .arg("--ref-text")
            .arg(&ref_text_path);
    }

    let current_dir = omnivoice_tts_executable_path()
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(app_root_dir);
    let mut child = command
        .current_dir(current_dir)
        .spawn()
        .map_err(|e| format!("Could not start the OmniVoice GGUF engine: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request_text.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|e| format!("Could not send text to the OmniVoice GGUF engine: {}", e))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Could not finish OmniVoice GGUF synthesis: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "The OmniVoice GGUF engine failed ({}). {} {}",
            output.status, stderr, stdout
        ));
    }

    let bytes = std::fs::read(&output_path).map_err(|e| {
        format!(
            "OmniVoice GGUF completed but audio output was not found ({}): {}",
            output_path.to_string_lossy(),
            e
        )
    })?;

    let _ = std::fs::remove_file(&output_path);
    let _ = std::fs::remove_file(&ref_text_path);
    set_ready_status(&state, &choice);

    Ok(AudioSynthesisResult {
        audio_base64: BASE64.encode(bytes),
        mime_type: "audio/wav".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::infer_omnivoice_language;

    #[test]
    fn infer_language_handles_unicode_without_mojibake_literals() {
        assert_eq!(
            infer_omnivoice_language("xin chào, hôm nay thế nào?"),
            "Vietnamese"
        );
        assert_eq!(infer_omnivoice_language("สวัสดีครับ"), "Thai");
        assert_eq!(infer_omnivoice_language("こんにちは"), "Japanese");
        assert_eq!(infer_omnivoice_language("你好"), "Chinese");
        assert_eq!(infer_omnivoice_language("안녕하세요"), "Korean");
        assert_eq!(infer_omnivoice_language("hello there"), "English");
    }
}
