use super::*;

pub(super) fn format_google_events(
    events: Vec<google_calendar::GoogleCalendarEvent>,
    user_text: &str,
) -> String {
    let vi = user_wants_vietnamese(user_text);
    if events.is_empty() {
        return if vi {
            "Không tìm thấy sự kiện nào trong khoảng thời gian này.".to_string()
        } else {
            "No calendar events found in that range.".to_string()
        };
    }
    let mut lines = vec![if vi {
        format!("### Tim thay {} su kien", events.len())
    } else {
        format!("### Found {} calendar events", events.len())
    }];
    lines.extend(events.into_iter().enumerate().map(|(index, event)| {
        format!(
            "**{}. {}**\n- Date/Time: {} -> {}\n- Location: {}\n- Details: {}",
            index + 1,
            event.title,
            event.start,
            event.end,
            event.location.unwrap_or_default(),
            event.description.unwrap_or_default()
        )
    }));
    lines.join("\n\n")
}

pub(super) fn format_gmail(
    messages: Vec<google_calendar::GoogleMailMessage>,
    user_text: &str,
) -> String {
    let vi = user_wants_vietnamese(user_text);
    if messages.is_empty() {
        return if vi {
            "Không tìm thấy email nào khớp yêu cầu.".to_string()
        } else {
            "No Gmail messages found.".to_string()
        };
    }
    let mut lines = vec![if vi {
        format!("### {} email gan day", messages.len())
    } else {
        format!("### Latest {} emails", messages.len())
    }];
    lines.extend(messages.into_iter().enumerate().map(|(index, message)| {
        format!(
            "**{}. {}**\n- From: {}\n- Date: {}\n- Preview: {}",
            index + 1,
            if message.subject.is_empty() {
                "(No subject)"
            } else {
                &message.subject
            },
            message.from,
            message.date,
            message.snippet
        )
    }));
    lines.push(if vi {
        "Muon mo email nao thi noi so thu tu.".to_string()
    } else {
        "Tell me the number if you want to inspect one email.".to_string()
    });
    lines.join("\n\n")
}

pub(super) fn simple_card(
    kind: &str,
    title: impl Into<String>,
    summary: Option<String>,
) -> ToolResultCard {
    ToolResultCard {
        kind: kind.to_string(),
        title: title.into(),
        summary,
        fields: Vec::new(),
        items: Vec::new(),
        text: None,
    }
}

#[allow(dead_code)]
pub(super) fn detail_value(item: &ToolResultItem, label: &str) -> String {
    item.details
        .iter()
        .find(|f| f.label.eq_ignore_ascii_case(label))
        .map(|f| f.value.clone())
        .unwrap_or_default()
}

pub(super) fn parse_card_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub(super) fn format_weather_day_label(value: &str, vi: bool) -> String {
    let Some(date) = parse_card_date(value) else {
        return value.to_string();
    };
    if vi {
        let weekday = match date.weekday().number_from_monday() {
            1 => "Th\u{1ee9} Hai",
            2 => "Th\u{1ee9} Ba",
            3 => "Th\u{1ee9} T\u{01b0}",
            4 => "Th\u{1ee9} N\u{0103}m",
            5 => "Th\u{1ee9} S\u{00e1}u",
            6 => "Th\u{1ee9} B\u{1ea3}y",
            _ => "Ch\u{1ee7} Nh\u{1ead}t",
        };
        format!("{} ({})", weekday, date.format("%d/%m"))
    } else {
        date.format("%a %Y-%m-%d").to_string()
    }
}
pub(super) fn user_asks_weather_rain(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["rain", "storm", "umbrella"])
        || contains_any_folded(
            &lowered,
            &normalized,
            &["m\u{01b0}a", "b\u{00e3}o", "c\u{00f3} m\u{01b0}a"],
        )
}
pub(super) fn user_asks_weather_weekend(text: &str) -> bool {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    contains_any(&normalized, &["weekend"])
        || contains_any_folded(&lowered, &normalized, &["cu\u{1ed1}i tu\u{1ea7}n"])
}
pub(super) fn weather_requested_focus_date(text: &str) -> Option<(NaiveDate, &'static str)> {
    let lowered = text.to_lowercase();
    let normalized = normalize_text(text);
    let today = Local::now().date_naive();

    if contains_any(&normalized, &["tomorrow"])
        || contains_any_folded(&lowered, &normalized, &["ng\u{00e0}y mai"])
    {
        return Some((today + Duration::days(1), "tomorrow"));
    }

    if contains_any(&normalized, &["today"])
        || contains_any_folded(&lowered, &normalized, &["h\u{00f4}m nay"])
    {
        return Some((today, "today"));
    }

    None
}

