use super::*;

pub(super) fn calendar_day_range(input: Option<&str>) -> Result<(String, String), String> {
    let today = Local::now().date_naive();
    if let Some(value) = input.map(str::trim).filter(|value| !value.is_empty()) {
        if value.len() == 7 && value.as_bytes().get(4) == Some(&b'-') {
            let year = value[0..4]
                .parse::<i32>()
                .map_err(|_| "Use month as YYYY-MM.".to_string())?;
            let month = value[5..7]
                .parse::<u32>()
                .map_err(|_| "Use month as YYYY-MM.".to_string())?;
            let start_date = NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| "Invalid calendar month.".to_string())?;
            let (end_year, end_month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            let end_date = NaiveDate::from_ymd_opt(end_year, end_month, 1)
                .ok_or_else(|| "Invalid calendar month.".to_string())?;
            let start = Local
                .from_local_datetime(
                    &start_date
                        .and_hms_opt(0, 0, 0)
                        .ok_or("Invalid start date.")?,
                )
                .single()
                .ok_or("Could not resolve local start time.")?;
            let end = Local
                .from_local_datetime(&end_date.and_hms_opt(0, 0, 0).ok_or("Invalid end date.")?)
                .single()
                .ok_or("Could not resolve local end time.")?;
            return Ok((start.to_rfc3339(), end.to_rfc3339()));
        }
    }
    let date = match input.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.eq_ignore_ascii_case("tomorrow") => today + Duration::days(1),
        Some(value) if value.eq_ignore_ascii_case("today") => today,
        Some(value) => NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| "Use date as today, tomorrow, or YYYY-MM-DD.".to_string())?,
        None => today,
    };
    let start = Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).ok_or("Invalid start date.")?)
        .single()
        .ok_or("Could not resolve local start time.")?;
    let end_date = date + Duration::days(1);
    let end = Local
        .from_local_datetime(&end_date.and_hms_opt(0, 0, 0).ok_or("Invalid end date.")?)
        .single()
        .ok_or("Could not resolve local end time.")?;
    Ok((start.to_rfc3339(), end.to_rfc3339()))
}

fn workspace_folder_name(folder: &str) -> String {
    std::path::Path::new(folder)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(folder)
        .trim()
        .to_string()
}

pub(super) fn explicit_windows_path_from_text(text: &str) -> Option<String> {
    let chars = text.char_indices().collect::<Vec<_>>();
    for index in 0..chars.len().saturating_sub(2) {
        let (_, drive) = chars[index];
        let (_, colon) = chars[index + 1];
        let (_, slash) = chars[index + 2];
        if !drive.is_ascii_alphabetic() || colon != ':' || !matches!(slash, '\\' | '/') {
            continue;
        }
        let start = chars[index].0;
        let mut end = text.len();
        for (offset, ch) in chars.iter().skip(index + 3) {
            if ch.is_control() || matches!(ch, '"' | '\'' | '`' | '<' | '>' | '|' | '\n' | '\r') {
                end = *offset;
                break;
            }
        }
        let candidate = text[start..end]
            .trim()
            .trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | '?' | '!' | ')' | ']'))
            .to_string();
        if candidate.len() >= 3 {
            if std::path::Path::new(&candidate).exists() {
                return Some(candidate);
            }
            let mut best_existing_prefix = None;
            for (offset, ch) in candidate.char_indices() {
                if !ch.is_whitespace() {
                    continue;
                }
                let prefix = candidate[..offset]
                    .trim()
                    .trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | '?' | '!' | ')' | ']'));
                if prefix.len() >= 3 && std::path::Path::new(prefix).exists() {
                    best_existing_prefix = Some(prefix.to_string());
                }
            }
            if let Some(prefix) = best_existing_prefix {
                return Some(prefix);
            }
            return Some(candidate);
        }
    }
    None
}

fn strip_extended_path_prefix(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    value.to_string()
}

