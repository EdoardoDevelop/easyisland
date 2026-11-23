//! The island built from a JSON (docs/architettura.md → Isola da JSON): what
//! the user adds to the open island from the chat, in `%APPDATA%\EasyIsland\isola.json`.
//! Step 1: buttons in fixed places (the foot of the menu, the header) and tabs
//! of their own in the menu, each a grid of buttons. A button only does what
//! is in `ACTIONS` (a fixed list, never code); what the existing parts do is
//! never touched. Every change is asked first (Consenti / Nega, the card says
//! what changes), the version before is kept in `isola-versioni\` and
//! `undo` brings it back. A file that does not read as a valid layout (edited
//! by hand) gives way to the newest valid version.
//! Step 2: a tab may also hold blocks (`BLOCKS`): a grid or a list of what a
//! source gives (`SOURCES`: installed apps, open windows, quick actions, a
//! folder), a value of the PC (`VALUES`, read by barsys.rs only while the tab is
//! open) or a text. What a block's item does comes from its source, never
//! from the JSON.
//! Step 3: the island's own parts in the JSON too, so each moves: `menu`
//! (order of the sections and of the user's tabs among them, what is hidden)
//! and `header` (order of the header's buttons, what is hidden). Only place
//! and visibility: what the parts do does not change. Panoramica and
//! Impostazioni never hide (the way back). `island_layout` gives the whole
//! island as it is, defaults included.
//! Then (23/11): the Panoramica too (`overview`: order and hidden of its parts
//! `OVERVIEW_PARTS`, order and hidden of the tiles, blocks of its own among
//! them), and existing pieces as blocks (`piece`: an integration's card, the
//! news, the quick actions), in a tab or in the Panoramica.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::i18n::{t, tf};

/// Where a button of the island may stand.
pub const ZONES: &[&str] = &["menu-bottom", "header"];
/// What a button may do (`action.kind`), with what it needs.
pub const ACTIONS: &[&str] = &["system", "windows", "quick", "app", "url", "view", "chat"];
/// `system` commands: the restart, sleep and shutdown ones ask in a window of their own.
pub const SYSTEM: &[&str] = &["lock", "sleep", "restart", "shutdown", "recycle-empty", "recycle-open", "taskmgr"];
/// `view` targets besides `tab:<id>`.
pub const VIEWS: &[&str] = &["overview", "agents", "chat", "actions", "files", "news", "settings", "memory"];

/// What a tab's block may be.
pub const BLOCKS: &[&str] = &["grid", "list", "value", "text", "piece"];
/// Existing pieces of the island a `piece` block shows as they are.
pub const PIECES: &[&str] = &["integration", "news", "quick"];
/// The Panoramica's parts, in their usual order: «Adesso», the tiles, the quick actions, the news.
pub const OVERVIEW_PARTS: &[&str] = &["now", "tiles", "quick", "news"];
/// Where a grid or a list takes its items from.
pub const SOURCES: &[&str] = &["apps", "windows", "quick", "folder"];
/// The PC's values a `value` block shows (barsys.rs).
pub const VALUES: &[&str] = &["cpu", "ram", "gpu", "disk", "battery", "net", "ip", "recycle", "updates"];

/// The menu's sections, in their usual order, and the integrations' list (hide only).
pub const MENU_PARTS: &[&str] = &["overview", "agents", "chat", "actions", "files", "news", "integrations"];
/// The header's buttons, in their usual order: Consumo, the user's own, then the island's.
pub const HEADER_PARTS: &[&str] = &["usage", "own", "pin", "memory", "settings", "sound"];
/// Never hidden: the way to everything else.
const ALWAYS_SHOWN: &[&str] = &["overview", "settings"];

const MAX_ZONE: usize = 12;
const MAX_BLOCKS: usize = 12;
const MAX_TABS: usize = 12;
const MAX_TAB_BUTTONS: usize = 40;
const KEEP_VERSIONS: usize = 30;

/// One writer at a time (two chat turns, the settings window).
static LOCK: Mutex<()> = Mutex::new(());

fn file() -> PathBuf {
    crate::settings::config_dir().join("isola.json")
}

fn versions_dir() -> PathBuf {
    crate::settings::config_dir().join("isola-versioni")
}

fn empty() -> Value {
    json!({ "buttons": [], "tabs": [] })
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default()
}

/// A short text the user reads: present, at most `max` characters.
fn label(v: &Value, key: &str, max: usize, what: &str) -> Result<String, String> {
    let s = text(v, key);
    if s.is_empty() {
        return Err(tf("Manca «{key}» in {what}.", &[("key", &key), ("what", &what)]));
    }
    if s.chars().count() > max {
        return Err(tf("«{key}» di {what} è troppo lungo (al massimo {n} caratteri).", &[("key", &key), ("what", &what), ("n", &max)]));
    }
    Ok(s.to_string())
}

/// An icon: one of the drawn ones (`i:power`), or up to four characters (an emoji).
fn icon(v: &Value, what: &str) -> Result<Option<String>, String> {
    let s = text(v, "icon");
    if s.is_empty() {
        return Ok(None);
    }
    let drawn = s.strip_prefix("i:").is_some_and(|n| !n.is_empty() && n.len() <= 20 && n.chars().all(|c| c.is_ascii_lowercase()));
    if drawn || (!s.starts_with("i:") && s.chars().count() <= 4) {
        return Ok(Some(s.to_string()));
    }
    Err(tf("Icona non valida in {what}: usa i:<nome> (power, lock, globe, folder…) o un'emoji.", &[("what", &what)]))
}

fn color(v: &Value, what: &str) -> Result<Option<String>, String> {
    let s = text(v, "color");
    if s.is_empty() {
        return Ok(None);
    }
    let ok = s.len() == 7 && s.starts_with('#') && s.chars().skip(1).all(|c| c.is_ascii_hexdigit());
    if ok { Ok(Some(s.to_ascii_lowercase())) } else { Err(tf("Colore non valido in {what}: #rrggbb.", &[("what", &what)])) }
}

/// A button's action, checked against the fixed list; only the keys it needs are kept.
fn action(v: &Value, what: &str, tabs: &[String]) -> Result<Value, String> {
    let a = v.get("action").filter(|a| a.is_object()).ok_or_else(|| tf("Manca «action» in {what}.", &[("what", &what)]))?;
    let kind = text(a, "kind");
    let need = |key: &str| -> Result<String, String> {
        let s = text(a, key);
        if s.is_empty() || s.chars().count() > 2000 {
            return Err(tf("Manca «{key}» nell'azione di {what}.", &[("key", &key), ("what", &what)]));
        }
        Ok(s.to_string())
    };
    let bad = |val: &str| tf("Valore non ammesso nell'azione di {what}: {val}.", &[("what", &what), ("val", &val)]);
    Ok(match kind {
        "system" => {
            let w = need("what")?;
            if !SYSTEM.contains(&w.as_str()) {
                return Err(bad(&w));
            }
            json!({ "kind": kind, "what": w })
        }
        "windows" => {
            let p = need("page")?;
            if !crate::pcfind::page_known(&p) {
                return Err(bad(&p));
            }
            json!({ "kind": kind, "page": p })
        }
        "quick" => json!({ "kind": kind, "id": need("id")? }),
        "app" => {
            let mut o = json!({ "kind": kind, "target": need("target")? });
            if !text(a, "args").is_empty() {
                o["args"] = json!(text(a, "args"));
            }
            o
        }
        "url" => {
            let u = need("url")?;
            let lower = u.to_ascii_lowercase();
            if !(lower.starts_with("https://") || lower.starts_with("http://")) {
                return Err(bad(&u));
            }
            json!({ "kind": kind, "url": u })
        }
        "view" => {
            let to = need("view")?;
            let tab_ok = to.strip_prefix("tab:").is_some_and(|id| tabs.iter().any(|x| x == id));
            if !VIEWS.contains(&to.as_str()) && !tab_ok {
                return Err(bad(&to));
            }
            json!({ "kind": kind, "view": to })
        }
        "chat" => json!({ "kind": kind, "text": need("text")? }),
        other => return Err(tf("Azione «{kind}» sconosciuta in {what}: {list}.", &[("kind", &other), ("what", &what), ("list", &ACTIONS.join(", "))])),
    })
}

