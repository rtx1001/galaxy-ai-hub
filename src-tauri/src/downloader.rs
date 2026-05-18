use std::io::Write;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::engine_paths;

static IS_DOWNLOADING: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
pub struct DownloadResult {
    pub success: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct EngineInfo {
    pub ready: bool,
    pub source: String,
    pub version: String,
    pub build: Option<u32>,
    pub supports_mmproj: bool,
}

#[tauri::command]
pub fn check_engine_ready() -> bool {
    engine_paths::existing_engine_dir()
        .map(|path| path.join("llama-server.exe").exists())
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_engine_info() -> EngineInfo {
    let server_path = match engine_paths::llama_server_path() {
        Ok(path) => path,
        Err(_) => {
            return EngineInfo {
                ready: false,
                source: "missing".to_string(),
                version: String::new(),
                build: None,
                supports_mmproj: false,
            };
        }
    };

    if !server_path.exists() {
        return EngineInfo {
            ready: false,
            source: "missing".to_string(),
            version: String::new(),
            build: None,
            supports_mmproj: false,
        };
    }

    let runtime_dir = engine_paths::runtime_engine_dir();
    let source = if server_path.starts_with(&runtime_dir) {
        "runtime"
    } else {
        "bundled"
    };

    EngineInfo {
        ready: true,
        source: source.to_string(),
        version: engine_paths::read_server_version(&server_path).unwrap_or_default(),
        build: engine_paths::build_number(&server_path),
        supports_mmproj: engine_paths::supports_mmproj(&server_path),
    }
}

#[tauri::command]
pub fn start_download_engine(has_nvidia_gpu: bool, force_refresh: Option<bool>) -> DownloadResult {
    let engine_dir = match engine_paths::ensure_runtime_engine_dir() {
        Ok(path) => path,
        Err(e) => {
            return DownloadResult {
                success: false,
                message: format!("Failed to prepare engine directory: {}", e),
            };
        }
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let server_path = engine_dir.join("llama-server.exe");
    if server_path.exists() && !force_refresh {
        return DownloadResult {
            success: true,
            message: "Runtime engine already present.".to_string(),
        };
    }

    if IS_DOWNLOADING.swap(true, Ordering::SeqCst) {
        return DownloadResult {
            success: true,
            message: "Download already in progress.".to_string(),
        };
    }

    let engine_dir_str = engine_dir.display().to_string();
    let engine_zip_str = engine_dir.join("engine.zip").display().to_string();
    let cudart_zip_str = engine_dir.join("cudart.zip").display().to_string();
    let tag_file_str = engine_dir.join("release-tag.txt").display().to_string();
    let force_block = if force_refresh {
        format!(
            "echo Clearing previous runtime engine...\r\n\
             del /q \"{}\\*.exe\" >nul 2>&1\r\n\
             del /q \"{}\\*.dll\" >nul 2>&1\r\n\
             del /q \"{}\\*.json\" >nul 2>&1\r\n\
             del /q \"{}\\*.log\" >nul 2>&1\r\n",
            engine_dir_str, engine_dir_str, engine_dir_str, engine_dir_str
        )
    } else {
        String::new()
    };

    let bat_content = if has_nvidia_gpu {
        format!(
            "@echo off\r\n\
             setlocal enabledelayedexpansion\r\n\
             set \"ENGINE_DIR={}\"\r\n\
             if not exist \"%ENGINE_DIR%\" mkdir \"%ENGINE_DIR%\"\r\n\
             {}\r\n\
             echo Fetching latest llama.cpp release tag...\r\n\
             powershell -NoProfile -Command \"$ProgressPreference='SilentlyContinue'; (Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest').tag_name | Set-Content -NoNewline '{}'\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             set /p LLAMA_TAG=<\"{}\"\r\n\
             if \"%LLAMA_TAG%\"==\"\" exit /b 1\r\n\
             set \"ENGINE_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_TAG%/llama-%LLAMA_TAG%-bin-win-cuda-12.4-x64.zip\"\r\n\
             set \"CUDA_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_TAG%/cudart-llama-bin-win-cuda-12.4-x64.zip\"\r\n\
             echo Downloading engine %LLAMA_TAG%...\r\n\
             curl.exe --ssl-no-revoke -L -C - -o \"{}\" \"%ENGINE_URL%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Extracting engine...\r\n\
             tar.exe -xf \"{}\" -C \"%ENGINE_DIR%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Cleaning up engine archive...\r\n\
             del \"{}\" >nul 2>&1\r\n\
             echo Downloading CUDA runtime...\r\n\
             curl.exe --ssl-no-revoke -L -C - -o \"{}\" \"%CUDA_URL%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Extracting CUDA runtime...\r\n\
             tar.exe -xf \"{}\" -C \"%ENGINE_DIR%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Cleaning up CUDA archive...\r\n\
             del \"{}\" >nul 2>&1\r\n\
             echo Done.\r\n",
            engine_dir_str,
            force_block,
            tag_file_str,
            tag_file_str,
            engine_zip_str,
            engine_zip_str,
            engine_zip_str,
            cudart_zip_str,
            cudart_zip_str,
            cudart_zip_str
        )
    } else {
        format!(
            "@echo off\r\n\
             setlocal enabledelayedexpansion\r\n\
             set \"ENGINE_DIR={}\"\r\n\
             if not exist \"%ENGINE_DIR%\" mkdir \"%ENGINE_DIR%\"\r\n\
             {}\r\n\
             echo Fetching latest llama.cpp release tag...\r\n\
             powershell -NoProfile -Command \"$ProgressPreference='SilentlyContinue'; (Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest').tag_name | Set-Content -NoNewline '{}'\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             set /p LLAMA_TAG=<\"{}\"\r\n\
             if \"%LLAMA_TAG%\"==\"\" exit /b 1\r\n\
             set \"ENGINE_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_TAG%/llama-%LLAMA_TAG%-bin-win-cpu-x64.zip\"\r\n\
             echo Downloading engine %LLAMA_TAG%...\r\n\
             curl.exe --ssl-no-revoke -L -C - -o \"{}\" \"%ENGINE_URL%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Extracting engine...\r\n\
             tar.exe -xf \"{}\" -C \"%ENGINE_DIR%\"\r\n\
             if errorlevel 1 exit /b 1\r\n\
             echo Cleaning up engine archive...\r\n\
             del \"{}\" >nul 2>&1\r\n\
             echo Done.\r\n",
            engine_dir_str,
            force_block,
            tag_file_str,
            tag_file_str,
            engine_zip_str,
            engine_zip_str,
            engine_zip_str
        )
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let bat_path = std::env::temp_dir().join(format!("galaxy_ai_download_{}.bat", timestamp));

    let mut file = match std::fs::File::create(&bat_path) {
        Ok(f) => f,
        Err(e) => {
            IS_DOWNLOADING.store(false, Ordering::SeqCst);
            return DownloadResult {
                success: false,
                message: format!("Failed to create download script: {}", e),
            };
        }
    };

    if let Err(e) = file.write_all(bat_content.as_bytes()) {
        IS_DOWNLOADING.store(false, Ordering::SeqCst);
        return DownloadResult {
            success: false,
            message: format!("Failed to write download script: {}", e),
        };
    }
    drop(file);

    let bat_path_clone = bat_path.clone();

    std::thread::spawn(move || {
        let _ = Command::new("cmd").arg("/C").arg(&bat_path_clone).status();
        let _ = std::fs::remove_file(&bat_path_clone);
        IS_DOWNLOADING.store(false, Ordering::SeqCst);
    });

    DownloadResult {
        success: true,
        message: if force_refresh {
            "Engine update started in background.".to_string()
        } else {
            "Download started in background.".to_string()
        },
    }
}

#[tauri::command]
pub async fn download_engine(has_nvidia_gpu: bool, force_refresh: Option<bool>) -> DownloadResult {
    start_download_engine(has_nvidia_gpu, force_refresh)
}
