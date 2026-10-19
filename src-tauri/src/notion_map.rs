// The structure of the user's Notion for the chat (asked by Edoardo on 19
// October 2026: every Notion request in the chat began with searches to learn
// how the workspace is made). What the integration's token sees — databases
// with their properties, options and relations, and the pages that are not
// rows — is read here and kept on this PC, encrypted (DPAPI). The chat gets a
// short index at the start of a conversation (`index`, lib.rs chat_turn) and
// the details with the easyisland tool `notion_map` (agent.rs).
//
// Synced with "Sincronizza" in the settings and by itself every
// `notionMapHours` hours (notion::poll; 0 = only by hand).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::i18n::tf;

/// Search pages of 100: at most this many for databases, and for pages.
const DB_PAGES: usize = 5;
const PAGE_PAGES: usize = 3;
/// What the index names at most (the tool has everything).
const INDEX_DBS: usize = 40;
const INDEX_PAGES: usize = 30;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Map {
    /// Seconds since 1970 of the sync.
    pub at: i64,
    pub databases: Vec<Db>,
    pub pages: Vec<Page>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Db {
    pub id: String,
    pub title: String,
    pub url: String,
    /// The page it is in ("" at the top or unknown).
    pub parent: String,
    /// Its data sources (API 2025-09-03): what Notion's own tools want to
    /// add or query rows ("collection://<id>").
    #[serde(default)]
    pub sources: Vec<String>,
    pub properties: Vec<Prop>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Prop {
    pub name: String,
    pub kind: String,
    /// Select, multi-select and status: the option names.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// Relation: the other database's id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub relation: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub url: String,
    pub parent: String,
}

static MAP: Mutex<Option<Map>> = Mutex::new(None);
static LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SYNCING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn path() -> std::path::PathBuf {
    crate::settings::config_dir().join("notion-map.bin")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// The map in memory, read from disk the first time.
fn current() -> Option<Map> {
    if !LOADED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let saved = std::fs::read(path())
            .ok()
            .and_then(|b| crate::secrets::dpapi(&b, false))
            .and_then(|j| serde_json::from_slice::<Map>(&j).ok());
        if let (Some(m), Ok(mut g)) = (saved, MAP.lock()) {
            g.get_or_insert(m);
        }
    }
    MAP.lock().ok()?.clone()
}

fn save(map: &Map) {
    let Ok(json) = serde_json::to_vec(map) else { return };
    match crate::secrets::dpapi(&json, true) {
        Some(sealed) => {
            if let Err(e) = crate::settings::write_atomic(&path(), &sealed) {
                crate::log::line(format!("notion: mappa non salvata ({e})"));
            }
        }
        None => crate::log::line("notion: mappa non cifrata, non salvata"),
    }
}

fn plain(rich: Option<&Value>) -> String {
    rich.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| t.get("plain_text").and_then(Value::as_str)).collect::<String>())
        .unwrap_or_default()
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn page_title(obj: &Value) -> String {
    obj.get("properties")
        .and_then(Value::as_object)
        .and_then(|p| p.values().find(|x| x.get("type").and_then(Value::as_str) == Some("title")))
        .map(|x| plain(x.get("title")))
        .unwrap_or_default()
}

/// The parent's id when it is a page ("" for the workspace, a database…).
fn parent_page(obj: &Value) -> Option<String> {
    let p = obj.get("parent")?;
    match p.get("type").and_then(Value::as_str)? {
        "page_id" => Some(str_of(p, "page_id")),
        "workspace" => Some(String::new()),
        _ => None,
    }
}

fn props_of(db: &Value) -> Vec<Prop> {
    let Some(props) = db.get("properties").and_then(Value::as_object) else { return Vec::new() };
    let mut list: Vec<Prop> = props
        .iter()
        .map(|(name, p)| {
            let kind = str_of(p, "type");
            let options = p
                .get(&kind)
                .and_then(|k| k.get("options"))
                .and_then(Value::as_array)
                .map(|o| o.iter().filter_map(|x| x.get("name").and_then(Value::as_str).map(String::from)).collect())
                .unwrap_or_default();
            let relation = if kind == "relation" { p.pointer("/relation/database_id").and_then(Value::as_str).unwrap_or_default().to_string() } else { String::new() };
            Prop { name: name.clone(), kind, options, relation }
        })
        .collect();
    // The title first, then by name: the same order every time.
    list.sort_by(|a, b| (a.kind != "title", &a.name).cmp(&(b.kind != "title", &b.name)));
    list
}

/// Every result of a search for `kind`, at most `max` pages of 100.
async fn search_all(kind: &str, max: usize) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..max {
        let mut body = json!({ "filter": { "property": "object", "value": kind }, "page_size": 100 });
        if let Some(c) = &cursor {
            body["start_cursor"] = json!(c);
        }
        let v = crate::notion::call(crate::notion::client().post(format!("{}/search", crate::notion::API)).json(&body)).await?;
        out.extend(v.get("results").and_then(Value::as_array).cloned().unwrap_or_default());
        cursor = v.get("next_cursor").and_then(Value::as_str).map(String::from);
        if cursor.is_none() || v.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
    }
    Ok(out)
}

