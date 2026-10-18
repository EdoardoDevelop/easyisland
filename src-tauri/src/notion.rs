// The Notion integration (integrations.rs → poll_notion calls `poll` here):
// - the user's tasks from the database chosen in the settings (`tasks`): not
//   done, soonest first; "fatto" ticks them off (`set_done`, one click);
// - "Nuova nota" (`add_note`): a paragraph at the end of the chosen page, or a
//   row in the chosen database;
// - the pages the user keeps in the card (settings only, nothing to fetch);
// - search (card and search bar) and a page's text for the chat;
// - a notion.so link opens in the Notion app when it is installed (notion://);
// - "+ Attività" and "Rimanda" from the card (`add_task`, `postpone`), the
//   databases that fit found by themselves (`suggest`);
// - notices (`alerts`): before a task with a time is due, and for a new
//   comment on a kept page or a task due today. Notion's own inbox (mentions,
//   reminders) is not in its API: these are what can be seen from here.
// Only what the integration's token can see. It never deletes anything.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

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
    let path = rest.get(host.len()..).unwrap_or("");
    match host.as_str() {
        "notion.so" | "www.notion.so" => Some(format!("notion://www.notion.so{path}")),
        // The links the API gives since 2026: app.notion.com/p/<title-id>.
        "app.notion.com" => Some(format!("notion://www.notion.so{}", path.strip_prefix("/p/").map_or(path.to_string(), |p| format!("/{p}")))),
        // Public sites (*.notion.site) and anything else stay in the browser.
        _ => None,
    }
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
            403 => t("L'integrazione di Notion non ha il permesso: nelle sue impostazioni su notion.so attiva leggere, aggiornare e inserire contenuti").to_string(),
            404 => t("La pagina non è condivisa con l'integrazione di Notion").to_string(),
            429 => t("Notion chiede di aspettare un momento").to_string(),
            code => format!("Notion: HTTP {code}"),
        });
    }
    r.json().await.map_err(|e| e.to_string())
}

/// Pages and databases whose title matches `query`, most recently edited
/// first; `kind` "page" or "database" keeps only those.
pub async fn search(query: &str, limit: usize, kind: Option<&str>) -> Result<Vec<Value>, String> {
    let mut body = json!({
        "query": query.trim(),
        "sort": { "direction": "descending", "timestamp": "last_edited_time" },
        "page_size": limit.clamp(1, 20),
    });
    if let Some(k @ ("page" | "database")) = kind {
        body["filter"] = json!({ "property": "object", "value": k });
    }
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

/// A page's blocks (top-level and nested) for rendering and editing.
/// Returns the raw block structure from the Notion API, limited to a reasonable depth.
pub async fn page_blocks(id: &str) -> Result<Value, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(t("Pagina di Notion non valida").into());
    }
    // Fetch the page to verify it exists and get its type (optional)
    let _page = call(client().get(format!("{API}/pages/{id}"))).await?;
    // Fetch top-level blocks (depth 0)
    let mut top_blocks = Vec::new();
    let top_resp = call(client().get(format!("{API}/blocks/{id}/children?page_size=100"))).await?;
    if let Some(arr) = top_resp.get("results").and_then(Value::as_array) {
        for b in arr {
            let mut block = b.clone();
            let has_children = b.get("has_children").and_then(Value::as_bool).unwrap_or(false);
            let block_type = b.get("type").and_then(Value::as_str).unwrap_or("");
            if has_children && block_type != "child_page" && block_type != "child_database" {
                if let Some(child_id) = b.get("id").and_then(Value::as_str) {
                    // Fetch children (depth 1)
                    let child_resp = call(client().get(format!("{API}/blocks/{child_id}/children?page_size=100"))).await?;
                    if let Some(child_arr) = child_resp.get("results").and_then(Value::as_array) {
                        block["children"] = Value::Array(child_arr.clone());
                    }
                }
            }
            top_blocks.push(block);
        }
    }
    Ok(Value::Array(top_blocks))
}

/// Update the text content of a block that supports rich_text.
pub async fn update_block_text(block_id: &str, text: &str) -> Result<(), String> {
    check_id(block_id)?;
    let block = call(client().get(format!("{API}/blocks/{block_id}"))).await?;
    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
    // Only update if the block has a rich_text field (we'll check for a few types that we know)
    // We'll try to update the rich_text for the block type if it exists.
    let mut payload = serde_json::Map::new();
    match block_type {
        "paragraph" | "heading_1" | "heading_2" | "heading_3" | "bulleted_list_item" | "numbered_list_item" | "quote" | "callout" | "to_do" => {
            let rich_text = rich(text);
            payload.insert(block_type.to_string(), json!({ "rich_text": rich_text }));
        }
        _ => {
            return Err(t("Tipo di blocco non supportato per la modifica del testo").into());
        }
    }
    call(client().patch(format!("{API}/blocks/{block_id}")).json(&payload)).await?;
    Ok(())
}

/// Delete a block.
pub async fn delete_block(block_id: &str) -> Result<(), String> {
    check_id(block_id)?;
    call(client().delete(format!("{API}/blocks/{block_id}"))).await?;
    Ok(())
}

/// Create a list of blocks as children of a parent block or page.
pub async fn create_blocks(parent_id: &str, blocks: Vec<Value>) -> Result<(), String> {
    check_id(parent_id)?;
    // Notion API expects { "children": [ ... ] }
    let payload = json!({ "children": blocks });
    call(client().patch(format!("{API}/blocks/{parent_id}/children")).json(&payload)).await?;
    Ok(())
}

/// Tauri command: get the blocks of a Notion page.
#[tauri::command]
pub async fn notion_page_blocks(id: String) -> Result<Value, String> {
    page_blocks(&id).await
}

/// Tauri command: update the text of a Notion block.
#[tauri::command]
pub async fn notion_update_block_text(block_id: String, text: String) -> Result<(), String> {
    update_block_text(&block_id, &text).await
}

