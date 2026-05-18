use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
}

fn clean_query(query: String) -> Result<String, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search text is required.".to_string());
    }
    if trimmed.len() > 500 {
        return Err("Search text is too long.".to_string());
    }
    Ok(trimmed.to_string())
}

fn clean_result_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace('\n', " ")
        .trim()
        .to_string()
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    html_unescape(&output)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let start_index = value.find(start)? + start.len();
    let rest = &value[start_index..];
    let end_index = rest.find(end)?;
    Some(&rest[..end_index])
}

fn extract_class_text(value: &str, class_name: &str) -> String {
    let class_index = match value.find(class_name) {
        Some(index) => index,
        None => return String::new(),
    };
    let rest = &value[class_index..];
    let tag_end = match rest.find('>') {
        Some(index) => index + 1,
        None => return String::new(),
    };
    let content = &rest[tag_end..];
    let end_index = content
        .find("</a>")
        .or_else(|| content.find("</div>"))
        .or_else(|| content.find("</span>"))
        .unwrap_or(content.len());
    strip_html_tags(&content[..end_index])
}

fn extract_anchor(value: &str, class_name: &str) -> Option<(String, String)> {
    let class_index = value.find(class_name)?;
    let before = &value[..class_index];
    let anchor_start = before.rfind("<a")?;
    let anchor = &value[anchor_start..];
    let tag_end = anchor.find('>')?;
    let opening_tag = &anchor[..tag_end];
    let href = find_between(opening_tag, "href=\"", "\"").unwrap_or_default();
    let content = &anchor[tag_end + 1..];
    let title_html = content.split("</a>").next().unwrap_or_default();
    let title = strip_html_tags(title_html);
    if title.is_empty() {
        return None;
    }
    Some((title, clean_duckduckgo_url(href)))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn clean_duckduckgo_url(href: &str) -> String {
    let href = html_unescape(href);
    if let Some(start) = href.find("uddg=") {
        let rest = &href[start + 5..];
        let encoded = rest.split('&').next().unwrap_or(rest);
        return percent_decode(encoded);
    }
    href
}

fn collect_duckduckgo_html(html: &str, query: &str, limit: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    for block in html.split("result__body").skip(1) {
        if results.len() >= limit {
            break;
        }

        let Some((title, url)) = extract_anchor(block, "result__a") else {
            continue;
        };
        let snippet = extract_class_text(block, "result__snippet");

        results.push(WebSearchResult {
            title,
            url,
            snippet,
            source: "DuckDuckGo".to_string(),
        });
    }

    if results.is_empty() && html.contains("result__a") {
        results.push(WebSearchResult {
            title: format!("Search results for {}", query),
            url: format!("https://duckduckgo.com/?q={}", query.replace(' ', "+")),
            snippet: "Open the search page for more results.".to_string(),
            source: "DuckDuckGo".to_string(),
        });
    }

    results
}

fn collect_duckduckgo_topic(topic: &Value, results: &mut Vec<WebSearchResult>, limit: usize) {
    if results.len() >= limit {
        return;
    }

    if let Some(topics) = topic.get("Topics").and_then(Value::as_array) {
        for child in topics {
            collect_duckduckgo_topic(child, results, limit);
            if results.len() >= limit {
                return;
            }
        }
        return;
    }

    let url = clean_result_text(topic, "FirstURL");
    let text = clean_result_text(topic, "Text");
    if url.is_empty() || text.is_empty() {
        return;
    }

    let title = text
        .split(" - ")
        .next()
        .unwrap_or(&text)
        .trim()
        .chars()
        .take(120)
        .collect::<String>();

    results.push(WebSearchResult {
        title,
        url,
        snippet: text,
        source: "DuckDuckGo".to_string(),
    });
}

async fn search_duckduckgo(query: &str, limit: usize) -> Result<Vec<WebSearchResult>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Could not prepare web search: {}", e))?;

    let body: Value = client
        .get("https://api.duckduckgo.com/")
        .query(&[
            ("q", query),
            ("format", "json"),
            ("no_html", "1"),
            ("skip_disambig", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("Web search failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Could not read web search results: {}", e))?;

    let mut results = Vec::new();
    let abstract_text = clean_result_text(&body, "AbstractText");
    let abstract_url = clean_result_text(&body, "AbstractURL");
    let heading = clean_result_text(&body, "Heading");
    if !abstract_text.is_empty() && !abstract_url.is_empty() {
        results.push(WebSearchResult {
            title: if heading.is_empty() {
                query.to_string()
            } else {
                heading
            },
            url: abstract_url,
            snippet: abstract_text,
            source: "DuckDuckGo".to_string(),
        });
    }

    if let Some(items) = body.get("Results").and_then(Value::as_array) {
        for item in items {
            collect_duckduckgo_topic(item, &mut results, limit);
        }
    }

    if let Some(items) = body.get("RelatedTopics").and_then(Value::as_array) {
        for item in items {
            collect_duckduckgo_topic(item, &mut results, limit);
            if results.len() >= limit {
                break;
            }
        }
    }

    results.truncate(limit);
    if results.len() >= limit {
        return Ok(results);
    }

    let html = client
        .get("https://html.duckduckgo.com/html/")
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 GalaxyAIHub/1.0")
        .query(&[("q", query)])
        .send()
        .await
        .map_err(|e| format!("Web search fallback failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Could not read web search fallback: {}", e))?;
    let mut html_results = collect_duckduckgo_html(&html, query, limit);
    results.append(&mut html_results);
    results.truncate(limit);
    Ok(results)
}

async fn search_tavily(
    query: &str,
    api_key: &str,
    limit: usize,
) -> Result<Vec<WebSearchResult>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not prepare Tavily search: {}", e))?;

    let body: Value = client
        .post("https://api.tavily.com/search")
        .json(&json!({
            "api_key": api_key,
            "query": query,
            "search_depth": "basic",
            "max_results": limit.clamp(1, 10),
            "include_answer": true,
            "include_raw_content": false
        }))
        .send()
        .await
        .map_err(|e| format!("Tavily search failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Could not read Tavily search results: {}", e))?;

    let mut results = Vec::new();
    if let Some(answer) = body.get("answer").and_then(Value::as_str) {
        if !answer.trim().is_empty() {
            results.push(WebSearchResult {
                title: "Tavily answer".to_string(),
                url: String::new(),
                snippet: answer.trim().to_string(),
                source: "Tavily".to_string(),
            });
        }
    }

    if let Some(items) = body.get("results").and_then(Value::as_array) {
        for item in items {
            let title = clean_result_text(item, "title");
            let url = clean_result_text(item, "url");
            let snippet = clean_result_text(item, "content");
            if !title.is_empty() || !snippet.is_empty() {
                results.push(WebSearchResult {
                    title: if title.is_empty() { url.clone() } else { title },
                    url,
                    snippet,
                    source: "Tavily".to_string(),
                });
            }
            if results.len() >= limit {
                break;
            }
        }
    }

    results.truncate(limit);
    Ok(results)
}

#[tauri::command]
pub async fn agent_web_search(
    query: String,
    tavily_api_key: Option<String>,
    max_results: Option<u32>,
) -> Result<Vec<WebSearchResult>, String> {
    let query = clean_query(query)?;
    let limit = max_results.unwrap_or(6).clamp(1, 10) as usize;
    let tavily_api_key = tavily_api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(api_key) = tavily_api_key {
        search_tavily(&query, &api_key, limit).await
    } else {
        search_duckduckgo(&query, limit).await
    }
}