pub(super) fn select_weather_items<'a>(
    items: &'a [ToolResultItem],
    user_text: &str,
) -> Vec<&'a ToolResultItem> {
    if user_asks_weather_weekend(user_text) {
        let weekend = items
            .iter()
            .filter(|item| {
                parse_card_date(&detail_value(item, "Date"))
                    .map(|date| matches!(date.weekday().number_from_monday(), 6 | 7))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if !weekend.is_empty() {
            return weekend;
        }
    }
    items.iter().take(4).collect()
}

#[allow(dead_code)]
pub(super) fn request_wants_file_followup(user_text: &str) -> bool {
    let lower = user_text.to_ascii_lowercase();
    [
        "open",
        "play",
        "show",
        "preview",
        "view",
        "read",
        "summarize",
        "listen",
        "display",
    ]
    .iter()
    .any(|w| lower.contains(w))
}

#[allow(dead_code)]
pub(super) fn verified_answer_from_cards(
    cards: &[ToolResultCard],
    fallback: &str,
    user_text: &str,
) -> String {
    let Some(card) = cards.first() else {
        return fallback.to_string();
    };
    let vi = user_wants_vietnamese(user_text);
    let count = card.items.len();

    match card.kind.as_str() {
        "gmail" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy email nào khớp yêu cầu.".to_string()
                } else {
                    "No Gmail messages matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} email từ Gmail.", count)
            } else {
                format!("Verified {} Gmail messages.", count)
            };
            let rows = card
                .items
                .iter()
                .take(5)
                .enumerate()
                .map(|(index, item)| {
                    format!(
                        "{}. {}\nFrom: {}\nDate: {}\nPreview: {}",
                        index + 1,
                        item.title,
                        detail_value(item, "From"),
                        detail_value(item, "Date"),
                        detail_value(item, "Preview")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "calendar" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy sự kiện nào trong khoảng thời gian này.".to_string()
                } else {
                    "No calendar events matched that range.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} sự kiện từ Google Calendar.", count)
            } else {
                format!("Verified {} Google Calendar events.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let location = detail_value(item, "Location");
                    [
                        format!("{}. {}", index + 1, item.title),
                        format!("Start: {}", detail_value(item, "Start")),
                        format!("End: {}", detail_value(item, "End")),
                        if location.is_empty() {
                            String::new()
                        } else {
                            format!("Location: {}", location)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "weather" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy dữ liệu thời tiết phù hợp.".to_string()
                } else {
                    "No weather forecast data was found.".to_string()
                };
            }
            let location = card
                .fields
                .iter()
                .find(|field| field.label == "Location")
                .map(|field| field.value.clone())
                .unwrap_or_else(|| card.title.clone());
            let items = select_weather_items(&card.items, user_text);
            if user_asks_weather_rain(user_text) {
                let rainy = items
                    .iter()
                    .filter_map(|item| {
                        let rain_prob = detail_value(item, "Rain chance")
                            .trim_end_matches('%')
                            .parse::<u32>()
                            .ok()
                            .unwrap_or(0);
                        let rain_mm = detail_value(item, "Rain")
                            .trim_end_matches(" mm")
                            .parse::<f64>()
                            .ok()
                            .unwrap_or(0.0);
                        if rain_prob >= 35 || rain_mm >= 0.2 {
                            Some(format!(
                                "{}: {} chance, {}",
                                format_weather_day_label(&detail_value(item, "Date"), vi),
                                detail_value(item, "Rain chance"),
                                detail_value(item, "Rain")
                            ))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>();
                if vi {
                    if rainy.is_empty() {
                        return format!(
                            "Khả năng mưa ở {} khá thấp trong khoảng anh hỏi. Nếu có thì mưa nhẹ.",
                            location
                        );
                    }
                    return format!("Có khả năng mưa ở {}.\n\n{}", location, rainy.join("\n"));
                }
                if rainy.is_empty() {
                    return format!(
                        "Rain looks unlikely in {} for the period you asked about.",
                        location
                    );
                }
                return format!("Rain is possible in {}.\n\n{}", location, rainy.join("\n"));
            }

            let rows = items
                .iter()
                .map(|item| {
                    format!(
                        "{}: {}, {} / {}, rain {}, wind {}",
                        format_weather_day_label(&detail_value(item, "Date"), vi),
                        item.title,
                        detail_value(item, "High"),
                        detail_value(item, "Low"),
                        detail_value(item, "Rain chance"),
                        detail_value(item, "Wind")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            if vi {
                format!("Dự báo cho {}:\n\n{}", location, rows)
            } else {
                format!("Forecast for {}:\n\n{}", location, rows)
            }
        }
        "file_search" | "folder" | "media" => {
            if count == 0 {
                return if vi {
                    card.summary
                        .clone()
                        .map(|summary| {
                            format!("Không tìm thấy mục phù hợp trong workspace: {}", summary)
                        })
                        .unwrap_or_else(|| {
                            "Không tìm thấy mục phù hợp trong workspace.".to_string()
                        })
                } else {
                    card.summary
                        .clone()
                        .unwrap_or_else(|| "No matching workspace items found.".to_string())
                };
            }
            let heading = if request_wants_file_followup(user_text) && count > 1 {
                if vi {
                    format!(
                        "Em tìm thấy {} mục phù hợp. Anh chọn đúng tệp muốn mở/phát bằng tên hoặc đường dẫn nhé.",
                        count
                    )
                } else {
                    format!(
                        "I found {} matching items. Choose the exact file to open/play by name or path.",
                        count
                    )
                }
            } else if vi {
                format!("Đã xác minh {} mục trong workspace.", count)
            } else {
                format!("Verified {} workspace items.", count)
            };
            let rows = card
                .items
                .iter()
                .take(10)
                .enumerate()
                .map(|(index, item)| {
                    let path = detail_value(item, "Path");
                    let type_name = detail_value(item, "Type");
                    let size = detail_value(item, "Size");
                    [
                        format!("{}. {}", index + 1, item.title),
                        if type_name.is_empty() {
                            String::new()
                        } else {
                            format!("Type: {}", type_name)
                        },
                        if size.is_empty() {
                            String::new()
                        } else {
                            format!("Size: {}", size)
                        },
                        if path.is_empty() {
                            item.subtitle.clone().unwrap_or_default()
                        } else {
                            format!("Path: {}", path)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "web_search" => {
            if count == 0 {
                return if vi {
                    card.summary
                        .clone()
                        .map(|query| format!("Không tìm thấy kết quả web mới cho: {}", query))
                        .unwrap_or_else(|| "Không tìm thấy kết quả web mới.".to_string())
                } else {
                    card.summary
                        .clone()
                        .map(|query| format!("No fresh web results found for: {}", query))
                        .unwrap_or_else(|| "No fresh web results found.".to_string())
                };
            }
            let heading = if vi {
                format!("Tóm tắt nhanh từ {} nguồn web mới.", count)
            } else {
                format!("Quick summary from {} fresh web sources.", count)
            };
            let rows = card
                .items
                .iter()
                .take(5)
                .enumerate()
                .map(|(index, item)| {
                    let details = detail_value(item, "Details");
                    let body = if details.trim().is_empty() {
                        item.title.clone()
                    } else {
                        details
                    };
                    format!("{}. {}", index + 1, body)
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_drive" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy tệp Google Drive nào khớp yêu cầu.".to_string()
                } else {
                    "No Google Drive files matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} tệp từ Google Drive.", count)
            } else {
                format!("Verified {} Google Drive files.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let modified = detail_value(item, "Modified");
                    [
                        format!("{}. {}", index + 1, item.title),
                        item.subtitle
                            .clone()
                            .map(|value| format!("Type: {}", value))
                            .unwrap_or_default(),
                        if modified.is_empty() {
                            String::new()
                        } else {
                            format!("Modified: {}", modified)
                        },
                        format!("File ID: {}", detail_value(item, "File ID")),
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_contacts" => {
            if count == 0 {
                return if vi {
                    "Không tìm thấy liên hệ nào khớp trong danh bạ Google.".to_string()
                } else {
                    "No Google contacts matched.".to_string()
                };
            }
            let heading = if vi {
                format!("Đã xác minh {} liên hệ từ Google Contacts.", count)
            } else {
                format!("Verified {} Google contacts.", count)
            };
            let rows = card
                .items
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, item)| {
                    let email = detail_value(item, "Email");
                    let phone = detail_value(item, "Phone");
                    let org = detail_value(item, "Organization");
                    [
                        format!("{}. {}", index + 1, item.title),
                        if email.is_empty() {
                            String::new()
                        } else {
                            format!("Email: {}", email)
                        },
                        if phone.is_empty() {
                            String::new()
                        } else {
                            format!("Phone: {}", phone)
                        },
                        if org.is_empty() {
                            String::new()
                        } else {
                            format!("Organization: {}", org)
                        },
                    ]
                    .into_iter()
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!("{}\n\n{}", heading, rows)
        }
        "google_doc" | "google_sheet" => {
            let heading = if vi {
                "Đã xác minh dữ liệu từ Google Workspace.".to_string()
            } else {
                "Verified Google Workspace data.".to_string()
            };
            let mut lines = vec![format!("Title: {}", card.title)];
            for field in &card.fields {
                lines.push(format!("{}: {}", field.label, field.value));
            }
            for (index, item) in card.items.iter().take(6).enumerate() {
                let mut row = vec![format!("{}. {}", index + 1, item.title)];
                if let Some(subtitle) = &item.subtitle {
                    if !subtitle.is_empty() {
                        row.push(format!("Type: {}", subtitle));
                    }
                }
                for detail in &item.details {
                    row.push(format!("{}: {}", detail.label, detail.value));
                }
                lines.push(row.join("\n"));
            }
            format!("{}\n\n{}", heading, lines.join("\n\n"))
        }
        "time" => card.summary.clone().unwrap_or_else(|| fallback.to_string()),
        "error" => card.summary.clone().unwrap_or_else(|| fallback.to_string()),
        _ => card
            .summary
            .clone()
            .filter(|summary| !summary.trim().is_empty())
            .unwrap_or_else(|| fallback.to_string()),
    }
}

pub(super) fn files_card(
    kind: &str,
    title: impl Into<String>,
    summary: Option<String>,
    files: &[file_tools::FileSearchResult],
) -> ToolResultCard {
    ToolResultCard {
        kind: kind.to_string(),
        title: title.into(),
        summary,
        fields: Vec::new(),
        items: files
            .iter()
            .map(|file| ToolResultItem {
                title: file.name.clone(),
                subtitle: Some(file.path.clone()),
                details: vec![
                    ToolResultField {
                        label: "Type".to_string(),
                        value: file.extension.clone(),
                    },
                    ToolResultField {
                        label: "Size".to_string(),
                        value: format!("{} bytes", file.size_bytes),
                    },
                    ToolResultField {
                        label: "Folder".to_string(),
                        value: file.folder.clone(),
                    },
                    ToolResultField {
                        label: "Path".to_string(),
                        value: file.path.clone(),
                    },
                ],
                url: None,
            })
            .collect(),
        text: None,
    }
}

pub(super) fn gmail_card(messages: &[google_calendar::GoogleMailMessage]) -> ToolResultCard {
    ToolResultCard {
        kind: "gmail".to_string(),
        title: format!("{} Gmail messages", messages.len()),
        summary: Some("Verified from Gmail API".to_string()),
        fields: vec![ToolResultField {
            label: "Order".to_string(),
            value: "Newest first from Gmail".to_string(),
        }],
        items: messages
            .iter()
            .enumerate()
            .map(|(index, message)| ToolResultItem {
                title: format!(
                    "{}. {}",
                    index + 1,
                    if message.subject.is_empty() {
                        "(No subject)"
                    } else {
                        &message.subject
                    }
                ),
                subtitle: Some(message.from.clone()),
                details: vec![
                    ToolResultField {
                        label: "From".to_string(),
                        value: message.from.clone(),
                    },
                    ToolResultField {
                        label: "Date".to_string(),
                        value: message.date.clone(),
                    },
                    ToolResultField {
                        label: "Message ID".to_string(),
                        value: message.id.clone(),
                    },
                    ToolResultField {
                        label: "Thread ID".to_string(),
                        value: message.thread_id.clone(),
                    },
                    ToolResultField {
                        label: "Preview".to_string(),
                        value: message.snippet.clone(),
                    },
                ],
                url: Some(message.web_link.clone()),
            })
            .collect(),
        text: None,
    }
}

pub(super) fn calendar_card(events: &[google_calendar::GoogleCalendarEvent]) -> ToolResultCard {
    ToolResultCard {
        kind: "calendar".to_string(),
        title: format!("{} calendar events", events.len()),
        summary: Some("Verified from Google Calendar API".to_string()),
        fields: vec![ToolResultField {
            label: "Order".to_string(),
            value: "Start time ascending".to_string(),
        }],
        items: events
            .iter()
            .map(|event| ToolResultItem {
                title: event.title.clone(),
                subtitle: Some(format!("{} -> {}", event.start, event.end)),
                details: [
                    Some(ToolResultField {
                        label: "Start".to_string(),
                        value: event.start.clone(),
                    }),
                    Some(ToolResultField {
                        label: "End".to_string(),
                        value: event.end.clone(),
                    }),
                    Some(ToolResultField {
                        label: "All day".to_string(),
                        value: event.all_day.to_string(),
                    }),
                    Some(ToolResultField {
                        label: "Event ID".to_string(),
                        value: event.id.clone(),
                    }),
                    event.location.as_ref().map(|location| ToolResultField {
                        label: "Location".to_string(),
                        value: location.clone(),
                    }),
                    event
                        .description
                        .as_ref()
                        .map(|description| ToolResultField {
                            label: "Details".to_string(),
                            value: description.clone(),
                        }),
                ]
                .into_iter()
                .flatten()
                .collect(),
                url: event.html_link.clone(),
            })
            .collect(),
        text: None,
    }
}

pub(super) fn weather_card(forecast: &weather::WeatherForecast) -> ToolResultCard {
    let location = if forecast.location.country.is_empty() {
        forecast.location.name.clone()
    } else {
        format!("{}, {}", forecast.location.name, forecast.location.country)
    };
    ToolResultCard {
        kind: "weather".to_string(),
        title: format!("Weather forecast for {}", location),
        summary: Some("Verified from Open-Meteo".to_string()),
        fields: vec![
            ToolResultField {
                label: "Location".to_string(),
                value: location,
            },
            ToolResultField {
                label: "Timezone".to_string(),
                value: forecast.location.timezone.clone(),
            },
        ],
        items: forecast
            .days
            .iter()
            .map(|day| ToolResultItem {
                title: day.summary.clone(),
                subtitle: None,
                details: vec![
                    ToolResultField {
                        label: "Date".to_string(),
                        value: day.date.clone(),
                    },
                    ToolResultField {
                        label: "High".to_string(),
                        value: format!("{:.0}°C", day.temperature_max_c),
                    },
                    ToolResultField {
                        label: "Low".to_string(),
                        value: format!("{:.0}°C", day.temperature_min_c),
                    },
                    ToolResultField {
                        label: "Rain chance".to_string(),
                        value: day
                            .precipitation_probability_max
                            .map(|value| format!("{}%", value))
                            .unwrap_or_else(|| "n/a".to_string()),
                    },
                    ToolResultField {
                        label: "Rain".to_string(),
                        value: format!("{:.1} mm", day.precipitation_sum_mm),
                    },
                    ToolResultField {
                        label: "Wind".to_string(),
                        value: format!("{:.0} km/h", day.wind_speed_max_kmh),
                    },
                ],
                url: None,
            })
            .collect(),
        text: None,
    }
}

pub(super) fn json_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(super) fn google_drive_card(body: &Value) -> ToolResultCard {
    let files = body
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_drive".to_string(),
        title: format!("{} Google Drive files", files.len()),
        summary: Some("Verified from Google Drive".to_string()),
        fields: Vec::new(),
        items: files
            .iter()
            .map(|file| ToolResultItem {
                title: json_string(file.get("name")),
                subtitle: Some(json_string(file.get("mimeType"))),
                details: vec![
                    ToolResultField {
                        label: "File ID".to_string(),
                        value: json_string(file.get("id")),
                    },
                    ToolResultField {
                        label: "Modified".to_string(),
                        value: json_string(file.get("modifiedTime")),
                    },
                ]
                .into_iter()
                .filter(|field| !field.value.is_empty())
                .collect(),
                url: file
                    .get("webViewLink")
                    .and_then(Value::as_str)
                    .map(|v| v.to_string()),
            })
            .collect(),
        text: None,
    }
}

pub(super) fn google_contacts_card(body: &Value) -> ToolResultCard {
    let people = body
        .get("results")
        .and_then(Value::as_array)
        .map(|results| {
            results
                .iter()
                .filter_map(|entry| entry.get("person").cloned())
                .collect::<Vec<_>>()
        })
        .or_else(|| body.get("connections").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_contacts".to_string(),
        title: format!("{} Google contacts", people.len()),
        summary: Some("Verified from Google Contacts".to_string()),
        fields: Vec::new(),
        items: people
            .iter()
            .map(|person| {
                let primary_name = person
                    .get("names")
                    .and_then(Value::as_array)
                    .and_then(|names| names.first())
                    .and_then(|name| name.get("displayName"))
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed contact")
                    .to_string();
                let email = person
                    .get("emailAddresses")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let phone = person
                    .get("phoneNumbers")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("value"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let org = person
                    .get("organizations")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(|entry| entry.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                ToolResultItem {
                    title: primary_name,
                    subtitle: if email.is_empty() {
                        None
                    } else {
                        Some(email.clone())
                    },
                    details: vec![
                        ToolResultField {
                            label: "Email".to_string(),
                            value: email,
                        },
                        ToolResultField {
                            label: "Phone".to_string(),
                            value: phone,
                        },
                        ToolResultField {
                            label: "Organization".to_string(),
                            value: org,
                        },
                        ToolResultField {
                            label: "Resource Name".to_string(),
                            value: person
                                .get("resourceName")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        },
                    ]
                    .into_iter()
                    .filter(|field| !field.value.is_empty())
                    .collect(),
                    url: None,
                }
            })
            .collect(),
        text: None,
    }
}

pub(super) fn google_doc_card(body: &Value) -> ToolResultCard {
    let title = body
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Google Doc")
        .to_string();
    ToolResultCard {
        kind: "google_doc".to_string(),
        title,
        summary: Some("Verified from Google Docs".to_string()),
        fields: vec![
            ToolResultField {
                label: "Document ID".to_string(),
                value: json_string(body.get("documentId")),
            },
            ToolResultField {
                label: "Tabs".to_string(),
                value: body
                    .get("tabs")
                    .and_then(Value::as_array)
                    .map(|tabs| tabs.len().to_string())
                    .unwrap_or_default(),
            },
        ]
        .into_iter()
        .filter(|field| !field.value.is_empty())
        .collect(),
        items: Vec::new(),
        text: None,
    }
}

pub(super) fn google_sheet_card(body: &Value) -> ToolResultCard {
    if body.get("values").is_some() {
        let values = body
            .get("values")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return ToolResultCard {
            kind: "google_sheet".to_string(),
            title: json_string(body.get("range")),
            summary: Some("Verified from Google Sheets".to_string()),
            fields: vec![
                ToolResultField {
                    label: "Rows".to_string(),
                    value: values.len().to_string(),
                },
                ToolResultField {
                    label: "Major dimension".to_string(),
                    value: json_string(body.get("majorDimension")),
                },
            ],
            items: values
                .iter()
                .take(8)
                .enumerate()
                .map(|(index, row)| ToolResultItem {
                    title: format!("Row {}", index + 1),
                    subtitle: None,
                    details: vec![ToolResultField {
                        label: "Values".to_string(),
                        value: row
                            .as_array()
                            .map(|cols| {
                                cols.iter()
                                    .map(|col| col.as_str().unwrap_or_default().to_string())
                                    .collect::<Vec<_>>()
                                    .join(" | ")
                            })
                            .unwrap_or_default(),
                    }],
                    url: None,
                })
                .collect(),
            text: None,
        };
    }

    let sheets = body
        .get("sheets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    ToolResultCard {
        kind: "google_sheet".to_string(),
        title: body
            .get("properties")
            .and_then(|props| props.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Google Sheet")
            .to_string(),
        summary: Some("Verified from Google Sheets".to_string()),
        fields: vec![
            ToolResultField {
                label: "Spreadsheet ID".to_string(),
                value: json_string(body.get("spreadsheetId")),
            },
            ToolResultField {
                label: "Tabs".to_string(),
                value: sheets.len().to_string(),
            },
        ]
        .into_iter()
        .filter(|field| !field.value.is_empty())
        .collect(),
        items: sheets
            .iter()
            .map(|sheet| {
                let props = sheet.get("properties").unwrap_or(&Value::Null);
                ToolResultItem {
                    title: json_string(props.get("title")),
                    subtitle: Some(json_string(props.get("sheetType"))).filter(|v| !v.is_empty()),
                    details: vec![
                        ToolResultField {
                            label: "Sheet ID".to_string(),
                            value: props
                                .get("sheetId")
                                .and_then(Value::as_i64)
                                .map(|v| v.to_string())
                                .unwrap_or_default(),
                        },
                        ToolResultField {
                            label: "Index".to_string(),
                            value: props
                                .get("index")
                                .and_then(Value::as_i64)
                                .map(|v| v.to_string())
                                .unwrap_or_default(),
                        },
                    ]
                    .into_iter()
                    .filter(|field| !field.value.is_empty())
                    .collect(),
                    url: None,
                }
            })
            .collect(),
        text: None,
    }
}
