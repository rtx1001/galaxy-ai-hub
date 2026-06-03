use super::*;

pub(super) fn request_wants_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered) && vietnamese_create_image_term(&lowered) {
        return true;
    }
    let image_terms = [
        "image",
        "picture",
        "photo",
        "art",
        "drawing",
        "poster",
        "wallpaper",
        "ảnh",
        "hình",
    ];
    let create_terms = [
        "create", "generate", "draw", "paint", "make", "render", "tạo", "vẽ", "làm",
    ];
    contains_any_folded(&lowered, &normalized, &image_terms)
        && contains_any_folded(&lowered, &normalized, &create_terms)
}

pub(super) fn broad_image_generation_signal(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered) && vietnamese_create_image_term(&lowered) {
        return true;
    }
    let image_terms = [
        "image", "picture", "photo", "avatar", "portrait", "selfie", "img2img", "txt2img", "ảnh",
        "hình",
    ];
    let action_terms = [
        "create", "generate", "draw", "paint", "make", "render", "send", "edit", "change",
        "replace", "inpaint", "tạo", "vẽ", "làm", "gửi", "sửa", "đổi", "thay",
    ];
    contains_any_folded(&lowered, &normalized, &image_terms)
        && contains_any_folded(&lowered, &normalized, &action_terms)
}

pub(super) fn request_targets_assistant_self(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_any(
        &lowered,
        &[
            "của em",
            "ảnh em",
            "hình em",
            "chính em",
            "bản thân em",
            "em trong",
            "em đang",
            "gửi em",
        ],
    ) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "yourself",
            "your own",
            "your picture",
            "your photo",
            "your image",
            "of you",
            "assistant",
            "character",
            "avatar",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "của em",
            "ảnh em",
            "hình em",
            "chính em",
            "bản thân em",
            "em trong",
            "em đang",
            "gửi em",
        ],
    )
}

pub(super) fn request_wants_avatar_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if vietnamese_image_term(&lowered)
        && request_targets_assistant_self(text)
        && vietnamese_create_image_term(&lowered)
    {
        return true;
    }
    let has_image_target = contains_any(
        &normalized,
        &["image", "picture", "photo", "portrait", "selfie", "avatar"],
    ) || contains_any_folded(&lowered, &normalized, &["ảnh", "hình"]);
    if !has_image_target || !request_targets_assistant_self(text) {
        return false;
    }

    contains_any(
        &normalized,
        &[
            "send", "show", "create", "generate", "draw", "make", "render", "see", "view",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &["gửi", "cho xem", "xem", "tạo", "vẽ", "làm"],
    )
}

pub(super) fn request_targets_user_profile_image(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(
        &normalized,
        &[
            "my avatar",
            "my profile",
            "my photo",
            "my picture",
            "my image",
            "user avatar",
            "user profile",
            "profile avatar",
            "of me",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "ảnh anh",
            "hình anh",
            "ảnh của anh",
            "hình của anh",
            "avatar anh",
            "profile anh",
            "ảnh đại ca",
            "hình đại ca",
        ],
    )
}

pub(super) fn request_targets_user_and_character_images(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let has_pair = contains_any(
        &normalized,
        &[
            "both of us",
            "you and me",
            "me and you",
            "user and character",
            "my avatar and your avatar",
            "our avatars",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "anh và em",
            "anh voi em",
            "em và anh",
            "em voi anh",
            "hai đứa",
            "hai dua",
            "cả hai",
            "ca hai",
        ],
    );
    has_pair && (request_targets_user_profile_image(text) || request_targets_assistant_self(text))
}

pub(super) fn request_wants_user_avatar_image_generation(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let has_image_target = contains_any(
        &normalized,
        &["image", "picture", "photo", "portrait", "selfie", "avatar"],
    ) || contains_any_folded(&lowered, &normalized, &["ảnh", "hình"]);
    has_image_target && request_targets_user_profile_image(text)
}