/// A folder of a `folder` source: a full path (`C:\…`, `\\server\…`) or one
/// starting with an environment variable (`%USERPROFILE%\Desktop`); never a
/// place of keys and passwords.
fn folder_ok(p: &str) -> bool {
    let drive = matches!(p.as_bytes().get(..3), Some([l, b':', b'\\' | b'/']) if l.is_ascii_alphabetic());
    let var = p.strip_prefix('%').is_some_and(|rest| rest.contains('%'));
    let full = drive || p.starts_with("\\\\") || var;
    full && p.chars().count() <= 260 && !crate::opencode::secret_place(p)
}

/// One block of a tab, checked; only the keys its kind needs are kept.
fn block(v: &Value, tab: &str) -> Result<Value, String> {
    let id = text(v, "id");
    if !id_ok(id) {
        return Err(tf("id del blocco non valido: «{id}» (minuscole, cifre, trattini).", &[("id", &id)]));
    }
    let what = tf("blocco «{id}» della scheda «{tab}»", &[("id", &id), ("tab", &tab)]);
    let kind = text(v, "kind");
    if !BLOCKS.contains(&kind) {
        return Err(tf("«kind» di {what}: {list}.", &[("what", &what), ("list", &BLOCKS.join(", "))]));
    }
    let mut o = Map::new();
    o.insert("id".into(), json!(id));
    o.insert("kind".into(), json!(kind));
    if !text(v, "title").is_empty() {
        o.insert("title".into(), json!(label(v, "title", 40, &what)?));
    }
    match kind {
        "grid" | "list" => {
            let src = v.get("source").filter(|x| x.is_object()).ok_or_else(|| tf("Manca «source» in {what}.", &[("what", &what)]))?;
            let sk = text(src, "kind");
            if !SOURCES.contains(&sk) {
                return Err(tf("«source.kind» di {what}: {list}.", &[("what", &what), ("list", &SOURCES.join(", "))]));
            }
            let mut so = json!({ "kind": sk });
            if sk == "folder" {
                let path = text(src, "path");
                if !folder_ok(path) {
                    return Err(tf("Cartella non ammessa in {what}: un percorso completo (C:\\…, \\\\server\\…, %USERPROFILE%\\…).", &[("what", &what)]));
                }
                so["path"] = json!(path);
            }
            o.insert("source".into(), so);
            let filter = text(v, "filter");
            if filter.chars().count() > 60 {
                return Err(tf("«filter» di {what} è troppo lungo (al massimo {n} caratteri).", &[("what", &what), ("n", &60)]));
            }
            if !filter.is_empty() {
                o.insert("filter".into(), json!(filter));
            }
            if let Some(n) = v.get("limit").and_then(Value::as_u64) {
                o.insert("limit".into(), json!(n.clamp(1, 500)));
            }
            if v.get("search").and_then(Value::as_bool) == Some(true) {
                o.insert("search".into(), json!(true));
            }
        }
        "value" => {
            let w = text(v, "what");
            if !VALUES.contains(&w) {
                return Err(tf("«what» di {what}: {list}.", &[("what", &what), ("list", &VALUES.join(", "))]));
            }
            o.insert("what".into(), json!(w));
            let drive = text(v, "drive").trim_end_matches([':', '\\']).to_ascii_uppercase();
            if w == "disk" && !drive.is_empty() {
                if drive.len() != 1 || !drive.chars().all(|c| c.is_ascii_uppercase()) {
                    return Err(tf("«drive» di {what}: una lettera (C, D…).", &[("what", &what)]));
                }
                o.insert("drive".into(), json!(drive));
            }
        }
        "piece" => {
            let pc = text(v, "piece");
            if !PIECES.contains(&pc) {
                return Err(tf("«piece» di {what}: {list}.", &[("what", &what), ("list", &PIECES.join(", "))]));
            }
            o.insert("piece".into(), json!(pc));
            if pc == "integration" {
                let iid = text(v, "integration");
                if !integration_id_ok(iid) {
                    return Err(tf("«integration» di {what}: l'id di un'integrazione attiva (island_layout le elenca).", &[("what", &what)]));
                }
                o.insert("integration".into(), json!(iid));
            }
        }
        _ => {
            o.insert("text".into(), json!(label(v, "text", 500, &what)?));
        }
    }
    Ok(Value::Object(o))
}

/// An integration's id as the island names it: `integration_media`, `widget:…`, `custom:…`.
fn integration_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '-' | '.'))
}

/// Blocks of a tab or of the Panoramica, checked, ids not repeated.
fn blocks_of(list: &[Value], owner: &str, what: &str) -> Result<Vec<Value>, String> {
    if list.len() > MAX_BLOCKS {
        return Err(tf("Troppi blocchi in {what}: al massimo {n}.", &[("what", &what), ("n", &MAX_BLOCKS)]));
    }
    let mut ids: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for b in list {
        let b = block(b, owner)?;
        let bid = text(&b, "id").to_string();
        if ids.contains(&bid) {
            return Err(tf("Due blocchi con l'id «{id}» in {what}.", &[("id", &bid), ("what", &what)]));
        }
        ids.push(bid);
        out.push(b);
    }
    Ok(out)
}

/// One button; `zone` only for the island's own (a tab's buttons have none).
fn button(v: &Value, zoned: bool, tabs: &[String]) -> Result<Value, String> {
    let id = text(v, "id");
    if !id_ok(id) {
        return Err(tf("id del pulsante non valido: «{id}» (minuscole, cifre, trattini).", &[("id", &id)]));
    }
    let what = tf("pulsante «{id}»", &[("id", &id)]);
    let mut o = Map::new();
    o.insert("id".into(), json!(id));
    o.insert("label".into(), json!(label(v, "label", 40, &what)?));
    if let Some(i) = icon(v, &what)? {
        o.insert("icon".into(), json!(i));
    }
    if let Some(c) = color(v, &what)? {
        o.insert("color".into(), json!(c));
    }
    if zoned {
        let z = text(v, "zone");
        if !ZONES.contains(&z) {
            return Err(tf("«zone» di {what}: {list}.", &[("what", &what), ("list", &ZONES.join(", "))]));
        }
        o.insert("zone".into(), json!(z));
    }
    o.insert("action".into(), action(v, &what, tabs)?);
    Ok(Value::Object(o))
}

