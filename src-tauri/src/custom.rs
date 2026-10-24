// Integrazioni personali (asked by Edoardo on 23 October 2026: «crea
// un'integrazione per i preventivi… programmabile al 100%»). The chat writes a
// description, never code: fields (text, numbers, money, dates, check boxes,
// choices, rows of a table, computed values), a document template and actions
// (save, document, copy, ask the chat, link, quick action, Notion). The island
// draws it (src/views/custom.ts) and EasyIsland runs it. No script, no
// command: what an action can do is what these few kinds do.
//
// Files in %APPDATA%\EasyIsland\integrazioni: `<id>.json` the description,
// `<id>.schede.json` its saved records. Both readable and editable.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::i18n::{t, tf};

const MAX_FIELDS: usize = 60;
const MAX_ACTIONS: usize = 12;
const MAX_RECORDS: usize = 2000;
const MAX_TEMPLATE: usize = 40_000;

pub const FIELD_KINDS: &[&str] = &[
    "text", "textarea", "number", "money", "date", "checkbox", "select", "multiselect", "email", "phone", "url", "rows", "computed",
    "counter", "link", "file",
];
pub const COLUMN_KINDS: &[&str] = &["text", "number", "money", "checkbox", "select", "date", "computed"];
pub const ACTION_KINDS: &[&str] = &["save", "document", "copy", "ai", "url", "quick", "notion", "fill", "export", "http", "task", "notice", "steps"];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Column {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub options: Vec<String>,
    /// computed: over the row's columns, "quantita*prezzo".
    pub formula: String,
    /// computed: money (default), number, percent, text, date, yesno.
    pub format: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Field {
    pub id: String,
    pub label: String,
    pub kind: String,
    /// select / multiselect.
    pub options: Vec<String>,
    pub required: bool,
    /// The starting value, as text ("true" for a check box, "oggi" for today's date).
    #[serde(rename = "default")]
    pub default_value: String,
    pub help: String,
    /// rows: the table's columns.
    pub columns: Vec<Column>,
    /// computed: "sum(quantita*prezzo)", "imponibile*0,22", "imponibile+iva".
    pub formula: String,
    /// counter: what goes before the number, "PREV-{anno}-" (the year restarts the count).
    pub prefix: String,
    /// counter: digits of the number (3 → 001).
    pub digits: u32,
    /// Shown only when: "urgente" (checked or filled) or "pagamento=Bonifico".
    pub show_if: String,
    /// link: the id of another integration, its records to pick from.
    pub source: String,
    /// In the list of the saved records: summed (numbers) or counted (choices).
    pub summary: bool,
    /// computed: money (default), number, percent, text, date, yesno.
    pub format: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Action {
    pub label: String,
    pub kind: String,
    /// ai: the question for the chat, with {{campi}}.
    pub prompt: String,
    /// url: the link, with {{campi}} (encoded).
    pub url: String,
    /// quick: the quick action's id.
    pub quick: String,
    /// notion: the database (name or id); its properties are the fields' labels.
    pub database: String,
    /// document: "html" (printable, the default) or "md".
    pub format: String,
    /// http: GET, POST, PUT, PATCH or DELETE (url above).
    pub method: String,
    /// http: headers, with {{campi}} and {{secret:nome}}.
    pub headers: Map<String, Value>,
    /// http: the body, with {{campi}} (JSON or text).
    pub body: String,
    /// http: what of the answer goes into the fields: { id_campo: "percorso.nella.risposta" }.
    pub store: Map<String, Value>,
    /// http, task, notice: the text, with {{campi}} and {{risposta.percorso}}.
    pub message: String,
    /// Several actions in a row, by their labels (the first that fails stops).
    pub steps: Vec<String>,
}

/// Data that comes from a service: read every `every` minutes (0 = when asked)
/// and shown in the card as values or a list; `alert` warns on the island.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub label: String,
    pub method: String,
    pub url: String,
    pub headers: Map<String, Value>,
    pub body: String,
    pub every: u32,
    /// The path of the list in the answer ("" = the answer itself, when it is a list).
    pub items: String,
    /// For each item of the list: its title, its line under it, a value on the right (paths).
    pub title: String,
    pub subtitle: String,
    pub value: String,
    /// Single values out of the answer: { "Etichetta": "percorso" }.
    pub values: Map<String, Value>,
    /// A formula over the answer (or each item): true = an alert on the island.
    pub alert: String,
    /// The alert's text, with {{percorso}}.
    pub alert_text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Custom {
    pub id: String,
    pub name: String,
    /// An emoji or one or two letters.
    pub icon: String,
    pub color: String,
    pub description: String,
    /// In the island's menu.
    pub enabled: bool,
    pub fields: Vec<Field>,
    /// The document: Markdown with {{campo}}, {{#righe}}…{{/righe}} for a table's rows.
    pub template: String,
    pub actions: Vec<Action>,
    /// The field that names a record in the list (the first text field when empty).
    pub title_field: String,
    /// Data read from services (lists, values, alerts).
    pub sources: Vec<Source>,
    /// The names of its keys ({{secret:nome}}), kept in Windows' Credential Manager.
    pub secrets: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Record {
    pub id: String,
    pub created: String,
    pub updated: String,
    pub values: Map<String, Value>,
}

pub fn dir() -> PathBuf {
    crate::settings::config_dir().join("integrazioni")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn key_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// "Quantità" → "quantita": the key a label gets when the chat gave none.
fn key_of(label: &str) -> String {
    crate::skills::slug(label).replace('-', "_")
}

fn now() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute)
}

/// Checks and tidies a description: keys, kinds, options, formulas' names.
/// Every error says what to change, for the chat as for the user.
pub fn normalize(mut c: Custom) -> Result<Custom, String> {
    c.name = c.name.trim().chars().take(60).collect();
    if c.name.is_empty() {
        return Err(t("name: il nome dell'integrazione.").into());
    }
    if c.id.trim().is_empty() {
        c.id = crate::skills::slug(&c.name);
    }
    c.id = c.id.trim().to_lowercase();
    if !valid_id(&c.id) {
        return Err(t("id: lettere minuscole, cifre e trattini.").into());
    }
    // "#rrggbb", or the tasks' blue.
    let hex = c.color.len() == 7 && c.color.starts_with('#') && c.color.get(1..).is_some_and(|h| h.chars().all(|x| x.is_ascii_hexdigit()));
    if !hex {
        c.color = "#0EA5E9".into();
    }
    c.icon = c.icon.trim().chars().take(4).collect();
    if c.fields.is_empty() && c.sources.is_empty() {
        return Err(t("fields o sources: almeno un campo o una fonte di dati.").into());
    }
    if c.fields.len() > MAX_FIELDS {
        return Err(tf("fields: al massimo {n} campi.", &[("n", &MAX_FIELDS.to_string())]));
    }
    let mut seen = std::collections::HashSet::new();
    for f in &mut c.fields {
        f.label = f.label.trim().chars().take(80).collect();
        if f.id.trim().is_empty() {
            f.id = key_of(&f.label);
        }
        f.id = f.id.trim().to_string();
        if !key_ok(&f.id) {
            return Err(tf("Campo «{l}»: id con sole lettere, cifre e _.", &[("l", &f.label)]));
        }
        if !seen.insert(f.id.clone()) {
            return Err(tf("Due campi con lo stesso id: {id}.", &[("id", &f.id)]));
        }
        if f.label.is_empty() {
            f.label = f.id.clone();
        }
        if !FIELD_KINDS.contains(&f.kind.as_str()) {
            return Err(tf("Campo «{l}»: kind deve essere uno di {k}.", &[("l", &f.label), ("k", &FIELD_KINDS.join(", "))]));
        }
        if matches!(f.kind.as_str(), "select" | "multiselect") && f.options.is_empty() {
            return Err(tf("Campo «{l}»: options con le scelte.", &[("l", &f.label)]));
        }
        if f.kind == "rows" {
            if f.columns.is_empty() {
                return Err(tf("Campo «{l}»: columns con le colonne della tabella.", &[("l", &f.label)]));
            }
            let mut cols = std::collections::HashSet::new();
            for col in &mut f.columns {
                col.label = col.label.trim().chars().take(60).collect();
                if col.id.trim().is_empty() {
                    col.id = key_of(&col.label);
                }
                if !key_ok(&col.id) || !cols.insert(col.id.clone()) {
                    return Err(tf("Colonna «{l}»: id unico con sole lettere, cifre e _.", &[("l", &col.label)]));
                }
                if col.kind.is_empty() {
                    col.kind = "text".into();
                }
                if !COLUMN_KINDS.contains(&col.kind.as_str()) {
                    return Err(tf("Colonna «{l}»: kind deve essere uno di {k}.", &[("l", &col.label), ("k", &COLUMN_KINDS.join(", "))]));
                }
                if col.kind == "computed" && col.formula.trim().is_empty() {
                    return Err(tf("Colonna «{l}»: formula sulle colonne della riga, es. quantita*prezzo.", &[("l", &col.label)]));
                }
            }
        }
        if f.kind == "counter" {
            f.digits = if f.digits == 0 { 3 } else { f.digits.min(8) };
            f.prefix = f.prefix.chars().take(30).collect();
        }
        if f.kind == "link" && !valid_id(f.source.trim()) {
            return Err(tf("Campo «{l}»: source, l'id dell'integrazione da cui scegliere (vedi custom_list).", &[("l", &f.label)]));
        }
        if f.kind == "computed" && f.formula.trim().is_empty() {
            return Err(tf("Campo «{l}»: formula, es. sum(quantita*prezzo) oppure imponibile*0,22.", &[("l", &f.label)]));
        }
    }
    if c.template.len() > MAX_TEMPLATE {
        return Err(t("template: al massimo 40.000 caratteri.").into());
    }
    if c.actions.len() > MAX_ACTIONS {
        return Err(tf("actions: al massimo {n}.", &[("n", &MAX_ACTIONS.to_string())]));
    }
    if c.actions.is_empty() {
        c.actions.push(Action { label: t("Salva").into(), kind: "save".into(), ..Default::default() });
    }
    for a in &mut c.actions {
        if !ACTION_KINDS.contains(&a.kind.as_str()) {
            return Err(tf("Azione «{l}»: kind deve essere uno di {k}.", &[("l", &a.label), ("k", &ACTION_KINDS.join(", "))]));
        }
        if a.label.trim().is_empty() {
            a.label = a.kind.clone();
        }
        match a.kind.as_str() {
            "ai" if a.prompt.trim().is_empty() => return Err(tf("Azione «{l}»: prompt, la domanda per la chat.", &[("l", &a.label)])),
            "url" | "http" if !(a.url.starts_with("https://") || a.url.starts_with("http://")) => {
                return Err(tf("Azione «{l}»: url deve iniziare con https:// o http://.", &[("l", &a.label)]));
            }
            "http" if host_of(&a.url).is_none() => {
                return Err(tf("Azione «{l}»: l'indirizzo del servizio va scritto per intero, senza {{campi}} prima del primo /.", &[("l", &a.label)]));
            }
            "task" | "notice" if a.message.trim().is_empty() => {
                return Err(tf("Azione «{l}»: message, il testo.", &[("l", &a.label)]));
            }
            "steps" if a.steps.is_empty() => return Err(tf("Azione «{l}»: steps, le etichette delle azioni da fare in fila.", &[("l", &a.label)])),
            "quick" if a.quick.trim().is_empty() => return Err(tf("Azione «{l}»: quick, l'id dell'azione rapida.", &[("l", &a.label)])),
            "notion" if a.database.trim().is_empty() => return Err(tf("Azione «{l}»: database di Notion.", &[("l", &a.label)])),
            _ => {}
        }
        if a.kind == "document" && a.format != "md" {
            a.format = "html".into();
        }
        if a.kind == "http" {
            a.method = method_of(&a.method)?;
        }
    }
    let labels: Vec<String> = c.actions.iter().map(|a| a.label.clone()).collect();
    for a in c.actions.iter().filter(|a| a.kind == "steps") {
        if let Some(missing) = a.steps.iter().find(|s| !labels.contains(s) || *s == &a.label) {
            return Err(tf("Azione «{l}»: in steps «{m}» non è l'etichetta di un'altra azione.", &[("l", &a.label), ("m", missing)]));
        }
    }
    let mut ids = std::collections::HashSet::new();
    for s in &mut c.sources {
        if s.id.trim().is_empty() {
            s.id = key_of(if s.label.is_empty() { "dati" } else { &s.label });
        }
        if s.label.trim().is_empty() {
            s.label = s.id.clone();
        }
        if !key_ok(&s.id) || !ids.insert(s.id.clone()) {
            return Err(tf("Fonte «{l}»: id unico con sole lettere, cifre e _.", &[("l", &s.label)]));
        }
        if !(s.url.starts_with("https://") || s.url.starts_with("http://")) || host_of(&s.url).is_none() {
            return Err(tf("Fonte «{l}»: url completo, https://servizio/…", &[("l", &s.label)]));
        }
        s.method = method_of(&s.method)?;
        // At most every minute; 0 = only when asked.
        if s.every > 0 {
            s.every = s.every.clamp(1, 1440);
        }
    }
    c.secrets = c.secrets.iter().map(|x| x.trim().to_string()).filter(|x| key_ok(x)).take(10).collect();
    // No template: one with every field, so a document can always be made.
    if c.template.trim().is_empty() {
        c.template = default_template(&c);
    }
    if !c.title_field.is_empty() && !c.fields.iter().any(|f| f.id == c.title_field) {
        c.title_field = String::new();
    }
    Ok(c)
}

/// "https://api.esempio.it/v1/x?{{a}}" → "https://api.esempio.it": scheme and
/// host, written out (no {{…}} in them). Calls go only to these (`http`).
fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").map(|r| ("https://", r)).or_else(|| url.strip_prefix("http://").map(|r| ("http://", r)))?;
    let host = rest.1.split(['/', '?', '#']).next().unwrap_or_default();
    if host.is_empty() || host.contains("{{") || host.contains('@') {
        return None;
    }
    Some(format!("{}{}", rest.0, host.to_lowercase()))
}

fn method_of(m: &str) -> Result<String, String> {
    let m = if m.trim().is_empty() { "GET".to_string() } else { m.trim().to_uppercase() };
    if ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&m.as_str()) {
        Ok(m)
    } else {
        Err(tf("method: GET, POST, PUT, PATCH o DELETE, non {m}.", &[("m", &m)]))
    }
}

