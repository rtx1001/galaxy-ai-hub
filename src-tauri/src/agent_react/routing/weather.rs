use super::*;

pub(in crate::agent_react) fn request_mentions_weather(text: &str) -> bool {
    let lowered = text.to_lowercase();
    contains_any(
        &lowered,
        &[
            "weather",
            "forecast",
            "rain",
            "storm",
            "temperature",
            "humidity",
            "wind",
            "weekend",
            "sunny",
            "cloudy",
        ],
    ) || contains_vietnamese_intent(
        &lowered,
        &[
            "thời tiết",
            "dự báo",
            "mưa",
            "bão",
            "nhiệt độ",
            "độ ẩm",
            "gió",
            "cuối tuần",
            "nắng",
            "mây",
        ],
    )
}

pub(in crate::agent_react) fn request_wants_weather(text: &str) -> bool {
    if !request_mentions_weather(text) {
        return false;
    }
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_has_action_intent(text)
        || request_has_question_intent(text)
        || contains_any(&normalized, &["forecast"])
        || contains_any_folded(&lowered, &normalized, &["dự báo", "thời tiết thế nào"])
}

pub(in crate::agent_react) fn request_is_casual_weather_observation(text: &str) -> bool {
    request_mentions_weather(text) && !request_wants_weather(text)
}

#[cfg(test)]
pub(in crate::agent_react) fn weather_location_stop_words() -> &'static [&'static str] {
    &[
        "anh",
        "em",
        "cho",
        "ngoài",
        "đó",
        "đây",
        "biết",
        "xem",
        "giúp",
        "với",
        "nhé",
        "nha",
        "được",
        "thời",
        "tiết",
        "dự",
        "báo",
        "mưa",
        "gió",
        "độ",
        "ẩm",
        "nhiệt",
        "ngày",
        "nay",
        "mai",
        "hôm",
        "qua",
        "cuối",
        "tuần",
        "có",
        "không",
        "ko",
        "sau",
        "trước",
        "khi",
        "lúc",
        "tiếp",
        "thế",
        "như",
        "nào",
        "nao",
        "ra",
        "sao",
        "trời",
        "xám",
        "xì",
        "nhiều",
        "ít",
        "sẽ",
        "rồi",
        "what",
        "weather",
        "forecast",
        "rain",
        "wind",
        "humidity",
        "temperature",
        "today",
        "tomorrow",
        "this",
        "weekend",
        "week",
        "city",
        "area",
        "need",
        "want",
        "info",
        "thông",
        "tin",
        "cụ",
    ]
}