/// The whole layout, checked: what is saved and what the island reads.
pub fn normalize(v: &Value) -> Result<Value, String> {
    let list = |key: &str| v.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
    let tabs_in = list("tabs");
    if tabs_in.len() > MAX_TABS {
        return Err(tf("Troppe schede: al massimo {n}.", &[("n", &MAX_TABS)]));
    }
    let tab_ids: Vec<String> = tabs_in.iter().map(|x| text(x, "id").to_string()).collect();
    let mut seen: Vec<String> = Vec::new();
    let mut buttons = Vec::new();
    for b in list("buttons") {
        let b = button(&b, true, &tab_ids)?;
        let id = text(&b, "id").to_string();
        if seen.contains(&id) {
            return Err(tf("Due pulsanti con l'id «{id}».", &[("id", &id)]));
        }
        seen.push(id);
        buttons.push(b);
    }
    for z in ZONES {
        if buttons.iter().filter(|b| text(b, "zone") == *z).count() > MAX_ZONE {
            return Err(tf("Troppi pulsanti in «{zone}»: al massimo {n}.", &[("zone", z), ("n", &MAX_ZONE)]));
        }
    }
    let mut tabs = Vec::new();
    for (i, tab) in tabs_in.iter().enumerate() {
        let id = tab_ids.get(i).cloned().unwrap_or_default();
        if !id_ok(&id) {
            return Err(tf("id della scheda non valido: «{id}» (minuscole, cifre, trattini).", &[("id", &id)]));
        }
        if tab_ids.iter().filter(|x| **x == id).count() > 1 {
            return Err(tf("Due schede con l'id «{id}».", &[("id", &id)]));
        }
        let what = tf("scheda «{id}»", &[("id", &id)]);
        let mut o = Map::new();
        o.insert("id".into(), json!(id));
        o.insert("name".into(), json!(label(tab, "name", 30, &what)?));
        if let Some(ic) = icon(tab, &what)? {
            o.insert("icon".into(), json!(ic));
        }
        let inner = tab.get("buttons").and_then(Value::as_array).cloned().unwrap_or_default();
        if inner.len() > MAX_TAB_BUTTONS {
            return Err(tf("Troppi pulsanti in {what}: al massimo {n}.", &[("what", &what), ("n", &MAX_TAB_BUTTONS)]));
        }
        let mut mine: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for b in &inner {
            let b = button(b, false, &tab_ids)?;
            let bid = text(&b, "id").to_string();
            if mine.contains(&bid) {
                return Err(tf("Due pulsanti con l'id «{id}» in {what}.", &[("id", &bid), ("what", &what)]));
            }
            mine.push(bid);
            out.push(b);
        }
        o.insert("buttons".into(), Value::Array(out));
        let blocks_in = tab.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
        let blocks = blocks_of(&blocks_in, &id, &what)?;
        if !blocks.is_empty() {
            o.insert("blocks".into(), Value::Array(blocks));
        }
        tabs.push(Value::Object(o));
    }
    let mut out = json!({ "buttons": buttons, "tabs": tabs });
    if let Some(m) = parts(v.get("menu"), "menu", MENU_PARTS, &tab_ids)? {
        out["menu"] = m;
    }
    if let Some(hd) = parts(v.get("header"), "header", HEADER_PARTS, &[])? {
        out["header"] = hd;
    }
    if let Some(ov) = overview(v.get("overview"))? {
        out["overview"] = ov;
    }
    Ok(out)
}

/// The Panoramica: `order` of its parts and of its own blocks (`block:<id>`),
/// `hidden` parts and tiles (`tile:<id>`), `tiles` (the tiles named first, in
/// this order), `blocks`. None when it says nothing.
fn overview(v: Option<&Value>) -> Result<Option<Value>, String> {
    let Some(v) = v.filter(|x| x.is_object()) else { return Ok(None) };
    let what = t("Panoramica").to_string();
    let blocks = blocks_of(&v.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default(), "overview", &what)?;
    let block_ids: Vec<String> = blocks.iter().map(|b| text(b, "id").to_string()).collect();
    let strings = |key: &str| -> Vec<String> {
        v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).collect()).unwrap_or_default()
    };
    let list = OVERVIEW_PARTS.join(", ");
    let mut order: Vec<String> = Vec::new();
    for id in strings("order") {
        let block_ok = id.strip_prefix("block:").is_some_and(|b| block_ids.iter().any(|x| x == b));
        if !OVERVIEW_PARTS.contains(&id.as_str()) && !block_ok {
            return Err(tf("«{id}» non è una parte di «{what}»: {list}.", &[("id", &id), ("what", &"overview"), ("list", &format!("{list}, block:<id>"))]));
        }
        if !order.contains(&id) {
            order.push(id);
        }
    }
    let mut hidden: Vec<String> = Vec::new();
    for id in strings("hidden") {
        let tile_ok = id.strip_prefix("tile:").is_some_and(integration_id_ok);
        if !OVERVIEW_PARTS.contains(&id.as_str()) && !tile_ok {
            return Err(tf("«{id}» non si può nascondere in «{what}»: {list}.", &[("id", &id), ("what", &"overview"), ("list", &format!("{list}, tile:<id>"))]));
        }
        if !hidden.contains(&id) {
            hidden.push(id);
        }
    }
    let mut tiles: Vec<String> = Vec::new();
    for id in strings("tiles") {
        if !integration_id_ok(&id) {
            return Err(tf("«{id}» non è l'id di un'integrazione.", &[("id", &id)]));
        }
        if !tiles.contains(&id) {
            tiles.push(id);
        }
    }
    let mut o = Map::new();
    for (key, val) in [("order", order), ("hidden", hidden), ("tiles", tiles)] {
        if !val.is_empty() {
            o.insert(key.into(), json!(val));
        }
    }
    if !blocks.is_empty() {
        o.insert("blocks".into(), Value::Array(blocks));
    }
    Ok(if o.is_empty() { None } else { Some(Value::Object(o)) })
}

