use super::*;

mod calendar;
mod google;
mod media;
mod tool_guard;
mod weather;

pub(super) use calendar::*;
pub(super) use google::*;
pub(super) use media::*;
pub(super) use tool_guard::*;
pub(super) use weather::*;

pub(super) fn is_confirmation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    matches!(
        words.as_slice(),
        ["ok"] | ["oke"] | ["yes"] | ["yeah"] | ["yep"]
    ) || has_word_folded(&lowered, &normalized, &["có", "được"])
        || contains_any_folded(&lowered, &normalized, &["làm đi", "mở đi"])
}

pub(super) fn request_mentions_mail(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["mailbox", "gmail", "email", "mail"])
        || contains_any_folded(
            &lowered,
            &normalized,
            &["hộp thư", "thư đến", "thư gửi", "email"],
        )
}

#[cfg(test)]
pub(super) fn request_wants_recent_mail(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_mail(text)
        && (extract_first_number(text).is_some()
            || contains_any(&normalized, &["recent", "latest", "newest", "inbox", "all"])
            || contains_any_folded(
                &lowered,
                &normalized,
                &["gần nhất", "mới nhất", "hộp thư đến", "tất cả"],
            ))
}

#[cfg(test)]
pub(super) fn request_wants_mail_write(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    request_mentions_mail(text)
        && (contains_any(
            &normalized,
            &["send", "reply", "trash", "delete", "remove", "archive"],
        ) || contains_any_folded(
            &lowered,
            &normalized,
            &["gửi", "trả lời", "xóa", "bỏ", "lưu trữ"],
        ))
}

pub(super) fn request_has_search_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "search", "find", "lookup", "look up", "check", "show", "list",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["tìm", "kiếm", "tra cứu", "kiểm tra", "cho biết"],
    )
}

pub(super) fn request_has_action_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "search",
            "find",
            "lookup",
            "look up",
            "check",
            "show",
            "list",
            "open",
            "play",
            "preview",
            "read",
            "create",
            "add",
            "delete",
            "remove",
            "send",
            "summarize",
            "summary",
            "forecast",
            "need",
            "want",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tìm",
            "kiếm",
            "tra cứu",
            "kiểm tra",
            "cho biết",
            "xem",
            "mở",
            "phát",
            "đọc",
            "tạo",
            "thêm",
            "xóa",
            "gửi",
            "tóm tắt",
            "tóm lược",
            "dự báo",
            "cần",
            "muốn",
        ],
    )
}

pub(super) fn request_has_question_intent(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    text.contains('?')
        || contains_any(
            &normalized,
            &[
                "what",
                "when",
                "where",
                "why",
                "how",
                "which",
                "can you",
                "could you",
                "will it",
                "does it",
                "is it",
            ],
        )
        || contains_any_folded(
            &lowered,
            &normalized,
            &[
                "thế nào",
                "như nào",
                "ra sao",
                "có phải",
                "có không",
                "co ko",
                "không",
                "ko",
                "bao nhiêu",
                "ở đâu",
                "khi nào",
                "vì sao",
                "tại sao",
            ],
        )
}

pub(super) fn request_mentions_workspace_files(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "workspace",
            "folder",
            "file",
            "directory",
            "path",
            "repo",
            "project",
            "code",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "thư mục",
            "tệp",
            "đường dẫn",
            "dự án",
            "mã nguồn",
            "workspace",
        ],
    )
}

pub(super) fn request_mentions_web_facts(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "web", "website", "internet", "online", "news", "weather", "price", "market", "search",
            "google",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["thông tin", "tin tức", "thời tiết", "giá", "trên web"],
    )
}

pub(super) fn request_wants_file_search(text: &str) -> bool {
    request_mentions_workspace_files(text) && request_has_search_intent(text)
}

pub(super) fn request_wants_web_search(text: &str) -> bool {
    request_mentions_web_facts(text)
        && (request_has_search_intent(text) || request_has_question_intent(text))
}

