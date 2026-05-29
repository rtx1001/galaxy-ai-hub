use super::*;

#[tauri::command]
pub fn get_graphics_power_status() -> GraphicsPowerStatus {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=memory.used,memory.total,utilization.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .to_string();
            let parts: Vec<_> = line.split(',').map(|value| value.trim()).collect();

            if parts.len() >= 3 {
                let used_mb = parts[0].parse::<u32>().unwrap_or(0);
                let total_mb = parts[1].parse::<u32>().unwrap_or(0);
                let percent = if total_mb == 0 {
                    0
                } else {
                    ((used_mb as f32 / total_mb as f32) * 100.0).round() as u8
                };

                GraphicsPowerStatus {
                    available: true,
                    used_mb,
                    total_mb,
                    percent,
                    summary: format!("{} MB of {} MB in use", used_mb, total_mb),
                }
            } else {
                GraphicsPowerStatus {
                    available: false,
                    used_mb: 0,
                    total_mb: 0,
                    percent: 0,
                    summary: "Graphics Power monitor is unavailable.".to_string(),
                }
            }
        }
        _ => GraphicsPowerStatus {
            available: false,
            used_mb: 0,
            total_mb: 0,
            percent: 0,
            summary: "Graphics Power monitor is unavailable.".to_string(),
        },
    }
}

#[tauri::command]
pub fn get_system_resource_status() -> crate::resource_monitor::SystemResourceStatus {
    crate::resource_monitor::get_system_resource_status()
}

#[tauri::command]
pub fn get_vram_memory_status() -> crate::resource_monitor::VramMemoryStatus {
    crate::resource_monitor::get_vram_memory_status()
}