fn media_scope_folders(call: &ToolCall, folders: &[String], user_text: &str) -> Vec<String> {
    let explicit_path = explicit_windows_path_from_text(user_text);
    let requested = call
        .arguments
        .get("root_folder")
        .or_else(|| call.arguments.get("folder"))
        .and_then(Value::as_str)
        .or(explicit_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(requested) = requested {
        let requested_norm = normalize_text(requested);
        if let Some(folder) = folders.iter().find(|folder| {
            let folder_norm = normalize_text(folder);
            let name_norm = normalize_text(&workspace_folder_name(folder));
            folder_norm == requested_norm
                || name_norm == requested_norm
                || std::fs::canonicalize(folder)
                    .ok()
                    .map(|path| normalize_text(&path.to_string_lossy()))
                    .as_deref()
                    == Some(requested_norm.as_str())
        }) {
            return vec![folder.clone()];
        }
        if std::path::Path::new(requested).is_absolute() {
            return vec![requested.to_string()];
        }
    }

    let user_norm = normalize_text(user_text);
    let named_matches = folders
        .iter()
        .filter(|folder| {
            let name_norm = normalize_text(&workspace_folder_name(folder));
            !name_norm.is_empty()
                && name_norm.len() >= 3
                && user_norm
                    .split(|ch: char| !(ch.is_alphanumeric() || ch == '_'))
                    .any(|token| token == name_norm)
        })
        .cloned()
        .collect::<Vec<_>>();
    if !named_matches.is_empty() {
        return named_matches;
    }

    folders.to_vec()
}

fn effective_media_kind(raw_kind: String, user_text: &str) -> String {
    let trimmed = raw_kind.trim();
    if matches!(trimmed, "" | "any") {
        if let Some(kind) = inferred_media_kind(user_text) {
            return kind.to_string();
        }
    }
    match normalize_text(trimmed).as_str() {
        "song" | "songs" | "music" | "track" | "tracks" => "audio".to_string(),
        "photo" | "photos" | "picture" | "pictures" => "image".to_string(),
        "movie" | "movies" => "video".to_string(),
        "doc" | "docs" => "document".to_string(),
        _ => trimmed.to_string(),
    }
}

fn random_preview_allows_extension(kind: &str, extension: &str) -> bool {
    if kind.trim().eq_ignore_ascii_case("any") {
        !matches!(
            extension.trim().to_ascii_lowercase().as_str(),
            "txt"
                | "md"
                | "log"
                | "csv"
                | "json"
                | "xml"
                | "html"
                | "css"
                | "js"
                | "ts"
                | "tsx"
                | "jsx"
                | "rs"
                | "py"
                | "toml"
                | "yaml"
                | "yml"
                | "ini"
        )
    } else {
        true
    }
}

pub(super) async fn execute_tool_result(
    call: &ToolCall,
    folders: &[String],
    google_client_id: &str,
    google_client_secret: &str,
) -> Result<ToolOutcome, String> {
    let user_text = call_user_text(call);
    let vi = user_wants_vietnamese(&user_text);
    let result: Result<ToolOutcome, String> = match call.tool.as_str() {
        "get_current_time" => {
            let now: DateTime<Local> = Local::now();
            let observation = format!(
                "Time: {} | Unix: {}",
                now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z"),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|value| value.as_secs())
                    .unwrap_or_default()
            );
            let mut outcome = text_outcome(observation.clone());
            outcome.cards.push(ToolResultCard {
                kind: "time".to_string(),
                title: "Current time".to_string(),
                summary: Some(now.format("%A, %B %-d, %Y at %-I:%M:%S %p %Z").to_string()),
                fields: vec![ToolResultField {
                    label: "Unix".to_string(),
                    value: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|value| value.as_secs().to_string())
                        .unwrap_or_default(),
                }],
                items: Vec::new(),
                text: None,
            });
            Ok(outcome)
        }
        "list_files_in_directory" => {
            let user_text = call_user_text(call);
            let explicit_path = explicit_windows_path_from_text(&user_text);
            let path_arg = call
                .arguments
                .get("path")
                .and_then(Value::as_str)
                .or(explicit_path.as_deref());
            let directory = resolve_directory(path_arg, folders)?;
            let mut rows = Vec::new();
            let mut items = Vec::new();
            for entry in std::fs::read_dir(&directory)
                .map_err(|e| format!("Could not read directory: {}", e))?
                .flatten()
                .take(80)
            {
                let path = entry.path();
                let metadata = entry.metadata().ok();
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default();
                let kind = if path.is_dir() { "folder" } else { "file" };
                let size = metadata.map(|value| value.len()).unwrap_or(0);
                let path_text = strip_extended_path_prefix(&path.to_string_lossy());
                rows.push(format!(
                    "{} | {} | {} bytes | {}",
                    kind, name, size, path_text
                ));
                items.push(ToolResultItem {
                    title: name.to_string(),
                    subtitle: Some(path_text.clone()),
                    details: vec![
                        ToolResultField {
                            label: "Type".to_string(),
                            value: kind.to_string(),
                        },
                        ToolResultField {
                            label: "Size".to_string(),
                            value: format!("{} bytes", size),
                        },
                        ToolResultField {
                            label: "Path".to_string(),
                            value: path_text,
                        },
                    ],
                    url: None,
                });
            }
            if rows.is_empty() {
                let directory_text = strip_extended_path_prefix(&directory.display().to_string());
                let observation = format!("Directory: {}\nNo items found.", directory_text);
                let mut outcome = text_outcome(observation);
                outcome.cards.push(simple_card(
                    "folder",
                    directory_text,
                    Some("No items found.".to_string()),
                ));
                Ok(outcome)
            } else {
                let directory_text = strip_extended_path_prefix(&directory.display().to_string());
                let observation =
                    format!("Directory: {}\n{}", directory_text, rows.join("\n"));
                let mut outcome = text_outcome(observation);
                outcome.cards.push(ToolResultCard {
                    kind: "folder".to_string(),
                    title: directory_text.clone(),
                    summary: Some(format!("{} items shown", rows.len())),
                    fields: vec![ToolResultField {
                        label: "Folder".to_string(),
                        value: directory_text,
                    }],
                    items,
                    text: None,
                });
                Ok(outcome)
            }
        }
        "search_directory" => {
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if query.is_empty() {
                return Ok(error_outcome("query is required.".to_string()));
            }
            let matches =
                file_tools::search_linked_files(query.to_string(), folders.to_vec(), Some(30))?;
            if matches.is_empty() {
                let mut outcome = text_outcome(format!("No matching files found for: {}", query));
                outcome.cards.push(simple_card(
                    "file_search",
                    "No matching files",
                    Some(query.to_string()),
                ));
                Ok(outcome)
            } else {
                let observation = matches
                    .iter()
                    .enumerate()
                    .map(|(index, file)| {
                        format!(
                            "{}. {}\nType: {}\nSize: {} bytes\nPath: {}",
                            index + 1,
                            file.name,
                            file.extension,
                            file.size_bytes,
                            file.path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let mut outcome = text_outcome(observation);
                outcome.cards.push(files_card(
                    "file_search",
                    format!("{} matching files", matches.len()),
                    Some(query.to_string()),
                    &matches,
                ));
                Ok(outcome)
            }
        }
        "read_file" => {
            let path = call
                .arguments
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if path.is_empty() {
                return Ok(error_outcome("path is required.".to_string()));
            }
            let result = file_tools::read_linked_text_file(
                path.to_string(),
                folders.to_vec(),
                Some(120_000),
            )?;
            let observation = format!(
                "File: {}\nPath: {}\nTruncated: {}\nContent:\n{}",
                result.name, result.path, result.truncated, result.content
            );
            let mut outcome = text_outcome(observation);
            outcome.cards.push(ToolResultCard {
                kind: "file_content".to_string(),
                title: result.name,
                summary: Some(result.path),
                fields: vec![ToolResultField {
                    label: "Truncated".to_string(),
                    value: result.truncated.to_string(),
                }],
                items: Vec::new(),
                text: Some(result.content),
            });
            Ok(outcome)
        }
        "list_media_files" => {
            let user_text = call_user_text(call);
            let raw_kind = call
                .arguments
                .get("kind")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "any".to_string());
            let kind = effective_media_kind(raw_kind, &user_text);
            let scoped_folders = media_scope_folders(call, folders, &user_text);
            let matches = file_tools::list_linked_media_files(
                kind.clone(),
                scoped_folders.clone(),
                Some(30),
            )?;
            if matches.is_empty() {
                let mut outcome = text_outcome(format!("No previewable {} files found.", kind));
                outcome
                    .cards
                    .push(simple_card("media", "No media files found", Some(kind)));
                Ok(outcome)
            } else {
                let observation = matches
                    .iter()
                    .enumerate()
                    .map(|(index, file)| {
                        format!(
                            "{}. {}\nType: {}\nSize: {} bytes\nPath: {}",
                            index + 1,
                            file.name,
                            file.extension,
                            file.size_bytes,
                            file.path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let mut outcome = text_outcome(observation);
                outcome.cards.push(files_card(
                    "media",
                    format!("{} media files", matches.len()),
                    Some(kind),
                    &matches,
                ));
                Ok(outcome)
            }
        }
        "preview_random_media" => {
            let user_text = call_user_text(call);
            let raw_kind = call
                .arguments
                .get("kind")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "any".to_string());
            let kind = effective_media_kind(raw_kind, &user_text);
            let scoped_folders = media_scope_folders(call, folders, &user_text);
            let mut matches = file_tools::list_linked_media_files(
                kind.clone(),
                scoped_folders.clone(),
                Some(random_media_scan_limit()),
            )?;
            matches.retain(|file| random_preview_allows_extension(&kind, &file.extension));
            let explicit_query = call.arguments.get("query").and_then(Value::as_str);
            let constraint_terms = media_constraint_terms(&user_text, explicit_query);
            if !constraint_terms.is_empty() {
                let constrained_matches = matches
                    .iter()
                    .cloned()
                    .filter(|file| media_matches_constraints(file, &constraint_terms))
                    .collect::<Vec<_>>();
                if !constrained_matches.is_empty() {
                    matches = constrained_matches;
                } else if explicit_query
                    .map(str::trim)
                    .filter(|query| !query.is_empty())
                    .is_none()
                {
                    matches = matches
                        .into_iter()
                        .filter(|file| media_matches_constraints(file, &constraint_terms))
                        .collect::<Vec<_>>();
                }
                if matches.is_empty() {
                    return Ok(error_outcome(format!(
                        "No previewable {} files matched the requested media constraint: {}.",
                        kind,
                        constraint_terms.join(", ")
                    )));
                }
            }
            let exclude_paths = call
                .arguments
                .get("exclude_paths")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|path| path.trim().to_ascii_lowercase())
                        .filter(|path| !path.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !exclude_paths.is_empty() {
                matches.retain(|file| {
                    !exclude_paths
                        .iter()
                        .any(|path| file.path.to_ascii_lowercase() == *path)
                });
            }
            if matches.is_empty() {
                return Ok(text_outcome(format!(
                    "No previewable {} files found.",
                    kind
                )));
            }
            let total_matches = matches.len();
            let selected = &matches[random_index(total_matches)];
            let preview = file_tools::preview_linked_file(
                selected.path.clone(),
                scoped_folders,
                Some(80_000_000),
            )?;
            if !preview_kind_matches_request(&preview, &user_text) {
                return Ok(error_outcome(format!(
                    "The selected file is {}, but the user asked for {}. Pick a matching real file path from the workspace and try again.",
                    preview.mime_type,
                    requested_kind_label(&user_text)
                )));
            }
            let observation =
                random_selection_observation(total_matches, selected, &preview, &user_text);
            Ok(ToolOutcome {
                observation,
                cards: Vec::new(),
                file_preview: Some(preview),
                image_proposal: None,
                action_proposal: None,
                success: true,
            })
        }
        "preview_file" => {
            let path = call
                .arguments
                .get("path")
                .or_else(|| call.arguments.get("file"))
                .or_else(|| call.arguments.get("file_path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if path.is_empty() {
                return Ok(error_outcome("path is required.".to_string()));
            }
            let preview = file_tools::preview_linked_file(
                path.to_string(),
                folders.to_vec(),
                Some(80_000_000),
            )?;
            let user_text = call_user_text(call);
            if !preview_kind_matches_request(&preview, &user_text) {
                return Ok(error_outcome(format!(
                    "The selected file is {}, but the user asked for {}. Use a matching real file path from the previous observation, or ask the user to choose.",
                    preview.mime_type,
                    requested_kind_label(&user_text)
                )));
            }
            let observation = format!(
                "Preview ready.\nTitle: {}\nType: {}\nPath: {}\nSize: {} bytes",
                preview.name, preview.mime_type, preview.path, preview.size_bytes
            );
            Ok(ToolOutcome {
                observation,
                cards: Vec::new(),
                file_preview: Some(preview),
                image_proposal: None,
                action_proposal: None,
                success: true,
            })
        }
        "weather_forecast" => {
            let location = call
                .arguments
                .get("location")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if location.is_empty() {
                return Ok(error_outcome("location is required.".to_string()));
            }
            let days = call
                .arguments
                .get("days")
                .and_then(Value::as_u64)
                .map(|value| value.clamp(1, 10) as u32)
                .unwrap_or(7);
            let forecast = weather::fetch_weather_forecast(location, days).await?;
            let mut observation_lines = vec![format!(
                "Location: {}, {}",
                forecast.location.name, forecast.location.country
            )];
            let user_text = call_user_text(call);
            let focus_date = weather_requested_focus_date(&user_text);
            let focused_days = if let Some((date, label)) = focus_date {
                observation_lines.push(format!(
                    "Requested period: {} ({})",
                    label,
                    date.format("%Y-%m-%d")
                ));
                let matching = forecast
                    .days
                    .iter()
                    .filter(|day| parse_card_date(&day.date) == Some(date))
                    .collect::<Vec<_>>();
                if matching.is_empty() {
                    observation_lines.push(format!(
                        "No forecast row matched the requested date {}; full forecast follows.",
                        date.format("%Y-%m-%d")
                    ));
                    forecast.days.iter().collect::<Vec<_>>()
                } else {
                    observation_lines
                        .push("Answer only from the requested date row below.".to_string());
                    matching
                }
            } else {
                forecast.days.iter().collect::<Vec<_>>()
            };
            for day in focused_days {
                let rain_chance = day
                    .precipitation_probability_max
                    .map(|value| format!("{}%", value))
                    .unwrap_or_else(|| "n/a".to_string());
                observation_lines.push(format!(
                    "{} | {} | high {:.0}C | low {:.0}C | rain {} | {:.1} mm | wind {:.0} km/h",
                    day.date,
                    day.summary,
                    day.temperature_max_c,
                    day.temperature_min_c,
                    rain_chance,
                    day.precipitation_sum_mm,
                    day.wind_speed_max_kmh
                ));
            }
            let mut outcome = text_outcome(observation_lines.join("\n"));
            outcome.cards.push(weather_card(&forecast));
            Ok(outcome)
        }
        "web_search" => {
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if query.is_empty() {
                return Ok(error_outcome("query is required.".to_string()));
            }
            let results = agent_web::agent_web_search(query.to_string(), None, Some(5)).await?;
            if results.is_empty() {
                let mut outcome =
                    text_outcome(format!("No fresh web results found for: {}", query));
                outcome.cards.push(simple_card(
                    "web_search",
                    "No fresh web results",
                    Some(query.to_string()),
                ));
                Ok(outcome)
            } else {
                let observation = results
                    .iter()
                    .enumerate()
                    .map(|(index, result)| {
                        format!(
                            "{}. {}\nSource: {}\nURL: {}\nDetails: {}",
                            index + 1,
                            result.title,
                            result.source,
                            result.url,
                            result.snippet
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let mut outcome = text_outcome(observation);
                outcome.cards.push(ToolResultCard {
                    kind: "web_search".to_string(),
                    title: format!("{} web results", results.len()),
                    summary: Some(query.to_string()),
                    fields: Vec::new(),
                    items: results
                        .iter()
                        .map(|result| ToolResultItem {
                            title: result.title.clone(),
                            subtitle: Some(result.source.clone()),
                            details: vec![ToolResultField {
                                label: "Details".to_string(),
                                value: result.snippet.clone(),
                            }],
                            url: Some(result.url.clone()),
                        })
                        .collect(),
                    text: None,
                });
                Ok(outcome)
            }
        }
        "gmail_recent" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let user_text = call_user_text(call);
            let model_count = call
                .arguments
                .get("count")
                .and_then(Value::as_u64)
                .map(|value| value.clamp(1, 25) as u32)
                .unwrap_or(5);
            let count = requested_item_count(&user_text, model_count, 25);
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .filter(|value| !value.trim().is_empty());
            let messages = google_calendar::list_google_gmail_messages(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                Some(count),
                query,
            )
            .await?;
            let observation = format_gmail(messages.clone(), &user_text);
            let mut outcome = text_outcome(observation);
            outcome.cards.push(gmail_card(&messages));
            Ok(outcome)
        }
        "google_calendar_check" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let user_text = call_user_text(call);
            let inferred_date = infer_calendar_date(&user_text);
            let date = inferred_date
                .as_deref()
                .or_else(|| call.arguments.get("date").and_then(Value::as_str));
            let (time_min, time_max) = calendar_day_range(date)?;
            let events = google_calendar::list_google_calendar_events(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                time_min,
                time_max,
            )
            .await?;
            let observation = format_google_events(events.clone(), &user_text);
            let mut outcome = text_outcome(observation);
            outcome.cards.push(calendar_card(&events));
            Ok(outcome)
        }
        "propose_image_generation" => {
            parse_image_proposal(call).map(|proposal| image_proposal_outcome(proposal, vi))
        }
        "propose_write_file" => {
            let relative_path = call
                .arguments
                .get("relative_path")
                .or_else(|| call.arguments.get("path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let content = call
                .arguments
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if relative_path.is_empty() {
                return Ok(error_outcome("relative_path is required.".to_string()));
            }
            Ok(proposed_action(
                "write_file",
                if vi { "Ghi tệp" } else { "Write file" },
                if vi {
                    format!("Tạo hoặc thay thế {} sau khi được duyệt.", relative_path)
                } else {
                    format!("Create or replace {} after approval.", relative_path)
                },
                json!({
                    "relative_path": relative_path,
                    "content": content,
                    "root_folder": call.arguments.get("root_folder").cloned().unwrap_or(Value::Null)
                }),
            ))
        }
        "propose_move_file" => {
            let source = call
                .arguments
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let destination = call
                .arguments
                .get("destination_relative_path")
                .or_else(|| call.arguments.get("destination"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if source.is_empty() || destination.is_empty() {
                return Ok(error_outcome(
                    "source and destination_relative_path are required.".to_string(),
                ));
            }
            Ok(proposed_action(
                "move_file",
                if vi {
                    "Di chuyển hoặc đổi tên tệp"
                } else {
                    "Move or rename file"
                },
                if vi {
                    format!(
                        "Di chuyển {} sang {} sau khi được duyệt.",
                        source, destination
                    )
                } else {
                    format!("Move {} to {} after approval.", source, destination)
                },
                json!({
                    "source": source,
                    "destination_relative_path": destination,
                    "root_folder": call.arguments.get("root_folder").cloned().unwrap_or(Value::Null)
                }),
            ))
        }
        "propose_delete_file" => {
            let source = call
                .arguments
                .get("source")
                .or_else(|| call.arguments.get("path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if source.is_empty() {
                return Ok(error_outcome("source is required.".to_string()));
            }
            Ok(proposed_action(
                "delete_file",
                if vi {
                    "Đưa tệp vào thùng rác của ứng dụng"
                } else {
                    "Move file to app trash"
                },
                if vi {
                    format!("Đưa {} vào .galaxy_trash sau khi được duyệt.", source)
                } else {
                    format!("Move {} into .galaxy_trash after approval.", source)
                },
                json!({ "source": source }),
            ))
        }
        "run_powershell" => {
            let command = call
                .arguments
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if command.is_empty() {
                return Ok(error_outcome("command is required.".to_string()));
            }
            let purpose = call
                .arguments
                .get("purpose")
                .and_then(Value::as_str)
                .unwrap_or("Run the requested local system action.");
            Ok(proposed_action(
                "run_powershell",
                if vi {
                    "Chạy tác vụ hệ thống"
                } else {
                    "Run system action"
                },
                purpose.to_string(),
                json!({
                    "purpose": purpose,
                    "command": command,
                    "working_directory": call.arguments.get("working_directory").cloned().unwrap_or(Value::Null),
                    "timeout_seconds": call.arguments.get("timeout_seconds").cloned().unwrap_or(json!(30))
                }),
            ))
        }
        "google_api_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let url = call
                .arguments
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if url.is_empty() {
                return Ok(error_outcome(
                    "url is required for google_api_read.".to_string(),
                ));
            }
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url.to_string(),
                None,
            )
            .await?;
            Ok(text_outcome(body))
        }
        "google_drive_search" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let mime_type = call
                .arguments
                .get("mime_type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let recent = call
                .arguments
                .get("recent")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let page_size = call
                .arguments
                .get("page_size")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 25);
            if query.is_empty() && mime_type.is_empty() {
                return Ok(error_outcome(
                    "query or mime_type is required for google_drive_search.".to_string(),
                ));
            }
            let mut url = url::Url::parse("https://www.googleapis.com/drive/v3/files")
                .map_err(|e| format!("Could not build Drive API URL: {}", e))?;
            let mut filters = vec!["trashed=false".to_string()];
            if !query.is_empty() {
                filters.push(format!("name contains '{}'", query.replace('\'', "\\'")));
            }
            if !mime_type.is_empty() {
                filters.push(format!("mimeType='{}'", mime_type.replace('\'', "\\'")));
            }
            url.query_pairs_mut()
                .append_pair("pageSize", &page_size.to_string())
                .append_pair("includeItemsFromAllDrives", "true")
                .append_pair("supportsAllDrives", "true")
                .append_pair(
                    "fields",
                    "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
                )
                .append_pair("q", &filters.join(" and "));
            if recent {
                url.query_pairs_mut()
                    .append_pair("orderBy", "modifiedTime desc");
            }
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url.to_string(),
                None,
            )
            .await?;
            let parsed: Value =
                serde_json::from_str(&body).unwrap_or_else(|_| json!({ "files": [] }));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_drive_card(&parsed));
            Ok(outcome)
        }
        "google_docs_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let document_id = call
                .arguments
                .get("document_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if document_id.is_empty() {
                return Ok(error_outcome(
                    "document_id is required for google_docs_read.".to_string(),
                ));
            }
            let url = format!("https://docs.googleapis.com/v1/documents/{}", document_id);
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_doc_card(&parsed));
            Ok(outcome)
        }
        "google_sheets_read" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let spreadsheet_id = call
                .arguments
                .get("spreadsheet_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if spreadsheet_id.is_empty() {
                return Ok(error_outcome(
                    "spreadsheet_id is required for google_sheets_read.".to_string(),
                ));
            }
            let range = call
                .arguments
                .get("range")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let url = if let Some(range) = range {
                let encoded_range: String =
                    url::form_urlencoded::byte_serialize(range.as_bytes()).collect();
                format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}?majorDimension=ROWS",
                    spreadsheet_id, encoded_range
                )
            } else {
                format!(
                    "https://sheets.googleapis.com/v4/spreadsheets/{}?includeGridData=false",
                    spreadsheet_id
                )
            };
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_sheet_card(&parsed));
            Ok(outcome)
        }
        "google_contacts_search" => {
            if google_client_id.trim().is_empty() || google_client_secret.trim().is_empty() {
                return Err("Google OAuth client ID/secret are missing.".to_string());
            }
            let query = call
                .arguments
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let page_size = call
                .arguments
                .get("page_size")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 50);
            let url = if let Some(query) = query {
                let mut url =
                    url::Url::parse("https://people.googleapis.com/v1/people:searchContacts")
                        .map_err(|e| format!("Could not build People API URL: {}", e))?;
                url.query_pairs_mut()
                    .append_pair(
                        "readMask",
                        "names,emailAddresses,phoneNumbers,organizations",
                    )
                    .append_pair("pageSize", &page_size.to_string())
                    .append_pair("query", query);
                url.to_string()
            } else {
                let mut url =
                    url::Url::parse("https://people.googleapis.com/v1/people/me/connections")
                        .map_err(|e| format!("Could not build People API URL: {}", e))?;
                url.query_pairs_mut()
                    .append_pair(
                        "personFields",
                        "names,emailAddresses,phoneNumbers,organizations",
                    )
                    .append_pair("pageSize", &page_size.to_string())
                    .append_pair("sortOrder", "LAST_MODIFIED_ASCENDING");
                url.to_string()
            };
            let body = google_calendar::execute_google_api(
                google_client_id.to_string(),
                google_client_secret.to_string(),
                "GET".to_string(),
                url,
                None,
            )
            .await?;
            let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
            let mut outcome = text_outcome(body);
            outcome.cards.push(google_contacts_card(&parsed));
            Ok(outcome)
        }
        "propose_gmail_send" => {
            let to = call
                .arguments
                .get("to")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let subject = call
                .arguments
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let body = call
                .arguments
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if to.is_empty() || subject.is_empty() {
                return Ok(error_outcome("to and subject are required.".to_string()));
            }
            Ok(proposed_action(
                "gmail_send",
                "Send email via Gmail",
                format!("Send email to: {}\nSubject: {}", to, subject),
                json!({ "to": to, "subject": subject, "body": body }),
            ))
        }
        "propose_gmail_trash" => {
            let id = call
                .arguments
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let reason = call
                .arguments
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Move this email to Trash");
            if id.is_empty() {
                return Ok(error_outcome("id is required.".to_string()));
            }
            Ok(proposed_action(
                "gmail_trash",
                "Delete email (move to Trash)",
                reason.to_string(),
                json!({ "id": id }),
            ))
        }
        "propose_calendar_create" => {
            let title = call
                .arguments
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let start = call
                .arguments
                .get("start")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let end = call
                .arguments
                .get("end")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if title.is_empty() || start.is_empty() || end.is_empty() {
                return Ok(error_outcome(
                    "title, start, and end are required.".to_string(),
                ));
            }
            Ok(proposed_action(
                "calendar_create",
                "Create calendar event",
                format!("Event: {}\nStart: {}\nEnd: {}", title, start, end),
                json!({
                    "title": title,
                    "start": start,
                    "end": end,
                    "description": call.arguments.get("description").cloned().unwrap_or(Value::Null),
                    "location": call.arguments.get("location").cloned().unwrap_or(Value::Null),
                }),
            ))
        }
        "propose_calendar_delete" => {
            let id = call
                .arguments
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let title = call
                .arguments
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if id.is_empty() {
                return Ok(error_outcome("id is required.".to_string()));
            }
            Ok(proposed_action(
                "calendar_delete",
                "Delete calendar event",
                format!("Event: {}", title),
                json!({
                    "id": id,
                    "title": title,
                }),
            ))
        }
        "propose_google_contact_delete" => {
            let resource_name = call
                .arguments
                .get("resource_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let name = call
                .arguments
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Google contact")
                .trim();
            if resource_name.is_empty() {
                return Ok(error_outcome(
                    "resource_name is required for propose_google_contact_delete.".to_string(),
                ));
            }
            Ok(proposed_action(
                "google_contact_delete",
                "Delete Google contact",
                format!("Contact: {}", name),
                json!({
                    "resource_name": resource_name,
                    "name": name,
                }),
            ))
        }
        "propose_google_action" => {
            let summary = call
                .arguments
                .get("action_summary")
                .and_then(Value::as_str)
                .unwrap_or("Google action")
                .trim();
            let method = call
                .arguments
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("POST")
                .trim();
            let url = call
                .arguments
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if url.is_empty() {
                return Ok(error_outcome(
                    "url is required for propose_google_action.".to_string(),
                ));
            }
            Ok(proposed_action(
                "google_action",
                "Google Workspace action",
                summary.to_string(),
                json!({
                    "method": method,
                    "url": url,
                    "payload": call.arguments.get("payload").cloned().unwrap_or(Value::Null),
                }),
            ))
        }
        other => Err(format!("Unknown tool: {}", other)),
    };

    result
}

