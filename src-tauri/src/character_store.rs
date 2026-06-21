use std::collections::HashSet;
use std::io::Write;
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
    pub memory: String,
    pub settings: CharacterSettings,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterFolderMigration {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub renamed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairChatTranscriptMeta {
    pub first_id: String,
    pub first_name: String,
    pub second_id: String,
    pub second_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PairChatTranscriptSummary {
    pub first_id: String,
    pub first_name: String,
    pub second_id: String,
    pub second_name: String,
    pub size_bytes: u64,
}

fn app_root_dir() -> PathBuf {
    crate::app_paths::app_root_dir()
}

fn characters_dir() -> PathBuf {
    app_root_dir().join("characters")
}

fn relationship_memories_dir() -> PathBuf {
    characters_dir().join("_relationships")
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

fn default_memory(name: &str) -> String {
    let character_name = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    [
        format!("# {character_name} Memory\n"),
        "This is the character's living memory, compacted from meaningful chat experiences.\n"
            .to_string(),
        memory_bullet_section("Self and Stable Facts", &[]),
        memory_bullet_section("Preferences", &[]),
        memory_bullet_section("Relationship and Communication", &[]),
        memory_bullet_section("Projects and Recurring Topics", &[]),
        memory_bullet_section("Open Threads", &[]),
        memory_bullet_section("Recent Useful Context", &[]),
    ]
    .join("\n")
}

fn default_relationship_memory(name: &str, partner_name: &str) -> String {
    let character_name = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    let partner = if partner_name.trim().is_empty() {
        "current partner"
    } else {
        partner_name.trim()
    };
    [
        format!("# {character_name} Memory with {partner}\n"),
        "This is relationship-scoped memory for this exact conversation partner.\n".to_string(),
        memory_bullet_section("Self and Stable Facts", &[]),
        memory_bullet_section("Preferences", &[]),
        memory_bullet_section("Relationship and Communication", &[]),
        memory_bullet_section("Projects and Recurring Topics", &[]),
        memory_bullet_section("Open Threads", &[]),
        memory_bullet_section("Recent Useful Context", &[]),
    ]
    .join("\n")
}

fn default_pair_relationship_memory(first_name: &str, second_name: &str) -> String {
    let first = if first_name.trim().is_empty() {
        "Character A"
    } else {
        first_name.trim()
    };
    let second = if second_name.trim().is_empty() {
        "Character B"
    } else {
        second_name.trim()
    };
    [
        format!("# {first} and {second} Relationship Memory\n"),
        "This is shared relationship-scoped memory for this exact character pair, no matter which side is currently controlled by the user.\n"
            .to_string(),
        memory_bullet_section("Stable Facts", &[]),
        memory_bullet_section("Relationship and Communication", &[]),
        memory_bullet_section("Preferences and Boundaries", &[]),
        memory_bullet_section("Projects and Recurring Topics", &[]),
        memory_bullet_section("Open Threads", &[]),
        memory_bullet_section("Recent Useful Context", &[]),
    ]
    .join("\n")
}

fn memory_bullet_section(title: &str, items: &[String]) -> String {
    let clean_items = items
        .iter()
        .map(|item| item.trim().trim_start_matches(['-', '*', ' ']).trim())
        .filter(|item| {
            !item.is_empty()
                && *item != "None yet."
                && !item.starts_with("This is the character's living memory")
        })
        .collect::<Vec<_>>();
    if clean_items.is_empty() {
        return format!("## {title}\n\n- None yet.\n");
    }
    format!(
        "## {title}\n\n{}\n",
        clean_items
            .iter()
            .map(|item| format!("- {}", item))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn canonical_memory_title(title: &str) -> Option<&'static str> {
    match title.trim().to_lowercase().as_str() {
        "self and stable facts" | "stable user facts" | "profile facts" => {
            Some("Self and Stable Facts")
        }
        "preferences" | "user preferences" => Some("Preferences"),
        "relationship and communication" | "relationship and communication style" => {
            Some("Relationship and Communication")
        }
        "projects and recurring topics" | "projects" => Some("Projects and Recurring Topics"),
        "open threads" | "open threads to remember" => Some("Open Threads"),
        "recent useful context" | "recent turns" => Some("Recent Useful Context"),
        _ => None,
    }
}

fn section_items<'a>(sections: &'a [(String, Vec<String>)], title: &str) -> &'a [String] {
    sections
        .iter()
        .find(|(section_title, _)| section_title == title)
        .map(|(_, items)| items.as_slice())
        .unwrap_or(&[])
}

fn render_memory_document(character_name: &str, sections: &[(String, Vec<String>)]) -> String {
    [
        format!("# {character_name} Memory\n"),
        "This is the character's living memory, compacted from meaningful chat experiences.\n"
            .to_string(),
        memory_bullet_section(
            "Self and Stable Facts",
            section_items(sections, "Self and Stable Facts"),
        ),
        memory_bullet_section("Preferences", section_items(sections, "Preferences")),
        memory_bullet_section(
            "Relationship and Communication",
            section_items(sections, "Relationship and Communication"),
        ),
        memory_bullet_section(
            "Projects and Recurring Topics",
            section_items(sections, "Projects and Recurring Topics"),
        ),
        memory_bullet_section("Open Threads", section_items(sections, "Open Threads")),
        memory_bullet_section(
            "Recent Useful Context",
            section_items(sections, "Recent Useful Context"),
        ),
    ]
    .join("\n")
}

fn normalize_character_memory_markdown(name: &str, memory: &str) -> String {
    let character_name = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    let clean = memory.trim();
    if clean.is_empty() || clean.contains("Nothing important has been remembered yet.") {
        return default_memory(character_name);
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(clean) {
        let list = |key: &str| -> Vec<String> {
            value
                .get(key)
                .and_then(serde_json::Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        let sections = vec![
            ("Self and Stable Facts".to_string(), list("profile_facts")),
            ("Preferences".to_string(), list("preferences")),
            (
                "Relationship and Communication".to_string(),
                list("relationship"),
            ),
            (
                "Projects and Recurring Topics".to_string(),
                list("projects"),
            ),
            ("Open Threads".to_string(), list("open_threads")),
            ("Recent Useful Context".to_string(), list("recent_turns")),
        ];
        return render_memory_document(character_name, &sections);
    }

    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_title = "Recent Useful Context".to_string();
    for line in clean.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with("# ") {
            continue;
        }
        if line.starts_with("## ") {
            current_title = canonical_memory_title(line.trim_start_matches("##").trim())
                .unwrap_or("Recent Useful Context")
                .to_string();
            if !sections.iter().any(|(title, _)| title == &current_title) {
                sections.push((current_title.clone(), Vec::new()));
            }
            continue;
        }
        if !line.starts_with('-') && !line.starts_with('*') && line.len() < 80 {
            current_title = canonical_memory_title(line.trim_end_matches(':'))
                .unwrap_or(line.trim_end_matches(':'))
                .to_string();
            if !sections.iter().any(|(title, _)| title == &current_title) {
                sections.push((current_title.clone(), Vec::new()));
            }
            continue;
        }
        if !sections.iter().any(|(title, _)| title == &current_title) {
            sections.push((current_title.clone(), Vec::new()));
        }
        if let Some((_, items)) = sections
            .iter_mut()
            .find(|(title, _)| title == &current_title)
        {
            let item = line.trim_start_matches(['-', '*', ' ']).trim();
            if !item.is_empty()
                && item != "None yet."
                && !item.starts_with("This is the character's living memory")
            {
                items.push(item.to_string());
            }
        }
    }
    let has_section_items = sections.iter().any(|(_, items)| !items.is_empty());
    let normalized_sections = if sections.is_empty() || !has_section_items {
        vec![("Recent Useful Context".to_string(), vec![clean.to_string()])]
    } else {
        sections
    };
    render_memory_document(character_name, &normalized_sections)
}

fn normalize_relationship_memory_markdown(name: &str, partner_name: &str, memory: &str) -> String {
    let character_name = if name.trim().is_empty() {
        "Assistant"
    } else {
        name.trim()
    };
    let partner = if partner_name.trim().is_empty() {
        "current partner"
    } else {
        partner_name.trim()
    };
    let normalized = normalize_character_memory_markdown(name, memory);
    let mut lines = normalized.lines();
    let _ = lines.next();
    std::iter::once(format!("# {character_name} Memory with {partner}"))
        .chain(lines.map(ToString::to_string))
        .collect::<Vec<_>>()
        .join("\n")
}

fn ensure_memory_file(dir: &PathBuf, name: &str) -> Result<PathBuf, String> {
    let memory_path = dir.join("memory.md");
    if !memory_path.exists() {
        std::fs::write(&memory_path, default_memory(name))
            .map_err(|e| format!("Could not create memory.md: {}", e))?;
    }
    Ok(memory_path)
}

fn ensure_relationship_memory_file(
    dir: &PathBuf,
    name: &str,
    partner_id: &str,
    partner_name: &str,
) -> Result<PathBuf, String> {
    let memories_dir = dir.join("memories");
    std::fs::create_dir_all(&memories_dir)
        .map_err(|e| format!("Could not create relationship memories folder: {}", e))?;
    let file_name = safe_character_folder_name(partner_name, partner_id);
    let memory_path = memories_dir.join(format!("{file_name}.md"));
    if !memory_path.exists() {
        std::fs::write(
            &memory_path,
            default_relationship_memory(name, partner_name),
        )
        .map_err(|e| format!("Could not create relationship memory: {}", e))?;
    }
    Ok(memory_path)
}

fn pair_relationship_file_name(first_id: &str, second_id: &str) -> String {
    let mut ids = [first_id.trim().to_string(), second_id.trim().to_string()];
    ids.sort();
    safe_character_folder_name(&ids.join("-with-"), &ids.join("-with-"))
}

fn ensure_pair_relationship_memory_file(
    first_id: &str,
    first_name: &str,
    second_id: &str,
    second_name: &str,
) -> Result<PathBuf, String> {
    let dir = relationship_memories_dir();
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Could not create shared relationship memories folder: {}",
            e
        )
    })?;
    let memory_path = dir.join(format!(
        "{}.md",
        pair_relationship_file_name(first_id, second_id)
    ));
    if !memory_path.exists() {
        std::fs::write(
            &memory_path,
            default_pair_relationship_memory(first_name, second_name),
        )
        .map_err(|e| format!("Could not create shared relationship memory: {}", e))?;
    }
    Ok(memory_path)
}

fn pair_chat_transcript_path(first_id: &str, second_id: &str) -> Result<PathBuf, String> {
    let dir = relationship_memories_dir().join("chat_history");
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Could not create shared relationship chat history folder: {}",
            e
        )
    })?;
    Ok(dir.join(format!(
        "{}.txt",
        pair_relationship_file_name(first_id, second_id)
    )))
}

