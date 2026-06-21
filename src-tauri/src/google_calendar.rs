use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;
use url::Url;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_EVENTS_URL: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_GMAIL_MESSAGES_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GOOGLE_GMAIL_SEND_URL: &str = "https://www.googleapis.com/gmail/v1/users/me/messages/send";
const GOOGLE_SCOPES: &str = "https://mail.google.com/ https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/userinfo.email";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoogleTokenStore {
    access_token: String,
    refresh_token: String,
    token_type: String,
    scope: String,
    expires_at: i64,
    email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default = "default_token_type")]
    token_type: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    expires_in: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleConnectionStatus {
    connected: bool,
    email: Option<String>,
    expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarEvent {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub html_link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleCalendarActionResult {
    pub id: String,
    pub title: String,
    pub html_link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleMailMessage {
    pub id: String,
    pub thread_id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub internal_date: Option<i64>,
    pub snippet: String,
    pub web_link: String,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarEventsResponse {
    #[serde(default)]
    items: Vec<GoogleCalendarEventRaw>,
}

#[derive(Debug, Deserialize)]
struct GmailMessagesResponse {
    #[serde(default)]
    messages: Vec<GmailMessageRef>,
}

#[derive(Debug, Deserialize)]
struct GmailMessageRef {
    id: String,
}

#[derive(Debug, Deserialize)]
struct GmailMessageRaw {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    #[serde(default)]
    snippet: String,
    payload: Option<GmailPayload>,
}

#[derive(Debug, Deserialize)]
struct GmailPayload {
    #[serde(default)]
    headers: Vec<GmailHeader>,
}

#[derive(Debug, Deserialize)]
struct GmailHeader {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarEventRaw {
    id: String,
    summary: Option<String>,
    start: GoogleCalendarDateValue,
    end: GoogleCalendarDateValue,
    location: Option<String>,
    description: Option<String>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarDateValue {
    date: Option<String>,
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_header_controls(input: &str) -> String {
    input
        .chars()
        .filter(|ch| !matches!(ch, '\r' | '\n'))
        .collect::<String>()
        .trim()
        .to_string()
}

fn repair_latin1_utf8_mojibake(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty()
        || !trimmed.chars().any(|ch| {
            matches!(
                ch as u32,
                0x00C3
                    | 0x00C2
                    | 0x00C4
                    | 0x00C5
                    | 0x00D0
                    | 0x00D1
                    | 0x00E1
                    | 0x00E0
                    | 0x00BA
                    | 0x00BF
                    | 0x00A1
            )
        })
    {
        return trimmed.to_string();
    }

    let mut bytes = Vec::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        let code = ch as u32;
        if code > 0xFF {
            return trimmed.to_string();
        }
        bytes.push(code as u8);
    }

    String::from_utf8(bytes)
        .ok()
        .filter(|decoded| decoded.chars().any(|ch| !ch.is_ascii()))
        .unwrap_or_else(|| trimmed.to_string())
}

fn encode_rfc2047_utf8(input: &str) -> String {
    use base64::Engine;
    let clean = strip_header_controls(&repair_latin1_utf8_mojibake(input));
    let encoded = base64::engine::general_purpose::STANDARD.encode(clean.as_bytes());
    format!("=?UTF-8?B?{}?=", encoded)
}

fn default_token_type() -> String {
    "Bearer".to_string()
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

fn token_path() -> PathBuf {
    app_root_dir().join("config").join("google_tokens.json")
}

fn normalize_event_datetime(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Event date/time is required.".to_string());
    }

    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(parsed.to_rfc3339());
    }

    if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S") {
        let localized = Local
            .from_local_datetime(&parsed)
            .single()
            .ok_or_else(|| format!("Ambiguous local event time: {}", trimmed))?;
        return Ok(localized.to_rfc3339());
    }

    if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M") {
        let localized = Local
            .from_local_datetime(&parsed)
            .single()
            .ok_or_else(|| format!("Ambiguous local event time: {}", trimmed))?;
        return Ok(localized.to_rfc3339());
    }

    if let Ok(parsed) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let local_midnight = parsed
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| format!("Invalid event date: {}", trimmed))?;
        let localized = Local
            .from_local_datetime(&local_midnight)
            .single()
            .ok_or_else(|| format!("Ambiguous local event date: {}", trimmed))?;
        return Ok(localized.to_rfc3339());
    }

    Err(format!(
        "Unsupported event date/time format: {}. Use ISO 8601 like 2026-05-09T07:30:00.",
        trimmed
    ))
}

fn read_token_store() -> Result<Option<GoogleTokenStore>, String> {
    let path = token_path();
    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read Google connection: {}", e))?;
    let store = serde_json::from_str(&content)
        .map_err(|e| format!("Could not understand saved Google connection: {}", e))?;
    Ok(Some(store))
}

fn save_token_store(store: &GoogleTokenStore) -> Result<(), String> {
    let path = token_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create Google config folder: {}", e))?;
    }
    let content = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Could not save Google connection: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("Could not save Google connection: {}", e))
}