pub(super) async fn execute_tool(
    call: &ToolCall,
    folders: &[String],
    google_client_id: &str,
    google_client_secret: &str,
    agent_started_at: Instant,
    request_elapsed_ms: i64,
) -> ToolOutcome {
    if matches!(
        call.tool.as_str(),
        "list_media_files" | "preview_random_media" | "preview_file" | "search_directory" | "list_files_in_directory"
    ) {
        crate::assistant_runtime::append_runtime_log(
            "agent",
            &format!(
                "execute_tool workspace tool={} folders={} args={}",
                call.tool,
                folders.len(),
                crate::assistant_runtime::compact_trace_text(&call.arguments.to_string(), 240)
            ),
        );
    }
    let outcome = execute_tool_result(call, folders, google_client_id, google_client_secret)
        .await
        .unwrap_or_else(error_outcome);
    if matches!(
        call.tool.as_str(),
        "list_media_files" | "preview_random_media" | "preview_file" | "search_directory" | "list_files_in_directory"
    ) {
        crate::assistant_runtime::append_runtime_log(
            "agent",
            &format!(
                "execute_tool workspace result tool={} success={} observation={}",
                call.tool,
                outcome.success,
                crate::assistant_runtime::compact_trace_text(&outcome.observation, 240)
            ),
        );
    }
    let agent_elapsed_ms = agent_started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;
    log_tool_run(
        call,
        &outcome,
        request_elapsed_ms
            .max(0)
            .saturating_add(agent_elapsed_ms)
            .max(0),
    );
    outcome
}