/// `menu` or `header`: `order` (some or all of the parts, `tab:<id>` too in the
/// menu) and `hidden`. None when it says nothing (the usual island).
fn parts(v: Option<&Value>, what: &str, known: &[&str], tabs: &[String]) -> Result<Option<Value>, String> {
    let Some(v) = v.filter(|x| x.is_object()) else { return Ok(None) };
    let strings = |key: &str| -> Vec<String> {
        v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).collect()).unwrap_or_default()
    };
    let list = known.join(", ");
    let mut order: Vec<String> = Vec::new();
    for id in strings("order") {
        let tab_ok = id.strip_prefix("tab:").is_some_and(|t| tabs.iter().any(|x| x == t));
        // The integrations' list keeps its place (it scrolls): hidden or shown only.
        if !(known.contains(&id.as_str()) && id != "integrations") && !tab_ok {
            return Err(tf("«{id}» non è una parte di «{what}»: {list}.", &[("id", &id), ("what", &what), ("list", &list)]));
        }
        if !order.contains(&id) {
            order.push(id);
        }
    }
    let mut hidden: Vec<String> = Vec::new();
    for id in strings("hidden") {
        if !known.contains(&id.as_str()) || id == "own" {
            return Err(tf("«{id}» non si può nascondere in «{what}»: {list}.", &[("id", &id), ("what", &what), ("list", &list)]));
        }
        if ALWAYS_SHOWN.contains(&id.as_str()) {
            return Err(tf("«{id}» resta sempre: serve per tornare indietro.", &[("id", &id)]));
        }
        if !hidden.contains(&id) {
            hidden.push(id);
        }
    }
    let mut o = Map::new();
    if !order.is_empty() {
        o.insert("order".into(), json!(order));
    }
    if !hidden.is_empty() {
        o.insert("hidden".into(), json!(hidden));
    }
    Ok(if o.is_empty() { None } else { Some(Value::Object(o)) })
}

fn read_valid(path: &std::path::Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    normalize(&serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')).ok()?).ok()
}

fn versions() -> Vec<PathBuf> {
    let mut all: Vec<PathBuf> = std::fs::read_dir(versions_dir())
        .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect())
        .unwrap_or_default();
    all.sort();
    all
}

/// The layout the island shows: `isola.json`, or the newest valid version if it is broken.
pub fn load() -> Value {
    let path = file();
    if !path.exists() {
        return empty();
    }
    if let Some(v) = read_valid(&path) {
        return v;
    }
    crate::log::line("isola.json non valido: uso l'ultima versione buona");
    versions().iter().rev().find_map(|p| read_valid(p)).unwrap_or_else(empty)
}

/// Copies the current file into `isola-versioni\` (the last `KEEP_VERSIONS`).
fn keep_version() {
    let Ok(bytes) = std::fs::read(file()) else { return };
    let dir = versions_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = crate::hooks::stamp();
    // Two changes in the same second: a counter keeps both, in order.
    let to = (0..100)
        .map(|n| dir.join(format!("isola-{stamp}-{n:02}.json")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| dir.join(format!("isola-{stamp}-99.json")));
    let _ = crate::settings::write_atomic(&to, &bytes);
    let all = versions();
    for p in all.iter().take(all.len().saturating_sub(KEEP_VERSIONS)) {
        let _ = std::fs::remove_file(p);
    }
}

fn write(app: &AppHandle, v: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(crate::settings::config_dir()).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&file(), &bytes).map_err(|e| e.to_string())?;
    let _ = app.emit("island-layout", v.clone());
    Ok(())
}

/// The layout after `args`: a whole `layout`, or pieces (button, buttons,
/// remove_buttons, tab, tabs, remove_tabs, tab_buttons for one tab).
pub fn apply(old: &Value, args: &Value) -> Result<Value, String> {
    if let Some(whole) = args.get("layout").filter(|v| v.is_object()) {
        return normalize(whole);
    }
    let mut v = old.clone();
    let arr = |v: &mut Value, key: &str| -> Vec<Value> { v.get(key).and_then(Value::as_array).cloned().unwrap_or_default() };
    let one_or_many = |key1: &str, key2: &str| -> Vec<Value> {
        let mut out: Vec<Value> = args.get(key2).and_then(Value::as_array).cloned().unwrap_or_default();
        if let Some(x) = args.get(key1).filter(|x| x.is_object()) {
            out.push(x.clone());
        }
        out
    };
    let strings = |key: &str| -> Vec<String> {
        args.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
    };
    // Replaces the one with the same id, else adds it at the end.
    let upsert = |list: &mut Vec<Value>, item: Value| {
        let id = text(&item, "id").to_string();
        match list.iter_mut().find(|x| text(x, "id") == id) {
            Some(x) => *x = item,
            None => list.push(item),
        }
    };

    let mut tabs = arr(&mut v, "tabs");
    let gone_tabs = strings("remove_tabs");
    tabs.retain(|x| !gone_tabs.iter().any(|g| g == text(x, "id")));
    for tab in one_or_many("tab", "tabs") {
        upsert(&mut tabs, tab);
    }
    // Buttons of one tab, without sending the whole tab again.
    if let Some(tb) = args.get("tab_buttons").filter(|x| x.is_object()) {
        let tid = text(tb, "tab");
        let tab = tabs.iter_mut().find(|x| text(x, "id") == tid).ok_or_else(|| tf("Nessuna scheda con l'id «{id}».", &[("id", &tid)]))?;
        let mut inner = tab.get("buttons").and_then(Value::as_array).cloned().unwrap_or_default();
        let gone: Vec<&str> = tb.get("remove").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        inner.retain(|x| !gone.contains(&text(x, "id")));
        for b in tb.get("buttons").and_then(Value::as_array).cloned().unwrap_or_default() {
            upsert(&mut inner, b);
        }
        tab["buttons"] = Value::Array(inner);
    }
    // Blocks of one tab, the same way.
    if let Some(tb) = args.get("tab_blocks").filter(|x| x.is_object()) {
        let tid = text(tb, "tab");
        let tab = tabs.iter_mut().find(|x| text(x, "id") == tid).ok_or_else(|| tf("Nessuna scheda con l'id «{id}».", &[("id", &tid)]))?;
        let mut inner = tab.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
        let gone: Vec<&str> = tb.get("remove").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        inner.retain(|x| !gone.contains(&text(x, "id")));
        for b in tb.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default() {
            upsert(&mut inner, b);
        }
        tab["blocks"] = Value::Array(inner);
    }

    let mut buttons = arr(&mut v, "buttons");
    let gone = strings("remove_buttons");
    buttons.retain(|x| !gone.iter().any(|g| g == text(x, "id")));
    for b in one_or_many("button", "buttons") {
        upsert(&mut buttons, b);
    }
    v["tabs"] = Value::Array(tabs);
    v["buttons"] = Value::Array(buttons);
    // The island's own parts: given whole (order and hidden), or back as usual.
    for key in ["menu", "header"] {
        if let Some(x) = args.get(key).filter(|x| x.is_object()) {
            v[key] = x.clone();
        }
    }
    // The Panoramica: given whole but for its blocks, which stay unless given
    // (`overview_blocks` adds, replaces or removes them one by one).
    if let Some(x) = args.get("overview").filter(|x| x.is_object()) {
        let keep = v.get("overview").and_then(|o| o.get("blocks")).cloned();
        let mut nx = x.clone();
        if nx.get("blocks").is_none() {
            if let Some(b) = keep {
                nx["blocks"] = b;
            }
        }
        v["overview"] = nx;
    }
    if let Some(ob) = args.get("overview_blocks").filter(|x| x.is_object()) {
        if !v.get("overview").is_some_and(Value::is_object) {
            v["overview"] = json!({});
        }
        let mut inner = v["overview"].get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
        let gone: Vec<String> = ob.get("remove").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
        inner.retain(|x| !gone.iter().any(|g| g == text(x, "id")));
        for b in ob.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default() {
            upsert(&mut inner, b);
        }
        v["overview"]["blocks"] = Value::Array(inner);
        if let Some(order) = v["overview"].get_mut("order").and_then(Value::as_array_mut) {
            order.retain(|x| x.as_str().and_then(|s| s.strip_prefix("block:")).is_none_or(|b| !gone.iter().any(|g| g == b)));
        }
    }
    // A tab taken away leaves the menu's order without it (a tab that never was stays an error).
    if let Some(order) = v.get_mut("menu").and_then(|m| m.get_mut("order")).and_then(Value::as_array_mut) {
        order.retain(|x| x.as_str().and_then(|s| s.strip_prefix("tab:")).is_none_or(|t| !gone_tabs.iter().any(|g| g == t)));
    }
    for key in strings("reset") {
        if key == "menu" || key == "header" || key == "overview" {
            if let Some(o) = v.as_object_mut() {
                o.remove(&key);
            }
        }
    }
    normalize(&v)
}