/// A document with every field: a title, a line per field, a table per table.
pub fn default_template(c: &Custom) -> String {
    let mut out = format!("# {}\n\n", c.name);
    for f in &c.fields {
        if f.kind == "rows" {
            let head = f.columns.iter().map(|x| x.label.as_str()).collect::<Vec<_>>().join(" | ");
            let line = f.columns.iter().map(|_| "---").collect::<Vec<_>>().join(" | ");
            let cells = f.columns.iter().map(|x| format!("{{{{{}}}}}", x.id)).collect::<Vec<_>>().join(" | ");
            out.push_str(&format!("**{}**\n\n| {head} |\n| {line} |\n{{{{#{id}}}}}| {cells} |\n{{{{/{id}}}}}\n", f.label, id = f.id));
        } else {
            out.push_str(&format!("**{}:** {{{{{}}}}}  \n", f.label, f.id));
        }
    }
    out
}

/// The next number of a counter: the highest saved with the same prefix, plus one.
fn next_counter(f: &Field, all: &[Record]) -> String {
    let year = now().get(..4).unwrap_or("2026").to_string();
    let prefix = f.prefix.replace("{anno}", &year).replace("{year}", &year);
    let top = all.iter()
        .filter_map(|r| r.values.get(&f.id).and_then(Value::as_str))
        .filter_map(|v| v.strip_prefix(prefix.as_str()))
        .filter_map(|n| n.trim().parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    format!("{prefix}{:0width$}", top + 1, width = f.digits.max(1) as usize)
}

fn def_file(id: &str) -> PathBuf {
    dir().join(format!("{id}.json"))
}

fn records_file(id: &str) -> PathBuf {
    dir().join(format!("{id}.schede.json"))
}

pub fn list() -> Vec<Custom> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir()) else { return out };
    for e in entries.flatten().take(400) {
        let path = e.path();
        let name = path.file_name().and_then(|x| x.to_str()).unwrap_or_default().to_string();
        if !name.ends_with(".json") || name.ends_with(".schede.json") {
            continue;
        }
        let Some(c) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Custom>(&b).ok()) else { continue };
        if let Ok(c) = normalize(c) {
            out.push(c);
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn get(id: &str) -> Option<Custom> {
    let want = id.trim().trim_start_matches("custom:");
    list().into_iter().find(|c| c.id == want || c.name.eq_ignore_ascii_case(want))
}

fn changed(app: &AppHandle) {
    let _ = app.emit("customs-changed", list());
}

/// Creates or replaces a description. `create`: refuses an id already taken.
pub fn save(app: &AppHandle, c: Custom, create: bool) -> Result<Custom, String> {
    let c = normalize(c)?;
    if create && def_file(&c.id).exists() {
        return Err(tf("Esiste già un'integrazione «{id}»: usa custom_update per cambiarla.", &[("id", &c.id)]));
    }
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&c).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&def_file(&c.id), &bytes).map_err(|e| e.to_string())?;
    crate::log::line(format!("integrazioni personali: salvata {}", c.id));
    changed(app);
    Ok(c)
}

