//! The island built from a JSON (docs/architettura.md → Isola da JSON): what
//! the user adds to the open island from the chat, in `%APPDATA%\EasyIsland\isola.json`.
//! Step 1: buttons in fixed places (the foot of the menu, the header) and tabs
//! of their own in the menu, each a grid of buttons. A button only does what
//! is in `ACTIONS` (a fixed list, never code); what the existing parts do is
//! never touched. Every change is asked first (Consenti / Nega, the card says
//! what changes), the version before is kept in `isola-versioni\` and
//! `undo` brings it back. A file that does not read as a valid layout (edited
//! by hand) gives way to the newest valid version.

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

const MAX_ZONE: usize = 12;
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
        tabs.push(Value::Object(o));
    }
    Ok(json!({ "buttons": buttons, "tabs": tabs }))
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

    let mut buttons = arr(&mut v, "buttons");
    let gone = strings("remove_buttons");
    buttons.retain(|x| !gone.iter().any(|g| g == text(x, "id")));
    for b in one_or_many("button", "buttons") {
        upsert(&mut buttons, b);
    }
    v["tabs"] = Value::Array(tabs);
    v["buttons"] = Value::Array(buttons);
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
            None => out.push(tf("Nuova scheda «{name}» nel menu, con {n} pulsanti", &[("name", &name), ("n", &n)])),
            Some((_, _, json_old)) if json_old != json_new => out.push(tf("Cambia la scheda «{name}» ({n} pulsanti)", &[("name", &name), ("n", &n)])),
            _ => {}
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
    out
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
    let now = load();
    let quick = crate::settings::load().actions.iter()
        .map(|a| format!("{} ({})", text(a, "name"), text(a, "id")))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{}\n\n{}: {}\n{}: {}\n{}: {}\n{}: {}\n{}: {}",
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

/// Impostazioni: a button or a tab taken away by hand (`kind` "button" or "tab").
#[tauri::command]
pub fn island_layout_remove(app: AppHandle, kind: String, id: String) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let old = load();
    let args = if kind == "tab" { json!({ "remove_tabs": [id] }) } else { json!({ "remove_buttons": [id] }) };
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
    fn a_view_may_open_only_a_tab_that_exists() {
        let go = |to: &str| json!({ "buttons": [{ "id": "g", "label": "Vai", "zone": "header", "action": { "kind": "view", "view": to } }], "tabs": [{ "id": "pc", "name": "PC" }] });
        assert!(normalize(&go("tab:pc")).is_ok());
        assert!(normalize(&go("tab:altro")).is_err());
        assert!(normalize(&go("chat")).is_ok());
    }
}
