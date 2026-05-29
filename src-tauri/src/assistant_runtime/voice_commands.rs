use super::*;

#[derive(Debug, Deserialize)]
pub(crate) struct WhisperStdout {
    pub(crate) text: String,
    pub(crate) language: String,
    pub(crate) language_probability: f32,
}

fn audio_extension_from_data_url(data_url: &str) -> &'static str {
    if data_url.starts_with("data:audio/webm") {
        "webm"
    } else if data_url.starts_with("data:audio/mpeg") || data_url.starts_with("data:audio/mp3") {
        "mp3"
    } else if data_url.starts_with("data:audio/ogg") {
        "ogg"
    } else if data_url.starts_with("data:audio/wav") {
        "wav"
    } else if data_url.starts_with("data:audio/mp4") {
        "m4a"
    } else if data_url.starts_with("data:audio/flac") {
        "flac"
    } else if data_url.starts_with("data:audio/aac") {
        "aac"
    } else {
        "bin"
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(data_url);

    BASE64
        .decode(encoded)
        .map_err(|e| format!("Could not decode the recorded audio: {}", e))
}

#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, VoiceRuntimeState>,
    audio_data_url: String,
) -> Result<TranscriptionResult, String> {
    let runtime_state = state.inner().clone();
    let status = current_voice_status(&runtime_state);
    if !status.ready {
        return Err(status.message);
    }

    let extension = audio_extension_from_data_url(&audio_data_url).to_string();
    let audio_bytes = decode_data_url(&audio_data_url)?;
    ensure_voice_dirs()?;

    let audio_path = voice_temp_dir().join(format!("recording-{}.{}", now_millis(), extension));
    std::fs::write(&audio_path, audio_bytes)
        .map_err(|e| format!("Could not save the recorded audio: {}", e))?;

    let stdout = tokio::task::spawn_blocking(move || {
        let args = voice_transcribe_args(&audio_path, None);
        run_voice_python(&args)
    })
    .await
    .map_err(|e| format!("Voice listening task failed: {}", e))??;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice listening failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the voice helper result: {}", e))?;

    Ok(TranscriptionResult {
        text: parsed.text,
        language: parsed.language,
        language_probability: parsed.language_probability,
    })
}

#[tauri::command]
pub async fn detect_voice_sample_language(
    state: State<'_, VoiceRuntimeState>,
    sample_path: String,
) -> Result<DetectedVoiceLanguage, String> {
    let runtime_state = state.inner().clone();
    let status = current_voice_status(&runtime_state);
    if !status.ready {
        return Err(status.message);
    }

    let prepared_path = prepare_voice_sample_for_omnivoice(&sample_path);
    let cache_key = voice_language_cache_key(&prepared_path)?;
    if let Ok(cache) = runtime_state.detected_languages.lock() {
        if let Some(cached) = cache.get(&cache_key).cloned() {
            return Ok(cached);
        }
    }

    let detection_path = prepared_path.clone();
    let detected = tokio::task::spawn_blocking(move || {
        detect_voice_language_from_path_blocking(&detection_path)
    })
    .await
    .map_err(|e| format!("Voice language detection task failed: {}", e))??;

    if let Ok(mut cache) = runtime_state.detected_languages.lock() {
        cache.insert(cache_key, detected.clone());
        if cache.len() > 64 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
    }

    Ok(detected)
}