/// Only from Impostazioni (a click): the description and its records go.
pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(t("Integrazione non trovata.").into());
    }
    let _ = std::fs::remove_file(records_file(id));
    std::fs::remove_file(def_file(id)).map_err(|e| e.to_string())?;
    changed(app);
    Ok(())
}

pub fn records(id: &str) -> Vec<Record> {
    if !valid_id(id) {
        return Vec::new();
    }
    std::fs::read(records_file(id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_records(id: &str, all: &[Record]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&records_file(id), &bytes).map_err(|e| e.to_string())
}

/// Saves a record: a new one (`record` empty) or the one with that id.
pub fn save_record(app: &AppHandle, id: &str, record: &str, values: Map<String, Value>) -> Result<Record, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    // Only the fields it has, and the required ones filled.
    let mut kept = Map::new();
    for f in &c.fields {
        if let Some(v) = values.get(&f.id) {
            kept.insert(f.id.clone(), v.clone());
        }
        let empty = match kept.get(&f.id) {
            None | Some(Value::Null) => true,
            Some(Value::String(s)) => s.trim().is_empty(),
            Some(Value::Array(a)) => a.is_empty(),
            _ => false,
        };
        if f.required && empty && f.kind != "computed" {
            return Err(tf("Manca «{l}».", &[("l", &f.label)]));
        }
    }
    let mut all = records(&c.id);
    // A counter is given here, once, when it is still empty.
    for f in c.fields.iter().filter(|f| f.kind == "counter") {
        let empty = kept.get(&f.id).and_then(Value::as_str).is_none_or(|s| s.trim().is_empty());
        if empty {
            kept.insert(f.id.clone(), json!(next_counter(f, &all)));
        }
    }
    let stamp = now();
    let saved = match all.iter_mut().find(|r| !record.is_empty() && r.id == record) {
        Some(r) => {
            r.values = kept;
            r.updated = stamp;
            r.clone()
        }
        None => {
            let r = Record {
                id: format!("{}-{}", stamp.chars().filter(char::is_ascii_digit).collect::<String>(), crate::msgraph::random(2).iter().map(|b| format!("{b:02x}")).collect::<String>()),
                created: stamp.clone(),
                updated: stamp,
                values: kept,
            };
            all.push(r.clone());
            r
        }
    };
    if all.len() > MAX_RECORDS {
        return Err(tf("Al massimo {n} schede: esportale o eliminane qualcuna.", &[("n", &MAX_RECORDS.to_string())]));
    }
    write_records(&c.id, &all)?;
    let _ = app.emit("custom-records", json!({ "id": c.id }));
    Ok(saved)
}

/// Only from a click in the island or in Impostazioni.
pub fn delete_record(app: &AppHandle, id: &str, record: &str) -> Result<(), String> {
    let mut all = records(id);
    let before = all.len();
    all.retain(|r| r.id != record);
    if all.len() == before {
        return Err(t("Scheda non trovata.").into());
    }
    write_records(id, &all)?;
    let _ = app.emit("custom-records", json!({ "id": id }));
    Ok(())
}

/// A document of a record (the template already filled by the island): into the Vassoio.
pub fn document(name: &str, ext: &str, text: &str) -> Result<crate::files::DroppedFile, String> {
    let ext = match ext {
        "md" => "md",
        "csv" => "csv",
        _ => "html",
    };
    let base: String = crate::skills::slug(name).chars().take(60).collect();
    let base = if base.is_empty() { "documento".to_string() } else { base };
    let tmp = std::env::temp_dir().join(format!("easyisland-{base}.{ext}"));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    let out = crate::files::ingest(&tmp.to_string_lossy());
    let _ = std::fs::remove_file(&tmp);
    out
}

/// «Compila con l'IA»: the fields read from a text (a mail, notes) by the
/// chat's engine, in a conversation of its own. Only the fields it has; the
/// user sees them in the form before saving.
pub async fn fill(app: &AppHandle, id: &str, text: &str) -> Result<Map<String, Value>, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    if text.trim().is_empty() {
        return Err(t("Incolla prima il testo da cui compilare.").into());
    }
    let schema: Vec<Value> = c.fields.iter().filter(|f| !matches!(f.kind.as_str(), "computed" | "counter")).map(|f| {
        let mut v = json!({ "id": f.id, "label": f.label, "kind": f.kind });
        if !f.options.is_empty() {
            v["options"] = json!(f.options);
        }
        if !f.columns.is_empty() {
            v["columns"] = json!(f.columns.iter().filter(|x| x.kind != "computed").map(|x| json!({ "id": x.id, "label": x.label, "kind": x.kind })).collect::<Vec<_>>());
        }
        v
    }).collect();
    let prompt = tf(
        "Compila i campi del modulo «{name}» con le informazioni del testo qui sotto. Rispondi solo con un oggetto JSON {{ id_campo: valore }}: numeri e importi come numeri, date AAAA-MM-GG, caselle true/false, scelte esattamente tra le options, una tabella come elenco di oggetti con gli id delle colonne. Lascia fuori i campi che il testo non dice; non inventare.\n\nCampi: {schema}\n\nTesto:\n{text}",
        &[("name", &c.name), ("schema", &serde_json::to_string(&schema).unwrap_or_default()), ("text", &text.chars().take(12_000).collect::<String>())],
    );
    let chat = crate::claude::Chat::default();
    let reply = crate::chat_turn(app, &chat, prompt, None, None, None, false, crate::Channel::Helper, &|_| {}).await?;
    crate::opencode::forget(chat.cli_session());
    let raw = reply.text;
    let start = raw.find('{').ok_or(t("L'IA non ha risposto con i campi: riprova o compila a mano."))?;
    let end = raw.rfind('}').ok_or(t("L'IA non ha risposto con i campi: riprova o compila a mano."))?;
    let json_text = raw.get(start..=end).unwrap_or_default();
    let found: Map<String, Value> = serde_json::from_str(json_text).map_err(|_| t("L'IA non ha risposto con i campi: riprova o compila a mano."))?;
    Ok(found.into_iter().filter(|(k, _)| c.fields.iter().any(|f| &f.id == k && !matches!(f.kind.as_str(), "computed" | "counter"))).collect())
}

