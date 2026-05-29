use super::*;

pub(in crate::agent_react) fn request_mentions_google_workspace(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "google docs",
            "google doc",
            "docs.google.com",
            "google sheets",
            "google sheet",
            "sheets.google.com",
            "google drive",
            "drive.google.com",
            "spreadsheet",
            "spreadsheets",
            "google workspace",
            "google document",
            "google spreadsheet",
            "google contacts",
            "google contact",
            "contact list",
            "contacts list",
            "address book",
            "phonebook",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "tài liệu google",
            "google drive",
            "google docs",
            "google sheets",
            "bảng tính google",
            "trang tính google",
            "tệp drive",
            "danh bạ",
            "liên hệ",
            "sổ liên lạc",
        ],
    )
}

pub(in crate::agent_react) fn request_wants_google_workspace(text: &str) -> bool {
    request_mentions_google_workspace(text)
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_gmail_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::Gmail) {
        return None;
    }
    if request_wants_mail_write(&latest_text) || !request_wants_recent_mail(&latest_text) {
        return None;
    }

    let count = requested_item_count(&latest_text, 10, 25);
    Some(with_user_text(
        ToolCall {
            tool: "gmail_recent".to_string(),
            arguments: json!({ "count": count }),
        },
        &latest_text,
    ))
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_web_search_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::WebSearch) {
        return None;
    }

    let query = if route_for_request(&latest_text) == Some(ToolRoute::WebSearch) {
        latest_text.trim().to_string()
    } else if is_confirmation(&latest_text) {
        latest_explicit_route_text(messages, ToolRoute::WebSearch)?
    } else if let Some(previous) = latest_explicit_route_text(messages, ToolRoute::WebSearch) {
        format!("{} {}", previous.trim(), latest_text.trim())
            .trim()
            .to_string()
    } else {
        latest_text.trim().to_string()
    };

    Some(with_user_text(
        ToolCall {
            tool: "web_search".to_string(),
            arguments: json!({ "query": query }),
        },
        &latest_text,
    ))
}

#[cfg(test)]
pub(in crate::agent_react) fn extract_people_resource_name(text: &str) -> Option<String> {
    text.split(|ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '`' | '"' | '\'' | ',' | ')' | '(' | '[' | ']' | '{' | '}' | '<' | '>'
            )
    })
    .map(|part| part.trim_matches(|ch: char| matches!(ch, '.' | ':' | ';' | '!' | '?')))
    .find(|part| part.starts_with("people/") && part.len() > "people/".len())
    .map(str::to_string)
}

#[cfg(test)]
pub(in crate::agent_react) fn text_mentions_contact_delete(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    (contains_any(&lowered, &["delete", "remove", "trash", "xóa", "xoá"])
        || contains_any_folded(&lowered, &normalized, &["xoa"]))
        && (contains_any(&lowered, &["contact", "contacts", "people", "danh bạ"])
            || contains_any_folded(&lowered, &normalized, &["danh ba"]))
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_google_contact_delete_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    let latest_mentions_delete = text_mentions_contact_delete(&latest_text);
    if !latest_mentions_delete && !is_confirmation(&latest_text) {
        return None;
    }

    if latest_mentions_delete {
        if let Some(resource_name) = extract_people_resource_name(&latest_text) {
            return Some(with_user_text(
                ToolCall {
                    tool: "propose_google_contact_delete".to_string(),
                    arguments: json!({ "resource_name": resource_name }),
                },
                &latest_text,
            ));
        }
    }

    for message in messages.iter().rev().skip(1).take(8) {
        let text = content_text(&message.content);
        if !text_mentions_contact_delete(&text) && !text.to_lowercase().contains("contact") {
            continue;
        }
        if let Some(resource_name) = extract_people_resource_name(&text) {
            return Some(with_user_text(
                ToolCall {
                    tool: "propose_google_contact_delete".to_string(),
                    arguments: json!({ "resource_name": resource_name }),
                },
                &latest_text,
            ));
        }
    }

    None
}

#[cfg(test)]
pub(in crate::agent_react) fn deterministic_google_workspace_call(
    messages: &[ReactChatMessage],
) -> Option<ToolCall> {
    let latest_text = latest_user_text(messages);
    if contextual_route_for_messages(messages) != Some(ToolRoute::GoogleWorkspace) {
        return None;
    }

    let normalized = normalize_text(&latest_text);
    let wants_recent = contains_any(&normalized, &["recent", "latest", "newest"])
        || contains_any_folded(
            &latest_text.to_lowercase(),
            &normalized,
            &["gan nhat", "moi nhat"],
        );
    let wants_sheet = contains_any(
        &normalized,
        &[
            "sheet",
            "sheets",
            "spreadsheet",
            "google sheet",
            "google sheets",
        ],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["bang tinh", "trang tinh", "google sheet"],
    );
    let wants_doc = contains_any(
        &normalized,
        &["doc", "docs", "document", "google doc", "google docs"],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["tai lieu google", "google doc"],
    );
    if contains_any(
        &normalized,
        &["contact", "contacts", "people", "address book", "phonebook"],
    ) || contains_any_folded(
        &latest_text.to_lowercase(),
        &normalized,
        &["danh ba", "lien he"],
    ) {
        let query = super::super::google_infer::infer_google_contacts_query(&latest_text);
        let page_size = if query.is_some() { 10 } else { 20 };
        return Some(with_user_text(
            ToolCall {
                tool: "google_contacts_search".to_string(),
                arguments: if let Some(query) = query {
                    json!({ "query": query, "page_size": page_size })
                } else {
                    json!({ "page_size": page_size })
                },
            },
            &latest_text,
        ));
    }

    if wants_recent && (wants_sheet || wants_doc) {
        let mime_type = if wants_sheet {
            "application/vnd.google-apps.spreadsheet"
        } else {
            "application/vnd.google-apps.document"
        };
        return Some(with_user_text(
            ToolCall {
                tool: "google_drive_search".to_string(),
                arguments: json!({
                    "mime_type": mime_type,
                    "recent": true,
                    "page_size": 10
                }),
            },
            &latest_text,
        ));
    }

    if let Some(document_id) = super::super::google_infer::extract_google_doc_id(&latest_text) {
        return Some(with_user_text(
            ToolCall {
                tool: "google_docs_read".to_string(),
                arguments: json!({ "document_id": document_id }),
            },
            &latest_text,
        ));
    }

    if let Some(spreadsheet_id) = super::super::google_infer::extract_google_sheet_id(&latest_text)
    {
        return Some(with_user_text(
            ToolCall {
                tool: "google_sheets_read".to_string(),
                arguments: json!({ "spreadsheet_id": spreadsheet_id }),
            },
            &latest_text,
        ));
    }

    if (request_has_search_intent(&latest_text)
        || contains_any(
            &normalized,
            &[
                "open",
                "read",
                "show",
                "inspect",
                "doc",
                "sheet",
                "document",
                "spreadsheet",
            ],
        ))
        && super::super::google_infer::infer_google_drive_query(&latest_text).is_some()
    {
        return Some(with_user_text(
            ToolCall {
                tool: "google_drive_search".to_string(),
                arguments: json!({ "query": super::super::google_infer::infer_google_drive_query(&latest_text).unwrap_or_default() }),
            },
            &latest_text,
        ));
    }

    None
}
