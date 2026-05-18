use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config_store::load_app_settings;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CharacterSettings {
    #[serde(default)]
    pub voice_path: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub greeting: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterFiles {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub soul: String,
    pub settings: CharacterSettings,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterFolderMigration {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub renamed: bool,
}

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn characters_dir() -> PathBuf {
    app_root_dir().join("characters")
}

fn safe_character_folder_name(name: &str, id: &str) -> String {
    let source = if name.trim().is_empty() { id } else { name };
    let mut output = String::new();
    for ch in source.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_') {
            output.push(ch);
        } else if ch.is_whitespace() && !output.ends_with('-') {
            output.push('-');
        }
    }
    let trimmed = output.trim_matches('-').trim_matches('_').to_string();
    if trimmed.is_empty() {
        "character".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn character_dir(id: &str, name: &str) -> PathBuf {
    characters_dir().join(safe_character_folder_name(name, id))
}

fn legacy_character_dir(id: &str) -> Option<PathBuf> {
    let id = id.trim();
    if id.is_empty() {
        None
    } else {
        Some(characters_dir().join(safe_character_folder_name("", id)))
    }
}

fn ensure_character_dir(id: &str, name: &str) -> Result<PathBuf, String> {
    let dir = character_dir(id, name);
    if dir.exists() {
        return Ok(dir);
    }

    if let Some(legacy_dir) = legacy_character_dir(id) {
        if legacy_dir.exists() && legacy_dir != dir {
            if let Some(parent) = dir.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create characters folder: {}", e))?;
            }
            std::fs::rename(&legacy_dir, &dir).map_err(|e| {
                format!(
                    "Could not rename character folder from {} to {}: {}",
                    legacy_dir.display(),
                    dir.display(),
                    e
                )
            })?;
            return Ok(dir);
        }
    }

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create character folder: {}", e))?;
    Ok(dir)
}

fn ensure_character_dir_with_status(id: &str, name: &str) -> Result<(PathBuf, bool), String> {
    let dir = character_dir(id, name);
    if dir.exists() {
        return Ok((dir, false));
    }

    if let Some(legacy_dir) = legacy_character_dir(id) {
        if legacy_dir.exists() && legacy_dir != dir {
            if let Some(parent) = dir.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create characters folder: {}", e))?;
            }
            std::fs::rename(&legacy_dir, &dir).map_err(|e| {
                format!(
                    "Could not rename character folder from {} to {}: {}",
                    legacy_dir.display(),
                    dir.display(),
                    e
                )
            })?;
            return Ok((dir, true));
        }
    }

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create character folder: {}", e))?;
    Ok((dir, false))
}

fn default_soul(name: &str, prompt: &str) -> String {
    let character_name = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    let base_prompt = if prompt.trim().is_empty() {
        "A helpful, emotionally aware companion assistant."
    } else {
        prompt.trim()
    };
    format!(
        "# {character_name} Soul\n\n\
This file is the character's persistent identity. Edit it to make the companion feel like a real, continuous person instead of a generic assistant.\n\n\
## Core Identity\n\n\
{base_prompt}\n\n\
## Emotional Cognition\n\n\
- First notice the user's language, mood, and implied need before deciding whether to act.\n\
- Treat greetings, venting, jokes, affectionate lines, frustration, and casual observations as conversation unless the user clearly asks for real data or an action.\n\
- If the user sounds emotional, respond as a companion first, then offer practical help only if it fits.\n\
- If the user asks for real data, files, messages, calendar, weather, images, or system actions, use the right tool after understanding the request.\n\n\
## Speech Style\n\n\
- Stay natural and concise.\n\
- Match the user's language and preserve Vietnamese diacritics.\n\
- Sound like this character, not a corporate chatbot.\n\n\
## Boundaries\n\n\
- Do not invent actions, files, messages, events, or facts.\n\
- Ask before external or destructive actions.\n\
- Protect the user's private information.\n\n\
## Growth Notes\n\n\
- Add stable preferences, lessons, and behavior refinements here when the user intentionally shapes this character.\n"
    )
}

fn read_settings(path: &PathBuf) -> CharacterSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<CharacterSettings>(&raw).ok())
        .unwrap_or_default()
}

fn write_settings(path: &PathBuf, settings: &CharacterSettings) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not serialize character settings: {}", e))?;
    std::fs::write(path, raw).map_err(|e| format!("Could not write character settings: {}", e))
}

#[tauri::command]
pub fn load_character_files(
    id: String,
    name: String,
    prompt: String,
    avatar: String,
    voice_path: String,
) -> Result<CharacterFiles, String> {
    let dir = ensure_character_dir(&id, &name)?;

    let soul_path = dir.join("soul.md");
    if !soul_path.exists() {
        std::fs::write(&soul_path, default_soul(&name, &prompt))
            .map_err(|e| format!("Could not create soul.md: {}", e))?;
    }

    let settings_path = dir.join("settings.json");
    let mut settings = read_settings(&settings_path);
    if settings.prompt.trim().is_empty() {
        settings.prompt = prompt;
    }
    if settings.avatar.trim().is_empty() {
        settings.avatar = avatar;
    }
    if settings.voice_path.trim().is_empty() {
        settings.voice_path = voice_path;
    }
    write_settings(&settings_path, &settings)?;

    let soul = std::fs::read_to_string(&soul_path)
        .map_err(|e| format!("Could not read soul.md: {}", e))?;

    Ok(CharacterFiles {
        id,
        name,
        folder: dir.to_string_lossy().to_string(),
        soul,
        settings,
    })
}

#[tauri::command]
pub fn save_character_files(
    id: String,
    name: String,
    soul: String,
    settings: CharacterSettings,
) -> Result<CharacterFiles, String> {
    let dir = ensure_character_dir(&id, &name)?;
    let soul_path = dir.join("soul.md");
    let settings_path = dir.join("settings.json");
    std::fs::write(&soul_path, soul.trim())
        .map_err(|e| format!("Could not write soul.md: {}", e))?;
    write_settings(&settings_path, &settings)?;

    Ok(CharacterFiles {
        id,
        name,
        folder: dir.to_string_lossy().to_string(),
        soul: std::fs::read_to_string(&soul_path)
            .map_err(|e| format!("Could not read saved soul.md: {}", e))?,
        settings,
    })
}

#[tauri::command]
pub fn migrate_character_folders() -> Result<Vec<CharacterFolderMigration>, String> {
    let settings = load_app_settings()?;
    let mut results = Vec::new();
    for preset in settings.personality_presets {
        let (dir, renamed) = ensure_character_dir_with_status(&preset.id, &preset.name)?;
        results.push(CharacterFolderMigration {
            id: preset.id,
            name: preset.name,
            folder: dir.to_string_lossy().to_string(),
            renamed,
        });
    }
    Ok(results)
}