fn names(v: &Value, key: &str, name_key: &str) -> Vec<(String, String, String)> {
    v.get(key).and_then(Value::as_array).map(|a| {
        a.iter().map(|x| (text(x, "id").to_string(), text(x, name_key).to_string(), serde_json::to_string(x).unwrap_or_default())).collect()
    }).unwrap_or_default()
}

fn zone_name(z: &str) -> String {
    match z {
        "menu-bottom" => t("in fondo al menu"),
        _ => t("in alto, nella testata"),
    }
    .to_string()
}

/// What an action does, in words, for the card.
pub fn action_words(a: &Value) -> String {
    let s = |k: &str| text(a, k).to_string();
    match text(a, "kind") {
        "system" => match text(a, "what") {
            "lock" => t("blocca il PC").into(),
            "sleep" => t("sospende il PC (chiede conferma)").into(),
            "restart" => t("riavvia il PC (chiede conferma)").into(),
            "shutdown" => t("spegne il PC (chiede conferma)").into(),
            "recycle-empty" => t("svuota il cestino (chiede Windows)").into(),
            "recycle-open" => t("apre il cestino").into(),
            _ => t("apre Gestione attività").into(),
        },
        "windows" => tf("apre la pagina di Windows «{page}»", &[("page", &s("page"))]),
        "quick" => tf("esegue l'azione rapida {id}", &[("id", &s("id"))]),
        "app" => tf("apre {target}", &[("target", &format!("{} {}", s("target"), s("args")).trim().to_string())]),
        "url" => tf("apre {url}", &[("url", &s("url"))]),
        "view" => tf("apre {view}", &[("view", &s("view"))]),
        "chat" => tf("scrive nella chat: «{text}»", &[("text", &s("text"))]),
        _ => String::new(),
    }
}

/// What a block shows, in words, for the card.
pub fn block_words(b: &Value) -> String {
    let title = text(b, "title");
    let head = if title.is_empty() { String::new() } else { format!("«{title}»: ") };
    let filter = text(b, "filter");
    let only = if filter.is_empty() { String::new() } else { tf(" (solo «{f}»)", &[("f", &filter)]) };
    let src = b.get("source").map(|s| match text(s, "kind") {
        "apps" => t("le app installate").to_string(),
        "windows" => t("le finestre aperte").to_string(),
        "quick" => t("le azioni rapide").to_string(),
        _ => tf("i file di {path}", &[("path", &text(s, "path"))]),
    }).unwrap_or_default();
    let body = match text(b, "kind") {
        "grid" => tf("griglia con {src}{only}", &[("src", &src), ("only", &only)]),
        "list" => tf("elenco con {src}{only}", &[("src", &src), ("only", &only)]),
        "value" => tf("valore del PC «{what}»", &[("what", &text(b, "what"))]),
        "piece" => match text(b, "piece") {
            "integration" => tf("la card di {id}", &[("id", &text(b, "integration"))]),
            "news" => t("le notizie").to_string(),
            _ => t("le azioni rapide").to_string(),
        },
        _ => tf("testo «{text}»", &[("text", &text(b, "text").chars().take(60).collect::<String>())]),
    };
    format!("{head}{body}")
}

/// What goes from `old` to `new`, one line each, for the Consenti / Nega card.
pub fn changes(old: &Value, new: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let bdesc = |b: &Value| {
        let zone = text(b, "zone");
        let place = if zone.is_empty() { String::new() } else { format!(", {}", zone_name(zone)) };
        format!("«{}»{place}: {}", text(b, "label"), b.get("action").map(action_words).unwrap_or_default())
    };
    let obj = |v: &Value, key: &str, id: &str| v.get(key).and_then(Value::as_array).and_then(|a| a.iter().find(|x| text(x, "id") == id).cloned());
    for (id, _, json_new) in names(new, "buttons", "label") {
        let b = obj(new, "buttons", &id).unwrap_or_default();
        match names(old, "buttons", "label").into_iter().find(|x| x.0 == id) {
            None => out.push(tf("Nuovo pulsante {desc}", &[("desc", &bdesc(&b))])),
            Some((_, _, json_old)) if json_old != json_new => out.push(tf("Cambia il pulsante {desc}", &[("desc", &bdesc(&b))])),
            _ => {}
        }
    }
    for (id, name, _) in names(old, "buttons", "label") {
        if obj(new, "buttons", &id).is_none() {
            out.push(tf("Tolto il pulsante «{name}»", &[("name", &name)]));
        }
    }
    for (id, name, json_new) in names(new, "tabs", "name") {
        let tab = obj(new, "tabs", &id).unwrap_or_default();
        let n = tab.get("buttons").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
        match names(old, "tabs", "name").into_iter().find(|x| x.0 == id) {
            None if n == 0 => out.push(tf("Nuova scheda «{name}» nel menu", &[("name", &name)])),
            None => out.push(tf("Nuova scheda «{name}» nel menu, con {n} pulsanti", &[("name", &name), ("n", &n)])),
            Some((_, _, json_old)) if json_old != json_new => out.push(tf("Cambia la scheda «{name}» ({n} pulsanti)", &[("name", &name), ("n", &n)])),
            _ => {}
        }
        let before_blocks = obj(old, "tabs", &id).and_then(|t| t.get("blocks").and_then(Value::as_array).cloned()).unwrap_or_default();
        let now_blocks = tab.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
        for b in &now_blocks {
            if before_blocks.iter().find(|x| text(x, "id") == text(b, "id")) != Some(b) {
                out.push(format!("  ▦ {}", block_words(b)));
            }
        }
        for b in &before_blocks {
            if !now_blocks.iter().any(|x| text(x, "id") == text(b, "id")) {
                out.push(format!("  {}", tf("tolto il blocco {desc}", &[("desc", &block_words(b))])));
            }
        }
        if let Some(bs) = tab.get("buttons").and_then(Value::as_array) {
            let before = obj(old, "tabs", &id);
            for b in bs {
                let was = before.as_ref().and_then(|t| t.get("buttons")).and_then(Value::as_array).and_then(|a| a.iter().find(|x| text(x, "id") == text(b, "id")));
                if was != Some(b) {
                    out.push(format!("  • {}", bdesc(b)));
                }
            }
        }
    }
    for (id, name, _) in names(old, "tabs", "name") {
        if obj(new, "tabs", &id).is_none() {
            out.push(tf("Tolta la scheda «{name}»", &[("name", &name)]));
        }
    }
    let ob_old = old.get("overview").and_then(|o| o.get("blocks")).and_then(Value::as_array).cloned().unwrap_or_default();
    let ob_new = new.get("overview").and_then(|o| o.get("blocks")).and_then(Value::as_array).cloned().unwrap_or_default();
    for b in &ob_new {
        if ob_old.iter().find(|x| text(x, "id") == text(b, "id")) != Some(b) {
            out.push(tf("Panoramica: blocco {desc}", &[("desc", &block_words(b))]));
        }
    }
    for b in &ob_old {
        if !ob_new.iter().any(|x| text(x, "id") == text(b, "id")) {
            out.push(tf("Panoramica: tolto il blocco {desc}", &[("desc", &block_words(b))]));
        }
    }
    let tiles = |v: &Value| v.get("overview").and_then(|o| o.get("tiles")).cloned().unwrap_or(Value::Null);
    if tiles(old) != tiles(new) {
        let now = tiles(new);
        let list: Vec<&str> = now.as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        out.push(if list.is_empty() { t("Panoramica: riquadri nell'ordine del menu").to_string() } else { tf("Panoramica: per primi i riquadri {list}", &[("list", &list.join(", "))]) });
    }
    for (key, head) in [("menu", t("Menu")), ("header", t("Testata")), ("overview", t("Panoramica"))] {
        // Only an order asked for: a new tab or block takes its usual place without a line.
        let asked = |v: &Value| v.get(key).and_then(|m| m.get("order")).cloned().unwrap_or(Value::Null);
        if asked(old) != asked(new) {
            let names: Vec<String> = shown_order(new, key).iter().map(|id| part_name(new, id)).collect();
            out.push(tf("{head}: nuovo ordine {list}", &[("head", &head), ("list", &names.join(" · "))]));
        }
        let (h_old, h_new) = (hidden_of(old, key), hidden_of(new, key));
        for id in h_new.iter().filter(|x| !h_old.contains(x)) {
            out.push(tf("{head}: nascosto «{name}»", &[("head", &head), ("name", &part_name(new, id))]));
        }
        for id in h_old.iter().filter(|x| !h_new.contains(x)) {
            out.push(tf("{head}: di nuovo visibile «{name}»", &[("head", &head), ("name", &part_name(new, id))]));
        }
    }
    out
}

