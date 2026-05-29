use super::*;

pub(in crate::agent_react) fn request_mentions_calendar(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["calendar", "schedule", "event", "agenda"])
        || contains_any_folded(&lowered, &normalized, &["lịch", "sự kiện"])
}

#[cfg(test)]
pub(in crate::agent_react) fn request_wants_calendar_write(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_calendar(text)
        && (contains_any(
            &normalized,
            &["create", "add", "book", "delete", "remove", "cancel"],
        ) || contains_any_folded(
            &lowered,
            &normalized,
            &["tạo", "thêm", "đặt lịch", "xóa", "hủy"],
        ))
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_calendar_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::Calendar) {
        return None;
    }
    if request_wants_calendar_write(&latest_text) {
        return None;
    }

    let date = infer_calendar_date(&latest_text).unwrap_or_else(|| {
        if contains_any(
            &normalize_text(&latest_text),
            &["calendar", "schedule", "agenda"],
        ) {
            "today".to_string()
        } else {
            Local::now().date_naive().format("%Y-%m-%d").to_string()
        }
    });

    Some(with_user_text(
        ToolCall {
            tool: "google_calendar_check".to_string(),
            arguments: json!({ "date": date }),
        },
        &latest_text,
    ))
}

pub(in crate::agent_react) fn month_name_to_number(value: &str) -> Option<u32> {
    match value {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "sept" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

pub(in crate::agent_react) fn infer_calendar_date(text: &str) -> Option<String> {
    let lower = normalize_text(text);
    let today = Local::now().date_naive();
    if contains_any(&lower, &["today", "hôm nay"]) {
        return Some(today.format("%Y-%m-%d").to_string());
    }
    if contains_any(&lower, &["tomorrow", "ngày mai"]) {
        return Some((today + Duration::days(1)).format("%Y-%m-%d").to_string());
    }

    let words = lower
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    for window in words.windows(2) {
        if matches!(window[0], "month" | "tháng") {
            if let Ok(month) = window[1].parse::<u32>() {
                if (1..=12).contains(&month) {
                    return Some(format!("{}-{month:02}", today.year()));
                }
            }
            if let Some(month) = month_name_to_number(window[1]) {
                return Some(format!("{}-{month:02}", today.year()));
            }
        }
    }

    for (index, word) in words.iter().enumerate() {
        if let Some(month) = month_name_to_number(word) {
            let year = words
                .get(index + 1)
                .and_then(|part| part.parse::<i32>().ok())
                .filter(|year| (2000..=2100).contains(year))
                .unwrap_or_else(|| today.year());
            return Some(format!("{year}-{month:02}"));
        }
    }

    None
}
