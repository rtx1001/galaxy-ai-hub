use super::*;

#[derive(Debug, Clone, Copy)]
pub(super) struct WavFormat {
    audio_format: u16,
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
    block_align: u16,
}

pub(super) fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

pub(super) fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

pub(super) fn decode_wav_sample(
    data: &[u8],
    offset: usize,
    audio_format: u16,
    bits_per_sample: u16,
) -> Option<f32> {
    match (audio_format, bits_per_sample) {
        (1, 8) => data
            .get(offset)
            .map(|value| (*value as f32 - 128.0) / 128.0),
        (1, 16) => Some(
            i16::from_le_bytes(data.get(offset..offset + 2)?.try_into().ok()?) as f32 / 32768.0,
        ),
        (1, 24) => {
            let bytes = data.get(offset..offset + 3)?;
            let mut sample =
                (bytes[0] as i32) | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16);
            if sample & 0x800000 != 0 {
                sample |= !0x00ff_ffff;
            }
            Some(sample as f32 / 8_388_608.0)
        }
        (1, 32) => Some(
            i32::from_le_bytes(data.get(offset..offset + 4)?.try_into().ok()?) as f32
                / 2_147_483_648.0,
        ),
        (3, 32) => Some(
            f32::from_le_bytes(data.get(offset..offset + 4)?.try_into().ok()?).clamp(-1.0, 1.0),
        ),
        _ => None,
    }
}

pub(super) fn decode_wav_mono_frame(
    data: &[u8],
    frame_index: usize,
    format: WavFormat,
) -> Option<(f32, f32)> {
    let bytes_per_sample = (format.bits_per_sample / 8).max(1) as usize;
    let frame_start = frame_index.checked_mul(format.block_align as usize)?;
    let mut sum = 0.0f32;
    let mut peak = 0.0f32;

    for channel in 0..format.channels as usize {
        let offset = frame_start + channel * bytes_per_sample;
        let sample = decode_wav_sample(data, offset, format.audio_format, format.bits_per_sample)?;
        sum += sample;
        peak = peak.max(sample.abs());
    }

    Some((sum / format.channels.max(1) as f32, peak))
}