fn validate_google_config(
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
) -> Result<Url, String> {
    if client_id.trim().is_empty() {
        return Err("Google OAuth Client ID is required.".to_string());
    }
    if client_secret.trim().is_empty() {
        return Err("Google OAuth Client Secret is required.".to_string());
    }

    let redirect = Url::parse(redirect_uri.trim())
        .map_err(|_| "The local redirect address is not valid.".to_string())?;
    let host = redirect.host_str().unwrap_or_default();
    if !matches!(host, "127.0.0.1" | "localhost") {
        return Err(
            "Use a local redirect address like http://127.0.0.1:8765/google/callback.".to_string(),
        );
    }
    if redirect.port_or_known_default().is_none() {
        return Err("The local redirect address needs a port, for example 8765.".to_string());
    }
    Ok(redirect)
}

fn build_auth_url(client_id: &str, redirect_uri: &str, state: &str) -> String {
    format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&state={}",
        GOOGLE_AUTH_URL,
        urlencoding::encode(client_id.trim()),
        urlencoding::encode(redirect_uri.trim()),
        urlencoding::encode(GOOGLE_SCOPES),
        urlencoding::encode(state),
    )
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Could not open Google sign-in: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Could not open Google sign-in: {}", e))?;
    }

    Ok(())
}

async fn wait_for_oauth_callback(redirect: &Url, expected_state: &str) -> Result<String, String> {
    let host = redirect.host_str().unwrap_or("127.0.0.1");
    let port = redirect
        .port_or_known_default()
        .ok_or_else(|| "The local redirect address needs a port.".to_string())?;
    let listener = TcpListener::bind(format!("{}:{}", host, port))
        .await
        .map_err(|e| {
            format!(
                "Could not listen for Google sign-in on port {}: {}",
                port, e
            )
        })?;
    let expected_path = redirect.path().to_string();
    let expected_state = expected_state.to_string();

    timeout(Duration::from_secs(180), async move {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("Could not receive Google sign-in result: {}", e))?;
        let mut buffer = [0_u8; 8192];
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Could not read Google sign-in result: {}", e))?;
        let request = String::from_utf8_lossy(&buffer[..count]);
        let request_line = request
            .lines()
            .next()
            .ok_or_else(|| "Google sign-in returned an empty result.".to_string())?;
        let target = request_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "Google sign-in result was not valid.".to_string())?;
        let callback_url = Url::parse(&format!("http://127.0.0.1{}", target))
            .map_err(|_| "Google sign-in result was not valid.".to_string())?;
        if callback_url.path() != expected_path {
            return Err("Google returned to an unexpected local address.".to_string());
        }
        let state = callback_url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.to_string())
            .unwrap_or_default();
        if state != expected_state {
            return Err("Google sign-in safety check failed. Please try again.".to_string());
        }
        if let Some(error) = callback_url
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, value)| value.to_string())
        {
            return Err(format!("Google sign-in was cancelled: {}", error));
        }
        let code = callback_url
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string())
            .ok_or_else(|| "Google did not return a sign-in code.".to_string())?;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<html><body style=\"font-family:sans-serif;background:#131314;color:#e3e3e3\"><h2>Galaxy AI Hub is connected to Google.</h2><p>You can close this tab.</p></body></html>";
        let _ = stream.write_all(response).await;
        Ok(code)
    })
    .await
    .map_err(|_| "Google sign-in timed out. Please try again.".to_string())?
}

async fn exchange_code_for_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> Result<GoogleTokenStore, String> {
    let response = client
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("code", code),
            ("client_id", client_id.trim()),
            ("client_secret", client_secret.trim()),
            ("redirect_uri", redirect_uri.trim()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not contact Google: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Google rejected the sign-in request: {} {}",
            status, body
        ));
    }

    let token: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not read Google sign-in response: {}", e))?;
    if token.refresh_token.is_empty() {
        return Err("Google did not return a refresh token. Remove the app from your Google Account permissions, then connect again.".to_string());
    }

    let email = fetch_google_email(client, &token.access_token).await.ok();
    Ok(GoogleTokenStore {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type,
        scope: token.scope,
        expires_at: now_unix() + token.expires_in.max(60),
        email,
    })
}

