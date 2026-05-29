use super::*;

pub(super) const VOICE_RUNTIME_SCRIPT: &str = include_str!("../../python/voice_runtime.py");
pub(super) const PREPARED_VOICE_SAMPLE_VERSION: &str = "v5-mono22050-normfade-8s-langhint";
pub(super) const PREPARED_VOICE_SAMPLE_RATE: u32 = 22_050;
pub(super) fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

pub(super) fn assistant_runtime_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime")
}

pub(super) fn voices_dir(folder: Option<&str>) -> PathBuf {
    folder
        .filter(|value| !value.trim().is_empty())
        .map(|value| PathBuf::from(value.trim()))
        .unwrap_or_else(|| assistant_runtime_dir().join("voice").join("voice_samples"))
}

pub(super) fn voice_runtime_dir() -> PathBuf {
    assistant_runtime_dir().join("voice")
}

pub(super) fn voice_cache_dir() -> PathBuf {
    voice_runtime_dir().join("cache")
}

pub(super) fn voice_temp_dir() -> PathBuf {
    voice_runtime_dir().join("temp")
}

pub(super) fn prepared_voice_samples_dir() -> PathBuf {
    voice_runtime_dir().join("prepared-samples")
}

pub(super) fn voice_venv_dir() -> PathBuf {
    voice_runtime_dir().join(".venv")
}

pub(super) fn voice_python_path() -> PathBuf {
    voice_venv_dir().join("Scripts").join("python.exe")
}

pub(super) fn voice_worker_script_path() -> PathBuf {
    voice_runtime_dir().join("voice_runtime.py")
}

pub(super) fn voice_models_dir() -> PathBuf {
    voice_runtime_dir().join("models")
}

pub(super) fn selected_whisper_model_marker_path() -> PathBuf {
    voice_runtime_dir().join("selected-whisper-model.txt")
}

pub(super) fn selected_whisper_model_dir() -> Option<PathBuf> {
    if let Ok(marker) = std::fs::read_to_string(selected_whisper_model_marker_path()) {
        let path = PathBuf::from(marker.trim());
        if path.join("model.bin").exists() && path.join("config.json").exists() {
            return Some(path);
        }
    }
    [
        "faster-whisper-medium",
        "faster-whisper-small",
        "faster-whisper-base",
        "faster-whisper-tiny",
    ]
    .iter()
    .map(|name| voice_models_dir().join(name))
    .find(|path| path.join("model.bin").exists() && path.join("config.json").exists())
}

pub(super) fn selected_voice_helper_cache_label() -> String {
    let model_name = selected_whisper_model_dir()
        .and_then(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
        })
        .unwrap_or_else(|| "tiny".to_string());

    if model_name.contains("medium") {
        "high".to_string()
    } else if model_name.contains("small") {
        "balanced".to_string()
    } else if model_name.contains("base") {
        "light".to_string()
    } else {
        "tiny".to_string()
    }
}

pub(super) fn pip_cache_dir() -> PathBuf {
    assistant_runtime_dir().join("pip-cache")
}