// ── Services (http actions and sources) ─────────────────────────────────────

/// What a service answered.
#[derive(Clone, Debug, Serialize)]
pub struct Reply {
    pub status: u16,
    pub ok: bool,
    /// The answer read as JSON when it is, else as text (cut at 200 KB).
    pub data: Value,
}

const MAX_ANSWER: usize = 200 * 1024;

/// {{secret:nome}} → the key kept for this integration; an error naming the missing one.
fn with_secrets(id: &str, text: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{secret:") {
        out.push_str(rest.get(..start).unwrap_or_default());
        let after = rest.get(start + 9..).unwrap_or_default();
        let Some(end) = after.find("}}") else { break };
        let name = after.get(..end).unwrap_or_default().trim();
        let value = crate::secrets::get(&format!("custom:{id}:{name}"))
            .ok_or_else(|| tf("Manca la chiave «{n}»: inseriscila in Impostazioni → Integrazioni → Create da te.", &[("n", &name.to_string())]))?;
        out.push_str(&value);
        rest = after.get(end + 2..).unwrap_or_default();
    }
    out.push_str(rest);
    Ok(out)
}

/// A call to a service of an integration, its {{campi}} already filled by the
/// island. Only to the hosts written in its approved description; the keys
/// are put in here and never leave Rust.
pub async fn http(id: &str, method: &str, url: &str, headers: &Map<String, Value>, body: &str) -> Result<Reply, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let allowed: Vec<String> = c.actions.iter().filter(|a| a.kind == "http").map(|a| a.url.as_str())
        .chain(c.sources.iter().map(|s| s.url.as_str()))
        .filter_map(host_of).collect();
    let host = host_of(url).ok_or(t("Indirizzo non valido."))?;
    if !allowed.contains(&host) {
        return Err(tf("{h} non è tra i servizi di questa integrazione.", &[("h", &host)]));
    }
    let url = with_secrets(&c.id, url)?;
    let method = reqwest::Method::from_bytes(method_of(method)?.as_bytes()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut req = client.request(method, &url).header("User-Agent", "EasyIsland");
    for (k, v) in headers {
        let v = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
        req = req.header(k.as_str(), with_secrets(&c.id, &v)?);
    }
    if !body.trim().is_empty() {
        let b = with_secrets(&c.id, body)?;
        let json = serde_json::from_str::<Value>(&b).is_ok();
        if json && !headers.keys().any(|k| k.eq_ignore_ascii_case("content-type")) {
            req = req.header("Content-Type", "application/json");
        }
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| tf("Il servizio non risponde: {e}", &[("e", &e.without_url().to_string())]))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.without_url().to_string())?;
    let cut = bytes.get(..bytes.len().min(MAX_ANSWER)).unwrap_or_default();
    let text = String::from_utf8_lossy(cut).to_string();
    let data = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
    Ok(Reply { status: status.as_u16(), ok: status.is_success(), data })
}