async fn fetch_google_email(client: &Client, access_token: &str) -> Result<String, String> {
    let response = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Could not read Google account info: {}", e))?;
    if !response.status().is_success() {
        return Err("Google account info was not available.".to_string());
    }
    let info: GoogleUserInfo = response
        .json()
        .await
        .map_err(|e| format!("Could not read Google account info: {}", e))?;
    info.email
        .ok_or_else(|| "Google account email was not available.".to_string())
}

async fn refresh_google_token(
    client: &Client,
    client_id: &str,
    client_secret: &str,
    mut store: GoogleTokenStore,
) -> Result<GoogleTokenStore, String> {
    if store.expires_at > now_unix() + 90 {
        return Ok(store);
    }

    let response = client
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("client_id", client_id.trim()),
            ("client_secret", client_secret.trim()),
            ("refresh_token", store.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not refresh Google connection: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Google connection needs sign-in again: {} {}",
            status, body
        ));
    }

    let token: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not refresh Google connection: {}", e))?;
    store.access_token = token.access_token;
    store.token_type = token.token_type;
    if !token.scope.is_empty() {
        store.scope = token.scope;
    }
    store.expires_at = now_unix() + token.expires_in.max(60);
    save_token_store(&store)?;
    Ok(store)
}

fn gmail_header(headers: &[GmailHeader], name: &str) -> String {
    headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case(name))
        .map(|header| header.value.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_google_connection_status() -> Result<GoogleConnectionStatus, String> {
    let store = read_token_store()?;
    Ok(GoogleConnectionStatus {
        connected: store.is_some(),
        email: store.as_ref().and_then(|item| item.email.clone()),
        expires_at: store.map(|item| item.expires_at),
    })
}

#[tauri::command]
pub async fn connect_google_calendar(
    client_id: String,
    client_secret: String,
    redirect_uri: String,
) -> Result<GoogleConnectionStatus, String> {
    let redirect = validate_google_config(&client_id, &client_secret, &redirect_uri)?;
    let state = format!("galaxy-{}-{}", std::process::id(), now_unix());
    let auth_url = build_auth_url(&client_id, &redirect_uri, &state);
    let code_future = wait_for_oauth_callback(&redirect, &state);
    open_browser(&auth_url)?;
    let code = code_future.await?;
    let client = Client::new();
    let store =
        exchange_code_for_token(&client, &client_id, &client_secret, &redirect_uri, &code).await?;
    save_token_store(&store)?;
    Ok(GoogleConnectionStatus {
        connected: true,
        email: store.email,
        expires_at: Some(store.expires_at),
    })
}

#[tauri::command]
pub fn disconnect_google_calendar() -> Result<GoogleConnectionStatus, String> {
    let path = token_path();
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|e| format!("Could not disconnect Google Calendar: {}", e))?;
    }
    Ok(GoogleConnectionStatus {
        connected: false,
        email: None,
        expires_at: None,
    })
}