/// Tauri command: delete a Notion block.
#[tauri::command]
pub async fn notion_delete_block(block_id: String) -> Result<(), String> {
    delete_block(&block_id).await
}

/// Tauri command: create blocks under a parent block or page.
#[tauri::command]
pub async fn notion_create_blocks(parent_id: String, blocks: Value) -> Result<(), String> {
    // Expect blocks to be an array of block objects
    let blocks_vec = blocks.as_array().ok_or_else(|| t("Expected an array of blocks").to_string())?;
    create_blocks(&parent_id, blocks_vec.clone()).await
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

/// How "done" is written in a tasks database.
#[derive(Clone, Debug, PartialEq)]
enum Done {
    /// A checkbox ("Fatto", "Done"…).
    Checkbox(String),
    /// A status: the options of its "complete" group, the first one set by "fatto".
    Status { prop: String, done: Vec<String> },
    /// Nothing to tick: the tasks are listed, not ticked off.
    None,
}

/// What EasyIsland needs of a database: its title, due date and done properties.
#[derive(Clone, Debug, PartialEq)]
struct Schema {
    title: String,
    date: Option<String>,
    done: Done,
    /// A "Priorità" select, for sorting a view by it and the dot in the card.
    priority: Option<String>,
}

static SCHEMAS: Mutex<Option<HashMap<String, Schema>>> = Mutex::new(None);

/// The property whose name best matches `words`, among those of `kind`.
fn pick(props: &serde_json::Map<String, Value>, kind: &str, words: &[&str]) -> Option<String> {
    let mut of_kind: Vec<&String> = props
        .iter()
        .filter(|(_, p)| p.get("type").and_then(Value::as_str) == Some(kind))
        .map(|(n, _)| n)
        .collect();
    of_kind.sort();
    of_kind
        .iter()
        .find(|n| {
            let l = n.to_lowercase();
            words.iter().any(|w| l.contains(w))
        })
        .or_else(|| of_kind.first())
        .map(|n| n.to_string())
}

fn schema_of(db: &Value) -> Option<Schema> {
    let props = db.get("properties")?.as_object()?;
    let title = props.iter().find(|(_, p)| p.get("type").and_then(Value::as_str) == Some("title"))?.0.clone();
    let date = pick(props, "date", &["scad", "due", "deadline", "data", "date", "quando", "entro"]);
    let done = if let Some(prop) = pick(props, "status", &["stato", "status"]) {
        let status = props.get(&prop).and_then(|p| p.get("status"));
        let options: Vec<(String, String)> = status
            .and_then(|s| s.get("options")?.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|o| Some((o.get("id")?.as_str()?.to_string(), o.get("name")?.as_str()?.to_string())))
            .collect();
        let groups = status.and_then(|s| s.get("groups")?.as_array().cloned()).unwrap_or_default();
        // The "Complete" group (any language), else the last one.
        let complete = groups
            .iter()
            .find(|g| {
                let n = g.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase();
                ["complete", "completat", "done", "fatto", "chius", "termin"].iter().any(|w| n.contains(w))
            })
            .or_else(|| groups.last());
        let ids: Vec<String> = complete
            .and_then(|g| g.get("option_ids")?.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        let done: Vec<String> = options.iter().filter(|(id, _)| ids.contains(id)).map(|(_, n)| n.clone()).collect();
        if done.is_empty() { Done::None } else { Done::Status { prop, done } }
    } else if let Some(prop) = pick(props, "checkbox", &["fatt", "done", "complet", "chius", "termin"]) {
        Done::Checkbox(prop)
    } else {
        Done::None
    };
    let priority = props
        .iter()
        .filter(|(_, p)| p.get("type").and_then(Value::as_str) == Some("select"))
        .map(|(n, _)| n)
        .find(|n| { let l = n.to_lowercase(); l.contains("priorit") || l.contains("urgen") })
        .cloned();
    Some(Schema { title, date, done, priority })
}

async fn schema(db: &str) -> Result<Schema, String> {
    if let Some(s) = SCHEMAS.lock().ok().and_then(|m| m.as_ref()?.get(db).cloned()) {
        return Ok(s);
    }
    let v = call(client().get(format!("{API}/databases/{db}"))).await?;
    let s = schema_of(&v).ok_or_else(|| t("Il database di Notion non ha un titolo").to_string())?;
    if let Ok(mut m) = SCHEMAS.lock() {
        m.get_or_insert_with(HashMap::new).insert(db.to_string(), s.clone());
    }
    Ok(s)
}

/// The query's filter: not done.
fn not_done_filter(done: &Done) -> Option<Value> {
    match done {
        Done::Checkbox(p) => Some(json!({ "property": p, "checkbox": { "equals": false } })),
        Done::Status { prop, done } => {
            let and: Vec<Value> = done.iter().map(|d| json!({ "property": prop, "status": { "does_not_equal": d } })).collect();
            Some(json!({ "and": and }))
        }
        Done::None => None,
    }
}

/// A task for the card.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: String,
    title: String,
    url: String,
    /// "2026-10-14" or "2026-10-14T15:00:00.000+02:00"; None without a date.
    due: Option<String>,
    /// The database lets EasyIsland tick it off.
    can_tick: bool,
    /// Its priority option and that option's color in Notion ("red"…).
    priority: Option<(String, String)>,
}

/// "YYYY-MM-DD" of a day count since 1970-01-01.
fn iso(days: i64) -> String {
    let (y, m, d) = crate::calendar::civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Today, as days since 1970-01-01, on this PC's clock.
fn today() -> i64 {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    crate::widgets::days_from_civil(t.wYear as i64, t.wMonth as i64, t.wDay as i64)
}

/// The last day a view's period covers (None = no limit).
fn period_end(period: &str, days: u32, today: i64) -> Option<i64> {
    match period {
        "today" => Some(today),
        // To Sunday (weekday: 0 = Monday).
        "week" => Some(today + 6 - crate::calendar::weekday(today)),
        "month" => {
            let (y, m, _) = crate::calendar::civil_from_days(today);
            let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
            Some(crate::widgets::days_from_civil(ny, nm, 1) - 1)
        }
        "days" => Some(today + days.clamp(1, 366) as i64 - 1),
        _ => None,
    }
}

/// One value of a filter, as Notion's query wants it.
fn value_filter(f: &crate::settings::NotionFilter, v: &str) -> Option<Value> {
    Some(match f.kind.as_str() {
        "select" => json!({ "property": f.prop, "select": { "equals": v } }),
        "multi_select" => json!({ "property": f.prop, "multi_select": { "contains": v } }),
        "status" => json!({ "property": f.prop, "status": { "equals": v } }),
        "relation" => json!({ "property": f.prop, "relation": { "contains": v } }),
        _ => return None,
    })
}

/// The query's filter for a view: not done, within its period (late ones
/// always in, undated if it says so), and for each property any of its values.
fn view_filter(s: &Schema, view: Option<&crate::settings::NotionView>, today: i64) -> Option<Value> {
    let mut and: Vec<Value> = Vec::new();
    if let Some(f) = not_done_filter(&s.done) {
        and.push(f);
    }
    if let (Some(v), Some(date)) = (view, &s.date) {
        if let Some(end) = period_end(&v.period, v.days, today) {
            let within = json!({ "property": date, "date": { "on_or_before": iso(end) } });
            and.push(if v.undated {
                json!({ "or": [within, { "property": date, "date": { "is_empty": true } }] })
            } else {
                within
            });
        } else if !v.undated {
            and.push(json!({ "property": date, "date": { "is_not_empty": true } }));
        }
    }
    for f in view.map(|v| v.filters.as_slice()).unwrap_or_default() {
        let any: Vec<Value> = f.values.iter().filter_map(|v| value_filter(f, v)).collect();
        match any.len() {
            0 => {}
            1 => and.extend(any),
            _ => and.push(json!({ "or": any })),
        }
    }
    match and.len() {
        0 => None,
        1 => and.pop(),
        _ => Some(json!({ "and": and })),
    }
}

/// The tasks of a view (None = all not done), soonest due first, then those
/// without a date; or by priority, when the view says so.
pub async fn tasks(db: &str, view: Option<&crate::settings::NotionView>) -> Result<Vec<Task>, String> {
    let s = schema(db).await?;
    let mut body = json!({ "page_size": 40 });
    if let Some(f) = view_filter(&s, view, today()) {
        body["filter"] = f;
    }
    let by_priority = view.is_some_and(|v| v.sort == "priority") && s.priority.is_some();
    let mut sorts: Vec<Value> = Vec::new();
    if let (true, Some(p)) = (by_priority, &s.priority) {
        // Notion sorts a select by the order of its options (Alta, Media, Bassa).
        sorts.push(json!({ "property": p, "direction": "ascending" }));
    }
    if let Some(d) = &s.date {
        sorts.push(json!({ "property": d, "direction": "ascending" }));
    }
    if !sorts.is_empty() {
        body["sorts"] = Value::Array(sorts);
    }
    let v = call(client().post(format!("{API}/databases/{db}/query")).json(&body)).await?;
    let mut out: Vec<Task> = v
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let props = p.get("properties")?;
            let title = plain(props.get(&s.title).and_then(|t| t.get("title")));
            let due = s
                .date
                .as_ref()
                .and_then(|d| props.get(d)?.get("date")?.get("start")?.as_str().map(String::from));
            let priority = s.priority.as_ref().and_then(|k| {
                let sel = props.get(k)?.get("select")?;
                Some((sel.get("name")?.as_str()?.to_string(), sel.get("color").and_then(Value::as_str).unwrap_or("default").to_string()))
            });
            Some(Task {
                id: p.get("id")?.as_str()?.to_string(),
                title: if title.trim().is_empty() { t("Senza titolo").to_string() } else { title },
                url: p.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
                due,
                can_tick: s.done != Done::None,
                priority,
            })
        })
        .collect();
    if by_priority {
        // Already in Notion's order; empty priorities stay where Notion put them.
        return Ok(out);
    }
    // Notion puts the empty dates first when sorting ascending: those go last.
    out.sort_by(|a, b| match (&a.due, &b.due) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    Ok(out)
}

/// A property a view can filter by, with the values to pick from.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    name: String,
    kind: String,
    /// (value, label): option names, or a related database's pages (id, title).
    options: Vec<(String, String)>,
}