#[cfg(test)]
pub(in crate::agent_react) fn looks_like_bare_weather_location(text: &str) -> bool {
    let tokens = natural_language_tokens(text);
    if tokens.is_empty() || tokens.len() > 4 {
        return false;
    }

    let folded_tokens = tokens
        .iter()
        .map(|token| normalize_text(token))
        .collect::<Vec<_>>();
    let stop_words = weather_location_stop_words();
    let meaningful = tokens
        .iter()
        .zip(folded_tokens.iter())
        .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
        .collect::<Vec<_>>();
    if meaningful.is_empty() || meaningful.len() > 3 {
        return false;
    }

    let folded = meaningful
        .iter()
        .map(|(_, folded)| folded.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if contains_any(
        &folded,
        &[
            "hà nội",
            "hanoi",
            "đà nẵng",
            "ho chi minh",
            "hcm",
            "sài gòn",
            "saigon",
            "huế",
            "nha trang",
            "đà lạt",
            "cần thơ",
            "hải phòng",
            "paris",
            "tokyo",
            "seoul",
            "london",
            "new york",
        ],
    ) {
        return true;
    }

    meaningful
        .iter()
        .all(|(original, _)| starts_with_uppercase_letter(original))
}

#[cfg(test)]
fn starts_with_uppercase_letter(token: &str) -> bool {
    token
        .chars()
        .find(|ch| ch.is_alphabetic())
        .map(|ch| ch.is_uppercase())
        .unwrap_or(false)
}

#[cfg(test)]
fn known_weather_location_from_text(text: &str) -> Option<String> {
    let lowered = text.to_lowercase();
    let known = [
        ("hà nội", "Hà Nội"),
        ("ha noi", "Ha Noi"),
        ("hanoi", "Hanoi"),
        ("đà nẵng", "Đà Nẵng"),
        ("da nang", "Da Nang"),
        ("ho chi minh", "Ho Chi Minh"),
        ("sài gòn", "Sài Gòn"),
        ("saigon", "Saigon"),
        ("hcm", "HCM"),
        ("huế", "Huế"),
        ("hue", "Hue"),
        ("nha trang", "Nha Trang"),
        ("đà lạt", "Đà Lạt"),
        ("da lat", "Da Lat"),
        ("cần thơ", "Cần Thơ"),
        ("can tho", "Can Tho"),
        ("hải phòng", "Hải Phòng"),
        ("hai phong", "Hai Phong"),
        ("paris", "Paris"),
        ("tokyo", "Tokyo"),
        ("seoul", "Seoul"),
        ("london", "London"),
        ("new york", "New York"),
    ];
    known
        .iter()
        .find(|(needle, _)| lowered.contains(*needle))
        .map(|(_, location)| (*location).to_string())
}

#[cfg(test)]
fn proper_location_sequence_after_weather_terms(
    original_tokens: &[&str],
    folded_tokens: &[String],
    stop_words: &[&str],
) -> Option<String> {
    let weather_terms = [
        "weather",
        "forecast",
        "rain",
        "temperature",
        "thời",
        "tiết",
        "dự",
        "báo",
        "mưa",
        "nhiệt",
    ];
    let start_index = folded_tokens
        .iter()
        .enumerate()
        .filter(|(_, token)| weather_terms.contains(&token.as_str()))
        .map(|(index, _)| index + 1)
        .max()
        .unwrap_or(0);

    let mut best: Vec<&str> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for (original, folded) in original_tokens
        .iter()
        .zip(folded_tokens.iter())
        .skip(start_index)
    {
        if stop_words.contains(&folded.as_str()) {
            if current.len() > best.len() {
                best = current.clone();
            }
            current.clear();
            continue;
        }
        if starts_with_uppercase_letter(original) {
            current.push(*original);
            continue;
        }
        if current.len() > best.len() {
            best = current.clone();
        }
        current.clear();
    }
    if current.len() > best.len() {
        best = current;
    }

    if best.is_empty() {
        None
    } else {
        Some(best.join(" "))
    }
}

#[cfg(test)]
pub(in crate::agent_react) fn weather_context_text(
    messages: &[ReactChatMessage],
) -> Option<String> {
    let latest_text = latest_user_text(messages);
    if route_for_request(&latest_text) == Some(ToolRoute::Weather) {
        if let Some(previous) = latest_explicit_route_text(messages, ToolRoute::Weather) {
            if is_contextual_follow_up(&latest_text)
                || weather_location_from_text(&latest_text).is_none()
            {
                return Some(
                    format!("{} {}", previous.trim(), latest_text.trim())
                        .trim()
                        .to_string(),
                );
            }
        }
        return Some(latest_text);
    }
    latest_explicit_route_text(messages, ToolRoute::Weather).map(|previous| {
        format!("{} {}", previous.trim(), latest_text.trim())
            .trim()
            .to_string()
    })
}

#[cfg(test)]
pub(in crate::agent_react) fn weather_location_from_text(text: &str) -> Option<String> {
    let original_tokens = natural_language_tokens(text);
    if original_tokens.is_empty() {
        return None;
    }

    let folded_tokens = original_tokens
        .iter()
        .map(|token| normalize_text(token))
        .collect::<Vec<_>>();

    let marker_words = ["ở", "tại", "in", "for", "at"];
    let stop_words = weather_location_stop_words();

    for marker in marker_words {
        if let Some(index) = folded_tokens.iter().position(|token| token == marker) {
            let value = original_tokens
                .iter()
                .zip(folded_tokens.iter())
                .skip(index + 1)
                .take_while(|(_, folded)| !stop_words.contains(&folded.as_str()))
                .map(|(original, _)| (*original).to_string())
                .collect::<Vec<_>>()
                .join(" ");
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }

    if request_wants_weather(text) {
        if let Some(location) = known_weather_location_from_text(text) {
            return Some(location);
        }
        if let Some(location) = proper_location_sequence_after_weather_terms(
            &original_tokens,
            &folded_tokens,
            stop_words,
        ) {
            return Some(location);
        }
        let value = original_tokens
            .iter()
            .zip(folded_tokens.iter())
            .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
            .take(5)
            .map(|(original, _)| (*original).to_string())
            .collect::<Vec<_>>()
            .join(" ");

        return if value.trim().is_empty() {
            None
        } else {
            Some(value.trim().to_string())
        };
    }

    if !looks_like_bare_weather_location(text) {
        return None;
    }

    let value = original_tokens
        .iter()
        .zip(folded_tokens.iter())
        .filter(|(_, folded)| !stop_words.contains(&folded.as_str()))
        .take(4)
        .map(|(original, _)| (*original).to_string())
        .collect::<Vec<_>>()
        .join(" ");

    if value.trim().is_empty() {
        None
    } else {
        Some(value.trim().to_string())
    }
}

#[cfg(test)]
pub(in crate::agent_react) fn infer_weather_days(text: &str) -> u32 {
    let normalized = normalize_text(text);
    if contains_any(&normalized, &["weekend"])
        || contains_any_folded(&text.to_lowercase(), &normalized, &["cuối tuần"])
    {
        return 4;
    }
    if contains_any(&normalized, &["today", "tomorrow"])
        || contains_any_folded(&text.to_lowercase(), &normalized, &["hôm nay", "ngày mai"])
    {
        return 2;
    }
    requested_item_count(text, 7, 10)
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_weather_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    if contextual_route_for_messages(messages) != Some(ToolRoute::Weather) {
        return None;
    }

    let latest_text = latest_user_text(messages);
    let context_text = weather_context_text(messages).unwrap_or_else(|| latest_text.clone());
    let location = weather_location_from_text(&latest_text)
        .or_else(|| {
            latest_explicit_route_text(messages, ToolRoute::Weather)
                .and_then(|text| weather_location_from_text(&text))
        })
        .or_else(|| weather_location_from_text(&context_text))?;
    let days = infer_weather_days(&context_text);

    Some(with_user_text(
        ToolCall {
            tool: "weather_forecast".to_string(),
            arguments: json!({
                "location": location,
                "days": days
            }),
        },
        &context_text,
    ))
}

#[cfg(test)]
pub(in crate::agent_react) fn weather_missing_location_reply(
    messages: &[ReactChatMessage],
) -> Option<String> {
    if contextual_route_for_messages(messages) != Some(ToolRoute::Weather) {
        return None;
    }

    let latest_text = latest_user_text(messages);
    let context_text = weather_context_text(messages).unwrap_or_else(|| latest_text.clone());
    if weather_location_from_text(&latest_text).is_some()
        || latest_explicit_route_text(messages, ToolRoute::Weather)
            .and_then(|text| weather_location_from_text(&text))
            .is_some()
        || weather_location_from_text(&context_text).is_some()
    {
        return None;
    }

    Some(if user_wants_vietnamese(&latest_text) {
        "Anh muốn xem thời tiết ở khu vực nào? Em cần tên thành phố hoặc khu vực cụ thể, ví dụ Hà Nội hoặc Đà Nẵng.".to_string()
    } else {
        "Which city or area do you want the weather for? I need a specific location, for example Hanoi or Da Nang.".to_string()
    })
}