#[tauri::command]
pub async fn list_google_calendar_events(
    client_id: String,
    client_secret: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<GoogleCalendarEvent>, String> {
    let store =
        read_token_store()?.ok_or_else(|| "Google Calendar is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;

    let response = client
        .get(GOOGLE_CALENDAR_EVENTS_URL)
        .bearer_auth(&store.access_token)
        .query(&[
            ("timeMin", time_min.as_str()),
            ("timeMax", time_max.as_str()),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "250"),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not load Google Calendar events: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not load Google Calendar events: {} {}",
            status, body
        ));
    }

    let payload: GoogleCalendarEventsResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not read Google Calendar events: {}", e))?;

    Ok(payload
        .items
        .into_iter()
        .map(|item| {
            let start = item.start.date_time.or(item.start.date).unwrap_or_default();
            let end = item.end.date_time.or(item.end.date).unwrap_or_default();
            let all_day = start.len() == 10;
            GoogleCalendarEvent {
                id: item.id,
                title: item.summary.unwrap_or_else(|| "Untitled event".to_string()),
                start,
                end,
                all_day,
                location: item.location,
                description: item.description,
                html_link: item.html_link,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn create_google_calendar_event(
    client_id: String,
    client_secret: String,
    title: String,
    start: String,
    end: String,
    description: Option<String>,
    location: Option<String>,
) -> Result<GoogleCalendarActionResult, String> {
    let store =
        read_token_store()?.ok_or_else(|| "Google Calendar is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;
    let title = title.trim();
    if title.is_empty() {
        return Err("Event title is required.".to_string());
    }
    let start = normalize_event_datetime(&start)?;
    let end = normalize_event_datetime(&end)?;

    let response = client
        .post(GOOGLE_CALENDAR_EVENTS_URL)
        .bearer_auth(&store.access_token)
        .json(&serde_json::json!({
            "summary": title,
            "description": description.unwrap_or_default(),
            "location": location.unwrap_or_default(),
            "start": { "dateTime": start },
            "end": { "dateTime": end },
        }))
        .send()
        .await
        .map_err(|e| format!("Could not create Google Calendar event: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not create Google Calendar event: {} {}",
            status, body
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Could not read Google Calendar event result: {}", e))?;
    Ok(GoogleCalendarActionResult {
        id: body
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        title: body
            .get("summary")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(title)
            .to_string(),
        html_link: body
            .get("htmlLink")
            .and_then(serde_json::Value::as_str)
            .map(|value| value.to_string()),
    })
}

#[tauri::command]
pub async fn delete_google_calendar_event(
    client_id: String,
    client_secret: String,
    id: String,
) -> Result<String, String> {
    let store =
        read_token_store()?.ok_or_else(|| "Google Calendar is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;

    let response = client
        .delete(&format!("{}/{}", GOOGLE_CALENDAR_EVENTS_URL, id.trim()))
        .bearer_auth(&store.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not delete Google Calendar event: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not delete Google Calendar event: {} {}",
            status, body
        ));
    }

    Ok("Event deleted successfully.".to_string())
}

#[tauri::command]
pub async fn list_google_gmail_messages(
    client_id: String,
    client_secret: String,
    max_results: Option<u32>,
    query: Option<String>,
) -> Result<Vec<GoogleMailMessage>, String> {
    let store = read_token_store()?.ok_or_else(|| "Google is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;
    let max_results = max_results.unwrap_or(10).clamp(1, 25).to_string();
    let query = query.unwrap_or_default();

    let response = client
        .get(GOOGLE_GMAIL_MESSAGES_URL)
        .bearer_auth(&store.access_token)
        .query(&[("maxResults", max_results.as_str()), ("q", query.as_str())])
        .send()
        .await
        .map_err(|e| format!("Could not load Gmail messages: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not load Gmail messages: {} {}. If you connected Google before Gmail support was added, disconnect and connect Google again.",
            status, body
        ));
    }

    let payload: GmailMessagesResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not read Gmail message list: {}", e))?;
    let mut messages = Vec::new();

    for message_ref in payload.messages {
        let detail_url = format!("{}/{}", GOOGLE_GMAIL_MESSAGES_URL, message_ref.id);
        let response = client
            .get(detail_url)
            .bearer_auth(&store.access_token)
            .query(&[
                ("format", "metadata"),
                ("metadataHeaders", "Subject"),
                ("metadataHeaders", "From"),
                ("metadataHeaders", "Date"),
            ])
            .send()
            .await
            .map_err(|e| format!("Could not load Gmail message details: {}", e))?;
        if !response.status().is_success() {
            continue;
        }
        let raw: GmailMessageRaw = response
            .json()
            .await
            .map_err(|e| format!("Could not read Gmail message details: {}", e))?;
        let headers = raw
            .payload
            .map(|payload| payload.headers)
            .unwrap_or_default();
        messages.push(GoogleMailMessage {
            web_link: format!("https://mail.google.com/mail/u/0/#inbox/{}", raw.id),
            thread_id: raw.thread_id.unwrap_or_default(),
            internal_date: raw
                .internal_date
                .and_then(|value| value.parse::<i64>().ok()),
            id: raw.id,
            subject: decode_html_entities(&gmail_header(&headers, "Subject")),
            from: decode_html_entities(&gmail_header(&headers, "From")),
            date: decode_html_entities(&gmail_header(&headers, "Date")),
            snippet: decode_html_entities(&raw.snippet),
        });
    }

    Ok(messages)
}

#[tauri::command]
pub async fn send_google_gmail_message(
    client_id: String,
    client_secret: String,
    to: String,
    subject: String,
    body: String,
    sender_name: Option<String>,
) -> Result<String, String> {
    let store = read_token_store()?.ok_or_else(|| "Google is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;

    let encoded_subject = encode_rfc2047_utf8(subject.trim());
    let to_header = strip_header_controls(&to);
    let from_header = store
        .email
        .as_deref()
        .map(strip_header_controls)
        .filter(|email| !email.is_empty())
        .and_then(|email| {
            sender_name
                .as_deref()
                .map(repair_latin1_utf8_mojibake)
                .map(|name| strip_header_controls(&name))
                .filter(|name| !name.is_empty())
                .map(|name| format!("From: {} <{}>\r\n", encode_rfc2047_utf8(&name), email))
        })
        .unwrap_or_default();

    let raw_email = format!(
        "{}To: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{}",
        from_header,
        to_header,
        encoded_subject,
        body
    );

    // Base64url-encode without padding
    use base64::Engine;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw_email.as_bytes());

    let response = client
        .post(GOOGLE_GMAIL_SEND_URL)
        .bearer_auth(&store.access_token)
        .json(&serde_json::json!({ "raw": encoded }))
        .send()
        .await
        .map_err(|e| format!("Could not send Gmail message: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Could not send Gmail message: {} {}", status, body));
    }

    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Could not read Gmail send response: {}", e))?;
    let id = result
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    Ok(format!("Email sent successfully. Message ID: {}", id))
}

#[tauri::command]
pub async fn trash_google_gmail_message(
    client_id: String,
    client_secret: String,
    id: String,
) -> Result<String, String> {
    let store = read_token_store()?.ok_or_else(|| "Google is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;

    let url = format!("{}/{}/trash", GOOGLE_GMAIL_MESSAGES_URL, id.trim());
    let response = client
        .post(&url)
        .bearer_auth(&store.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not trash Gmail message: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not trash Gmail message: {} {}",
            status, body
        ));
    }

    Ok(format!("Email {} moved to Trash.", id))
}

fn google_api_url_allowed(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url.trim()) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    matches!(
        host,
        "www.googleapis.com"
            | "drive.googleapis.com"
            | "docs.googleapis.com"
            | "sheets.googleapis.com"
            | "people.googleapis.com"
            | "storage.googleapis.com"
            | "gmail.googleapis.com"
            | "chat.googleapis.com"
    )
}

#[tauri::command]
pub async fn delete_google_contact(
    client_id: String,
    client_secret: String,
    resource_name: String,
) -> Result<String, String> {
    let resource_name = resource_name.trim();
    if !resource_name.starts_with("people/")
        || resource_name.contains(':')
        || resource_name.chars().any(char::is_whitespace)
    {
        return Err("Invalid Google People resource name.".to_string());
    }

    let store = read_token_store()?.ok_or_else(|| "Google is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;
    let url = format!(
        "https://people.googleapis.com/v1/{}:deleteContact",
        resource_name
    );
    let response = client
        .delete(&url)
        .bearer_auth(&store.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not delete Google contact: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Could not delete Google contact: {} {}",
            status, body
        ));
    }

    Ok(format!("Google contact {} deleted.", resource_name))
}

/// Universal Google API Gateway.
/// Used by the LLM agent to execute any Google REST API call with the user's
/// authenticated access token injected automatically.
#[tauri::command]
pub async fn execute_google_api(
    client_id: String,
    client_secret: String,
    method: String,
    url: String,
    payload: Option<String>,
) -> Result<String, String> {
    let store = read_token_store()?.ok_or_else(|| "Google is not connected.".to_string())?;
    let client = Client::new();
    let store = refresh_google_token(&client, &client_id, &client_secret, store).await?;

    let method_upper = method.trim().to_uppercase();
    if !google_api_url_allowed(&url)
        || url
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '<' | '>' | '"'))
    {
        return Err("Google API URL is not allowed.".to_string());
    }

    let mut request = match method_upper.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        other => return Err(format!("Unsupported HTTP method: {}", other)),
    };

    request = request.bearer_auth(&store.access_token);

    if let Some(body_str) = payload {
        if !body_str.trim().is_empty() {
            let json_body: serde_json::Value = serde_json::from_str(&body_str)
                .map_err(|e| format!("Invalid JSON payload: {}", e))?;
            request = request
                .header("Content-Type", "application/json")
                .json(&json_body);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Google API call failed: {}", e))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Google API returned {}: {}", status, body));
    }

    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::normalize_event_datetime;
    use chrono::{DateTime, Local, TimeZone};

    #[test]
    fn normalize_event_datetime_preserves_explicit_offset() {
        let value = normalize_event_datetime("2026-05-09T07:30:00+07:00").expect("datetime");
        assert_eq!(value, "2026-05-09T07:30:00+07:00");
    }

    #[test]
    fn normalize_event_datetime_attaches_local_offset_to_naive_time() {
        let value = normalize_event_datetime("2026-05-09T07:30:00").expect("datetime");
        let parsed = DateTime::parse_from_rfc3339(&value).expect("rfc3339");
        let expected = Local
            .with_ymd_and_hms(2026, 5, 9, 7, 30, 0)
            .single()
            .expect("local datetime");
        assert_eq!(parsed.timestamp(), expected.timestamp());
    }
}