fn build(dbs: &[Value], pages: &[Value]) -> Map {
    let pages: Vec<(Page, String)> = pages
        .iter()
        .filter(|p| p.get("archived").and_then(Value::as_bool) != Some(true) && p.get("in_trash").and_then(Value::as_bool) != Some(true))
        .filter_map(|p| {
            // Rows of a database are its content, not the structure.
            let parent = parent_page(p)?;
            let title = page_title(p);
            Some((Page { id: str_of(p, "id"), title, url: str_of(p, "url"), parent: String::new() }, parent))
        })
        .collect();
    let title_of = |id: &str| pages.iter().find(|(p, _)| p.id == id).map(|(p, _)| p.title.clone()).unwrap_or_default();
    let databases = dbs
        .iter()
        .filter(|d| d.get("archived").and_then(Value::as_bool) != Some(true) && d.get("in_trash").and_then(Value::as_bool) != Some(true))
        .map(|d| Db {
            id: str_of(d, "id"),
            title: plain(d.get("title")),
            url: str_of(d, "url"),
            parent: parent_page(d).map(|p| title_of(&p)).unwrap_or_default(),
            sources: Vec::new(),
            properties: props_of(d),
        })
        .collect();
    let pages = pages
        .iter()
        .map(|(p, parent)| Page { parent: if parent.is_empty() { String::new() } else { title_of(parent) }, ..p.clone() })
        .collect();
    Map { at: now(), databases, pages }
}

/// A database's data sources; none when the API does not say (the map
/// still works, Notion's tools then fetch the database once).
async fn sources_of(db: &str) -> Vec<String> {
    let req = crate::notion::client().get(format!("{}/databases/{db}", crate::notion::API));
    crate::notion::call_version(req, "2025-09-03")
        .await
        .ok()
        .and_then(|v| v.get("data_sources")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|s| s.get("id").and_then(Value::as_str).map(|id| format!("collection://{id}")))
        .collect()
}

/// Reads the structure again and keeps it ("Sincronizza", or by itself).
pub async fn sync() -> Result<Map, String> {
    if SYNCING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err(crate::i18n::t("Sincronizzazione già in corso").to_string());
    }
    let read = async {
        let dbs = search_all("database", DB_PAGES).await?;
        let pages = search_all("page", PAGE_PAGES).await?;
        let mut map = build(&dbs, &pages);
        for d in &mut map.databases {
            d.sources = sources_of(&d.id).await;
        }
        Ok::<_, String>(map)
    }
    .await;
    SYNCING.store(false, std::sync::atomic::Ordering::SeqCst);
    let map = read?;
    crate::log::line(format!("notion: mappa con {} database e {} pagine", map.databases.len(), map.pages.len()));
    save(&map);
    LOADED.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut g) = MAP.lock() {
        *g = Some(map.clone());
    }
    Ok(map)
}

/// From notion::poll: syncs when the map is older than `hours` (0: never by itself).
pub async fn sync_if_old(hours: u32) {
    if hours == 0 {
        return;
    }
    let at = current().map(|m| m.at).unwrap_or(0);
    if now() - at >= i64::from(hours) * 3600 {
        if let Err(e) = sync().await {
            crate::log::line(format!("notion: mappa non letta ({e})"));
        }
    }
}