/// Impostazioni → Notion → Viste: the properties of the tasks database that a
/// view can filter by — selects, multi-selects, the status and relations (the
/// first 100 pages of the related database).
pub async fn properties(db: &str) -> Result<Vec<Property>, String> {
    check_id(db)?;
    let v = call(client().get(format!("{API}/databases/{db}"))).await?;
    let mut out = Vec::new();
    let mut props: Vec<(&String, &Value)> = v.get("properties").and_then(Value::as_object).into_iter().flatten().collect();
    props.sort_by_key(|(n, _)| n.to_lowercase());
    for (name, p) in props {
        let kind = p.get("type").and_then(Value::as_str).unwrap_or_default();
        let options: Vec<(String, String)> = match kind {
            "select" | "multi_select" | "status" => p
                .get(kind)
                .and_then(|k| k.get("options"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|o| o.get("name").and_then(Value::as_str).map(|n| (n.to_string(), n.to_string())))
                .collect(),
            "relation" => {
                let Some(other) = p.pointer("/relation/database_id").and_then(Value::as_str) else { continue };
                // A related database the integration cannot see: left out.
                let Ok(s) = schema(other).await else { continue };
                let Ok(rows) = call(client().post(format!("{API}/databases/{other}/query")).json(&json!({ "page_size": 100 }))).await else { continue };
                let mut list: Vec<(String, String)> = rows
                    .get("results")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|r| {
                        let title = plain(r.get("properties")?.get(&s.title)?.get("title"));
                        Some((r.get("id")?.as_str()?.to_string(), if title.trim().is_empty() { t("Senza titolo").to_string() } else { title }))
                    })
                    .collect();
                list.sort_by_key(|(_, l)| l.to_lowercase());
                list
            }
            _ => continue,
        };
        if !options.is_empty() {
            out.push(Property { name: name.clone(), kind: kind.to_string(), options });
        }
    }
    Ok(out)
}

