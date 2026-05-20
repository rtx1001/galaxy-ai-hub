use std::process::Command;
use sysinfo::System;

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub has_nvidia_gpu: bool,
    pub gpu_details: String,
    pub total_vram_mb: u32,
    pub total_ram_mb: u64,
    pub cpu_name: String,
    pub cpu_threads: u32,
    pub recommended_chat_gpu_layers: u32,
    pub recommended_task_gpu_layers: u32,
    pub recommended_context_size: u32,
}

#[tauri::command]
pub fn check_system() -> SystemInfo {
    let mut system = System::new_all();
    system.refresh_memory();
    system.refresh_cpu();
    let output = Command::new("nvidia-smi")
        .arg("--query-gpu=name,memory.total")
        .arg("--format=csv,noheader,nounits")
        .output();
    let cpu_threads = std::thread::available_parallelism()
        .map(|value| value.get() as u32)
        .unwrap_or(4);
    let total_ram_mb = system.total_memory() / 1024 / 1024;
    let cpu_name = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    match output {
        Ok(out) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            let mut parts = line.split(',').map(str::trim);
            let gpu_name = parts.next().unwrap_or("NVIDIA GPU");
            let total_vram_mb = parts
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            let (
                recommended_chat_gpu_layers,
                recommended_task_gpu_layers,
                recommended_context_size,
            ) = if total_vram_mb <= 8192 {
                (24, 8, 8192)
            } else if total_vram_mb <= 12288 {
                (40, 12, 8192)
            } else {
                (60, 16, 8192)
            };

            SystemInfo {
                has_nvidia_gpu: true,
                gpu_details: format!(
                    "{} ({:.1} GB VRAM)",
                    gpu_name,
                    total_vram_mb as f32 / 1024.0
                ),
                total_vram_mb,
                total_ram_mb,
                cpu_name,
                cpu_threads,
                recommended_chat_gpu_layers,
                recommended_task_gpu_layers,
                recommended_context_size,
            }
        }
        _ => SystemInfo {
            has_nvidia_gpu: false,
            gpu_details: "No NVIDIA GPU detected (or nvidia-smi not in PATH)".to_string(),
            total_vram_mb: 0,
            total_ram_mb,
            cpu_name,
            cpu_threads,
            recommended_chat_gpu_layers: 0,
            recommended_task_gpu_layers: 0,
            recommended_context_size: 8192,
        },
    }
}
