// Notion beyond the card's polling (integrations.rs → poll_notion): a page
// opens in the Notion app when it is installed (its notion:// link), the card
// and the search bar search the workspace, and a page's text goes to the chat.
// Only what the integration's token can see, read-only.

use serde_json::{json, Value};

use crate::i18n::t;
use crate::probes::reg;
use crate::secrets;

const API: &str = "https://api.notion.com/v1";
const VERSION: &str = "2022-06-28";
/// A page's text for the chat: enough for a summary, never a whole wiki.
const MAX_CHARS: usize = 30_000;
const MAX_BLOCKS: usize = 400;

/// True when the Notion app registered its notion:// links (it does at install).
fn app_installed() -> bool {
    reg::Key::exists(reg::HKEY_CURRENT_USER, r"Software\Classes\notion")
        || reg::Key::exists(reg::HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\notion")
}

/// A notion.so link as the app's own link (same path), or None for any other site.
pub fn app_link(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    let notion = host == "notion.so" || host == "www.notion.so" || host.ends_with(".notion.site");
    if !notion || host.ends_with(".notion.site") {
        return None; // public sites (*.notion.site) stay in the browser
    }
    let path = rest.get(host.len()..).unwrap_or("");
    Some(format!("notion://www.notion.so{path}"))
}

/// The link to open: in the Notion app when it is there, the web link otherwise.
pub fn link_for(url: &str) -> Option<String> {
    app_link(url).filter(|_| app_installed())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .unwrap_or_default()
}

fn token() -> Result<String, String> {
    secrets::get("notion-api-key").ok_or_else(|| t("Notion non è configurato").to_string())
}

async fn call(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let r = req
        .header("Authorization", format!("Bearer {}", token()?))
        .header("Notion-Version", VERSION)
        .send()
        .await
        .map_err(|_| t("Notion non risponde").to_string())?;
    if !r.status().is_success() {
        return Err(match r.status().as_u16() {
            401 => t("Il token di Notion non è valido").to_string(),
            404 => t("La pagina non è condivisa con l'integrazione di Notion").to_string(),
            429 => t("Notion chiede di aspettare un momento").to_string(),
            code => format!("Notion: HTTP {code}"),
        });
    }
    r.json().await.map_err(|e| e.to_string())
}

/// Pages and databases whose title matches `query`, most recently edited first.
pub async fn search(query: &str, limit: usize) -> Result<Vec<Value>, String> {
    let body = json!({
        "query": query.trim(),
        "sort": { "direction": "descending", "timestamp": "last_edited_time" },
        "page_size": limit.clamp(1, 20),
    });
    let v = call(client().post(format!("{API}/search")).json(&body)).await?;
    Ok(v.get("results")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(crate::integrations::parse_notion_page).collect())
        .unwrap_or_default())
}

/// The text of a rich_text array.
fn plain(rich: Option<&Value>) -> String {
    rich.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|r| r.get("plain_text").and_then(Value::as_str)).collect())
        .unwrap_or_default()
}

/// One block as a line of text (markdown-ish), or None for what has no text.
fn block_line(b: &Value) -> Option<String> {
    let kind = b.get("type")?.as_str()?;
    let body = b.get(kind)?;
    let text = plain(body.get("rich_text"));
    let line = match kind {
        "heading_1" => format!("# {text}"),
        "heading_2" => format!("## {text}"),
        "heading_3" => format!("### {text}"),
        "bulleted_list_item" => format!("- {text}"),
        "numbered_list_item" => format!("1. {text}"),
        "to_do" => {
            let done = body.get("checked").and_then(Value::as_bool).unwrap_or(false);
            format!("- [{}] {text}", if done { "x" } else { " " })
        }
        "quote" | "callout" => format!("> {text}"),
        "code" => format!("```\n{text}\n```"),
        "paragraph" | "toggle" => text,
        "child_page" | "child_database" => format!("[{}]", body.get("title").and_then(Value::as_str).unwrap_or("")),
        "divider" => "---".into(),
        _ => return None,
    };
    Some(line)
}

/// A page's title and text (top-level blocks and one level below), for the chat.
pub async fn page_text(id: &str) -> Result<(String, String), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(t("Pagina di Notion non valida").into());
    }
    let page = call(client().get(format!("{API}/pages/{id}"))).await?;
    let title = crate::integrations::parse_notion_page(&page)
        .and_then(|p| p.get("title").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| t("Senza titolo").into());

    let mut lines: Vec<String> = Vec::new();
    let mut size = 0usize;
    let mut blocks = 0usize;
    let mut cursor: Option<String> = None;
    'pages: loop {
        let mut url = format!("{API}/blocks/{id}/children?page_size=100");
        if let Some(c) = &cursor {
            url.push_str(&format!("&start_cursor={c}"));
        }
        let v = call(client().get(url)).await?;
        for b in v.get("results").and_then(Value::as_array).into_iter().flatten() {
            blocks += 1;
            if let Some(line) = block_line(b) {
                size += line.len();
                lines.push(line);
            }
            // Toggles and list items keep their content one level down.
            if b.get("has_children").and_then(Value::as_bool) == Some(true)
                && !matches!(b.get("type").and_then(Value::as_str), Some("child_page" | "child_database"))
            {
                if let Some(child) = b.get("id").and_then(Value::as_str) {
                    if let Ok(inner) = call(client().get(format!("{API}/blocks/{child}/children?page_size=100"))).await {
                        for c in inner.get("results").and_then(Value::as_array).into_iter().flatten() {
                            blocks += 1;
                            if let Some(line) = block_line(c) {
                                size += line.len();
                                lines.push(format!("  {line}"));
                            }
                        }
                    }
                }
            }
            if size > MAX_CHARS || blocks > MAX_BLOCKS {
                lines.push(t("[…il resto della pagina è stato tagliato]").to_string());
                break 'pages;
            }
        }
        cursor = v.get("next_cursor").and_then(Value::as_str).map(String::from);
        if cursor.is_none() || v.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
    }
    let text = lines.join("\n");
    if text.trim().is_empty() {
        return Err(t("La pagina di Notion è vuota").into());
    }
    Ok((title, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notion_links_become_app_links() {
        assert_eq!(app_link("https://www.notion.so/Piano-abc123").as_deref(), Some("notion://www.notion.so/Piano-abc123"));
        assert_eq!(app_link("https://notion.so/team/Pagina-1?pvs=4").as_deref(), Some("notion://www.notion.so/team/Pagina-1?pvs=4"));
        assert_eq!(app_link("https://notion.so").as_deref(), Some("notion://www.notion.so"));
        assert_eq!(app_link("https://acme.notion.site/Pubblica-1"), None);
        assert_eq!(app_link("https://notion.so.evil.com/x"), None);
        assert_eq!(app_link("https://github.com"), None);
        assert_eq!(app_link("notion://www.notion.so/x"), None);
    }

    #[test]
    fn blocks_as_text() {
        let b = json!({ "type": "heading_2", "heading_2": { "rich_text": [{ "plain_text": "Obiettivi" }] } });
        assert_eq!(block_line(&b).as_deref(), Some("## Obiettivi"));
        let b = json!({ "type": "to_do", "to_do": { "checked": true, "rich_text": [{ "plain_text": "Fatto" }] } });
        assert_eq!(block_line(&b).as_deref(), Some("- [x] Fatto"));
        let b = json!({ "type": "image", "image": {} });
        assert_eq!(block_line(&b), None);
        assert_eq!(block_line(&json!({ "type": "paragraph" })), None);
    }
}