/// "Fatto" on a task: its checkbox ticked, or its status set to the first "complete" one.
pub async fn set_done(db: &str, page: &str) -> Result<(), String> {
    check_id(page)?;
    let s = schema(db).await?;
    let props = match &s.done {
        Done::Checkbox(p) => one(p, json!({ "checkbox": true })),
        Done::Status { prop, done } => one(prop, json!({ "status": { "name": done.first().cloned().unwrap_or_default() } })),
        Done::None => return Err(t("Questo database non ha una casella o uno stato «fatto»").into()),
    };
    call(client().patch(format!("{API}/pages/{page}")).json(&json!({ "properties": props }))).await?;
    Ok(())
}

/// `{ key: value }` with a key known only at run time.
fn one(key: &str, value: Value) -> Value {
    let mut m = serde_json::Map::new();
    m.insert(key.to_string(), value);
    Value::Object(m)
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(t("Pagina di Notion non valida").into());
    }
    Ok(())
}

// ── Notes ─────────────────────────────────────────────────────────────────────

/// Text as rich_text pieces of at most 2000 characters (Notion's limit).
fn rich(text: &str) -> Vec<Value> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(2000)
        .map(|c| json!({ "type": "text", "text": { "content": c.iter().collect::<String>() } }))
        .collect()
}

/// One paragraph block per line (empty lines dropped), at most 90.
fn paragraphs(text: &str) -> Vec<Value> {
    text.lines()
        .map(str::trim_end)
        .filter(|l| !l.trim().is_empty())
        .take(90)
        .map(|l| json!({ "object": "block", "type": "paragraph", "paragraph": { "rich_text": rich(l) } }))
        .collect()
}

/// "Nuova nota": in a database, a row titled with the first line (the rest
/// inside); in a page, the text appended at the end, after the date and time.
pub async fn add_note(target_id: &str, database: bool, text: &str, stamp: &str) -> Result<(), String> {
    check_id(target_id)?;
    let text = text.trim();
    if text.is_empty() {
        return Err(t("Scrivi qualcosa").into());
    }
    if database {
        let s = schema(target_id).await?;
        let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
        let title: String = first.chars().take(200).collect();
        let body = json!({
            "parent": { "database_id": target_id },
            "properties": one(&s.title, json!({ "title": rich(&title) })),
            "children": paragraphs(rest),
        });
        call(client().post(format!("{API}/pages")).json(&body)).await?;
    } else {
        let mut blocks = vec![json!({ "object": "block", "type": "paragraph", "paragraph": { "rich_text": [
            { "type": "text", "text": { "content": stamp }, "annotations": { "bold": true, "color": "gray" } }
        ] } })];
        blocks.extend(paragraphs(text));
        call(client().patch(format!("{API}/blocks/{target_id}/children")).json(&json!({ "children": blocks }))).await?;
    }
    Ok(())
}

// ── Polling ───────────────────────────────────────────────────────────────────

/// Every 5 minutes (and on "Aggiorna"): the tasks, or with no tasks database
/// just a check that the token works. The card's pages come from the settings.
pub async fn poll(app: AppHandle) {
    if secrets::get("notion-api-key").is_none() {
        return;
    }
    let Some(cfg) = app.try_state::<crate::Shared>().and_then(|s| s.settings.lock().ok().map(|g| g.integration_config.clone())) else {
        return;
    };
    let tasks_db = cfg.notion_tasks.as_ref().map(|r| r.id.clone());
    let views = cfg.notion_views.clone();
    let (data, error) = match tasks_db.clone() {
        // Every view at once (at most 6), so the card switches without waiting.
        Some(db) if !views.is_empty() => {
            let mut by_view = serde_json::Map::new();
            let mut failed: Option<String> = None;
            for v in views.iter().take(6) {
                match tasks(&db, Some(v)).await {
                    Ok(list) => { by_view.insert(v.name.clone(), json!(list)); }
                    Err(e) => { failed.get_or_insert(e); }
                }
            }
            let mut data = json!({ "tasks": [], "tasksSet": true, "byView": by_view });
            if let Some(e) = failed {
                data["tasksError"] = json!(e);
            }
            (data, None)
        }
        Some(db) => match tasks(&db, None).await {
            Ok(list) => (json!({ "tasks": list, "tasksSet": true }), None),
            // The card still works without them: the error goes on the tasks only.
            Err(e) => (json!({ "tasks": [], "tasksSet": true, "tasksError": e }), None),
        },
        None => match call(client().get(format!("{API}/users/me"))).await {
            Ok(_) => (json!({ "tasks": [], "tasksSet": false }), None),
            Err(e) => (json!({}), Some(e)),
        },
    };
    let mut data = data;
    // Due today (and late), whatever the views: the morning recap and the notices.
    let today_list = match &tasks_db {
        Some(db) if error.is_none() => {
            let v = crate::settings::NotionView { name: String::new(), period: "today".into(), undated: false, ..Default::default() };
            tasks(db, Some(&v)).await.unwrap_or_default()
        }
        _ => Vec::new(),
    };
    if !data.is_null() && error.is_none() {
        data["today"] = json!(today_list);
    }
    crate::integrations::emit(&app, crate::integrations::IntegrationUpdate {
        id: "integration_notion",
        data,
        error,
        event: None,
    });
    if cfg.notion_alert_due {
        due_alerts(&app, &today_list, cfg.notion_alert_lead);
    }
    if cfg.notion_alert_comments {
        let mut watch: Vec<(String, String, String)> = cfg
            .notion_pins
            .iter()
            .filter(|p| !p.database)
            .map(|p| (p.id.clone(), p.title.clone(), p.url.clone()))
            .collect();
        watch.extend(today_list.iter().take(10).map(|x| (x.id.clone(), x.title.clone(), x.url.clone())));
        comment_alerts(&app, &watch).await;
    }
}

