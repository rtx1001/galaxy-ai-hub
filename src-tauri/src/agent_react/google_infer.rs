use super::*;

pub(super) fn extract_google_id_from_marker(text: &str, marker: &str) -> Option<String> {
    text.split_whitespace().find_map(|raw| {
        let token = trim_inline_token(raw);
        let index = token.find(marker)?;
        let after = &token[index + marker.len()..];
        let id: String = after
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .collect();
        if id.is_empty() {
            None
        } else {
            Some(id)
        }
    })
}

pub(super) fn extract_google_doc_id(text: &str) -> Option<String> {
    extract_google_id_from_marker(text, "/document/d/")
}

pub(super) fn extract_google_sheet_id(text: &str) -> Option<String> {
    extract_google_id_from_marker(text, "/spreadsheets/d/")
}

pub(super) fn infer_google_drive_query(text: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let mut parts = text.split(quote);
        let _ = parts.next();
        if let Some(candidate) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(candidate.to_string());
        }
    }

    let stop_words = [
        "find",
        "search",
        "locate",
        "open",
        "read",
        "show",
        "inspect",
        "check",
        "list",
        "the",
        "a",
        "an",
        "my",
        "in",
        "on",
        "from",
        "google",
        "drive",
        "docs",
        "doc",
        "document",
        "sheets",
        "sheet",
        "spreadsheet",
        "workspace",
        "please",
        "giúp",
        "tìm",
        "kiếm",
        "mở",
        "đọc",
        "xem",
        "google",
        "drive",
        "tài",
        "liệu",
        "bảng",
        "tính",
        "trang",
        "tiếp",
        "cho",
        "anh",
        "em",
    ];
    let words: Vec<String> = text
        .split_whitespace()
        .map(trim_inline_token)
        .filter(|token| !token.is_empty())
        .filter(|token| {
            let folded = normalize_text(token);
            !stop_words.contains(&folded.as_str())
        })
        .map(|token| token.to_string())
        .collect();
    if words.is_empty() {
        None
    } else {
        Some(words.join(" "))
    }
}

pub(super) fn infer_google_contacts_query(text: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let mut parts = text.split(quote);
        let _ = parts.next();
        if let Some(candidate) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(candidate.to_string());
        }
    }

    let stop_words = [
        "find",
        "search",
        "lookup",
        "look",
        "up",
        "show",
        "list",
        "get",
        "read",
        "check",
        "the",
        "a",
        "an",
        "my",
        "in",
        "from",
        "google",
        "contacts",
        "contact",
        "people",
        "phonebook",
        "address",
        "book",
        "contactlist",
        "contact-list",
        "sổ",
        "danh",
        "bạ",
        "liên",
        "hệ",
        "danhbạ",
        "trong",
        "của",
        "với",
        "về",
        "kiếm",
        "tìm",
        "kiểmtra",
        "danhsách",
        "cho",
        "anh",
        "em",
    ];
    let words: Vec<String> = text
        .split_whitespace()
        .map(trim_inline_token)
        .filter(|token| !token.is_empty())
        .filter(|token| {
            let folded = normalize_text(token);
            !stop_words.contains(&folded.as_str())
        })
        .map(|token| token.to_string())
        .collect();
    if words.is_empty() {
        None
    } else {
        Some(words.join(" "))
    }
}
