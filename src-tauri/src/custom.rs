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
];
pub const COLUMN_KINDS: &[&str] = &["text", "number", "money", "checkbox", "select", "date"];
pub const ACTION_KINDS: &[&str] = &["save", "document", "copy", "ai", "url", "quick", "notion"];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Column {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub options: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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
    if c.fields.is_empty() {
        return Err(t("fields: almeno un campo.").into());
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
            }
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
            "url" if !(a.url.starts_with("https://") || a.url.starts_with("http://")) => {
                return Err(tf("Azione «{l}»: url deve iniziare con https:// o http://.", &[("l", &a.label)]));
            }
            "quick" if a.quick.trim().is_empty() => return Err(tf("Azione «{l}»: quick, l'id dell'azione rapida.", &[("l", &a.label)])),
            "notion" if a.database.trim().is_empty() => return Err(tf("Azione «{l}»: database di Notion.", &[("l", &a.label)])),
            "document" | "copy" if c.template.trim().is_empty() => {
                return Err(tf("Azione «{l}»: serve template, il modello del documento.", &[("l", &a.label)]));
            }
            _ => {}
        }
        if a.kind == "document" && a.format != "md" {
            a.format = "html".into();
        }
    }
    if !c.title_field.is_empty() && !c.fields.iter().any(|f| f.id == c.title_field) {
        c.title_field = String::new();
    }
    Ok(c)
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
    let ext = if ext == "md" { "md" } else { "html" };
    let base: String = crate::skills::slug(name).chars().take(60).collect();
    let base = if base.is_empty() { "documento".to_string() } else { base };
    let tmp = std::env::temp_dir().join(format!("easyisland-{base}.{ext}"));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    let out = crate::files::ingest(&tmp.to_string_lossy());
    let _ = std::fs::remove_file(&tmp);
    out
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
        c.template.clear();
        assert!(normalize(c).unwrap_err().contains("template"));
        let mut c = quote();
        c.actions.push(Action { label: "Sito".into(), kind: "url".into(), url: "file:///c:/x".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("https://"));
        let mut c = quote();
        c.fields[1].id = "cliente".into();
        assert!(normalize(c).unwrap_err().contains("stesso id"));
    }

    #[test]
    fn no_actions_means_save() {
        let mut c = quote();
        c.actions.clear();
        assert_eq!(normalize(c).unwrap().actions[0].kind, "save");
    }
}
