use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::System;

#[cfg(target_os = "windows")]
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
};

#[derive(Debug, Clone, Serialize)]
pub struct MediaTrackInfo {
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaPlayerStatus {
    pub app_open: bool,
    pub connected: bool,
    pub playing: bool,
    pub account_name: Option<String>,
    pub active_app: Option<String>,
    pub track: Option<MediaTrackInfo>,
    pub message: String,
}

static MEDIA_PLAYING: AtomicBool = AtomicBool::new(false);

fn detect_media_app() -> Option<String> {
    let system = System::new_all();
    let candidates = [
        ("spotify.exe", "Spotify"),
        ("spotify", "Spotify"),
        ("vlc.exe", "VLC"),
        ("vlc", "VLC"),
        ("potplayermini64.exe", "PotPlayer"),
        ("potplayermini.exe", "PotPlayer"),
        ("mpc-hc64.exe", "MPC-HC"),
        ("mpc-hc.exe", "MPC-HC"),
        ("wmplayer.exe", "Windows Media Player"),
        ("musicbee.exe", "MusicBee"),
        ("aimp.exe", "AIMP"),
        ("foobar2000.exe", "foobar2000"),
        ("winamp.exe", "Winamp"),
        ("itunes.exe", "iTunes"),
        ("applemusic.exe", "Apple Music"),
        ("chrome.exe", "Chrome"),
        ("msedge.exe", "Edge"),
        ("firefox.exe", "Firefox"),
    ];

    for (process_name, label) in candidates {
        if system
            .processes()
            .values()
            .any(|process| process.name().eq_ignore_ascii_case(process_name))
        {
            return Some(label.to_string());
        }
    }
    None
}

fn readable_media_app_label(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("spotify") {
        "Spotify".to_string()
    } else if lower.contains("chrome") {
        "Chrome".to_string()
    } else if lower.contains("edge") {
        "Edge".to_string()
    } else if lower.contains("firefox") {
        "Firefox".to_string()
    } else if lower.contains("vlc") {
        "VLC".to_string()
    } else if lower.contains("zune") || lower.contains("music") {
        "Media Player".to_string()
    } else {
        raw.split('!')
            .next()
            .and_then(|value| value.rsplit('.').next())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(raw)
            .trim()
            .to_string()
    }
}

#[cfg(target_os = "windows")]
fn current_media_session_state() -> Option<(bool, Option<String>)> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;
    let session = manager.GetCurrentSession().ok()?;
    let playback_info = session.GetPlaybackInfo().ok()?;
    let playing = playback_info.PlaybackStatus().ok()?
        == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
    let app_id = session
        .SourceAppUserModelId()
        .ok()
        .map(|value| readable_media_app_label(&value.to_string()));
    Some((playing, app_id))
}

#[cfg(not(target_os = "windows"))]
fn current_media_session_state() -> Option<(bool, Option<String>)> {
    None
}

fn media_status(playing: bool, message: Option<String>) -> MediaPlayerStatus {
    let session_state = current_media_session_state();
    let playing = session_state
        .as_ref()
        .map(|(is_playing, _)| *is_playing)
        .unwrap_or(playing);
    let active_app = session_state
        .and_then(|(_, app)| app)
        .or_else(detect_media_app);
    let app_open = active_app.is_some();
    MediaPlayerStatus {
        app_open,
        connected: true,
        playing,
        account_name: None,
        active_app: active_app.clone(),
        track: None,
        message: message.unwrap_or_else(|| {
            active_app.unwrap_or_else(|| "Windows media keys are ready.".to_string())
        }),
    }
}

#[cfg(target_os = "windows")]
fn send_windows_media_key(virtual_key: u16) -> Result<(), String> {
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: virtual_key,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: virtual_key,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows did not accept the media key command.".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn send_windows_media_key(_virtual_key: u16) -> Result<(), String> {
    Err("Media keys are only available on Windows.".to_string())
}

fn send_media_command(
    virtual_key: u16,
    playing: bool,
    label: &str,
) -> Result<MediaPlayerStatus, String> {
    send_windows_media_key(virtual_key)?;
    MEDIA_PLAYING.store(playing, Ordering::SeqCst);
    Ok(media_status(playing, Some(label.to_string())))
}

#[tauri::command]
pub fn get_media_player_status(_client_id: String) -> Result<MediaPlayerStatus, String> {
    Ok(media_status(MEDIA_PLAYING.load(Ordering::SeqCst), None))
}

#[tauri::command]
pub fn media_player_play(_client_id: String) -> Result<MediaPlayerStatus, String> {
    send_media_command(0xB3, true, "Play")
}

#[tauri::command]
pub fn media_player_pause(_client_id: String) -> Result<MediaPlayerStatus, String> {
    send_media_command(0xB3, false, "Pause")
}

#[tauri::command]
pub fn media_player_next(_client_id: String) -> Result<MediaPlayerStatus, String> {
    send_media_command(0xB0, true, "Next")
}

#[tauri::command]
pub fn media_player_previous(_client_id: String) -> Result<MediaPlayerStatus, String> {
    send_media_command(0xB1, true, "Previous")
}