// ── Notices ───────────────────────────────────────────────────────────────────

/// A notice in the island, as `easyisland-hook notify` gives one; a click
/// opens `url` (in the Notion app). The island applies the user's notification rules.
fn notice(app: &AppHandle, title: &str, text: &str, url: &str) {
    use tauri::Emitter;
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "hook", json!({
        "hook_event_name": "EasyIslandNotify",
        "title": cut(title, 120),
        "text": cut(text, 600),
        "level": "warn",
        "url": url,
    }));
}

/// Seconds since 1970 (UTC) of a Notion date with a time; None for a day only.
/// Without an offset (a date with a time zone of its own) the PC's is assumed.
fn epoch_of(due: &str, local_offset: i64) -> Option<i64> {
    let (date, time) = due.split_once('T')?;
    let y: i64 = date.get(0..4)?.parse().ok()?;
    let m: i64 = date.get(5..7)?.parse().ok()?;
    let d: i64 = date.get(8..10)?.parse().ok()?;
    let hh: i64 = time.get(0..2)?.parse().ok()?;
    let mm: i64 = time.get(3..5)?.parse().ok()?;
    let offset = if time.ends_with('Z') {
        0
    } else if let Some(at) = time.rfind(['+', '-']).filter(|&i| i >= 5) {
        let sign = if time.get(at..at + 1) == Some("-") { -1 } else { 1 };
        let oh: i64 = time.get(at + 1..at + 3)?.parse().ok()?;
        let om: i64 = time.get(at + 4..at + 6).and_then(|x| x.parse().ok()).unwrap_or(0);
        sign * (oh * 3600 + om * 60)
    } else {
        local_offset
    };
    Some(crate::widgets::days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 - offset)
}

fn now_utc() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// The PC's offset from UTC, in seconds (to the quarter hour).
fn local_offset() -> i64 {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let local = crate::widgets::days_from_civil(t.wYear as i64, t.wMonth as i64, t.wDay as i64) * 86_400
        + t.wHour as i64 * 3600 + t.wMinute as i64 * 60 + t.wSecond as i64;
    ((local - now_utc()) as f64 / 900.0).round() as i64 * 900
}

/// Tasks already announced (id and due), so a poll never repeats one.
static ALERTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// What to do about a task with a time, `now` and the lead in seconds:
/// announce it now, in so many seconds (before the next poll), or not yet.
#[derive(Debug, PartialEq)]
enum When {
    Now,
    In(i64),
    Later,
}

fn when_to_alert(due: i64, now: i64, lead: i64) -> When {
    let at = due - lead;
    if now >= at {
        // Late by more than an hour: the card shows it, no notice.
        if now - due > 3600 { When::Later } else { When::Now }
    } else if at - now <= 330 {
        When::In(at - now)
    } else {
        When::Later
    }
}

/// "Tra 10 minuti: Chiamare Rossi" (or "Adesso", "Scaduta da 20 minuti").
fn due_title(title: &str, due: i64, now: i64) -> String {
    let min = (due - now) as f64 / 60.0;
    let min = min.round() as i64;
    if min >= 1 {
        crate::i18n::tf("Tra {n} min: {title}", &[("n", &min), ("title", &title)])
    } else if min > -2 {
        crate::i18n::tf("Adesso: {title}", &[("title", &title)])
    } else {
        crate::i18n::tf("Scaduta da {n} min: {title}", &[("n", &-min), ("title", &title)])
    }
}

fn due_alerts(app: &AppHandle, list: &[Task], lead_min: u32) {
    let now = now_utc();
    let offset = local_offset();
    let lead = lead_min.min(24 * 60) as i64 * 60;
    for x in list {
        let Some(due) = x.due.as_deref().and_then(|d| epoch_of(d, offset)) else { continue };
        let key = format!("{}|{}", x.id, x.due.as_deref().unwrap_or(""));
        let delay = match when_to_alert(due, now, lead) {
            When::Now => 0,
            When::In(s) => s,
            When::Later => continue,
        };
        {
            let Ok(mut g) = ALERTED.lock() else { continue };
            if !g.get_or_insert_with(HashSet::new).insert(key) {
                continue;
            }
        }
        let (app, title, url) = (app.clone(), x.title.clone(), x.url.clone());
        let at = x.due.clone().unwrap_or_default();
        tauri::async_runtime::spawn(async move {
            if delay > 0 {
                tokio::time::sleep(std::time::Duration::from_secs(delay as u64)).await;
            }
            let hhmm = at.split_once('T').and_then(|(_, t)| t.get(0..5)).unwrap_or("");
            notice(&app, &due_title(&title, due, now_utc()), &crate::i18n::tf("Attività di Notion, alle {time}", &[("time", &hhmm)]), &url);
        });
    }
}

