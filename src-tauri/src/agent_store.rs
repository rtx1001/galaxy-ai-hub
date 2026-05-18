use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct MemoryItem {
    pub id: i64,
    pub kind: String,
    pub key: String,
    pub value: String,
    pub source: String,
    pub confidence: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AutomationJob {
    pub id: i64,
    pub name: String,
    pub prompt: String,
    pub schedule: String,
    pub enabled: bool,
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolRun {
    pub tool_name: String,
    pub input_json: String,
    pub output_text: String,
    pub success: bool,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentToolRunRecord {
    pub id: i64,
    pub tool_name: String,
    pub input_json: String,
    pub output_text: String,
    pub success: bool,
    pub duration_ms: i64,
    pub created_at: i64,
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

fn db_path() -> PathBuf {
    app_root_dir().join("config").join("galaxy_agent.db")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the memory folder: {}", e))?;
    }

    let conn = Connection::open(path)
        .map_err(|e| format!("Could not open local memory database: {}", e))?;
    initialize_db(&conn)?;
    Ok(conn)
}

fn initialize_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS memory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'user',
            confidence REAL NOT NULL DEFAULT 1.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(kind, key)
        );

        CREATE INDEX IF NOT EXISTS idx_memory_items_kind
            ON memory_items(kind, updated_at DESC);

        CREATE TABLE IF NOT EXISTS automation_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL,
            schedule TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            next_run_at INTEGER,
            last_run_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_automation_jobs_enabled
            ON automation_jobs(enabled, next_run_at);

        CREATE TABLE IF NOT EXISTS tool_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_name TEXT NOT NULL,
            input_json TEXT NOT NULL,
            output_text TEXT NOT NULL,
            success INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tool_runs_created
            ON tool_runs(created_at DESC);

        CREATE TABLE IF NOT EXISTS personality_chat_sessions (
            personality_id TEXT PRIMARY KEY,
            messages_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Could not initialize local memory database: {}", e))?;

    let has_duration_ms = conn
        .prepare("PRAGMA table_info(tool_runs)")
        .and_then(|mut stmt| {
            let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for column in columns {
                if column? == "duration_ms" {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .map_err(|e| format!("Could not inspect tool activity schema: {}", e))?;
    if !has_duration_ms {
        conn.execute(
            "ALTER TABLE tool_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Could not upgrade tool activity schema: {}", e))?;
    }

    Ok(())
}

fn sanitize_required(value: String, label: &str, max_len: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} is required.", label));
    }
    if trimmed.len() > max_len {
        return Err(format!("{} is too long.", label));
    }
    Ok(trimmed.to_string())
}

fn validate_schedule(schedule: &str) -> Result<(), String> {
    let trimmed = schedule.trim();
    if matches!(trimmed, "@hourly" | "@daily" | "@weekly" | "@monthly") {
        return Ok(());
    }

    let is_date = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() == 10
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes
                .iter()
                .enumerate()
                .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    };
    let is_time = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() == 5
            && bytes[2] == b':'
            && bytes
                .iter()
                .enumerate()
                .all(|(index, byte)| index == 2 || byte.is_ascii_digit())
    };

    let date_parts: Vec<_> = trimmed.split_whitespace().collect();
    if date_parts.len() == 1 && is_date(date_parts[0]) {
        return Ok(());
    }
    if date_parts.len() == 2 && is_date(date_parts[0]) && is_time(date_parts[1]) {
        return Ok(());
    }
    if date_parts.len() == 2
        && is_date(date_parts[0])
        && matches!(date_parts[1], "@daily" | "@weekly" | "@monthly")
    {
        return Ok(());
    }
    if date_parts.len() == 3
        && is_date(date_parts[0])
        && matches!(date_parts[1], "@daily" | "@weekly" | "@monthly")
        && is_time(date_parts[2])
    {
        return Ok(());
    }

    let parts: Vec<_> = trimmed.split_whitespace().collect();
    if parts.len() != 5 {
        return Err("Use a calendar date, a repeat choice, or a 5-part cron schedule.".to_string());
    }

    let allowed = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, '*' | '/' | ',' | '-'))
    };
    if parts.iter().all(|part| allowed(part)) {
        Ok(())
    } else {
        Err("The schedule contains unsupported characters.".to_string())
    }
}

