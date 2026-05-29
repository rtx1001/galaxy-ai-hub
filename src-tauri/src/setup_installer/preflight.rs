use super::*;

pub(super) fn preflight_check(
    key: &str,
    label: &str,
    ok: bool,
    message: String,
) -> SetupPreflightCheck {
    SetupPreflightCheck {
        key: key.to_string(),
        label: label.to_string(),
        status: if ok { "ok" } else { "attention" }.to_string(),
        message,
    }
}

pub(super) fn command_available(command_name: &str) -> bool {
    let mut command = Command::new("where.exe");
    command.arg(command_name);
    crate::process_util::hide_window(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub(super) fn webview2_available() -> bool {
    let registry_keys = [
        r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
        r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1E7A2DF-5D0D-4D6B-8E1D-95E2C5DB0B21}",
    ];
    registry_keys.iter().any(|key| {
        let mut command = Command::new("reg.exe");
        command.arg("query").arg(key).arg("/v").arg("pv");
        command.stdout(Stdio::null()).stderr(Stdio::null());
        crate::process_util::hide_window(&mut command);
        command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

pub(super) fn app_folder_writable() -> bool {
    let probe = app_root_dir().join("logs").join(format!(
        "preflight-{}.tmp",
        chrono::Utc::now().timestamp_millis()
    ));
    if let Some(parent) = probe.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}

pub(super) fn app_disk_free_mb() -> Option<u64> {
    let root = app_root_dir();
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|disk| root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space() / 1024 / 1024)
}
