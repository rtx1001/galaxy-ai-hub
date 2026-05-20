use std::path::PathBuf;

use serde::{Deserialize, Serialize};

fn default_sampling_temperature() -> f32 {
    0.6
}

fn default_top_k() -> u32 {
    40
}

fn default_top_p() -> f32 {
    0.9
}

fn default_min_p() -> f32 {
    0.1
}

fn default_repeat_last_n() -> i32 {
    64
}

fn default_repeat_penalty() -> f32 {
    1.0
}

fn default_user_name() -> String {
    "You".to_string()
}

fn default_user_avatar() -> String {
    String::new()
}

fn default_assistant_avatar() -> String {
    String::new()
}

fn default_theme_swatch_id() -> String {
    "blue".to_string()
}

fn default_user_auto_speech() -> bool {
    true
}

fn default_image_size() -> u32 {
    1024
}

fn default_panel_open() -> bool {
    false
}

fn default_main_panel_open() -> bool {
    true
}

fn default_user_profile() -> UserProfilePreset {
    UserProfilePreset {
        id: "default_user".to_string(),
        name: default_user_name(),
        description: String::new(),
        avatar: default_user_avatar(),
        voice_path: String::new(),
        location_label: String::new(),
        latitude: None,
        longitude: None,
        auto_speech: default_user_auto_speech(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalityPreset {
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default = "default_assistant_avatar")]
    pub avatar: String,
    #[serde(default)]
    pub voice_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfilePreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_user_avatar")]
    pub avatar: String,
    #[serde(default)]
    pub voice_path: String,
    #[serde(default)]
    pub location_label: String,
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
    #[serde(default = "default_user_auto_speech")]
    pub auto_speech: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramGuest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub setup_completed: bool,
    #[serde(default = "default_user_name")]
    pub user_name: String,
    #[serde(default = "default_user_avatar")]
    pub user_avatar: String,
    #[serde(default)]
    pub user_description: String,
    #[serde(default)]
    pub user_location_label: String,
    #[serde(default)]
    pub user_latitude: Option<f64>,
    #[serde(default)]
    pub user_longitude: Option<f64>,
    #[serde(default = "default_theme_swatch_id")]
    pub theme_swatch_id: String,
    pub live_conversation: bool,
    #[serde(default)]
    pub telegram_bot_token: String,
    #[serde(default)]
    pub telegram_owner_id: String,
    #[serde(default)]
    pub telegram_guests: Vec<TelegramGuest>,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default)]
    pub google_client_id: String,
    #[serde(default)]
    pub google_client_secret: String,
    #[serde(default)]
    pub google_redirect_uri: String,
    #[serde(default = "default_image_size")]
    pub image_width: u32,
    #[serde(default = "default_image_size")]
    pub image_height: u32,
    #[serde(default)]
    pub voice_folder: String,
    pub selected_voice_path: String,
    pub creativity: u32,
    #[serde(default = "default_sampling_temperature")]
    pub sampling_temperature: f32,
    #[serde(default = "default_top_k")]
    pub top_k: u32,
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    #[serde(default = "default_min_p")]
    pub min_p: f32,
    #[serde(default = "default_repeat_last_n")]
    pub repeat_last_n: i32,
    #[serde(default = "default_repeat_penalty")]
    pub repeat_penalty: f32,
    pub memory_size: u32,
    pub reply_length: u32,
    pub intelligence_quality: u32,
    pub personality: String,
    #[serde(default)]
    pub personality_presets: Vec<PersonalityPreset>,
    #[serde(default)]
    pub selected_personality_id: String,
    #[serde(default)]
    pub user_profiles: Vec<UserProfilePreset>,
    #[serde(default)]
    pub selected_user_profile_id: String,
    pub model_folder: String,
    pub selected_model_path: String,
    pub linked_folders: Vec<String>,
    #[serde(default = "default_main_panel_open")]
    pub ui_left_panel_open: bool,
    #[serde(default = "default_main_panel_open")]
    pub ui_right_panel_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_workspace_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_image_studio_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_calendar_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_automation_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_telegram_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_google_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_tool_activity_open: bool,
    #[serde(default = "default_panel_open")]
    pub ui_sampling_open: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            setup_completed: false,
            user_name: default_user_name(),
            user_avatar: default_user_avatar(),
            user_description: String::new(),
            user_location_label: String::new(),
            user_latitude: None,
            user_longitude: None,
            theme_swatch_id: default_theme_swatch_id(),
            live_conversation: false,
            telegram_bot_token: String::new(),
            telegram_owner_id: String::new(),
            telegram_guests: Vec::new(),
            thinking_enabled: false,
            google_client_id: String::new(),
            google_client_secret: String::new(),
            google_redirect_uri: "http://127.0.0.1:8765/google/callback".to_string(),
            image_width: default_image_size(),
            image_height: default_image_size(),
            voice_folder: String::new(),
            selected_voice_path: String::new(),
            creativity: 50,
            sampling_temperature: default_sampling_temperature(),
            top_k: default_top_k(),
            top_p: default_top_p(),
            min_p: default_min_p(),
            repeat_last_n: default_repeat_last_n(),
            repeat_penalty: default_repeat_penalty(),
            memory_size: 8192,
            reply_length: 512,
            intelligence_quality: 50,
            personality: "You are a helpful and friendly AI assistant.".to_string(),
            personality_presets: vec![PersonalityPreset {
                id: "default".to_string(),
                name: "Helpful".to_string(),
                prompt: "You are a helpful and friendly AI assistant.".to_string(),
                avatar: default_assistant_avatar(),
                voice_path: String::new(),
            }],
            selected_personality_id: "default".to_string(),
            user_profiles: vec![default_user_profile()],
            selected_user_profile_id: "default_user".to_string(),
            model_folder: String::new(),
            selected_model_path: String::new(),
            linked_folders: Vec::new(),
            ui_left_panel_open: default_main_panel_open(),
            ui_right_panel_open: default_main_panel_open(),
            ui_workspace_open: default_panel_open(),
            ui_image_studio_open: default_panel_open(),
            ui_calendar_open: default_panel_open(),
            ui_automation_open: default_panel_open(),
            ui_telegram_open: default_panel_open(),
            ui_google_open: default_panel_open(),
            ui_tool_activity_open: default_panel_open(),
            ui_sampling_open: default_panel_open(),
        }
    }
}

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn config_dir() -> PathBuf {
    app_root_dir().join("config")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.linked_folders.sort();
    settings.linked_folders.dedup();
    if settings.theme_swatch_id.trim().is_empty() {
        settings.theme_swatch_id = default_theme_swatch_id();
    }
    if settings.personality_presets.is_empty() {
        settings.personality_presets = AppSettings::default().personality_presets;
    }
    settings.image_width = settings.image_width.clamp(256, 2048);
    settings.image_height = settings.image_height.clamp(256, 2048);
    settings.telegram_guests = normalize_telegram_guests(settings.telegram_guests);
    if settings.selected_personality_id.is_empty() {
        settings.selected_personality_id = settings
            .personality_presets
            .first()
            .map(|preset| preset.id.clone())
            .unwrap_or_else(|| "default".to_string());
    }
    if settings.user_profiles.is_empty() {
        settings.user_profiles = vec![UserProfilePreset {
            id: "default_user".to_string(),
            name: if settings.user_name.trim().is_empty() {
                default_user_name()
            } else {
                settings.user_name.clone()
            },
            description: settings.user_description.clone(),
            avatar: settings.user_avatar.clone(),
            voice_path: String::new(),
            location_label: settings.user_location_label.clone(),
            latitude: settings.user_latitude,
            longitude: settings.user_longitude,
            auto_speech: default_user_auto_speech(),
        }];
    }
    if settings.selected_user_profile_id.is_empty() {
        settings.selected_user_profile_id = settings
            .user_profiles
            .first()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "default_user".to_string());
    }
    if let Some(active_user) = settings
        .user_profiles
        .iter()
        .find(|profile| profile.id == settings.selected_user_profile_id)
        .cloned()
    {
        settings.user_name = active_user.name;
        settings.user_description = active_user.description;
        settings.user_avatar = active_user.avatar;
        settings.user_location_label = active_user.location_label;
        settings.user_latitude = active_user.latitude;
        settings.user_longitude = active_user.longitude;
    }
    settings
}