/// A source read now.
pub async fn fetch(id: &str, source: &str) -> Result<Reply, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let s = c.sources.iter().find(|s| s.id == source).ok_or(t("Fonte non trovata."))?;
    http(&c.id, &s.method, &s.url, &s.headers, &s.body).await
}

/// Reads the sources with `every` when their time comes and tells the island
/// ("custom-source"). Asleep otherwise: one look every 30 s at the clock.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last: std::collections::HashMap<String, std::time::Instant> = std::collections::HashMap::new();
        // In the log: the first answer of each source, and every error.
        let mut logged: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            for c in list().into_iter().filter(|c| c.enabled) {
                for s in c.sources.iter().filter(|s| s.every > 0) {
                    let key = format!("{}/{}", c.id, s.id);
                    let due = last.get(&key).is_none_or(|t| t.elapsed() >= std::time::Duration::from_secs(s.every as u64 * 60));
                    if !due {
                        continue;
                    }
                    last.insert(key, std::time::Instant::now());
                    let out = http(&c.id, &s.method, &s.url, &s.headers, &s.body).await;
                    match &out {
                        Ok(r) if logged.insert(format!("{}/{}", c.id, s.id)) => {
                            crate::log::line(format!("integrazioni personali: {}/{} HTTP {}", c.id, s.id, r.status));
                        }
                        Err(e) => crate::log::line(format!("integrazioni personali: {}/{} non letta: {e}", c.id, s.id)),
                        _ => {}
                    }
                    let payload = match out {
                        Ok(r) => json!({ "id": c.id, "source": s.id, "reply": r, "at": now() }),
                        Err(e) => json!({ "id": c.id, "source": s.id, "error": e, "at": now() }),
                    };
                    let _ = app.emit("custom-source", payload);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

// ── Tools (agent.rs) ─────────────────────────────────────────────────────────

fn parse_def(args: &Value) -> Result<Custom, String> {
    let raw = args.get("definition").cloned().unwrap_or_else(|| args.clone());
    let raw = match raw {
        Value::String(s) => serde_json::from_str::<Value>(&s).map_err(|e| tf("definition non è JSON valido: {e}", &[("e", &e.to_string())]))?,
        v => v,
    };
    let mut c: Custom = serde_json::from_value(raw).map_err(|e| tf("definition: {e}", &[("e", &e.to_string())]))?;
    c.enabled = true;
    Ok(c)
}

pub fn tool_create(app: &AppHandle, args: &Value) -> Result<String, String> {
    let c = save(app, parse_def(args)?, true)?;
    Ok(tf("Integrazione «{name}» creata: è nel menu dell'isola con {n} campi. Puoi cambiarla con custom_update.", &[("name", &c.name), ("n", &c.fields.len().to_string())]))
}

pub fn tool_update(app: &AppHandle, args: &Value) -> Result<String, String> {
    let mut c = parse_def(args)?;
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
    if !id.is_empty() {
        c.id = id.to_string();
    }
    let old = get(&c.id).or_else(|| get(&c.name)).ok_or(t("Integrazione non trovata: usa custom_create per una nuova."))?;
    c.id = old.id;
    c.enabled = old.enabled;
    let c = save(app, c, false)?;
    Ok(tf("Integrazione «{name}» aggiornata.", &[("name", &c.name)]))
}

pub fn tool_list() -> String {
    let all = list();
    if all.is_empty() {
        return t("Nessuna integrazione personale. Creane una con custom_create.").into();
    }
    all.iter().map(|c| format!("- {} ({}): {} · {} campi · {} schede", c.name, c.id, c.description, c.fields.len(), records(&c.id).len())).collect::<Vec<_>>().join("\n")
}

pub fn tool_get(id: &str) -> Result<String, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    serde_json::to_string_pretty(&c).map_err(|e| e.to_string())
}

pub fn tool_records(id: &str, query: &str, limit: usize) -> Result<String, String> {
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let q = query.trim().to_lowercase();
    let rows: Vec<Value> = records(&c.id).into_iter().rev()
        .filter(|r| q.is_empty() || Value::Object(r.values.clone()).to_string().to_lowercase().contains(&q))
        .take(limit.clamp(1, 200))
        .map(|r| json!({ "id": r.id, "updated": r.updated, "values": r.values }))
        .collect();
    serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())
}