fn row_to_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryItem> {
    Ok(MemoryItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        key: row.get(2)?,
        value: row.get(3)?,
        source: row.get(4)?,
        confidence: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_automation(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationJob> {
    let enabled: i64 = row.get(4)?;
    Ok(AutomationJob {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        schedule: row.get(3)?,
        enabled: enabled != 0,
        next_run_at: row.get(5)?,
        last_run_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn remember_local_memory(
    kind: String,
    key: String,
    value: String,
    source: Option<String>,
    confidence: Option<f64>,
) -> Result<MemoryItem, String> {
    let conn = open_db()?;
    let now = now_unix();
    let kind = sanitize_required(kind, "Memory type", 80)?;
    let key = sanitize_required(key, "Memory key", 200)?;
    let value = sanitize_required(value, "Memory value", 16_000)?;
    let source = source
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "user".to_string());
    let confidence = confidence.unwrap_or(1.0).clamp(0.0, 1.0);

    conn.execute(
        r#"
        INSERT INTO memory_items (kind, key, value, source, confidence, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(kind, key) DO UPDATE SET
            value = excluded.value,
            source = excluded.source,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        "#,
        params![kind, key, value, source, confidence, now],
    )
    .map_err(|e| format!("Could not save memory: {}", e))?;

    conn.query_row(
        r#"
        SELECT id, kind, key, value, source, confidence, created_at, updated_at
        FROM memory_items
        WHERE kind = ?1 AND key = ?2
        "#,
        params![kind, key],
        row_to_memory,
    )
    .map_err(|e| format!("Could not read saved memory: {}", e))
}

#[tauri::command]
pub fn list_local_memory(
    kind: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<MemoryItem>, String> {
    let conn = open_db()?;
    let max = limit.unwrap_or(100).clamp(1, 500) as i64;
    let kind = kind
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let sql = if kind.is_some() {
        r#"
        SELECT id, kind, key, value, source, confidence, created_at, updated_at
        FROM memory_items
        WHERE kind = ?1
        ORDER BY updated_at DESC
        LIMIT ?2
        "#
    } else {
        r#"
        SELECT id, kind, key, value, source, confidence, created_at, updated_at
        FROM memory_items
        ORDER BY updated_at DESC
        LIMIT ?2
        "#
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Could not prepare memory list: {}", e))?;
    let rows = if let Some(kind) = kind {
        stmt.query_map(params![kind, max], row_to_memory)
            .map_err(|e| format!("Could not list memory: {}", e))?
            .collect::<Result<Vec<_>, _>>()
    } else {
        stmt.query_map(params![max], row_to_memory)
            .map_err(|e| format!("Could not list memory: {}", e))?
            .collect::<Result<Vec<_>, _>>()
    };

    rows.map_err(|e| format!("Could not read memory: {}", e))
}

#[tauri::command]
pub fn forget_local_memory(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let changed = conn
        .execute("DELETE FROM memory_items WHERE id = ?1", params![id])
        .map_err(|e| format!("Could not remove memory: {}", e))?;
    Ok(changed > 0)
}

#[tauri::command]
pub fn create_automation_job(
    name: String,
    prompt: String,
    schedule: String,
    enabled: Option<bool>,
) -> Result<AutomationJob, String> {
    let conn = open_db()?;
    let now = now_unix();
    let name = sanitize_required(name, "Automation name", 160)?;
    let prompt = sanitize_required(prompt, "Automation task", 16_000)?;
    let schedule = sanitize_required(schedule, "Automation schedule", 120)?;
    validate_schedule(&schedule)?;
    let enabled = enabled.unwrap_or(true);

    conn.execute(
        r#"
        INSERT INTO automation_jobs
            (name, prompt, schedule, enabled, next_run_at, last_run_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?5)
        "#,
        params![name, prompt, schedule, if enabled { 1 } else { 0 }, now],
    )
    .map_err(|e| format!("Could not create automation: {}", e))?;

    let id = conn.last_insert_rowid();
    get_automation_job_by_id(&conn, id)
}

#[tauri::command]
pub fn update_automation_job(
    id: i64,
    name: String,
    prompt: String,
    schedule: String,
    enabled: Option<bool>,
) -> Result<AutomationJob, String> {
    let conn = open_db()?;
    let now = now_unix();
    let name = sanitize_required(name, "Automation name", 160)?;
    let prompt = sanitize_required(prompt, "Automation task", 16_000)?;
    let schedule = sanitize_required(schedule, "Automation schedule", 120)?;
    validate_schedule(&schedule)?;

    let changed = if let Some(enabled) = enabled {
        conn.execute(
            r#"
            UPDATE automation_jobs
            SET name = ?1, prompt = ?2, schedule = ?3, enabled = ?4, updated_at = ?5
            WHERE id = ?6
            "#,
            params![name, prompt, schedule, if enabled { 1 } else { 0 }, now, id],
        )
    } else {
        conn.execute(
            r#"
            UPDATE automation_jobs
            SET name = ?1, prompt = ?2, schedule = ?3, updated_at = ?4
            WHERE id = ?5
            "#,
            params![name, prompt, schedule, now, id],
        )
    }
    .map_err(|e| format!("Could not update automation: {}", e))?;

    if changed == 0 {
        return Err("Automation was not found.".to_string());
    }
    get_automation_job_by_id(&conn, id)
}

fn get_automation_job_by_id(conn: &Connection, id: i64) -> Result<AutomationJob, String> {
    conn.query_row(
        r#"
        SELECT id, name, prompt, schedule, enabled, next_run_at, last_run_at, created_at, updated_at
        FROM automation_jobs
        WHERE id = ?1
        "#,
        params![id],
        row_to_automation,
    )
    .optional()
    .map_err(|e| format!("Could not read automation: {}", e))?
    .ok_or_else(|| "Automation was not found.".to_string())
}

#[tauri::command]
pub fn list_automation_jobs(include_disabled: Option<bool>) -> Result<Vec<AutomationJob>, String> {
    let conn = open_db()?;
    let include_disabled = include_disabled.unwrap_or(true);
    let sql = if include_disabled {
        r#"
        SELECT id, name, prompt, schedule, enabled, next_run_at, last_run_at, created_at, updated_at
        FROM automation_jobs
        ORDER BY enabled DESC, updated_at DESC
        "#
    } else {
        r#"
        SELECT id, name, prompt, schedule, enabled, next_run_at, last_run_at, created_at, updated_at
        FROM automation_jobs
        WHERE enabled = 1
        ORDER BY updated_at DESC
        "#
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Could not prepare automation list: {}", e))?;
    let rows = stmt
        .query_map([], row_to_automation)
        .map_err(|e| format!("Could not list automations: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read automations: {}", e))?;
    Ok(rows)
}

#[tauri::command]
pub fn set_automation_job_enabled(id: i64, enabled: bool) -> Result<AutomationJob, String> {
    let conn = open_db()?;
    let now = now_unix();
    let changed = conn
        .execute(
            "UPDATE automation_jobs SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, now, id],
        )
        .map_err(|e| format!("Could not update automation: {}", e))?;
    if changed == 0 {
        return Err("Automation was not found.".to_string());
    }
    get_automation_job_by_id(&conn, id)
}

#[tauri::command]
pub fn delete_automation_job(id: i64) -> Result<bool, String> {
    let conn = open_db()?;
    let changed = conn
        .execute("DELETE FROM automation_jobs WHERE id = ?1", params![id])
        .map_err(|e| format!("Could not delete automation: {}", e))?;
    Ok(changed > 0)
}

#[tauri::command]
pub fn mark_automation_job_ran(id: i64) -> Result<AutomationJob, String> {
    let conn = open_db()?;
    let now = now_unix();
    let changed = conn
        .execute(
            "UPDATE automation_jobs SET last_run_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| format!("Could not update automation run time: {}", e))?;
    if changed == 0 {
        return Err("Automation was not found.".to_string());
    }
    get_automation_job_by_id(&conn, id)
}

#[tauri::command]
pub fn record_agent_tool_run(run: AgentToolRun) -> Result<i64, String> {
    let conn = open_db()?;
    let input_json = if run.input_json.len() > 32_000 {
        format!("{}...[truncated]", &run.input_json[..32_000])
    } else {
        run.input_json
    };
    let output_text = if run.output_text.len() > 32_000 {
        format!("{}...[truncated]", &run.output_text[..32_000])
    } else {
        run.output_text
    };
    conn.execute(
        r#"
        INSERT INTO tool_runs (tool_name, input_json, output_text, success, duration_ms, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            sanitize_required(run.tool_name, "Tool name", 120)?,
            input_json,
            output_text,
            if run.success { 1 } else { 0 },
            run.duration_ms.max(0),
            now_unix()
        ],
    )
    .map_err(|e| format!("Could not record tool run: {}", e))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn list_agent_tool_runs(limit: Option<i64>) -> Result<Vec<AgentToolRunRecord>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(30).clamp(1, 200);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, tool_name, input_json, output_text, success, duration_ms, created_at
            FROM tool_runs
            ORDER BY created_at DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|e| format!("Could not read tool activity: {}", e))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let success: i64 = row.get(4)?;
            Ok(AgentToolRunRecord {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                input_json: row.get(2)?,
                output_text: row.get(3)?,
                success: success != 0,
                duration_ms: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Could not read tool activity: {}", e))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Could not read tool activity: {}", e))
}

#[tauri::command]
pub fn save_personality_chat_session(
    personality_id: String,
    messages_json: String,
) -> Result<bool, String> {
    let conn = open_db()?;
    let personality_id = sanitize_required(personality_id, "Personality ID", 160)?;
    if messages_json.len() > 1_000_000 {
        return Err("This chat session is too large to save safely.".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO personality_chat_sessions (personality_id, messages_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(personality_id) DO UPDATE SET
            messages_json = excluded.messages_json,
            updated_at = excluded.updated_at
        "#,
        params![personality_id, messages_json, now_unix()],
    )
    .map_err(|e| format!("Could not save this chat session: {}", e))?;
    Ok(true)
}

#[tauri::command]
pub fn load_personality_chat_session(personality_id: String) -> Result<String, String> {
    let conn = open_db()?;
    let personality_id = sanitize_required(personality_id, "Personality ID", 160)?;
    conn.query_row(
        "SELECT messages_json FROM personality_chat_sessions WHERE personality_id = ?1",
        params![personality_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("Could not load this chat session: {}", e))
    .map(|value| value.unwrap_or_else(|| "[]".to_string()))
}

#[tauri::command]
pub fn delete_personality_chat_session(personality_id: String) -> Result<bool, String> {
    let conn = open_db()?;
    let personality_id = sanitize_required(personality_id, "Personality ID", 160)?;
    let changed = conn
        .execute(
            "DELETE FROM personality_chat_sessions WHERE personality_id = ?1",
            params![personality_id],
        )
        .map_err(|e| format!("Could not delete this chat session: {}", e))?;
    Ok(changed > 0)
}