pub(super) fn request_is_conversational_turn(text: &str) -> bool {
    if request_is_casual_weather_observation(text) {
        return true;
    }
    if route_for_request(text).is_some() {
        return false;
    }

    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if words.is_empty() {
        return false;
    }

    if contains_any(
        &normalized,
        &[
            "how are you",
            "are you happy",
            "are you sad",
            "do you like",
            "do you miss",
            "what do you think of me",
            "do you love",
        ],
    ) {
        return true;
    }

    if contains_any_folded(
        &lowered,
        &normalized,
        &[
            "có vui",
            "có buồn",
            "có nhớ",
            "có thích",
            "có ghét",
            "gặp anh",
            "gặp em",
            "cảm thấy",
            "nghĩ sao",
            "chán chết",
            "buồn quá",
            "vui không",
        ],
    ) {
        return true;
    }

    words.len() <= 8
        && words.iter().any(|word| {
            matches!(
                *word,
                "anh"
                    | "em"
                    | "tôi"
                    | "bạn"
                    | "mình"
                    | "tao"
                    | "cậu"
                    | "vui"
                    | "buồn"
                    | "nhớ"
                    | "thich"
                    | "ghet"
                    | "yêu"
                    | "chán"
            )
        })
        && !request_has_search_intent(text)
}

pub(super) fn route_for_request(text: &str) -> Option<ToolRoute> {
    if request_wants_image_generation(text)
        || broad_image_generation_signal(text)
        || request_wants_avatar_image_generation(text)
        || request_wants_user_avatar_image_generation(text)
        || request_targets_user_and_character_images(text)
    {
        return None;
    }
    if request_wants_preview(text) && request_mentions_media(text) {
        return Some(ToolRoute::MediaPreview);
    }
    if request_mentions_mail(text) {
        return Some(ToolRoute::Gmail);
    }
    if request_wants_weather(text) {
        return Some(ToolRoute::Weather);
    }
    if request_mentions_calendar(text) {
        return Some(ToolRoute::Calendar);
    }
    if request_wants_google_workspace(text) {
        return Some(ToolRoute::GoogleWorkspace);
    }
    if request_wants_file_search(text) {
        return Some(ToolRoute::FileSearch);
    }
    if request_wants_web_search(text) {
        return Some(ToolRoute::WebSearch);
    }
    None
}

#[cfg(test)]
pub(super) fn previous_explicit_route(messages: &[ReactChatMessage]) -> Option<ToolRoute> {
    let latest_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, message)| message.role == "user" && Some(*index) != latest_index)
        .next()
        .and_then(|(_, message)| route_for_request(&content_text(&message.content)))
}

pub(super) fn request_adds_context_details(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return false;
    }

    let starts_with_context_marker = words
        .first()
        .map(|word| matches!(*word, "ở" | "tại" | "in" | "for" | "at" | "vào" | "lúc"))
        .unwrap_or(false);
    if starts_with_context_marker {
        return true;
    }

    contains_any(
        &normalized,
        &["today", "tomorrow", "weekend", "this week", "this month"],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "hôm nay",
            "ngày mai",
            "cuối tuần",
            "tuần này",
            "tháng này",
            "năm nay",
        ],
    )
}

pub(super) fn is_contextual_follow_up(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let words = normalized
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return false;
    }
    if is_confirmation(text) {
        return true;
    }
    if words.len() <= 5 && !request_wants_preview(text) && request_adds_context_details(text) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "result",
            "results",
            "summary",
            "summarize",
            "dont send link",
            "don't send link",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "kết quả",
            "tóm lược",
            "tóm tắt",
            "đừng gửi link",
            "không gửi link",
            "xem rồi",
        ],
    )
}

pub(super) fn request_wants_explanation_only(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "explain",
            "clarify",
            "what do you mean",
            "meaning",
            "why",
            "how so",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "giải thích",
            "nghĩa là sao",
            "ý là gì",
            "tại sao",
            "vì sao",
            "thế là sao",
            "sao vậy",
            "dễ hiểu",
        ],
    )
}

#[cfg(test)]
pub(super) fn contextual_route_for_messages(messages: &[ReactChatMessage]) -> Option<ToolRoute> {
    let latest_text = latest_user_text(messages);
    route_for_request(&latest_text).or_else(|| {
        let previous = previous_explicit_route(messages);
        if previous == Some(ToolRoute::MediaPreview)
            && (vietnamese_media_followup_term(&latest_text.to_lowercase())
                || request_wants_another(&latest_text))
        {
            return previous;
        }
        if is_contextual_follow_up(&latest_text)
            || (previous == Some(ToolRoute::Weather)
                && looks_like_bare_weather_location(&latest_text))
        {
            previous
        } else {
            None
        }
    })
}

#[cfg(test)]
pub(super) fn latest_explicit_route_text(
    messages: &[ReactChatMessage],
    route: ToolRoute,
) -> Option<String> {
    let latest_index = messages.iter().rposition(|message| message.role == "user");
    messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, message)| message.role == "user" && Some(*index) != latest_index)
        .find_map(|(_, message)| {
            let text = content_text(&message.content);
            if route_for_request(&text) == Some(route) {
                Some(text)
            } else {
                None
            }
        })
}