/// The newest comment seen on each watched page (its time), since the app started.
static SEEN_COMMENTS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// New comments since the last poll on the kept pages and today's tasks. The
/// first look at a page only notes where it is: no notice for old comments.
async fn comment_alerts(app: &AppHandle, pages: &[(String, String, String)]) {
    let mut shown = 0;
    for (id, title, url) in pages {
        let Ok(v) = call(client().get(format!("{API}/comments?block_id={id}&page_size=100"))).await else { continue };
        let comments: Vec<&Value> = v.get("results").and_then(Value::as_array).into_iter().flatten().collect();
        let newest = comments.iter().filter_map(|c| c.get("created_time").and_then(Value::as_str)).max().unwrap_or("").to_string();
        let before = {
            let Ok(mut g) = SEEN_COMMENTS.lock() else { return };
            let map = g.get_or_insert_with(HashMap::new);
            let before = map.get(id).cloned();
            if !newest.is_empty() || before.is_none() {
                map.insert(id.clone(), newest.clone().max(before.clone().unwrap_or_default()));
            }
            before
        };
        let Some(before) = before else { continue };
        for c in comments.iter().filter(|c| c.get("created_time").and_then(Value::as_str).is_some_and(|t| t > before.as_str())) {
            if shown >= 3 {
                return;
            }
            let text = plain(c.get("rich_text"));
            notice(app, &crate::i18n::tf("Nuovo commento su «{title}»", &[("title", &title)]), text.trim(), url);
            shown += 1;
        }
    }
}

// ── Quick add, postpone, setup ────────────────────────────────────────────────

/// "+ Attività" in the card: a row in the tasks database with its title, the
/// due date if given, and the values the view in use asks for when it asks
/// for just one (so the new task shows in that view).
pub async fn add_task(db: &str, title: &str, due: Option<&str>, view: Option<&crate::settings::NotionView>) -> Result<(), String> {
    check_id(db)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(t("Scrivi l'attività").into());
    }
    let s = schema(db).await?;
    let mut props = serde_json::Map::new();
    props.insert(s.title.clone(), json!({ "title": rich(&title.chars().take(200).collect::<String>()) }));
    if let (Some(d), Some(prop)) = (due.filter(|d| valid_date(d)), &s.date) {
        props.insert(prop.clone(), json!({ "date": { "start": d } }));
    }
    for f in view.map(|v| v.filters.as_slice()).unwrap_or_default() {
        let [v] = f.values.as_slice() else { continue };
        let value = match f.kind.as_str() {
            "select" => json!({ "select": { "name": v } }),
            "multi_select" => json!({ "multi_select": [{ "name": v }] }),
            "status" => json!({ "status": { "name": v } }),
            "relation" => json!({ "relation": [{ "id": v }] }),
            _ => continue,
        };
        props.insert(f.prop.clone(), value);
    }
    let body = json!({ "parent": { "database_id": db }, "properties": Value::Object(props) });
    call(client().post(format!("{API}/pages")).json(&body)).await?;
    Ok(())
}

/// "YYYY-MM-DD", optionally with a time: what the card sends.
fn valid_date(d: &str) -> bool {
    let day = d.get(0..10).unwrap_or("");
    day.len() == 10 && day.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}

/// "Rimanda" on a task: its due date moved (the card keeps the time of day).
pub async fn postpone(db: &str, page: &str, date: &str) -> Result<(), String> {
    check_id(page)?;
    if !valid_date(date) {
        return Err(t("Data non valida").into());
    }
    let s = schema(db).await?;
    let prop = s.date.ok_or_else(|| t("Questo database non ha una data").to_string())?;
    call(client().patch(format!("{API}/pages/{page}")).json(&json!({ "properties": one(&prop, json!({ "date": { "start": date } })) }))).await?;
    Ok(())
}

/// Impostazioni → Notion, first time: the databases the token sees, with what
/// they could be — tasks (a date and a "done"), notes (by the name).
pub async fn suggest() -> Result<Vec<Value>, String> {
    let dbs = search("", 30, Some("database")).await?;
    let mut out = Vec::new();
    for d in dbs {
        let Some(id) = d.get("id").and_then(Value::as_str).map(String::from) else { continue };
        let Ok(s) = schema(&id).await else { continue };
        let name = d.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase();
        let named = |words: &[&str]| words.iter().any(|w| name.contains(w));
        let tasks = s.date.is_some() && s.done != Done::None;
        let task_name = named(&["attivit", "task", "todo", "to do", "da fare", "compiti"]);
        let notes = named(&["note", "appunt", "inbox", "idee", "diario", "journal"]);
        let mut v = d.clone();
        v["tasks"] = json!(tasks);
        // The likeliest first: a tasks database with a name that says so.
        v["score"] = json!(if tasks && task_name { 2 } else if tasks { 1 } else { 0 });
        v["notes"] = json!(notes);
        if tasks || notes {
            out.push(v);
        }
    }
    out.sort_by_key(|v| -v["score"].as_i64().unwrap_or(0));
    Ok(out)
}