fn hidden_of(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(|m| m.get("hidden")).and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
}

/// The order the parts stand in: those named first, then the rest as usual
/// (the user's tabs after the sections in the menu).
pub fn shown_order(v: &Value, key: &str) -> Vec<String> {
    let mut out: Vec<String> = v.get(key).and_then(|m| m.get("order")).and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    let usual: Vec<String> = if key == "menu" {
        MENU_PARTS.iter().filter(|p| **p != "integrations").map(|p| p.to_string())
            .chain(v.get("tabs").and_then(Value::as_array).into_iter().flatten().map(|x| format!("tab:{}", text(x, "id"))))
            .collect()
    } else if key == "overview" {
        OVERVIEW_PARTS.iter().map(|p| p.to_string())
            .chain(v.get("overview").and_then(|o| o.get("blocks")).and_then(Value::as_array).into_iter().flatten().map(|x| format!("block:{}", text(x, "id"))))
            .collect()
    } else {
        HEADER_PARTS.iter().map(|p| p.to_string()).collect()
    };
    for p in usual {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// A part's name as the user sees it.
fn part_name(v: &Value, id: &str) -> String {
    if let Some(tile) = id.strip_prefix("tile:") {
        return tf("riquadro {id}", &[("id", &tile)]);
    }
    if let Some(b) = id.strip_prefix("block:") {
        let found = v.get("overview").and_then(|o| o.get("blocks")).and_then(Value::as_array).and_then(|a| a.iter().find(|x| text(x, "id") == b)).map(block_words);
        return found.unwrap_or_else(|| b.to_string());
    }
    if let Some(tab) = id.strip_prefix("tab:") {
        let name = v.get("tabs").and_then(Value::as_array).and_then(|a| a.iter().find(|x| text(x, "id") == tab)).map(|x| text(x, "name").to_string());
        return name.unwrap_or_else(|| tab.to_string());
    }
    match id {
        "overview" => t("Panoramica"),
        "agents" => t("Agenti"),
        "chat" => t("Chat"),
        "actions" => t("Azioni"),
        "files" => t("File e schermo"),
        "news" => t("Notizie"),
        "integrations" => t("Integrazioni"),
        "usage" => t("Consumo"),
        "own" => t("pulsanti aggiunti dalla chat"),
        "pin" => t("Tieni aperta"),
        "memory" => t("Mappa della memoria"),
        "settings" => t("Impostazioni"),
        "sound" => t("Silenzia"),
        "now" => t("Adesso"),
        "tiles" => t("riquadri delle integrazioni"),
        "quick" => t("Azioni rapide"),
        _ => id,
    }
    .to_string()
}

/// Before the Consenti / Nega card of `island_layout_set` / `island_layout_undo`:
/// what changes in `_changes` and the layout it leads to in `_draft` (the island
/// shows it while the card is up). Only for the card: the decision is a word.
pub fn annotate(payload: &mut Value) {
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default().to_string();
    let set = tool == "island_layout_set" || tool.ends_with("__island_layout_set");
    let undo = tool == "island_layout_undo" || tool.ends_with("__island_layout_undo");
    if !set && !undo {
        return;
    }
    let old = load();
    let new = if set {
        let Some(input) = payload.get("tool_input") else { return };
        match apply(&old, input) {
            Ok(n) => n,
            Err(e) => {
                if let Some(obj) = payload.get_mut("tool_input").and_then(Value::as_object_mut) {
                    obj.insert("_changes".into(), json!([tf("Non valida: {e}", &[("e", &e)])]));
                }
                return;
            }
        }
    } else {
        match versions().iter().rev().find_map(|p| read_valid(p)) {
            Some(v) => v,
            None => return,
        }
    };
    let notes = changes(&old, &new);
    if let Some(obj) = payload.get_mut("tool_input").and_then(Value::as_object_mut) {
        obj.insert("_changes".into(), json!(notes));
        obj.insert("_draft".into(), new);
    }
}

/// island_layout: what there is now, and what may go in it.
pub fn tool_get() -> String {
    let mut now = load();
    // The whole island as it is: the usual order and nothing hidden when the JSON says nothing.
    for key in ["menu", "header"] {
        now[key] = json!({ "order": shown_order(&now, key), "hidden": hidden_of(&now, key) });
    }
    let blocks = now.get("overview").and_then(|o| o.get("blocks")).cloned().unwrap_or(json!([]));
    let tiles = now.get("overview").and_then(|o| o.get("tiles")).cloned().unwrap_or(json!([]));
    now["overview"] = json!({ "order": shown_order(&now, "overview"), "hidden": hidden_of(&now, "overview"), "tiles": tiles, "blocks": blocks });
    let s = crate::settings::load();
    let active: Vec<String> = s.active_integrations.iter().cloned()
        .chain(crate::widgets::all_widgets(&s).into_iter().map(|w| format!("widget:{}", w.id)))
        .collect();
    let quick = s.actions.iter()
        .map(|a| format!("{} ({})", text(a, "name"), text(a, "id")))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{}\n\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}",
        serde_json::to_string_pretty(&now).unwrap_or_default(),
        t("Zone dei pulsanti"),
        ZONES.join(", "),
        t("Comandi di system"),
        SYSTEM.join(", "),
        t("Pagine di windows"),
        crate::pcfind::page_ids().join(", "),
        t("Viste di view (oltre a tab:<id>)"),
        VIEWS.join(", "),
        t("Azioni rapide dell'utente per quick"),
        if quick.is_empty() { t("nessuna").to_string() } else { quick },
        t("Blocchi delle schede"),
        BLOCKS.join(", "),
        t("Fonti di grid e list"),
        SOURCES.join(", "),
        t("Valori di value"),
        VALUES.join(", "),
        t("Parti di menu (order: anche tab:<id>; integrations solo hidden)"),
        MENU_PARTS.join(", "),
        t("Parti di header (Panoramica e Impostazioni non si nascondono)"),
        HEADER_PARTS.join(", "),
        t("Parti di overview (order: anche block:<id>; hidden: anche tile:<id>)"),
        OVERVIEW_PARTS.join(", "),
        t("Pezzi di piece"),
        PIECES.join(", "),
        t("Integrazioni attive (per piece integration e per i riquadri)"),
        if active.is_empty() { t("nessuna").to_string() } else { active.join(", ") },
    )
}