pub(super) fn stable_bytes_fingerprint(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in parts {
        for byte in *part {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

pub(super) fn find_last_pause_start(
    peaks: &[f32],
    search_start: usize,
    search_end: usize,
    silence_threshold: f32,
    min_pause_frames: usize,
) -> Option<usize> {
    if search_end <= search_start || min_pause_frames == 0 {
        return None;
    }

    let mut run_start: Option<usize> = None;
    let mut last_pause_start: Option<usize> = None;

    for frame in search_start..search_end {
        if peaks.get(frame).copied().unwrap_or(0.0) <= silence_threshold {
            run_start.get_or_insert(frame);
        } else if let Some(start) = run_start.take() {
            if frame.saturating_sub(start) >= min_pause_frames {
                last_pause_start = Some(start);
            }
        }
    }

    if let Some(start) = run_start {
        if search_end.saturating_sub(start) >= min_pause_frames {
            last_pause_start = Some(start);
        }
    }

    last_pause_start
}

pub(super) fn apply_fade(samples: &mut [f32], fade_in_frames: usize, fade_out_frames: usize) {
    if samples.is_empty() {
        return;
    }

    let fade_in_len = fade_in_frames.min(samples.len());
    for (index, sample) in samples.iter_mut().take(fade_in_len).enumerate() {
        let gain = (index as f32 + 1.0) / fade_in_len as f32;
        *sample *= gain;
    }

    let fade_out_len = fade_out_frames.min(samples.len());
    let total = samples.len();
    for index in 0..fade_out_len {
        let gain = (fade_out_len.saturating_sub(index) as f32) / fade_out_len as f32;
        if let Some(sample) = samples.get_mut(total - fade_out_len + index) {
            *sample *= gain;
        }
    }
}

pub(super) fn normalize_samples(samples: &mut [f32]) {
    let peak = samples
        .iter()
        .fold(0.0f32, |current, sample| current.max(sample.abs()));
    if peak <= 0.0001 {
        return;
    }
    let gain = 0.999f32 / peak;
    for sample in samples.iter_mut() {
        *sample = (*sample * gain).clamp(-1.0, 1.0);
    }
}

pub(super) fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == 0 || target_rate == 0 || source_rate == target_rate {
        return samples.to_vec();
    }

    let target_len =
        ((samples.len() as u64 * target_rate as u64) / source_rate as u64).max(1) as usize;
    let step = source_rate as f64 / target_rate as f64;
    let mut output = Vec::with_capacity(target_len);

    for index in 0..target_len {
        let position = index as f64 * step;
        let left = position.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let fraction = (position - left as f64) as f32;
        let left_sample = samples[left];
        let right_sample = samples[right];
        output.push(left_sample + (right_sample - left_sample) * fraction);
    }

    output
}

pub(super) fn write_pcm16_mono_wav(
    path: &Path,
    sample_rate: u32,
    samples: &[f32],
) -> Result<(), String> {
    let data_size = samples
        .len()
        .checked_mul(2)
        .ok_or_else(|| "Prepared voice sample is too large.".to_string())?
        as u32;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());

    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    std::fs::write(path, bytes).map_err(|e| format!("Could not write prepared voice sample: {}", e))
}

pub(super) fn prepare_wav_voice_sample(
    input_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let bytes = std::fs::read(input_path)
        .map_err(|e| format!("Could not read voice sample for preparation: {}", e))?;
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("Only standard WAV voice samples can be prepared automatically.".to_string());
    }

    let mut offset = 12usize;
    let mut format: Option<WavFormat> = None;
    let mut data_slice: Option<&[u8]> = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = bytes.get(offset..offset + 4).unwrap_or_default();
        let chunk_size = read_u32_le(&bytes, offset + 4).unwrap_or(0) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start.saturating_add(chunk_size).min(bytes.len());

        if chunk_id == b"fmt " && chunk_end >= chunk_start + 16 {
            format = Some(WavFormat {
                audio_format: read_u16_le(&bytes, chunk_start).unwrap_or(0),
                channels: read_u16_le(&bytes, chunk_start + 2).unwrap_or(0),
                sample_rate: read_u32_le(&bytes, chunk_start + 4).unwrap_or(0),
                block_align: read_u16_le(&bytes, chunk_start + 12).unwrap_or(0),
                bits_per_sample: read_u16_le(&bytes, chunk_start + 14).unwrap_or(0),
            });
        } else if chunk_id == b"data" {
            data_slice = Some(&bytes[chunk_start..chunk_end]);
        }

        offset = chunk_start + chunk_size + (chunk_size % 2);
    }

    let format = format.ok_or_else(|| "The WAV voice sample has no format section.".to_string())?;
    let data = data_slice.ok_or_else(|| "The WAV voice sample has no audio data.".to_string())?;

    if !matches!(format.audio_format, 1 | 3)
        || format.channels == 0
        || format.channels > 8
        || format.sample_rate == 0
        || format.block_align == 0
        || !matches!(format.bits_per_sample, 8 | 16 | 24 | 32)
    {
        return Err("This WAV voice sample uses an unsupported audio format.".to_string());
    }

    let total_frames = data.len() / format.block_align as usize;
    if total_frames == 0 {
        return Err("The WAV voice sample is empty.".to_string());
    }

    let mut mono_samples = Vec::with_capacity(total_frames);
    let mut peaks = Vec::with_capacity(total_frames);
    for frame in 0..total_frames {
        let (sample, peak) = decode_wav_mono_frame(data, frame, format)
            .ok_or_else(|| "Could not decode the WAV voice sample.".to_string())?;
        mono_samples.push(sample);
        peaks.push(peak);
    }

    let silence_threshold = 0.01f32;
    let first_voice_frame = peaks
        .iter()
        .position(|peak| *peak > silence_threshold)
        .ok_or_else(|| "The WAV voice sample appears to contain only silence.".to_string())?;
    let pre_roll_frames = (format.sample_rate / 10) as usize;
    let start_frame = first_voice_frame.saturating_sub(pre_roll_frames);
    let max_frames = (format.sample_rate as usize).saturating_mul(8);
    let hard_end_frame = total_frames.min(start_frame.saturating_add(max_frames));
    let mut end_frame = hard_end_frame;

    while end_frame > start_frame {
        let frame = end_frame - 1;
        let peak = peaks.get(frame).copied().unwrap_or(0.0);
        if peak > silence_threshold {
            break;
        }
        end_frame -= 1;
    }

    let min_phrase_frames = (format.sample_rate / 2) as usize;
    let pause_frames = (format.sample_rate / 8) as usize;
    let tail_frames = (format.sample_rate / 20) as usize;
    if let Some(pause_start) = find_last_pause_start(
        &peaks,
        start_frame
            .saturating_add(min_phrase_frames)
            .min(hard_end_frame),
        hard_end_frame,
        silence_threshold,
        pause_frames,
    ) {
        end_frame = pause_start.saturating_add(tail_frames).min(hard_end_frame);
    } else {
        end_frame = end_frame.saturating_add(tail_frames).min(hard_end_frame);
    }

    if end_frame <= start_frame || end_frame - start_frame < (format.sample_rate / 3) as usize {
        return Err("The prepared voice sample would be too short.".to_string());
    }

    let mut prepared_samples = mono_samples[start_frame..end_frame].to_vec();
    prepared_samples = resample_linear(
        &prepared_samples,
        format.sample_rate,
        PREPARED_VOICE_SAMPLE_RATE,
    );
    let fade_in_frames = (format.sample_rate / 100).max(1) as usize;
    let fade_out_frames = (format.sample_rate / 50).max(1) as usize;
    let fade_in_frames = ((fade_in_frames as u64 * PREPARED_VOICE_SAMPLE_RATE as u64)
        / format.sample_rate.max(1) as u64)
        .max(1) as usize;
    let fade_out_frames = ((fade_out_frames as u64 * PREPARED_VOICE_SAMPLE_RATE as u64)
        / format.sample_rate.max(1) as u64)
        .max(1) as usize;
    apply_fade(&mut prepared_samples, fade_in_frames, fade_out_frames);
    normalize_samples(&mut prepared_samples);

    write_pcm16_mono_wav(output_path, PREPARED_VOICE_SAMPLE_RATE, &prepared_samples)
}

