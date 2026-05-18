use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Default)]
pub struct ShellApprovalState {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, PendingShellAction>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingShellAction {
    pub id: u64,
    pub command: String,
    pub working_directory: String,
    pub purpose: String,
    pub risk_level: String,
    pub timeout_seconds: u64,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ShellExecutionResult {
    pub id: u64,
    pub command: String,
    pub working_directory: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u128,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn clean_text(value: String, label: &str, max_len: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} is required.", label));
    }
    if trimmed.len() > max_len {
        return Err(format!("{} is too long.", label));
    }
    Ok(trimmed.to_string())
}

fn resolve_working_directory(value: Option<String>) -> Result<PathBuf, String> {
    let path = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(app_root_dir);

    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Could not inspect the working folder: {}", e))?;
    if !canonical.is_dir() {
        return Err("The working folder must be a folder.".to_string());
    }
    Ok(canonical)
}

fn classify_risk(command: &str) -> String {
    let lower = command.to_ascii_lowercase();
    let high_risk_terms = [
        "remove-item",
        "del ",
        "erase ",
        " rmdir",
        "format ",
        "diskpart",
        "bcdedit",
        "reg delete",
        "shutdown",
        "restart-computer",
        "stop-computer",
        "cipher /w",
        "takeown",
        "icacls",
    ];
    let medium_risk_terms = [
        "set-",
        "new-item",
        "move-item",
        "copy-item",
        "rename-item",
        "start-process",
        "invoke-webrequest",
        "curl ",
        "wget ",
    ];

    if high_risk_terms.iter().any(|term| lower.contains(term)) {
        "high".to_string()
    } else if medium_risk_terms.iter().any(|term| lower.contains(term)) {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn looks_like_image_generation_request(command: &str, purpose: &str) -> bool {
    let text = format!("{} {}", command, purpose).to_ascii_lowercase();
    [
        "sd-cli",
        "stable-diffusion",
        "stable_diffusion",
        "generate_image",
        "image generation",
        "create image",
        "generate an image",
        "text-to-image",
        "txt2img",
        "img2img",
    ]
    .iter()
    .any(|term| text.contains(term))
}

fn truncate_output(bytes: &[u8]) -> String {
    const MAX_OUTPUT: usize = 64 * 1024;
    let truncated = bytes.len() > MAX_OUTPUT;
    let mut text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_OUTPUT)]).to_string();
    if truncated {
        text.push_str("\n\n[Output was shortened.]");
    }
    text
}

#[tauri::command]
pub fn propose_shell_action(
    state: State<'_, ShellApprovalState>,
    command: String,
    working_directory: Option<String>,
    purpose: String,
    timeout_seconds: Option<u64>,
) -> Result<PendingShellAction, String> {
    let command = clean_text(command, "Command", 12_000)?;
    let purpose = clean_text(purpose, "Purpose", 2_000)?;
    if looks_like_image_generation_request(&command, &purpose) {
        return Err(
            "Image creation uses the app approval card, not Windows shell. Ask the assistant to propose an image instead."
                .to_string(),
        );
    }
    let working_directory = resolve_working_directory(working_directory)?;
    let timeout_seconds = timeout_seconds.unwrap_or(30).clamp(1, 180);
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;

    let action = PendingShellAction {
        id,
        command: command.clone(),
        working_directory: working_directory.to_string_lossy().to_string(),
        purpose,
        risk_level: classify_risk(&command),
        timeout_seconds,
        created_at: now_unix(),
    };

    state
        .pending
        .lock()
        .map_err(|_| "Could not lock pending shell actions.".to_string())?
        .insert(id, action.clone());

    Ok(action)
}

#[tauri::command]
pub fn list_pending_shell_actions(
    state: State<'_, ShellApprovalState>,
) -> Result<Vec<PendingShellAction>, String> {
    let mut actions = state
        .pending
        .lock()
        .map_err(|_| "Could not lock pending shell actions.".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    actions.sort_by_key(|action| action.created_at);
    Ok(actions)
}

#[tauri::command]
pub fn reject_shell_action(state: State<'_, ShellApprovalState>, id: u64) -> Result<bool, String> {
    let removed = state
        .pending
        .lock()
        .map_err(|_| "Could not lock pending shell actions.".to_string())?
        .remove(&id)
        .is_some();
    Ok(removed)
}

#[tauri::command]
pub async fn execute_shell_action(
    state: State<'_, ShellApprovalState>,
    id: u64,
) -> Result<ShellExecutionResult, String> {
    let action = state
        .pending
        .lock()
        .map_err(|_| "Could not lock pending shell actions.".to_string())?
        .remove(&id)
        .ok_or_else(|| "That shell action is no longer waiting for approval.".to_string())?;

    let started = std::time::Instant::now();
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(&action.command)
        .current_dir(&action.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start PowerShell: {}", e))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture command output.".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture command errors.".to_string())?;

    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes).await;
        bytes
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes).await;
        bytes
    });

    let timeout = Duration::from_secs(action.timeout_seconds);
    let (exit_code, timed_out) = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(error)) => {
            return Err(format!("Could not wait for PowerShell: {}", error));
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            (None, true)
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();

    Ok(ShellExecutionResult {
        id: action.id,
        command: action.command,
        working_directory: action.working_directory,
        exit_code,
        stdout: truncate_output(&stdout_bytes),
        stderr: truncate_output(&stderr_bytes),
        timed_out,
        duration_ms: started.elapsed().as_millis(),
    })
}