/// The settings' line: how many, and when.
pub fn status() -> Value {
    match current() {
        Some(m) => json!({ "databases": m.databases.len(), "pages": m.pages.len(), "at": m.at }),
        None => json!({ "databases": 0, "pages": 0, "at": 0 }),
    }
}

/// What goes in front of a conversation's first question: the names and ids,
/// so the model does not search for them. `tool`: the easyisland tools are on.
pub fn index(tool: bool) -> Option<String> {
    crate::secrets::get("notion-api-key")?;
    let m = current().filter(|m| !m.databases.is_empty() || !m.pages.is_empty())?;
    let date = chrono_like(m.at);
    let mut s = tf("[Notion dell'utente, mappa di EasyIsland del {d}. Usa questi id con gli strumenti di Notion invece di cercarli (per aggiungere o cercare righe la data source); se qualcosa non c'è o non torna, cerca come al solito.", &[("d", &date)]);
    if !m.databases.is_empty() {
        s.push_str("\nDatabase: ");
        let names: Vec<String> = m
            .databases
            .iter()
            .take(INDEX_DBS)
            .map(|d| match d.sources.as_slice() {
                [] => format!("{} ({})", d.title, d.id),
                s => format!("{} ({}, data source {})", d.title, d.id, s.join(", ")),
            })
            .collect();
        s.push_str(&names.join(" · "));
    }
    if !m.pages.is_empty() {
        s.push_str("\nPagine: ");
        let names: Vec<String> = m.pages.iter().take(INDEX_PAGES).map(|p| format!("{} ({})", p.title, p.id)).collect();
        s.push_str(&names.join(" · "));
    }
    if tool {
        s.push_str("\nProprietà, opzioni di stati e selezioni e relazioni di ogni database: strumento notion_map di easyisland (database = nome o id), senza chiamate a Notion; se lo strumento non c'è, un solo fetch della data source.");
    } else {
        // Without the tool, the properties come along.
        for d in m.databases.iter().take(INDEX_DBS) {
            s.push('\n');
            s.push_str(&describe(d, &m));
        }
    }
    // Learnt from a turn on 19 October 2026: a model put `parent` inside each
    // page, and Notion made eight empty private pages before it found out.
    s.push_str("\nPer aggiungere righe con notion-create-pages: \"parent\": {\"data_source_id\": \"…\"} va al livello principale della chiamata, accanto a \"pages\", mai dentro una pagina; le proprietà con i nomi esatti della mappa (date come date:Nome:start). Se la risposta torna con le proprietà vuote, la pagina è finita fuori dal database: correggi la chiamata, non creare pagine di prova.");
    s.push_str("]\n\n");
    Some(s)
}

/// "19/10/2026 08:30", local time, without a date crate.
fn chrono_like(at: i64) -> String {
    let local = at + crate::notion::local_offset();
    let days = local.div_euclid(86_400);
    let secs = local.rem_euclid(86_400);
    // Civil from days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    format!("{d:02}/{mo:02}/{y} {:02}:{:02}", secs / 3600, secs % 3600 / 60)
}

fn describe(d: &Db, m: &Map) -> String {
    let mut s = format!("## {} — id {} — {}", d.title, d.id, d.url);
    if !d.sources.is_empty() {
        s.push_str(&format!(" — data source {}", d.sources.join(", ")));
    }
    if !d.parent.is_empty() {
        s.push_str(&format!(" — in «{}»", d.parent));
    }
    for p in &d.properties {
        s.push_str(&format!("\n- {} ({}", p.name, p.kind));
        if !p.options.is_empty() {
            s.push_str(&format!(": {}", p.options.join(", ")));
        }
        if !p.relation.is_empty() {
            let other = m.databases.iter().find(|x| same_id(&x.id, &p.relation)).map(|x| x.title.clone()).unwrap_or_else(|| p.relation.clone());
            s.push_str(&format!(" → {other}"));
        }
        s.push(')');
    }
    s
}