pub(super) fn sanitized_file_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voice-sample");
    let cleaned: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if cleaned.trim_matches('_').is_empty() {
        "voice-sample".to_string()
    } else {
        cleaned
    }
}

pub(super) fn find_existing_prepared_sample_by_fingerprint(
    label: &str,
    fingerprint: u64,
) -> Option<PathBuf> {
    let dir = prepared_voice_samples_dir();
    let entries = std::fs::read_dir(&dir).ok()?;
    let suffix = format!("-{}-{:016x}.wav", label, fingerprint);

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.ends_with(&suffix) {
            return Some(path);
        }
    }

    None
}

pub(super) fn prepared_voice_cache_path(path: &Path, source_bytes: &[u8], label: &str) -> PathBuf {
    let fingerprint = stable_bytes_fingerprint(&[
        PREPARED_VOICE_SAMPLE_VERSION.as_bytes(),
        label.as_bytes(),
        source_bytes,
    ]);

    if let Some(existing) = find_existing_prepared_sample_by_fingerprint(label, fingerprint) {
        return existing;
    }

    prepared_voice_samples_dir().join(format!(
        "{}-{}-{:016x}.wav",
        sanitized_file_stem(path),
        label,
        fingerprint
    ))
}

pub(super) fn voice_language_cache_key(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Could not inspect the selected voice sample: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    Ok(format!(
        "{}|{}|{}",
        path.to_string_lossy(),
        metadata.len(),
        modified
    ))
}

pub(super) fn voice_language_hint_from_path(path: &Path) -> Option<&'static str> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let tokens: Vec<&str> = file_name
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();

    if tokens
        .iter()
        .any(|token| matches!(*token, "vi" | "vn" | "vie"))
        || file_name.contains("vietnam")
    {
        return Some("vi");
    }
    if tokens.iter().any(|token| matches!(*token, "en" | "eng")) || file_name.contains("english") {
        return Some("en");
    }
    if tokens
        .iter()
        .any(|token| matches!(*token, "th" | "tha" | "thai"))
        || file_name.contains("thai")
    {
        return Some("th");
    }
    if tokens
        .iter()
        .any(|token| matches!(*token, "ja" | "jp" | "jpn"))
        || file_name.contains("japanese")
    {
        return Some("ja");
    }
    if tokens
        .iter()
        .any(|token| matches!(*token, "ko" | "kr" | "kor"))
        || file_name.contains("korean")
    {
        return Some("ko");
    }
    if tokens
        .iter()
        .any(|token| matches!(*token, "zh" | "cn" | "zho" | "chi"))
        || file_name.contains("chinese")
        || file_name.contains("mandarin")
    {
        return Some("zh");
    }

    None
}

pub(super) fn voice_transcribe_args(audio_path: &Path, language_hint: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "transcribe".to_string(),
        "--audio".to_string(),
        audio_path.to_string_lossy().to_string(),
        "--cache-dir".to_string(),
        voice_cache_dir().to_string_lossy().to_string(),
    ];
    if let Some(language) = language_hint {
        args.push("--language".to_string());
        args.push(language.to_string());
    }
    if let Some(model_dir) = selected_whisper_model_dir() {
        args.push("--model-dir".to_string());
        args.push(model_dir.to_string_lossy().to_string());
    }
    args
}

