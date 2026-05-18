use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use libloading::Library;
use serde::Serialize;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

static HOST_SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();
static NVML_STATE: OnceLock<Mutex<Option<NvmlApi>>> = OnceLock::new();

type NvmlReturn = u32;
type NvmlDevice = *mut c_void;

const NVML_SUCCESS: NvmlReturn = 0;
const NVML_TEMPERATURE_GPU: u32 = 0;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct NvmlMemory {
    total: u64,
    free: u64,
    used: u64,
}

struct NvmlApi {
    _library: Library,
    device: NvmlDevice,
    device_get_memory_info: unsafe extern "C" fn(NvmlDevice, *mut NvmlMemory) -> NvmlReturn,
    device_get_temperature: unsafe extern "C" fn(NvmlDevice, u32, *mut u32) -> NvmlReturn,
}

unsafe impl Send for NvmlApi {}

#[derive(Clone, Copy, Default)]
struct GpuMetrics {
    available: bool,
    used_mb: u32,
    total_mb: u32,
    free_mb: u32,
    temperature_c: Option<u8>,
}

#[derive(Debug, Serialize)]
pub struct ResourceBarStatus {
    pub label: String,
    pub available: bool,
    pub percent: u8,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct SystemResourceStatus {
    pub vram: ResourceBarStatus,
    pub gpu_temp: ResourceBarStatus,
    pub ram: ResourceBarStatus,
    pub cpu: ResourceBarStatus,
    pub cpu_temp: ResourceBarStatus,
}

#[derive(Debug, Serialize)]
pub struct VramMemoryStatus {
    pub available: bool,
    pub used_mb: u32,
    pub total_mb: u32,
    pub free_mb: u32,
}

fn make_resource_bar(
    label: &str,
    available: bool,
    percent: u8,
    summary: String,
) -> ResourceBarStatus {
    ResourceBarStatus {
        label: label.to_string(),
        available,
        percent,
        summary,
    }
}

fn query_host_metrics() -> Option<(u64, u64, u8)> {
    let system = HOST_SYSTEM.get_or_init(|| {
        Mutex::new(System::new_with_specifics(
            RefreshKind::new()
                .with_memory(MemoryRefreshKind::everything())
                .with_cpu(CpuRefreshKind::everything()),
        ))
    });
    let mut system = system.lock().ok()?;
    system.refresh_memory();
    system.refresh_cpu();

    let cpu_percent = system
        .global_cpu_info()
        .cpu_usage()
        .round()
        .clamp(0.0, 100.0) as u8;

    Some((
        system.available_memory(),
        system.total_memory(),
        cpu_percent,
    ))
}

fn nvml_library_candidates() -> &'static [&'static str] {
    &[
        "nvml.dll",
        "C:\\Windows\\System32\\nvml.dll",
        "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvml.dll",
    ]
}

unsafe fn load_symbol<T>(library: &Library, names: &[&[u8]]) -> Result<T, String>
where
    T: Copy,
{
    for name in names {
        if let Ok(symbol) = library.get::<T>(name) {
            return Ok(*symbol);
        }
    }
    Err("Required NVML symbol is unavailable.".to_string())
}

fn load_nvml_api() -> Result<NvmlApi, String> {
    for candidate in nvml_library_candidates() {
        let library = match unsafe { Library::new(candidate) } {
            Ok(library) => library,
            Err(_) => continue,
        };

        let api = unsafe {
            let init: unsafe extern "C" fn() -> NvmlReturn =
                load_symbol(&library, &[b"nvmlInit_v2\0", b"nvmlInit\0"])?;
            if init() != NVML_SUCCESS {
                continue;
            }

            let device_get_handle_by_index: unsafe extern "C" fn(
                u32,
                *mut NvmlDevice,
            ) -> NvmlReturn = load_symbol(
                &library,
                &[
                    b"nvmlDeviceGetHandleByIndex_v2\0",
                    b"nvmlDeviceGetHandleByIndex\0",
                ],
            )?;
            let device_get_memory_info: unsafe extern "C" fn(
                NvmlDevice,
                *mut NvmlMemory,
            ) -> NvmlReturn = load_symbol(&library, &[b"nvmlDeviceGetMemoryInfo\0"])?;
            let device_get_temperature: unsafe extern "C" fn(
                NvmlDevice,
                u32,
                *mut u32,
            ) -> NvmlReturn = load_symbol(&library, &[b"nvmlDeviceGetTemperature\0"])?;

            let mut device: NvmlDevice = std::ptr::null_mut();
            if device_get_handle_by_index(0, &mut device) != NVML_SUCCESS || device.is_null() {
                continue;
            }

            NvmlApi {
                _library: library,
                device,
                device_get_memory_info,
                device_get_temperature,
            }
        };

        return Ok(api);
    }

    Err("NVML is unavailable.".to_string())
}