fn same_id(a: &str, b: &str) -> bool {
    a.replace('-', "").eq_ignore_ascii_case(&b.replace('-', ""))
}

/// The easyisland tool: one database (name or id), or all of them, and the pages.
pub fn tool(database: &str) -> Result<String, String> {
    if crate::secrets::get("notion-api-key").is_none() {
        return Err("Notion non è collegato a EasyIsland (Impostazioni → Integrazioni → Notion).".into());
    }
    let m = current().ok_or("La mappa di Notion non è ancora stata letta: Impostazioni → Integrazioni → Notion → Sincronizza.")?;
    let q = database.trim().to_lowercase();
    let mut out = tf("Mappa di Notion del {d}.", &[("d", &chrono_like(m.at))]);
    let chosen: Vec<&Db> = if q.is_empty() {
        m.databases.iter().collect()
    } else {
        m.databases.iter().filter(|d| same_id(&d.id, &q) || d.title.to_lowercase().contains(&q)).collect()
    };
    if chosen.is_empty() && !q.is_empty() {
        return Ok(format!("{out}\nNessun database «{database}» nella mappa (forse non è condiviso con l'integrazione di EasyIsland, o è nuovo): cercalo con gli strumenti di Notion."));
    }
    for d in chosen {
        out.push_str("\n\n");
        out.push_str(&describe(d, &m));
    }
    if q.is_empty() && !m.pages.is_empty() {
        out.push_str("\n\n## Pagine");
        for p in &m.pages {
            out.push_str(&format!("\n- {} — id {} — {}", p.title, p.id, p.url));
            if !p.parent.is_empty() {
                out.push_str(&format!(" — in «{}»", p.parent));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_structure_without_rows() {
        let dbs = vec![json!({
            "id": "db1", "url": "https://notion.so/db1", "title": [{ "plain_text": "Attività" }],
            "parent": { "type": "page_id", "page_id": "p1" },
            "properties": {
                "Stato": { "type": "status", "status": { "options": [{ "name": "Da fare" }, { "name": "Fatto" }] } },
                "Nome": { "type": "title", "title": {} },
                "Progetto": { "type": "relation", "relation": { "database_id": "db2" } }
            }
        }), json!({ "id": "db2", "url": "u", "title": [{ "plain_text": "Progetti" }], "parent": { "type": "workspace" }, "properties": {} })];
        let pages = vec![
            json!({ "id": "p1", "url": "u1", "parent": { "type": "workspace" }, "properties": { "title": { "type": "title", "title": [{ "plain_text": "Lavoro" }] } } }),
            json!({ "id": "r1", "url": "u2", "parent": { "type": "database_id", "database_id": "db1" }, "properties": {} }),
        ];
        let m = build(&dbs, &pages);
        assert_eq!(m.pages.len(), 1);
        assert_eq!(m.databases[0].parent, "Lavoro");
        assert_eq!(m.databases[0].properties[0].name, "Nome");
        let d = describe(&m.databases[0], &m);
        assert!(d.contains("Stato (status: Da fare, Fatto)"), "{d}");
        assert!(d.contains("Progetto (relation → Progetti)"), "{d}");
    }

    /// Read-only, with the real token: `cargo test --lib notion_map::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let dbs = rt.block_on(search_all("database", DB_PAGES)).unwrap();
        let pages = rt.block_on(search_all("page", PAGE_PAGES)).unwrap();
        let mut m = build(&dbs, &pages);
        for d in &mut m.databases {
            d.sources = rt.block_on(sources_of(&d.id));
        }
        *MAP.lock().unwrap() = Some(m.clone());
        LOADED.store(true, std::sync::atomic::Ordering::SeqCst);
        let index = index(true).unwrap();
        let full = tool("").unwrap();
        println!("{} database, {} pagine (su {} risultati); indice {} caratteri, strumento {} caratteri", m.databases.len(), m.pages.len(), pages.len(), index.chars().count(), full.chars().count());
        println!("{}", index.chars().take(1500).collect::<String>());
    }

    #[test]
    fn date_is_readable() {
        // 2026-10-19 00:00 UTC, whatever the offset: the year is there.
        assert!(chrono_like(1_792_368_000).contains("/2026 "));
    }
}