pub(super) fn detect_voice_language_from_path_blocking(
    audio_path: &Path,
) -> Result<DetectedVoiceLanguage, String> {
    ensure_voice_dirs()?;

    let language_hint = voice_language_hint_from_path(audio_path);
    let args = voice_transcribe_args(audio_path, language_hint);
    let stdout = run_voice_python(&args)?;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice language detection failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the voice helper result: {}", e))?;

    Ok(DetectedVoiceLanguage {
        language: language_hint
            .unwrap_or_else(|| parsed.language.trim())
            .to_string(),
        language_probability: parsed.language_probability,
    })
}

pub(super) fn prepare_voice_sample_for_omnivoice(file_path: &str) -> PathBuf {
    let path = PathBuf::from(file_path);
    let is_wav = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);

    if !is_wav {
        return path;
    }

    if let Err(error) = ensure_voice_dirs() {
        append_runtime_log("voice", &format!("voice sample prep skipped: {}", error));
        return path;
    }

    let source_bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return path,
    };

    let helper_label = selected_voice_helper_cache_label();
    let cache_path = prepared_voice_cache_path(&path, &source_bytes, &helper_label);

    if cache_path.exists() {
        return cache_path;
    }

    let staging_path = prepared_voice_samples_dir().join(format!(
        "{}-{}-{:016x}.tmp.wav",
        sanitized_file_stem(&path),
        helper_label,
        stable_bytes_fingerprint(&[
            PREPARED_VOICE_SAMPLE_VERSION.as_bytes(),
            helper_label.as_bytes(),
            source_bytes.as_slice(),
            b"staging",
        ])
    ));

    let started = Instant::now();
    match prepare_wav_voice_sample(&path, &staging_path) {
        Ok(()) => {
            let _ = std::fs::rename(&staging_path, &cache_path);
            if !cache_path.exists() {
                let _ = std::fs::copy(&staging_path, &cache_path);
                let _ = std::fs::remove_file(&staging_path);
            }
            let original_size = source_bytes.len() as u64;
            let prepared_size = std::fs::metadata(&cache_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
            append_runtime_log(
                "voice",
                &format!(
                    "prepared voice sample original={} prepared={} helper_tier={} original_bytes={} prepared_bytes={} hz={} mono=true normalized=true took_ms={}",
                    path.display(),
                    cache_path.display(),
                    helper_label,
                    original_size,
                    prepared_size,
                    PREPARED_VOICE_SAMPLE_RATE,
                    started.elapsed().as_millis()
                ),
            );
            cache_path
        }
        Err(error) => {
            append_runtime_log(
                "voice",
                &format!("voice sample prep failed for {}: {}", path.display(), error),
            );
            let _ = std::fs::remove_file(&staging_path);
            path
        }
    }
}

pub(crate) fn prepare_voice_sample_for_omnivoice_path(file_path: &str) -> PathBuf {
    prepare_voice_sample_for_omnivoice(file_path)
}

pub(super) fn prepared_voice_transcript_cache_path(audio_path: &Path) -> PathBuf {
    let stem = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voice-sample");
    audio_path.with_file_name(format!("{stem}.transcript.txt"))
}

pub(crate) fn transcribe_prepared_voice_sample_path(audio_path: &Path) -> Result<String, String> {
    ensure_voice_dirs()?;

    let transcript_cache_path = prepared_voice_transcript_cache_path(audio_path);
    if let Ok(cached) = std::fs::read_to_string(&transcript_cache_path) {
        let cached = cached.trim().to_string();
        if !cached.is_empty() {
            return Ok(cached);
        }
    }

    if !voice_python_path().exists() {
        return Err(
            "The shared voice helper is not installed yet. Start the voice input helper once so clone transcription can reuse it."
                .to_string(),
        );
    }

    let args = voice_transcribe_args(audio_path, voice_language_hint_from_path(audio_path));
    let stdout = run_voice_python(&args)?;

    if !stdout.status.success() {
        let stderr = String::from_utf8_lossy(&stdout.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Voice sample transcription failed.".to_string()
        } else {
            stderr
        });
    }

    let parsed: WhisperStdout = serde_json::from_slice(&stdout.stdout)
        .map_err(|e| format!("Could not read the shared voice helper result: {}", e))?;

    let text = parsed.text.trim().to_string();
    if text.is_empty() {
        return Err("The shared voice helper returned an empty transcript.".to_string());
    }

    let _ = std::fs::write(&transcript_cache_path, &text);
    Ok(text)
}