fn query_gpu_metrics() -> GpuMetrics {
    let state = NVML_STATE.get_or_init(|| Mutex::new(load_nvml_api().ok()));
    let mut guard = match state.lock() {
        Ok(guard) => guard,
        Err(_) => return GpuMetrics::default(),
    };

    if guard.is_none() {
        *guard = load_nvml_api().ok();
    }

    let Some(api) = guard.as_ref() else {
        return GpuMetrics::default();
    };

    let mut memory = NvmlMemory::default();
    let memory_ok =
        unsafe { (api.device_get_memory_info)(api.device, &mut memory) } == NVML_SUCCESS;
    if !memory_ok || memory.total == 0 {
        return GpuMetrics::default();
    }

    let mut temperature_raw = 0u32;
    let temperature_c = if unsafe {
        (api.device_get_temperature)(api.device, NVML_TEMPERATURE_GPU, &mut temperature_raw)
    } == NVML_SUCCESS
    {
        Some(temperature_raw.min(100) as u8)
    } else {
        None
    };

    let used_mb = (memory.used / 1024 / 1024) as u32;
    let total_mb = (memory.total / 1024 / 1024) as u32;
    GpuMetrics {
        available: true,
        used_mb,
        total_mb,
        free_mb: total_mb.saturating_sub(used_mb),
        temperature_c,
    }
}

pub fn get_vram_memory_status() -> VramMemoryStatus {
    let gpu = query_gpu_metrics();
    VramMemoryStatus {
        available: gpu.available,
        used_mb: gpu.used_mb,
        total_mb: gpu.total_mb,
        free_mb: gpu.free_mb,
    }
}

pub fn get_system_resource_status() -> SystemResourceStatus {
    let gpu = query_gpu_metrics();
    let (vram, gpu_temp) = if gpu.available && gpu.total_mb > 0 {
        let vram_percent = ((gpu.used_mb as f32 / gpu.total_mb as f32) * 100.0)
            .round()
            .clamp(0.0, 100.0) as u8;
        (
            make_resource_bar("VRAM", true, vram_percent, format!("{}%", vram_percent)),
            match gpu.temperature_c {
                Some(temp) => make_resource_bar("GPU TEMP", true, temp, format!("{} C", temp)),
                None => make_resource_bar("GPU TEMP", false, 0, "Unavailable".to_string()),
            },
        )
    } else {
        (
            make_resource_bar("VRAM", false, 0, "Unavailable".to_string()),
            make_resource_bar("GPU TEMP", false, 0, "Unavailable".to_string()),
        )
    };

    let (ram, cpu, cpu_temp) = match query_host_metrics() {
        Some((available_bytes, total_bytes, cpu_percent)) => {
            let used_bytes = total_bytes.saturating_sub(available_bytes);
            let ram_percent = if total_bytes == 0 {
                0
            } else {
                ((used_bytes as f32 / total_bytes as f32) * 100.0).round() as u8
            };

            (
                make_resource_bar(
                    "RAM",
                    true,
                    ram_percent.min(100),
                    format!("{}%", ram_percent.min(100)),
                ),
                make_resource_bar("CPU", true, cpu_percent, format!("{}%", cpu_percent)),
                make_resource_bar("CPU TEMP", false, 0, "Unavailable".to_string()),
            )
        }
        None => (
            make_resource_bar("RAM", false, 0, "Unavailable".to_string()),
            make_resource_bar("CPU", false, 0, "Unavailable".to_string()),
            make_resource_bar("CPU TEMP", false, 0, "Unavailable".to_string()),
        ),
    };

    SystemResourceStatus {
        vram,
        gpu_temp,
        ram,
        cpu,
        cpu_temp,
    }
}