/// island_layout_set: applies the change (the user said Consenti on the card).
pub fn tool_set(app: &AppHandle, args: &Value) -> Result<String, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old = load();
    let new = apply(&old, args)?;
    let notes = changes(&old, &new);
    if notes.is_empty() {
        return Ok(t("Nessun cambiamento: l'isola era già così.").into());
    }
    keep_version();
    write(app, &new)?;
    crate::log::line(format!("isola da JSON: {} cambiamenti dalla chat", notes.len()));
    Ok(format!("{}\n{}", t("Fatto. Nell'isola adesso:"), notes.join("\n")))
}

/// island_layout_undo: back to the version before the last change.
pub fn tool_undo(app: &AppHandle) -> Result<String, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    undo(app)
}

fn undo(app: &AppHandle) -> Result<String, String> {
    let all = versions();
    let Some((path, prev)) = all.iter().rev().find_map(|p| read_valid(p).map(|v| (p.clone(), v))) else {
        return Err(t("Nessuna versione precedente da rimettere.").into());
    };
    let notes = changes(&load(), &prev);
    write(app, &prev)?;
    // Taken off the pile: «Annulla» again goes one further back.
    let _ = std::fs::remove_file(&path);
    crate::log::line("isola da JSON: annullata l'ultima modifica");
    Ok(format!("{}\n{}", t("Rimessa la versione di prima:"), notes.join("\n")))
}

#[tauri::command]
pub fn island_layout() -> Value {
    load()
}

/// Impostazioni → Aspetto → Isola aperta: «Annulla l'ultima modifica».
#[tauri::command]
pub fn island_layout_undo(app: AppHandle) -> Result<String, String> {
    tool_undo(&app)
}

/// Impostazioni: a button or a tab taken away by hand (`kind` "button" or "tab"),
/// or the menu, the header or the Panoramica back as usual (`kind` "menu", "header", "overview").
#[tauri::command]
pub fn island_layout_remove(app: AppHandle, kind: String, id: String) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old = load();
    let args = match kind.as_str() {
        "tab" => json!({ "remove_tabs": [id] }),
        "menu" | "header" | "overview" => json!({ "reset": [kind] }),
        _ => json!({ "remove_buttons": [id] }),
    };
    let new = apply(&old, &args)?;
    if new != old {
        keep_version();
        write(&app, &new)?;
    }
    Ok(())
}