/// custom_fetch: what a source of an integration says now (its approved address).
pub async fn tool_fetch(id: &str, source: &str) -> Result<String, String> {
    let r = fetch(id, source).await?;
    let text = serde_json::to_string_pretty(&r.data).unwrap_or_default();
    let cut: String = text.chars().take(20_000).collect();
    Ok(format!("HTTP {}\n{cut}", r.status))
}

/// {{campo}} in a text from plain values (custom_call): text as it is, the rest as JSON;
/// `encode` for a URL. {{secret:…}} stays for `http`.
fn fill_values(text: &str, values: &Map<String, Value>, encode: bool, json_body: bool) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(rest.get(..start).unwrap_or_default());
        let after = rest.get(start + 2..).unwrap_or_default();
        let Some(end) = after.find("}}") else {
            out.push_str(rest.get(start..).unwrap_or_default());
            return out;
        };
        let key = after.get(..end).unwrap_or_default().trim();
        let whole = rest.get(start..start + 2 + end + 2).unwrap_or_default();
        match values.get(key) {
            _ if key.starts_with("secret:") => out.push_str(whole),
            Some(Value::String(s)) if encode => out.push_str(&url_encode(s)),
            Some(Value::String(s)) if json_body => out.push_str(&s.replace('\\', "\\\\").replace('"', "\\\"")),
            Some(Value::String(s)) => out.push_str(s),
            Some(v) if encode => out.push_str(&url_encode(&v.to_string())),
            Some(v) => out.push_str(&v.to_string()),
            None => out.push_str(if json_body { "null" } else { "" }),
        }
        rest = after.get(end + 2..).unwrap_or_default();
    }
    out.push_str(rest);
    out
}

