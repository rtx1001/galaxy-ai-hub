use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn clean_command(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("MCP server command is required.".to_string());
    }
    if trimmed.len() > 1_000 {
        return Err("MCP server command is too long.".to_string());
    }
    Ok(trimmed.to_string())
}

fn clean_args(args: Option<Vec<String>>) -> Result<Vec<String>, String> {
    args.unwrap_or_default()
        .into_iter()
        .map(|arg| {
            let trimmed = arg.trim();
            if trimmed.len() > 1_000 {
                Err("One MCP server argument is too long.".to_string())
            } else {
                Ok(trimmed.to_string())
            }
        })
        .collect()
}

fn resolve_working_directory(value: Option<String>) -> Result<PathBuf, String> {
    let path = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(app_root_dir);
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Could not inspect the MCP working folder: {}", e))?;
    if !canonical.is_dir() {
        return Err("The MCP working folder must be a folder.".to_string());
    }
    Ok(canonical)
}

async fn write_json_line(
    stdin: &mut tokio::process::ChildStdin,
    value: &Value,
) -> Result<(), String> {
    let mut line =
        serde_json::to_string(value).map_err(|e| format!("Could not encode MCP message: {}", e))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Could not send MCP message: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Could not flush MCP message: {}", e))
}

async fn read_response_with_id(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    expected_id: i64,
) -> Result<Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("Could not read MCP response: {}", e))?;
        if bytes == 0 {
            return Err("The MCP server closed before answering.".to_string());
        }

        let parsed: Value = serde_json::from_str(line.trim())
            .map_err(|e| format!("MCP server returned invalid JSON: {}", e))?;
        if parsed.get("id").and_then(Value::as_i64) == Some(expected_id) {
            return Ok(parsed);
        }
    }
}

async fn run_mcp_stdio_request_inner(
    command: String,
    args: Option<Vec<String>>,
    working_directory: Option<String>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let command = clean_command(command)?;
    let args = clean_args(args)?;
    let working_directory = resolve_working_directory(working_directory)?;

    let mut child = Command::new(command)
        .args(args)
        .current_dir(working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start MCP server: {}", e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open MCP server input.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open MCP server output.".to_string())?;
    let mut reader = BufReader::new(stdout);

    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "Galaxy AI Hub",
                "version": "0.1.0"
            }
        }
    });
    write_json_line(&mut stdin, &initialize).await?;
    let initialize_response = read_response_with_id(&mut reader, 1).await?;
    if initialize_response.get("error").is_some() {
        let _ = child.kill().await;
        return Ok(initialize_response);
    }

    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_json_line(&mut stdin, &initialized).await?;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": method,
        "params": params.unwrap_or_else(|| json!({}))
    });
    write_json_line(&mut stdin, &request).await?;
    let response = read_response_with_id(&mut reader, 2).await?;
    let _ = child.kill().await;
    Ok(response)
}

#[tauri::command]
pub async fn mcp_stdio_list_tools(
    command: String,
    args: Option<Vec<String>>,
    working_directory: Option<String>,
    timeout_seconds: Option<u64>,
) -> Result<Value, String> {
    let timeout_seconds = timeout_seconds.unwrap_or(30).clamp(3, 180);
    tokio::time::timeout(
        Duration::from_secs(timeout_seconds),
        run_mcp_stdio_request_inner(
            command,
            args,
            working_directory,
            "tools/list".to_string(),
            Some(json!({})),
        ),
    )
    .await
    .map_err(|_| "The MCP server did not answer in time.".to_string())?
}

#[tauri::command]
pub async fn mcp_stdio_call_tool(
    command: String,
    args: Option<Vec<String>>,
    working_directory: Option<String>,
    tool_name: String,
    tool_arguments: Option<Value>,
    timeout_seconds: Option<u64>,
) -> Result<Value, String> {
    let tool_name = tool_name.trim();
    if tool_name.is_empty() {
        return Err("Tool name is required.".to_string());
    }
    if tool_name.len() > 200 {
        return Err("Tool name is too long.".to_string());
    }

    let timeout_seconds = timeout_seconds.unwrap_or(30).clamp(3, 180);
    tokio::time::timeout(
        Duration::from_secs(timeout_seconds),
        run_mcp_stdio_request_inner(
            command,
            args,
            working_directory,
            "tools/call".to_string(),
            Some(json!({
                "name": tool_name,
                "arguments": tool_arguments.unwrap_or_else(|| json!({}))
            })),
        ),
    )
    .await
    .map_err(|_| "The MCP server did not answer in time.".to_string())?
}