pub(super) fn request_looks_like_image_edit_follow_up(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    if contains_any(
        &lowered,
        &[
            "sửa",
            "chỉnh",
            "đổi",
            "thay",
            "thêm",
            "xóa",
            "bỏ",
            "làm lại",
            "tạo lại",
            "gắn",
            "đội",
            "mặc",
        ],
    ) {
        return true;
    }
    contains_any(
        &normalized,
        &[
            "edit",
            "change",
            "replace",
            "add",
            "remove",
            "redo",
            "fix",
            "adjust",
            "inpaint",
            "try again",
            "make it",
            "put",
            "wearing",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "sửa",
            "chỉnh",
            "đổi",
            "thay",
            "thêm",
            "xóa",
            "bỏ",
            "làm lại",
            "tạo lại",
            "gắn",
            "đội",
            "mặc",
        ],
    )
}

pub(super) fn answer_claims_unverified_tool_result(
    answer: &str,
    task_state: &ConversationTaskState,
) -> bool {
    if !task_state.requires_tool() {
        return false;
    }

    let lowered = answer.to_lowercase();
    let normalized = normalize_text(answer);
    if answer_is_clarification_or_refusal(answer) {
        return false;
    }

    contains_any(
        &normalized,
        &[
            "i found",
            "i checked",
            "i searched",
            "i created",
            "i generated",
            "here is",
            "here are",
            "result",
            "forecast",
            "verified",
            "created the image",
            "generated the image",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "em đã",
            "đã tìm",
            "đã kiểm tra",
            "đã tạo",
            "sẽ tạo",
            "đang tạo",
            "tạo xong",
            "tìm thấy",
            "kết quả",
            "dưới đây",
            "xem thử",
            "dự báo",
        ],
    )
}

pub(super) fn answer_contains_file_or_media_artifact(answer: &str) -> bool {
    let normalized = normalize_text(answer);
    contains_any(
        &normalized,
        &[
            ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".mp4", ".mkv", ".avi", ".mov",
            ".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".txt", ".md", ".docx", ".xlsx",
            ":\\", "file preview", "path:", "title:", "type:", "size:",
        ],
    )
}

pub(super) fn answer_claims_verified_workspace_result(answer: &str) -> bool {
    if answer_is_clarification_or_refusal(answer) {
        return false;
    }
    answer_contains_file_or_media_artifact(answer)
}

pub(super) fn answer_is_clarification_or_refusal(answer: &str) -> bool {
    let lowered = answer.to_lowercase();
    let normalized = normalize_text(answer);
    contains_any(
        &normalized,
        &[
            "i cannot",
            "i can't",
            "i need",
            "please provide",
            "tell me",
            "which",
            "what location",
            "need more",
        ],
    ) || contains_any_folded(
        &lowered,
        &normalized,
        &[
            "em cần",
            "anh cho",
            "bạn cho",
            "không thể",
            "chưa thể",
            "cần thêm",
            "ở đâu",
            "khu vực nào",
        ],
    )
}

pub(super) fn protocol_retry_for_missing_tool(
    task_state: &ConversationTaskState,
) -> Option<&'static str> {
    if task_state.route.is_some() {
        return Some(
            "Protocol error: this user request requires a tool for live, local, or external data. Produce exactly one structured tool call, or ask a clarification. Do not claim that you checked, found, created, opened, or verified anything without a tool result.",
        );
    }
    if task_state.image_required {
        return Some(
            "Protocol error: this user request requires the image proposal tool. Produce exactly one propose_image_generation call, or ask a clarification only when a required visual detail is missing. Do not promise to create an image in normal text.",
        );
    }
    None
}

pub(super) fn route_label(route: ToolRoute) -> &'static str {
    match route {
        ToolRoute::MediaPreview => "workspace media preview",
        ToolRoute::Gmail => "Gmail",
        ToolRoute::Calendar => "calendar",
        ToolRoute::Weather => "weather",
        ToolRoute::FileSearch => "workspace file",
        ToolRoute::WebSearch => "web search",
        ToolRoute::GoogleWorkspace => "Google Workspace",
    }
}