fn normalize_telegram_guests(guests: Vec<TelegramGuest>) -> Vec<TelegramGuest> {
    let mut out = Vec::new();
    for guest in guests {
        let id = guest.id.trim().to_string();
        if id.is_empty() || !id.chars().all(|ch| ch == '-' || ch.is_ascii_digit()) {
            continue;
        }
        if out.iter().any(|existing: &TelegramGuest| existing.id == id) {
            continue;
        }
        out.push(TelegramGuest {
            name: if guest.name.trim().is_empty() {
                id.clone()
            } else {
                guest.name.trim().to_string()
            },
            id,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn settings_richness(settings: &AppSettings) -> usize {
    let mut score = 0;
    score += settings.personality_presets.len();
    score += settings.user_profiles.len();
    score += settings
        .personality_presets
        .iter()
        .filter(|preset| {
            !preset.avatar.is_empty()
                || !preset.voice_path.is_empty()
                || preset.name != "Helpful"
                || preset.id != "default"
        })
        .count();
    score += usize::from(!settings.user_avatar.is_empty());
    score += settings
        .user_profiles
        .iter()
        .filter(|profile| {
            profile.name != default_user_name()
                || !profile.avatar.is_empty()
                || !profile.description.is_empty()
                || !profile.voice_path.is_empty()
        })
        .count();
    score += usize::from(settings.user_name != default_user_name());
    score += usize::from(settings.theme_swatch_id != default_theme_swatch_id());
    score += usize::from(!settings.voice_folder.is_empty());
    score += usize::from(!settings.selected_voice_path.is_empty());
    score += usize::from(!settings.model_folder.is_empty());
    score += usize::from(!settings.selected_model_path.is_empty());
    score += settings.linked_folders.len();
    score
}

fn looks_like_accidental_default_reset(settings: &AppSettings) -> bool {
    settings.user_name == default_user_name()
        && settings.user_avatar.is_empty()
        && settings.theme_swatch_id == default_theme_swatch_id()
        && settings.personality_presets.len() == 1
        && settings
            .personality_presets
            .first()
            .map(|preset| {
                preset.id == "default"
                    && preset.name == "Helpful"
                    && preset.avatar.is_empty()
                    && preset.voice_path.is_empty()
            })
            .unwrap_or(false)
        && settings.linked_folders.is_empty()
}

#[tauri::command]
pub fn load_app_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read app settings: {}", e))?;
    let settings: AppSettings = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("Could not parse app settings: {}", e))?;
    Ok(normalize_settings(settings))
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    std::fs::create_dir_all(config_dir())
        .map_err(|e| format!("Could not create the config folder: {}", e))?;
    let settings = normalize_settings(settings);
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Could not encode app settings: {}", e))?;
    let path = settings_path();

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing_json = existing.trim_start_matches('\u{feff}');
        if existing_json == content {
            return Ok(settings);
        }
        if let Ok(existing_settings) = serde_json::from_str::<AppSettings>(existing_json) {
            let existing_settings = normalize_settings(existing_settings);
            if looks_like_accidental_default_reset(&settings)
                && settings_richness(&existing_settings) > settings_richness(&settings) + 3
            {
                return Err(
                    "Refusing to overwrite rich saved settings with a default startup state."
                        .to_string(),
                );
            }
        }
        let backup_path = config_dir().join("settings.backup.json");
        let _ = std::fs::write(backup_path, existing);
    }

    std::fs::write(path, content).map_err(|e| format!("Could not save app settings: {}", e))?;
    Ok(settings)
}

#[tauri::command]
pub fn list_telegram_guests() -> Result<Vec<TelegramGuest>, String> {
    Ok(load_app_settings()?.telegram_guests)
}

pub fn add_telegram_guest_if_missing(
    id: String,
    name: String,
) -> Result<Option<TelegramGuest>, String> {
    let mut settings = load_app_settings()?;
    let id = id.trim().to_string();
    if id.is_empty() || !id.chars().all(|ch| ch == '-' || ch.is_ascii_digit()) {
        return Ok(None);
    }
    if settings.telegram_guests.iter().any(|guest| guest.id == id) {
        return Ok(None);
    }
    let guest = TelegramGuest {
        id: id.clone(),
        name: if name.trim().is_empty() {
            id.clone()
        } else {
            name.trim().to_string()
        },
    };
    settings.telegram_guests.push(guest.clone());
    let _ = save_app_settings(settings)?;
    Ok(Some(guest))
}