/// A `folder` block: what is in it, folders first, by name; hidden files left out.
#[tauri::command]
pub async fn island_folder(path: String) -> Result<Vec<Value>, String> {
    if !folder_ok(&path) {
        return Err(t("Cartella non ammessa.").into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let full = expand_vars(&path);
        let rd = std::fs::read_dir(&full).map_err(|e| tf("Non riesco a leggere {path}: {e}", &[("path", &full), ("e", &e)]))?;
        let mut out: Vec<(bool, String, String)> = Vec::new();
        for e in rd.flatten().take(2000) {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.starts_with("~$") {
                continue;
            }
            {
                use std::os::windows::fs::MetadataExt;
                const HIDDEN: u32 = 0x2;
                if e.metadata().is_ok_and(|m| m.file_attributes() & HIDDEN != 0) {
                    continue;
                }
            }
            let dir = e.file_type().is_ok_and(|t| t.is_dir());
            out.push((!dir, name, e.path().to_string_lossy().into_owned()));
        }
        out.sort_by(|a, b| (a.0, a.1.to_lowercase()).cmp(&(b.0, b.1.to_lowercase())));
        Ok(out.into_iter().take(500).map(|(file, name, path)| json!({ "name": name, "path": path, "dir": !file })).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `%NAME%` replaced by the environment variable (left as it is when unknown).
fn expand_vars(p: &str) -> String {
    let mut out = String::new();
    let mut rest = p;
    while let Some(i) = rest.find('%') {
        out.push_str(rest.get(..i).unwrap_or_default());
        let after = rest.get(i + 1..).unwrap_or_default();
        match after.find('%') {
            Some(j) => {
                let name = after.get(..j).unwrap_or_default();
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = after.get(j + 1..).unwrap_or_default();
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Impostazioni → Isola aperta → Panoramica: the user's own click, so no card;
/// the same pieces as the chat's (`apply`), checked the same way, version kept.
#[tauri::command]
pub fn island_layout_apply(app: AppHandle, args: Value) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old = load();
    let new = apply(&old, &args)?;
    if new != old {
        keep_version();
        write(&app, &new)?;
    }
    Ok(())
}

/// How many older versions «Annulla» can go back to.
#[tauri::command]
pub fn island_layout_versions() -> usize {
    versions().len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn off() -> Value {
        json!({ "id": "spegni", "label": "Spegni", "icon": "i:power", "zone": "menu-bottom", "action": { "kind": "system", "what": "shutdown" } })
    }

    #[test]
    fn a_button_is_checked_and_kept_clean() {
        let v = normalize(&json!({ "buttons": [off()] })).unwrap();
        assert_eq!(v["buttons"][0]["action"], json!({ "kind": "system", "what": "shutdown" }));
        assert_eq!(v["tabs"], json!([]));
        let mut bad = off();
        bad["action"]["what"] = json!("format-c");
        assert!(normalize(&json!({ "buttons": [bad] })).is_err());
        let mut nowhere = off();
        nowhere["zone"] = json!("middle");
        assert!(normalize(&json!({ "buttons": [nowhere] })).is_err());
        let mut code = off();
        code["action"] = json!({ "kind": "script", "script": "rm -rf" });
        assert!(normalize(&json!({ "buttons": [code] })).is_err());
    }

    #[test]
    fn pieces_add_replace_and_remove() {
        let v = apply(&empty(), &json!({ "button": off() })).unwrap();
        assert_eq!(v["buttons"].as_array().unwrap().len(), 1);
        let mut renamed = off();
        renamed["label"] = json!("Spegni il PC");
        let v2 = apply(&v, &json!({ "button": renamed })).unwrap();
        assert_eq!(v2["buttons"].as_array().unwrap().len(), 1);
        assert_eq!(v2["buttons"][0]["label"], "Spegni il PC");
        assert!(changes(&v, &v2)[0].starts_with("Cambia"));
        let tab = json!({ "id": "pc", "name": "PC", "buttons": [{ "id": "w", "label": "Wi-Fi", "action": { "kind": "windows", "page": "wifi" } }] });
        let v3 = apply(&v2, &json!({ "tab": tab })).unwrap();
        let v4 = apply(&v3, &json!({ "tab_buttons": { "tab": "pc", "buttons": [{ "id": "b", "label": "BT", "action": { "kind": "windows", "page": "bluetooth" } }] } })).unwrap();
        assert_eq!(v4["tabs"][0]["buttons"].as_array().unwrap().len(), 2);
        let v5 = apply(&v4, &json!({ "remove_tabs": ["pc"], "remove_buttons": ["spegni"] })).unwrap();
        assert_eq!(v5, empty());
    }

    #[test]
    fn blocks_take_only_known_sources() {
        let apps = json!({ "id": "app", "name": "App", "blocks": [{ "id": "tutte", "kind": "grid", "source": { "kind": "apps" }, "search": true, "extra": 1 }] });
        let v = normalize(&json!({ "tabs": [apps] })).unwrap();
        assert_eq!(v["tabs"][0]["blocks"][0], json!({ "id": "tutte", "kind": "grid", "source": { "kind": "apps" }, "search": true }));
        let src = |s: Value| normalize(&json!({ "tabs": [{ "id": "x", "name": "X", "blocks": [{ "id": "b", "kind": "list", "source": s }] }] }));
        assert!(src(json!({ "kind": "folder", "path": "%USERPROFILE%\\Desktop" })).is_ok());
        assert!(src(json!({ "kind": "folder", "path": "C:\\Users\\me\\.ssh" })).is_err());
        assert!(src(json!({ "kind": "folder", "path": "Desktop" })).is_err());
        assert!(src(json!({ "kind": "shell", "cmd": "dir" })).is_err());
        let val = |w: &str| normalize(&json!({ "tabs": [{ "id": "x", "name": "X", "blocks": [{ "id": "b", "kind": "value", "what": w, "drive": "d:" }] }] }));
        assert_eq!(val("disk").unwrap()["tabs"][0]["blocks"][0]["drive"], "D");
        assert!(val("password").is_err());
        let one = apply(&v, &json!({ "tab_blocks": { "tab": "app", "blocks": [{ "id": "nota", "kind": "text", "text": "Ciao" }] } })).unwrap();
        assert_eq!(one["tabs"][0]["blocks"].as_array().unwrap().len(), 2);
        assert!(changes(&v, &one).iter().any(|l| l.contains("Ciao")));
        let none = apply(&one, &json!({ "tab_blocks": { "tab": "app", "remove": ["nota", "tutte"] } })).unwrap();
        assert!(none["tabs"][0].get("blocks").is_none());
        assert!(expand_vars("%NO_SUCH_VAR_X%\\a").starts_with("%NO_SUCH_VAR_X%"));
    }

    #[test]
    fn the_islands_own_parts_move_and_hide() {
        let base = normalize(&json!({ "tabs": [{ "id": "app", "name": "App" }] })).unwrap();
        assert_eq!(shown_order(&base, "menu"), ["overview", "agents", "chat", "actions", "files", "news", "tab:app"]);
        let moved = apply(&base, &json!({ "menu": { "order": ["tab:app", "chat"], "hidden": ["news", "integrations"] } })).unwrap();
        assert_eq!(shown_order(&moved, "menu")[..3], ["tab:app", "chat", "overview"]);
        let lines = changes(&base, &moved);
        assert!(lines.iter().any(|l| l.contains("nuovo ordine")));
        assert!(lines.iter().any(|l| l.contains("Notizie")));
        assert!(apply(&base, &json!({ "menu": { "hidden": ["overview"] } })).is_err());
        assert!(apply(&base, &json!({ "header": { "hidden": ["settings"] } })).is_err());
        assert!(apply(&base, &json!({ "menu": { "order": ["tab:altra"] } })).is_err());
        assert!(apply(&base, &json!({ "header": { "order": ["close"] } })).is_err());
        let back = apply(&moved, &json!({ "reset": ["menu"] })).unwrap();
        assert_eq!(back, base);
        // A tab taken away leaves the menu's order without it, not broken.
        let gone = apply(&moved, &json!({ "remove_tabs": ["app"] })).unwrap();
        assert_eq!(shown_order(&gone, "menu")[0], "chat");
    }

    #[test]
    fn the_overview_takes_blocks_tiles_and_order() {
        let ov = json!({ "overview": {
            "order": ["block:musica", "tiles"], "hidden": ["news", "tile:integration_vercel"], "tiles": ["integration_github"],
            "blocks": [{ "id": "musica", "kind": "piece", "piece": "integration", "integration": "integration_media" }],
        } });
        let v = apply(&empty(), &ov).unwrap();
        assert_eq!(shown_order(&v, "overview"), ["block:musica", "tiles", "now", "quick", "news"]);
        assert!(changes(&empty(), &v).iter().any(|l| l.contains("integration_media")));
        let bad = |o: Value| apply(&empty(), &json!({ "overview": o })).is_err();
        assert!(bad(json!({ "order": ["block:nessuno"] })));
        assert!(bad(json!({ "hidden": ["tile:<script>"] })));
        assert!(bad(json!({ "blocks": [{ "id": "x", "kind": "piece", "piece": "terminal" }] })));
        // Order given again: the blocks stay; a block taken away leaves the order.
        let v2 = apply(&v, &json!({ "overview": { "order": ["quick"] } })).unwrap();
        assert_eq!(v2["overview"]["blocks"].as_array().unwrap().len(), 1);
        let v3 = apply(&v, &json!({ "overview_blocks": { "remove": ["musica"] } })).unwrap();
        assert_eq!(shown_order(&v3, "overview")[0], "tiles");
        let in_tab = normalize(&json!({ "tabs": [{ "id": "x", "name": "X", "blocks": [{ "id": "n", "kind": "piece", "piece": "news" }] }] }));
        assert!(in_tab.is_ok());
        assert_eq!(apply(&v, &json!({ "reset": ["overview"] })).unwrap(), empty());
    }

    #[test]
    fn a_view_may_open_only_a_tab_that_exists() {
        let go = |to: &str| json!({ "buttons": [{ "id": "g", "label": "Vai", "zone": "header", "action": { "kind": "view", "view": to } }], "tabs": [{ "id": "pc", "name": "PC" }] });
        assert!(normalize(&go("tab:pc")).is_ok());
        assert!(normalize(&go("tab:altro")).is_err());
        assert!(normalize(&go("chat")).is_ok());
    }
}