/// A database chosen again in the settings: its properties are read again.
pub fn forget_schemas() {
    if let Ok(mut m) = SCHEMAS.lock() {
        *m = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notion_links_become_app_links() {
        assert_eq!(app_link("https://www.notion.so/Piano-abc123").as_deref(), Some("notion://www.notion.so/Piano-abc123"));
        assert_eq!(app_link("https://notion.so/team/Pagina-1?pvs=4").as_deref(), Some("notion://www.notion.so/team/Pagina-1?pvs=4"));
        assert_eq!(app_link("https://notion.so").as_deref(), Some("notion://www.notion.so"));
        assert_eq!(
            app_link("https://app.notion.com/p/Piano-3f984c09bb6781128e7feb757ba97f87").as_deref(),
            Some("notion://www.notion.so/Piano-3f984c09bb6781128e7feb757ba97f87")
        );
        assert_eq!(app_link("https://acme.notion.site/Pubblica-1"), None);
        assert_eq!(app_link("https://notion.so.evil.com/x"), None);
        assert_eq!(app_link("https://github.com"), None);
        assert_eq!(app_link("notion://www.notion.so/x"), None);
    }

    /// On a PC with the Notion app: `cargo test --lib notion::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_link() {
        println!("app installata: {}", app_installed());
        println!("link: {:?}", link_for("https://www.notion.so/Prova-0123456789abcdef0123456789abcdef"));
        if std::env::var("NOTION_OPEN").is_ok() {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            let pages = rt.block_on(search("", 1, None)).unwrap();
            let url = pages.first().and_then(|p| p.get("url")).and_then(Value::as_str).unwrap().to_string();
            println!("pagina: {url}");
            println!("apro: {:?}", link_for(&url));
            crate::open_url_now(&url);
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    }

    /// The databases the token sees and what EasyIsland would use of each:
    /// `NOTION_DBS=1 cargo test --lib notion::tests::live_databases -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_databases() {
        if std::env::var("NOTION_DBS").is_err() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let dbs = rt.block_on(search("", 20, Some("database"))).unwrap();
        for d in dbs {
            let id = d.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let s = rt.block_on(schema(&id));
            println!("{} → {:?}", d.get("title").and_then(Value::as_str).unwrap_or(""), s);
        }
    }

    /// The properties of the databases the token sees (names, types, options):
    /// `NOTION_DBS=1 cargo test --lib notion::tests::live_properties -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_properties() {
        if std::env::var("NOTION_DBS").is_err() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let dbs = rt.block_on(search("", 20, Some("database"))).unwrap();
        for d in dbs {
            let id = d.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            println!("== {}", d.get("title").and_then(Value::as_str).unwrap_or(""));
            let Ok(v) = rt.block_on(call(client().get(format!("{API}/databases/{id}")))) else { continue };
            for (name, p) in v.get("properties").and_then(Value::as_object).into_iter().flatten() {
                let kind = p.get("type").and_then(Value::as_str).unwrap_or("");
                let opts: Vec<&str> = p.get(kind).and_then(|k| k.get("options")).and_then(Value::as_array).into_iter().flatten()
                    .filter_map(|o| o.get("name").and_then(Value::as_str)).collect();
                println!("   {name}: {kind} {opts:?}");
            }
        }
    }

    /// The views on the tasks database (counts only):
    /// `NOTION_DBS=1 cargo test --lib notion::tests::live_views -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_views() {
        use crate::settings::{NotionFilter, NotionView};
        if std::env::var("NOTION_DBS").is_err() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let dbs = rt.block_on(search("Attività", 5, Some("database"))).unwrap();
        let db = dbs.first().and_then(|d| d.get("id")).and_then(Value::as_str).unwrap().to_string();
        for p in rt.block_on(properties(&db)).unwrap() {
            println!("{} ({}): {} valori", p.name, p.kind, p.options.len());
        }
        let views = [
            NotionView { name: "tutte".into(), period: "all".into(), undated: true, ..Default::default() },
            NotionView { name: "oggi".into(), period: "today".into(), undated: false, ..Default::default() },
            NotionView { name: "settimana".into(), period: "week".into(), undated: false, ..Default::default() },
            NotionView { name: "mese+senza".into(), period: "month".into(), undated: true, sort: "priority".into(), ..Default::default() },
            NotionView { name: "PC o Ufficio".into(), period: "all".into(), undated: true,
                filters: vec![NotionFilter { prop: "Contesto".into(), kind: "multi_select".into(), values: vec!["PC".into(), "Ufficio".into()] }], ..Default::default() },
        ];
        for v in &views {
            match rt.block_on(tasks(&db, Some(v))) {
                Ok(l) => println!("vista {}: {} attività", v.name, l.len()),
                Err(e) => println!("vista {}: errore {e}", v.name),
            }
        }
    }

    /// Can the token read comments? (`NOTION_DBS=1 … live_comments -- --ignored --nocapture`)
    #[test]
    #[ignore]
    fn live_comments() {
        if std::env::var("NOTION_DBS").is_err() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let pages = rt.block_on(search("", 3, Some("page"))).unwrap();
        for p in pages {
            let id = p.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            match rt.block_on(call(client().get(format!("{API}/comments?block_id={id}&page_size=5")))) {
                Ok(v) => println!("commenti: {}", v.get("results").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)),
                Err(e) => println!("errore: {e}"),
            }
        }
    }

    /// What "Configurazione rapida" proposes (`NOTION_DBS=1 … live_suggest -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn live_suggest() {
        if std::env::var("NOTION_DBS").is_err() {
            return;
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for d in rt.block_on(suggest()).unwrap() {
            println!("{} tasks={} notes={} score={}", d["title"], d["tasks"], d["notes"], d["score"]);
        }
    }

    #[test]
    fn due_times_and_when_to_say_so() {
        // 15:00 in Rome (UTC+2) is 13:00 UTC.
        let utc = epoch_of("2026-10-15T15:00:00.000+02:00", 0).unwrap();
        assert_eq!(utc, crate::widgets::days_from_civil(2026, 10, 15) * 86_400 + 13 * 3600);
        assert_eq!(epoch_of("2026-10-15T13:00:00.000Z", 3600), Some(utc));
        assert_eq!(epoch_of("2026-10-15T15:00:00.000", 7200), Some(utc));
        assert_eq!(epoch_of("2026-10-15T10:30:00.000-02:30", 0), Some(utc));
        assert_eq!(epoch_of("2026-10-15", 0), None);
        assert_eq!(epoch_of("2026-1", 0), None);
        let lead = 600;
        assert_eq!(when_to_alert(utc, utc - 3600, lead), When::Later);
        assert_eq!(when_to_alert(utc, utc - 900, lead), When::In(300));
        assert_eq!(when_to_alert(utc, utc - 500, lead), When::Now);
        assert_eq!(when_to_alert(utc, utc + 1800, lead), When::Now);
        assert_eq!(when_to_alert(utc, utc + 4000, lead), When::Later);
        assert_eq!(due_title("Rossi", utc, utc - 600), "Tra 10 min: Rossi");
        assert_eq!(due_title("Rossi", utc, utc), "Adesso: Rossi");
        assert_eq!(due_title("Rossi", utc, utc + 1200), "Scaduta da 20 min: Rossi");
        assert!(valid_date("2026-10-16") && valid_date("2026-10-16T09:00:00.000+02:00"));
        assert!(!valid_date("16/10/2026") && !valid_date("2026-10"));
    }

    #[test]
    fn views_become_notion_filters() {
        use crate::settings::{NotionFilter, NotionView};
        let s = Schema {
            title: "Nome".into(),
            date: Some("Scadenza".into()),
            done: Done::Status { prop: "Stato".into(), done: vec!["Fatto".into()] },
            priority: Some("Priorità".into()),
        };
        // Wednesday 15 October 2026.
        let today = crate::widgets::days_from_civil(2026, 10, 15);
        assert_eq!(iso(today), "2026-10-15");
        assert_eq!(period_end("week", 0, today).map(iso).as_deref(), Some("2026-10-18"));
        assert_eq!(period_end("month", 0, today).map(iso).as_deref(), Some("2026-10-31"));
        assert_eq!(period_end("days", 3, today).map(iso).as_deref(), Some("2026-10-17"));
        assert_eq!(period_end("all", 0, today), None);
        let dec = crate::widgets::days_from_civil(2026, 12, 20);
        assert_eq!(period_end("month", 0, dec).map(iso).as_deref(), Some("2026-12-31"));

        // No view: only "not done".
        assert_eq!(view_filter(&s, None, today), Some(json!({ "and": [{ "property": "Stato", "status": { "does_not_equal": "Fatto" } }] })));

        let v = NotionView {
            name: "Ufficio oggi".into(),
            period: "today".into(),
            days: 0,
            undated: false,
            filters: vec![
                NotionFilter { prop: "Contesto".into(), kind: "multi_select".into(), values: vec!["Ufficio".into(), "PC".into()] },
                NotionFilter { prop: "Priorità".into(), kind: "select".into(), values: vec!["Alta".into()] },
                NotionFilter { prop: "Tipo".into(), kind: "select".into(), values: vec![] },
            ],
            sort: "priority".into(),
        };
        let f = view_filter(&s, Some(&v), today).unwrap();
        let and = f["and"].as_array().unwrap();
        assert_eq!(and.len(), 4);
        assert_eq!(and[1], json!({ "property": "Scadenza", "date": { "on_or_before": "2026-10-15" } }));
        assert_eq!(and[2]["or"][1], json!({ "property": "Contesto", "multi_select": { "contains": "PC" } }));
        assert_eq!(and[3], json!({ "property": "Priorità", "select": { "equals": "Alta" } }));

        // A week with the undated ones too; all dates but only dated ones.
        let week = NotionView { name: "Settimana".into(), period: "week".into(), undated: true, ..Default::default() };
        let f = view_filter(&s, Some(&week), today).unwrap();
        assert_eq!(f["and"][1]["or"][1], json!({ "property": "Scadenza", "date": { "is_empty": true } }));
        let dated = NotionView { name: "Con data".into(), period: "all".into(), undated: false, ..Default::default() };
        let f = view_filter(&s, Some(&dated), today).unwrap();
        assert_eq!(f["and"][1], json!({ "property": "Scadenza", "date": { "is_not_empty": true } }));
        // A relation: the page id.
        let p = NotionView { name: "EasyIsland".into(), period: "all".into(), undated: true,
            filters: vec![NotionFilter { prop: "Progetto".into(), kind: "relation".into(), values: vec!["abc-1".into()] }], ..Default::default() };
        let f = view_filter(&s, Some(&p), today).unwrap();
        assert_eq!(f["and"][1], json!({ "property": "Progetto", "relation": { "contains": "abc-1" } }));
    }

    #[test]
    fn task_databases() {
        let db = json!({ "properties": {
            "Nome": { "type": "title", "title": {} },
            "Creato": { "type": "created_time" },
            "Scadenza": { "type": "date", "date": {} },
            "Stato": { "type": "status", "status": {
                "options": [ { "id": "a", "name": "Da fare" }, { "id": "b", "name": "In corso" }, { "id": "c", "name": "Fatto" } ],
                "groups": [
                    { "name": "To-do", "option_ids": ["a"] },
                    { "name": "In progress", "option_ids": ["b"] },
                    { "name": "Complete", "option_ids": ["c"] }
                ] } }
        } });
        let s = schema_of(&db).unwrap();
        assert_eq!(s.title, "Nome");
        assert_eq!(s.date.as_deref(), Some("Scadenza"));
        assert_eq!(s.done, Done::Status { prop: "Stato".into(), done: vec!["Fatto".into()] });
        assert_eq!(
            not_done_filter(&s.done).unwrap(),
            json!({ "and": [{ "property": "Stato", "status": { "does_not_equal": "Fatto" } }] })
        );

        let db = json!({ "properties": {
            "Task": { "type": "title", "title": {} },
            "Urgente": { "type": "checkbox", "checkbox": {} },
            "Done": { "type": "checkbox", "checkbox": {} },
        } });
        let s = schema_of(&db).unwrap();
        assert_eq!(s.done, Done::Checkbox("Done".into()));
        assert_eq!(s.date, None);

        let notes = json!({ "properties": { "Titolo": { "type": "title", "title": {} } } });
        assert_eq!(schema_of(&notes).unwrap().done, Done::None);
        assert!(schema_of(&json!({ "properties": {} })).is_none());
    }

    #[test]
    fn notes_as_blocks() {
        assert_eq!(paragraphs("uno\n\n  \ndue").len(), 2);
        let long = "x".repeat(4500);
        assert_eq!(rich(&long).len(), 3);
        assert!(paragraphs("").is_empty());
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