pub(super) fn cleanup_voice_temp_dir() {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(60 * 60 * 24))
        .unwrap_or(SystemTime::now());
    let Ok(entries) = std::fs::read_dir(voice_temp_dir()) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(|modified| modified <= cutoff)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(super) fn cleanup_stale_prepared_samples() {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(60 * 60 * 24 * 30))
        .unwrap_or(SystemTime::now());
    let Ok(entries) = std::fs::read_dir(prepared_voice_samples_dir()) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_staging = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.ends_with(".tmp.wav"))
            .unwrap_or(false);
        if !is_staging {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(|modified| modified <= cutoff)
            .unwrap_or(true);
        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(super) fn update_voice_status(state: &VoiceRuntimeState, status: VoiceSetupStatus) {
    if let Ok(mut guard) = state.status.lock() {
        *guard = status;
    }
}

pub(super) fn current_voice_status(state: &VoiceRuntimeState) -> VoiceSetupStatus {
    state
        .status
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(VoiceSetupStatus {
            state: "error".to_string(),
            message: "Voice helper status is unavailable.".to_string(),
            progress: 100,
            ready: false,
        })
}

pub(super) fn ensure_voice_dirs() -> Result<(), String> {
    std::fs::create_dir_all(voice_runtime_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(voice_cache_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(voice_temp_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(prepared_voice_samples_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(voice_models_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(pip_cache_dir()).map_err(|e| e.to_string())?;
    cleanup_voice_temp_dir();
    cleanup_stale_prepared_samples();
    Ok(())
}

pub(super) fn ensure_voice_worker_script() -> Result<PathBuf, String> {
    ensure_voice_dirs()?;
    let path = voice_worker_script_path();
    let needs_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != VOICE_RUNTIME_SCRIPT,
        Err(_) => true,
    };

    if needs_write {
        std::fs::write(&path, VOICE_RUNTIME_SCRIPT).map_err(|e| e.to_string())?;
    }

    Ok(path)
}

pub(super) fn command_exists(program: &str, args: &[&str]) -> bool {
    let mut command = Command::new(program);
    command.args(args);
    crate::process_util::hide_window(&mut command);
    command
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub(super) fn create_venv() -> Result<(), String> {
    if voice_python_path().exists() {
        return Ok(());
    }

    let venv_dir = voice_venv_dir();
    let mut command = if command_exists("py", &["-3", "--version"]) {
        let mut command = Command::new("py");
        command.args(["-3", "-m", "venv"]);
        command
    } else {
        let mut command = Command::new("python");
        command.args(["-m", "venv"]);
        command
    };
    command.arg(&venv_dir);
    crate::process_util::hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Unable to start Python for voice helper: {}", e))?;

    if !status.success() {
        return Err(
            "A compatible Python 3.10+ runtime was not found, so voice listening could not be prepared."
                .to_string(),
        );
    }

    Ok(())
}

pub(super) fn run_voice_python<I, S>(args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let script_path = ensure_voice_worker_script()?;
    let mut command = Command::new(voice_python_path());
    command
        .arg(script_path)
        .args(args)
        .env("HF_HOME", voice_cache_dir())
        .env("HUGGINGFACE_HUB_CACHE", voice_cache_dir())
        .env("TRANSFORMERS_CACHE", voice_cache_dir())
        .env("XDG_CACHE_HOME", voice_cache_dir())
        .env("PIP_CACHE_DIR", pip_cache_dir())
        .current_dir(voice_runtime_dir());

    crate::process_util::hide_window(&mut command);
    command
        .output()
        .map_err(|e| format!("Voice helper failed to start: {}", e))
}

pub(super) fn install_voice_runtime_blocking(state: VoiceRuntimeState) {
    let result = (|| -> Result<(), String> {
        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Preparing voice helper...".to_string(),
                progress: 10,
                ready: false,
            },
        );

        ensure_voice_dirs()?;
        create_venv()?;

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Installing listening tools...".to_string(),
                progress: 45,
                ready: false,
            },
        );

        let mut pip_command = Command::new(voice_python_path());
        pip_command
            .args(["-m", "pip", "install", "--upgrade", "pip"])
            .env("PIP_CACHE_DIR", pip_cache_dir())
            .current_dir(voice_runtime_dir());
        crate::process_util::hide_window(&mut pip_command);
        let pip_upgrade = pip_command
            .status()
            .map_err(|e| format!("Could not prepare pip: {}", e))?;

        if !pip_upgrade.success() {
            return Err("Could not prepare the voice installer.".to_string());
        }

        let mut install_command = Command::new(voice_python_path());
        install_command
            .args(["-m", "pip", "install", "faster-whisper"])
            .env("PIP_CACHE_DIR", pip_cache_dir())
            .current_dir(voice_runtime_dir());
        crate::process_util::hide_window(&mut install_command);
        let install = install_command
            .status()
            .map_err(|e| format!("Could not install faster-whisper: {}", e))?;

        if !install.success() {
            return Err("Could not install the listening helper.".to_string());
        }

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "installing".to_string(),
                message: "Preparing the listening model...".to_string(),
                progress: 80,
                ready: false,
            },
        );

        let mut warmup_args = vec![
            "warmup".to_string(),
            "--cache-dir".to_string(),
            voice_cache_dir().to_string_lossy().to_string(),
        ];
        if let Some(model_dir) = selected_whisper_model_dir() {
            warmup_args.push("--model-dir".to_string());
            warmup_args.push(model_dir.to_string_lossy().to_string());
        }
        let warmup = run_voice_python(&warmup_args)?;

        if !warmup.status.success() {
            let stderr = String::from_utf8_lossy(&warmup.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "The voice helper could not finish setting up.".to_string()
            } else {
                stderr
            });
        }

        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "ready".to_string(),
                message: "Voice helper is ready.".to_string(),
                progress: 100,
                ready: true,
            },
        );

        Ok(())
    })();

    if let Err(error) = result {
        update_voice_status(
            &state,
            VoiceSetupStatus {
                state: "error".to_string(),
                message: error,
                progress: 100,
                ready: false,
            },
        );
    }

    state.installing.store(false, Ordering::SeqCst);
}