fn pair_chat_transcript_meta_path(first_id: &str, second_id: &str) -> Result<PathBuf, String> {
    let dir = relationship_memories_dir().join("chat_history");
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Could not create shared relationship chat history folder: {}",
            e
        )
    })?;
    Ok(dir.join(format!(
        "{}.json",
        pair_relationship_file_name(first_id, second_id)
    )))
}

fn normalize_pair_relationship_memory_markdown(
    first_name: &str,
    second_name: &str,
    memory: &str,
) -> String {
    let first = if first_name.trim().is_empty() {
        "Character A"
    } else {
        first_name.trim()
    };
    let second = if second_name.trim().is_empty() {
        "Character B"
    } else {
        second_name.trim()
    };
    let normalized = normalize_character_memory_markdown(first, memory);
    let mut lines = normalized.lines();
    let _ = lines.next();
    std::iter::once(format!("# {first} and {second} Relationship Memory"))
        .chain(lines.map(ToString::to_string))
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_settings(path: &PathBuf) -> CharacterSettings {
    std::fs::read_to_string(path)
        .ok()
        .map(|raw| crate::text_encoding::repair_mojibake_text(&raw))
        .and_then(|raw| serde_json::from_str::<CharacterSettings>(&raw).ok())
        .unwrap_or_default()
}

fn write_settings(path: &PathBuf, settings: &CharacterSettings) -> Result<(), String> {
    let mut settings = settings.clone();
    settings.prompt = crate::text_encoding::repair_mojibake_text(&settings.prompt);
    settings.greeting = crate::text_encoding::repair_mojibake_text(&settings.greeting);
    settings.notes = crate::text_encoding::repair_mojibake_text(&settings.notes);
    let raw = serde_json::to_string_pretty(&settings)
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
    let memory_path = ensure_memory_file(&dir, &name)?;

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

    let soul = crate::text_encoding::repair_mojibake_text(
        &std::fs::read_to_string(&soul_path)
            .map_err(|e| format!("Could not read soul.md: {}", e))?,
    );
    let memory = crate::text_encoding::repair_mojibake_text(
        &std::fs::read_to_string(&memory_path)
            .map_err(|e| format!("Could not read memory.md: {}", e))?,
    );

    Ok(CharacterFiles {
        id,
        name,
        folder: dir.to_string_lossy().to_string(),
        soul,
        memory,
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
    let memory_path = ensure_memory_file(&dir, &name)?;
    let settings_path = dir.join("settings.json");
    let soul = crate::text_encoding::repair_mojibake_text(soul.trim());
    std::fs::write(&soul_path, &soul).map_err(|e| format!("Could not write soul.md: {}", e))?;
    write_settings(&settings_path, &settings)?;

    Ok(CharacterFiles {
        id,
        name,
        folder: dir.to_string_lossy().to_string(),
        soul: crate::text_encoding::repair_mojibake_text(
            &std::fs::read_to_string(&soul_path)
                .map_err(|e| format!("Could not read saved soul.md: {}", e))?,
        ),
        memory: crate::text_encoding::repair_mojibake_text(
            &std::fs::read_to_string(&memory_path)
                .map_err(|e| format!("Could not read memory.md: {}", e))?,
        ),
        settings,
    })
}

#[tauri::command]
pub fn load_character_memory(id: String, name: String) -> Result<String, String> {
    let dir = ensure_character_dir(&id, &name)?;
    let memory_path = ensure_memory_file(&dir, &name)?;
    std::fs::read_to_string(&memory_path).map_err(|e| format!("Could not read memory.md: {}", e))
}

#[tauri::command]
pub fn save_character_memory(id: String, name: String, memory: String) -> Result<String, String> {
    let dir = ensure_character_dir(&id, &name)?;
    let memory_path = ensure_memory_file(&dir, &name)?;
    let next_memory = normalize_character_memory_markdown(&name, &memory);
    std::fs::write(&memory_path, &next_memory)
        .map_err(|e| format!("Could not write memory.md: {}", e))?;
    Ok(next_memory)
}

#[tauri::command]
pub fn clear_character_memory(id: String, name: String) -> Result<String, String> {
    save_character_memory(id, name.clone(), default_memory(&name))
}

#[tauri::command]
pub fn load_character_relationship_memory(
    id: String,
    name: String,
    partner_id: String,
    partner_name: String,
) -> Result<String, String> {
    let dir = ensure_character_dir(&id, &name)?;
    let memory_path = ensure_relationship_memory_file(&dir, &name, &partner_id, &partner_name)?;
    std::fs::read_to_string(&memory_path)
        .map_err(|e| format!("Could not read relationship memory: {}", e))
}

#[tauri::command]
pub fn save_character_relationship_memory(
    id: String,
    name: String,
    partner_id: String,
    partner_name: String,
    memory: String,
) -> Result<String, String> {
    let dir = ensure_character_dir(&id, &name)?;
    let memory_path = ensure_relationship_memory_file(&dir, &name, &partner_id, &partner_name)?;
    let next_memory = normalize_relationship_memory_markdown(&name, &partner_name, &memory);
    std::fs::write(&memory_path, &next_memory)
        .map_err(|e| format!("Could not write relationship memory: {}", e))?;
    Ok(next_memory)
}

#[tauri::command]
pub fn clear_character_relationship_memory(
    id: String,
    name: String,
    partner_id: String,
    partner_name: String,
) -> Result<String, String> {
    save_character_relationship_memory(
        id,
        name.clone(),
        partner_id,
        partner_name.clone(),
        default_relationship_memory(&name, &partner_name),
    )
}

#[tauri::command]
pub fn load_pair_relationship_memory(
    first_id: String,
    first_name: String,
    second_id: String,
    second_name: String,
) -> Result<String, String> {
    let memory_path =
        ensure_pair_relationship_memory_file(&first_id, &first_name, &second_id, &second_name)?;
    std::fs::read_to_string(&memory_path)
        .map_err(|e| format!("Could not read shared relationship memory: {}", e))
}

#[tauri::command]
pub fn save_pair_relationship_memory(
    first_id: String,
    first_name: String,
    second_id: String,
    second_name: String,
    memory: String,
) -> Result<String, String> {
    let memory_path =
        ensure_pair_relationship_memory_file(&first_id, &first_name, &second_id, &second_name)?;
    let next_memory =
        normalize_pair_relationship_memory_markdown(&first_name, &second_name, &memory);
    std::fs::write(&memory_path, &next_memory)
        .map_err(|e| format!("Could not write shared relationship memory: {}", e))?;
    Ok(next_memory)
}

#[tauri::command]
pub fn clear_pair_relationship_memory(
    first_id: String,
    first_name: String,
    second_id: String,
    second_name: String,
) -> Result<String, String> {
    save_pair_relationship_memory(
        first_id,
        first_name.clone(),
        second_id,
        second_name.clone(),
        default_pair_relationship_memory(&first_name, &second_name),
    )
}

#[tauri::command]
pub fn append_pair_chat_transcript(
    first_id: String,
    first_name: String,
    second_id: String,
    second_name: String,
    speaker_name: String,
    created_at: String,
    text: String,
) -> Result<bool, String> {
    let clean_text = text.trim();
    if clean_text.is_empty() {
        return Ok(false);
    }
    let transcript_path = pair_chat_transcript_path(&first_id, &second_id)?;
    let meta_path = pair_chat_transcript_meta_path(&first_id, &second_id)?;
    let meta = PairChatTranscriptMeta {
        first_id: first_id.clone(),
        first_name: first_name.clone(),
        second_id: second_id.clone(),
        second_name: second_name.clone(),
    };
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Could not encode chat history metadata: {}", e))?;
    std::fs::write(&meta_path, meta_json)
        .map_err(|e| format!("Could not write chat history metadata: {}", e))?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&transcript_path)
        .map_err(|e| format!("Could not open chat history transcript: {}", e))?;
    let clean_speaker = if speaker_name.trim().is_empty() {
        "Speaker"
    } else {
        speaker_name.trim()
    };
    let clean_time = if created_at.trim().is_empty() {
        "unknown time"
    } else {
        created_at.trim()
    };
    writeln!(
        file,
        "[{}] {}: {}\n",
        clean_time,
        clean_speaker,
        clean_text.replace("\r\n", "\n").replace('\r', "\n")
    )
    .map_err(|e| format!("Could not write chat history transcript: {}", e))?;
    Ok(true)
}

#[tauri::command]
pub fn load_pair_chat_transcript(first_id: String, second_id: String) -> Result<String, String> {
    let transcript_path = pair_chat_transcript_path(&first_id, &second_id)?;
    if !transcript_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&transcript_path)
        .map_err(|e| format!("Could not read chat history transcript: {}", e))
}

#[tauri::command]
pub fn clear_pair_chat_transcript(first_id: String, second_id: String) -> Result<bool, String> {
    let transcript_path = pair_chat_transcript_path(&first_id, &second_id)?;
    std::fs::write(&transcript_path, "")
        .map_err(|e| format!("Could not clear chat history transcript: {}", e))?;
    Ok(true)
}

#[tauri::command]
pub fn clear_character_chat_transcripts(character_id: String) -> Result<usize, String> {
    let dir = relationship_memories_dir().join("chat_history");
    if !dir.exists() {
        return Ok(0);
    }
    let canonical_id = character_id.trim();
    if canonical_id.is_empty() {
        return Ok(0);
    }
    let mut cleared = 0usize;
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read chat history transcripts: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Could not read chat history entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let meta_raw = match std::fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let meta: PairChatTranscriptMeta = match serde_json::from_str(&meta_raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if meta.first_id != canonical_id && meta.second_id != canonical_id {
            continue;
        }
        let transcript_path = path.with_extension("txt");
        if transcript_path.exists() {
            std::fs::write(&transcript_path, "").map_err(|e| {
                format!(
                    "Could not clear chat history transcript {}: {}",
                    transcript_path.display(),
                    e
                )
            })?;
            cleared += 1;
        }
    }
    Ok(cleared)
}

#[tauri::command]
pub fn list_pair_chat_transcripts() -> Result<Vec<PairChatTranscriptSummary>, String> {
    let dir = relationship_memories_dir().join("chat_history");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read chat history transcripts: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Could not read chat history entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("txt") {
            continue;
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Could not read chat history metadata: {}", e))?;
        if metadata.len() == 0 {
            continue;
        }
        let meta_path = path.with_extension("json");
        let meta_raw = match std::fs::read_to_string(&meta_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let meta: PairChatTranscriptMeta = match serde_json::from_str(&meta_raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        summaries.push(PairChatTranscriptSummary {
            first_id: meta.first_id,
            first_name: meta.first_name,
            second_id: meta.second_id,
            second_name: meta.second_name,
            size_bytes: metadata.len(),
        });
    }
    Ok(summaries)
}

#[tauri::command]
pub fn delete_character_files(id: String, name: String) -> Result<bool, String> {
    let root = characters_dir();
    let root_canonical = if root.exists() {
        root.canonicalize()
            .map_err(|e| format!("Could not access characters folder: {}", e))?
    } else {
        return Ok(false);
    };

    let mut targets = vec![character_dir(&id, &name)];
    if let Some(legacy_dir) = legacy_character_dir(&id) {
        targets.push(legacy_dir);
    }

    let mut seen = HashSet::new();
    let mut deleted_any = false;
    for target in targets {
        if !target.exists() {
            continue;
        }
        let target_canonical = target
            .canonicalize()
            .map_err(|e| format!("Could not access character folder: {}", e))?;
        if !target_canonical.starts_with(&root_canonical) || target_canonical == root_canonical {
            return Err(
                "Refusing to delete a folder outside the characters directory.".to_string(),
            );
        }
        if !seen.insert(target_canonical.clone()) {
            continue;
        }
        std::fs::remove_dir_all(&target_canonical).map_err(|e| {
            format!(
                "Could not delete character folder {}: {}",
                target_canonical.display(),
                e
            )
        })?;
        deleted_any = true;
    }

    Ok(deleted_any)
}

#[tauri::command]
pub fn migrate_character_folders() -> Result<Vec<CharacterFolderMigration>, String> {
    let settings = load_app_settings()?;
    let mut results = Vec::new();
    for preset in settings.personality_presets {
        let (dir, renamed) = ensure_character_dir_with_status(&preset.id, &preset.name)?;
        let memory_path = ensure_memory_file(&dir, &preset.name)?;
        if let Ok(current_memory) = std::fs::read_to_string(&memory_path) {
            let normalized_memory =
                normalize_character_memory_markdown(&preset.name, &current_memory);
            if normalized_memory != current_memory {
                std::fs::write(&memory_path, normalized_memory)
                    .map_err(|e| format!("Could not normalize memory.md: {}", e))?;
            }
        }
        results.push(CharacterFolderMigration {
            id: preset.id,
            name: preset.name,
            folder: dir.to_string_lossy().to_string(),
            renamed,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn character_memory_file_round_trips_and_clears() {
        let id = format!("test-memory-{}", chrono::Local::now().timestamp_millis());
        let name = "Memory Test Character".to_string();
        let saved = save_character_memory(
            id.clone(),
            name.clone(),
            "Character remembers a quiet promise.".to_string(),
        )
        .expect("save memory");
        assert!(saved.starts_with("# Memory Test Character Memory"));
        assert!(saved.contains("## Recent Useful Context"));
        assert!(saved.contains("quiet promise"));

        let loaded = load_character_memory(id.clone(), name.clone()).expect("load memory");
        assert_eq!(loaded, saved);

        let cleared = clear_character_memory(id.clone(), name.clone()).expect("clear memory");
        assert!(cleared.contains("## Self and Stable Facts"));
        assert!(cleared.contains("- None yet."));

        delete_character_files(id, name).expect("delete test character");
    }
}