fn url_encode(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{b:02X}"),
    }).collect()
}

/// custom_call: an "http" action of an integration from the chat, a task or the
/// heartbeat, with the values given. Consenti / Nega first (not read-only).
pub async fn tool_call(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
    let label = args.get("action").and_then(Value::as_str).unwrap_or_default();
    let values = args.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let a = c.actions.iter().find(|a| a.kind == "http" && a.label.eq_ignore_ascii_case(label.trim()))
        .ok_or_else(|| tf("Nessuna azione http «{l}». Quelle che ci sono: {all}", &[("l", &label.to_string()), ("all", &c.actions.iter().filter(|a| a.kind == "http").map(|a| a.label.clone()).collect::<Vec<_>>().join(", "))]))?;
    let mut headers = Map::new();
    for (k, v) in &a.headers {
        headers.insert(k.clone(), json!(fill_values(v.as_str().unwrap_or_default(), &values, false, false)));
    }
    let r = http(&c.id, &a.method, &fill_values(&a.url, &values, true, false), &headers, &fill_values(&a.body, &values, false, true)).await?;
    let text = serde_json::to_string_pretty(&r.data).unwrap_or_default();
    Ok(format!("HTTP {}\n{}", r.status, text.chars().take(20_000).collect::<String>()))
}

pub fn tool_add_record(app: &AppHandle, args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
    let record = args.get("record").and_then(Value::as_str).unwrap_or_default();
    let values = args.get("values").and_then(Value::as_object).cloned().ok_or(t("values: { id_campo: valore }."))?;
    let r = save_record(app, id, record, values)?;
    Ok(tf("Scheda salvata ({id}).", &[("id", &r.id)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote() -> Custom {
        serde_json::from_value(json!({
            "name": "Preventivi",
            "fields": [
                { "label": "Cliente", "kind": "text", "required": true },
                { "label": "Data", "kind": "date", "default": "oggi" },
                { "label": "Voci", "kind": "rows", "columns": [
                    { "label": "Descrizione" }, { "label": "Quantità", "kind": "number" }, { "label": "Prezzo", "kind": "money" } ] },
                { "label": "Imponibile", "kind": "computed", "formula": "sum(quantita*prezzo)" },
                { "label": "Urgente", "kind": "checkbox" },
                { "label": "Pagamento", "kind": "select", "options": ["Bonifico", "Carta"] }
            ],
            "template": "# Preventivo per {{cliente}}",
            "actions": [{ "label": "Crea il documento", "kind": "document" }]
        })).unwrap()
    }

    #[test]
    fn a_description_gets_ids_and_defaults() {
        let c = normalize(quote()).unwrap();
        assert_eq!(c.id, "preventivi");
        let ids: Vec<&str> = c.fields.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, ["cliente", "data", "voci", "imponibile", "urgente", "pagamento"]);
        assert_eq!(c.fields[2].columns.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["descrizione", "quantita", "prezzo"]);
        assert_eq!(c.fields[2].columns[0].kind, "text");
        assert_eq!(c.actions[0].format, "html");
        assert_eq!(c.color, "#0EA5E9");
    }

    #[test]
    fn mistakes_are_explained() {
        let mut c = quote();
        c.fields[5].options.clear();
        assert!(normalize(c).unwrap_err().contains("options"));
        let mut c = quote();
        c.fields[0].kind = "colore".into();
        assert!(normalize(c).unwrap_err().contains("kind"));
        let mut c = quote();
        c.actions.push(Action { label: "Sito".into(), kind: "url".into(), url: "file:///c:/x".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("https://"));
        let mut c = quote();
        c.fields[1].id = "cliente".into();
        assert!(normalize(c).unwrap_err().contains("stesso id"));
    }

    #[test]
    fn counters_count_per_prefix_and_year() {
        let f = Field { id: "numero".into(), kind: "counter".into(), prefix: "PREV-{anno}-".into(), digits: 3, ..Default::default() };
        let year = now().get(..4).unwrap_or_default().to_string();
        let rec = |v: &str| Record { values: [("numero".to_string(), json!(v))].into_iter().collect(), ..Default::default() };
        assert_eq!(next_counter(&f, &[]), format!("PREV-{year}-001"));
        let all = [rec(&format!("PREV-{year}-007")), rec(&format!("PREV-{year}-002")), rec("PREV-1999-950")];
        assert_eq!(next_counter(&f, &all), format!("PREV-{year}-008"));
    }

    #[test]
    fn without_a_template_every_field_goes_in_the_document() {
        let mut c = quote();
        c.template.clear();
        let c = normalize(c).unwrap();
        assert!(c.template.contains("{{cliente}}") && c.template.contains("{{#voci}}") && c.template.contains("{{prezzo}}"));
    }

    #[test]
    fn new_kinds_are_checked() {
        let mut c = quote();
        c.fields.push(Field { label: "Totale riga".into(), kind: "rows".into(), columns: vec![Column { label: "Tot".into(), kind: "computed".into(), ..Default::default() }], ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("formula"));
        let mut c = quote();
        c.fields.push(Field { label: "Cliente collegato".into(), kind: "link".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("source"));
        let mut c = quote();
        c.fields.push(Field { label: "Numero".into(), kind: "counter".into(), ..Default::default() });
        assert_eq!(normalize(c).unwrap().fields.last().unwrap().digits, 3);
    }

    #[test]
    fn services_only_where_the_description_says() {
        assert_eq!(host_of("https://API.esempio.it/v1/x?{{a}}"), Some("https://api.esempio.it".into()));
        assert_eq!(host_of("https://{{dominio}}/x"), None);
        assert_eq!(host_of("https://utente:pw@esempio.it/"), None);
        assert_eq!(host_of("ftp://x"), None);
        let mut c = quote();
        c.actions.push(Action { label: "Invia".into(), kind: "http".into(), url: "https://{{server}}/api".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("per intero"));
        let mut c = quote();
        c.actions.push(Action { label: "Invia".into(), kind: "http".into(), url: "https://hook.esempio.it/x".into(), method: "TRACE".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("method"));
    }

    #[test]
    fn a_dashboard_needs_no_fields() {
        let c: Custom = serde_json::from_value(json!({
            "name": "Server", "sources": [{ "label": "Stato", "url": "https://status.esempio.it/api", "every": 0 }]
        })).unwrap();
        let c = normalize(c).unwrap();
        assert_eq!((c.sources[0].id.as_str(), c.sources[0].method.as_str()), ("stato", "GET"));
        let empty: Custom = serde_json::from_value(json!({ "name": "Vuota" })).unwrap();
        assert!(normalize(empty).is_err());
    }

    #[test]
    fn steps_name_other_actions() {
        let mut c = quote();
        c.actions.push(Action { label: "Tutto".into(), kind: "steps".into(), steps: vec!["Crea il documento".into(), "Manca".into()], ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("Manca"));
    }

    #[test]
    fn keys_are_put_in_and_a_missing_one_is_named() {
        assert_eq!(with_secrets("x", "senza chiavi").unwrap(), "senza chiavi");
        assert!(with_secrets("x-prova-inesistente", "Bearer {{secret:token}}").unwrap_err().contains("token"));
    }

    #[test]
    fn values_fill_urls_bodies_and_leave_keys() {
        let v: Map<String, Value> = serde_json::from_value(json!({ "q": "a b/c", "n": 3, "nome": "Ro\"ssi" })).unwrap();
        assert_eq!(fill_values("https://x.it/s?q={{q}}&n={{n}}", &v, true, false), "https://x.it/s?q=a%20b%2Fc&n=3");
        assert_eq!(fill_values(r#"{"nome":"{{nome}}","n":{{n}},"x":{{manca}}}"#, &v, false, true), r#"{"nome":"Ro\"ssi","n":3,"x":null}"#);
        assert_eq!(fill_values("Bearer {{secret:token}}", &v, false, false), "Bearer {{secret:token}}");
    }

    #[test]
    fn no_actions_means_save() {
        let mut c = quote();
        c.actions.clear();
        assert_eq!(normalize(c).unwrap().actions[0].kind, "save");
    }
}
