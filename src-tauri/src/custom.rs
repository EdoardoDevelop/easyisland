// Integrazioni personali (asked by Edoardo on 23 October 2026: «crea
// un'integrazione per i preventivi… programmabile al 100%»). The chat writes a
// description, never code: fields (text, numbers, money, dates, check boxes,
// choices, rows of a table, computed values), a document template and actions
// (save, document, copy, ask the chat, link, quick action, Notion…). The island
// draws it (src/views/custom.ts) and EasyIsland runs it: what an action can do
// is what these few kinds do. The one that holds code is "script" (asked by
// Edoardo on 7 November 2026): the island shows it and waits for a click every
// time, and it is not reachable from custom_call.
//
// Files in %APPDATA%\EasyIsland\integrazioni: `<id>.json` the description,
// `<id>.schede.json` its saved records, `<id>\` its own files ({{file:nome}}).
// All readable and editable: a change by hand is seen by `watch`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::i18n::{t, tf};

const MAX_FIELDS: usize = 60;
const MAX_ACTIONS: usize = 12;
const MAX_RECORDS: usize = 2000;
const MAX_TEMPLATE: usize = 40_000;
const MAX_SCRIPT: usize = 20_000;
/// A record's title and a file's name, with their {{campi}}.
const MAX_NAME: usize = 200;
/// {{file:nome}}: it ends up in the page as text, a third bigger.
const MAX_ASSET: u64 = 5 * 1024 * 1024;

pub const FIELD_KINDS: &[&str] = &[
    "text", "textarea", "number", "money", "date", "checkbox", "select", "multiselect", "email", "phone", "url", "rows", "computed",
    "counter", "link", "file",
];
pub const COLUMN_KINDS: &[&str] = &["text", "number", "money", "checkbox", "select", "date", "computed", "link"];

/// What a `link` copies from the record picked: target field (or column) → a
/// field of the other integration ("indirizzo") or a short template with
/// {{campi}} ("{{cap}} {{citta}}").
pub type Fill = std::collections::BTreeMap<String, String>;
pub const ACTION_KINDS: &[&str] = &["save", "document", "pdf", "copy", "ai", "url", "quick", "script", "notion", "fill", "export", "http", "task", "notice", "steps"];

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
    /// link: the integration whose records are picked from.
    pub source: String,
    /// link: the row's other columns filled from the record picked.
    pub fill: Fill,
    /// link: a value written by hand goes into `source` when the record is saved.
    pub remember: bool,
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
    /// link: the id of another integration, its records to pick from (searched as you type).
    pub source: String,
    /// link: the other fields filled from the record picked.
    pub fill: Fill,
    /// link: a value written by hand goes into `source` when the record is saved.
    pub remember: bool,
    /// In the list of the saved records: summed (numbers) or counted (choices).
    pub summary: bool,
    /// computed: money (default), number, percent, text, date, yesno.
    pub format: String,
    /// select: the choices read from a source of the same integration
    /// (searched as you type); `fill` then copies paths of the item picked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options_from: Option<OptionsFrom>,
}

/// A select's choices from a source (11 Nov 2026, for models and voices of a
/// service that change): its items, or a list inside the item that matches.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct OptionsFrom {
    /// The id of one of `sources`.
    pub source: String,
    /// Paths in each choice: what is saved and what is shown ("" = the choice itself, or "id").
    pub value: String,
    pub label: String,
    /// Only the item whose paths equal these ({{campi}} allowed): { "id": "{{modello}}" }.
    #[serde(rename = "match")]
    pub matching: std::collections::BTreeMap<String, String>,
    /// A list inside that item whose elements are the choices ("supported_voices").
    pub list: String,
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
    /// document: "html" (printable, the default), "pdf" or "md".
    pub format: String,
    /// document: a folder for a copy, besides the Vassoio (%VARIABILI% allowed).
    /// http: where a file the service answers with is kept (then only there,
    /// unless `tray`).
    pub folder: String,
    /// document: the file's name, with {{campi}}, as it reads ("{{numero}} {{cliente}}").
    /// http: the same for a file the service answers with (the extension
    /// comes from its type); with folder or filename the file is kept.
    pub filename: String,
    /// http: a file kept in `folder` goes into the Vassoio too.
    pub tray: bool,
    /// script: the commands, as they are ({{campi}} are not filled in: the
    /// record's data is in the JSON file named by EASYISLAND_SCHEDA).
    pub script: String,
    /// script: "powershell" (the default) or "cmd".
    pub shell: String,
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
    /// The id of another integration whose template (and pictures) this one uses
    /// when its own `template` is empty: one look for DDT and register (11 Nov 2026).
    pub template_from: String,
    pub actions: Vec<Action>,
    /// How a record reads in the list, with {{campi}} ("{{numero}} · {{cliente}}"); before `title_field`.
    pub title: String,
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
        if f.kind != "select" {
            f.options_from = None;
        }
        if matches!(f.kind.as_str(), "select" | "multiselect") && f.options.is_empty() && f.options_from.is_none() {
            return Err(tf("Campo «{l}»: options con le scelte (o optionsFrom con una fonte).", &[("l", &f.label)]));
        }
        if let Some(o) = &mut f.options_from {
            o.source = o.source.trim().to_string();
            // By its id; written as its label's key, saved with the id (the card looks by id).
            let Some(s) = c.sources.iter().find(|s| s.id == o.source || key_of(&s.label) == o.source) else {
                return Err(tf("Campo «{l}»: optionsFrom.source, l'id di una delle sources di questa integrazione.", &[("l", &f.label)]));
            };
            if !s.id.trim().is_empty() {
                o.source = s.id.trim().to_string();
            }
            if o.matching.len() > 5 || o.list.len() > 200 || o.value.len() > 200 || o.label.len() > 200 {
                return Err(tf("Campo «{l}»: optionsFrom troppo lungo (match al massimo 5 voci).", &[("l", &f.label)]));
            }
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
                if col.kind == "link" {
                    col.source = col.source.trim().to_string();
                    if !valid_id(&col.source) {
                        return Err(tf("Colonna «{l}»: source, l'id dell'integrazione da cui scegliere (vedi custom_list).", &[("l", &col.label)]));
                    }
                }
            }
            // The row's columns a link fills: the others, never a computed one.
            let targets: Vec<(String, String)> = f.columns.iter().map(|x| (x.id.clone(), x.kind.clone())).collect();
            for col in f.columns.iter_mut().filter(|x| x.kind == "link") {
                col.fill = check_fill(&col.label, &col.id, std::mem::take(&mut col.fill), &targets)?;
            }
        }
        if f.kind == "counter" {
            f.digits = if f.digits == 0 { 3 } else { f.digits.min(8) };
            f.prefix = f.prefix.chars().take(30).collect();
        }
        if f.kind == "link" {
            f.source = f.source.trim().to_string();
            if !valid_id(&f.source) {
                return Err(tf("Campo «{l}»: source, l'id dell'integrazione da cui scegliere (vedi custom_list).", &[("l", &f.label)]));
            }
        }
        if f.kind == "computed" && f.formula.trim().is_empty() {
            return Err(tf("Campo «{l}»: formula, es. sum(quantita*prezzo) oppure imponibile*0,22.", &[("l", &f.label)]));
        }
    }
    // The fields a link fills: the form's others, never a table, a computed value or a counter.
    let targets: Vec<(String, String)> = c.fields.iter().map(|x| (x.id.clone(), x.kind.clone())).collect();
    // A select from a source fills them too, with paths of the item picked ("pricing.prompt").
    for f in c.fields.iter_mut().filter(|x| x.kind == "link" || x.options_from.is_some()) {
        f.fill = check_fill(&f.label, &f.id, std::mem::take(&mut f.fill), &targets)?;
    }
    if c.template.len() > MAX_TEMPLATE {
        return Err(t("template: al massimo 40.000 caratteri.").into());
    }
    c.title = c.title.trim().to_string();
    check_name("title", &c.title, &c.fields)?;
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
            "script" if a.script.trim().is_empty() => return Err(tf("Azione «{l}»: script, i comandi da eseguire.", &[("l", &a.label)])),
            "script" if a.script.len() > MAX_SCRIPT => return Err(tf("Azione «{l}»: script di al massimo 20.000 caratteri.", &[("l", &a.label)])),
            _ => {}
        }
        // A button that makes a PDF is a document in PDF.
        if a.kind == "pdf" {
            a.kind = "document".into();
            a.format = "pdf".into();
        }
        if a.kind == "document" && a.format != "md" && a.format != "pdf" {
            a.format = "html".into();
        }
        a.folder = a.folder.trim().to_string();
        if !a.folder.is_empty() && !(a.folder.starts_with('%') || Path::new(&a.folder).is_absolute()) {
            return Err(tf("Azione «{l}»: folder, il percorso completo di una cartella.", &[("l", &a.label)]));
        }
        a.filename = a.filename.trim().to_string();
        check_name(&tf("Azione «{l}»: filename", &[("l", &a.label)]), &a.filename, &c.fields)?;
        if a.kind == "script" && a.shell != "cmd" {
            a.shell = "powershell".into();
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
    c.template_from = c.template_from.trim().to_lowercase();
    if !c.template_from.is_empty() && (!valid_id(&c.template_from) || c.template_from == c.id) {
        return Err(t("templateFrom: l'id di un'altra integrazione personale, di cui usare il modello (vedi custom_list).").into());
    }
    // No template (and none borrowed): one with every field, so a document can always be made.
    if c.template.trim().is_empty() && c.template_from.is_empty() {
        c.template = default_template(&c);
    }
    if !c.title_field.is_empty() && !c.fields.iter().any(|f| f.id == c.title_field) {
        c.title_field = String::new();
    }
    Ok(c)
}

/// A link's `fill`: each target is another field (or column) that can hold a
/// value, each source a field id of the other integration or a short template.
fn check_fill(label: &str, own: &str, fill: Fill, targets: &[(String, String)]) -> Result<Fill, String> {
    if fill.len() > 30 {
        return Err(tf("«{l}»: fill, al massimo 30 campi da compilare.", &[("l", &label)]));
    }
    let mut out = Fill::new();
    for (to, from) in fill {
        let (to, from) = (to.trim().to_string(), from.trim().to_string());
        let ok = to != own && targets.iter().any(|(id, kind)| id == &to && !matches!(kind.as_str(), "rows" | "computed" | "counter"));
        if !ok {
            return Err(tf("«{l}»: in fill «{t}» non è un campo da compilare (deve essere l'id di un altro campo, non calcolato).", &[("l", &label), ("t", &to)]));
        }
        if from.is_empty() || from.chars().count() > 300 {
            return Err(tf("«{l}»: in fill, per «{t}» l'id di un campo dell'altra integrazione o un modello con {{campi}}.", &[("l", &label), ("t", &to)]));
        }
        out.insert(to, from);
    }
    Ok(out)
}

/// When the chat writes a description: the integrations its links pick from
/// exist and `fill` names their fields. Read from their files, not `list`
/// (which normalizes every description and would come back here).
fn check_links(c: &Custom) -> Result<(), String> {
    if !c.template_from.is_empty() && !def_file(&c.template_from).exists() {
        return Err(tf("templateFrom: «{s}» non è un'integrazione personale (vedi custom_list).", &[("s", &c.template_from)]));
    }
    let mut wanted: Vec<(String, String, Fill)> = Vec::new();
    for f in &c.fields {
        if f.kind == "link" {
            wanted.push((f.label.clone(), f.source.clone(), f.fill.clone()));
        }
        for col in f.columns.iter().filter(|x| x.kind == "link") {
            wanted.push((col.label.clone(), col.source.clone(), col.fill.clone()));
        }
    }
    for (label, source, fill) in wanted {
        let other: Option<Custom> = if source == c.id {
            Some(c.clone())
        } else {
            std::fs::read(def_file(&source)).ok().and_then(|b| serde_json::from_slice(&b).ok())
        };
        let Some(other) = other else {
            return Err(tf("«{l}»: source «{s}» non è un'integrazione personale (vedi custom_list; creala prima).", &[("l", &label), ("s", &source)]));
        };
        for (to, from) in fill {
            let names: Vec<String> = if from.contains("{{") {
                from.split("{{").skip(1).filter_map(|x| x.split("}}").next()).map(|x| x.split('|').next().unwrap_or_default().trim().to_string()).collect()
            } else {
                vec![from.clone()]
            };
            if let Some(bad) = names.iter().find(|n| !other.fields.iter().any(|f| &f.id == *n)) {
                return Err(tf("«{l}»: in fill, per «{t}», «{b}» non è un campo di «{s}».", &[("l", &label), ("t", &to), ("b", bad), ("s", &other.name)]));
            }
        }
    }
    Ok(())
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

/// A title or a file's name of a description: not too long, and only fields it has,
/// so that a mistyped {{campo}} is told to whoever writes it, not printed in the name.
fn check_name(what: &str, text: &str, fields: &[Field]) -> Result<(), String> {
    if text.len() > MAX_NAME {
        return Err(tf("{w}: al massimo 200 caratteri.", &[("w", &what)]));
    }
    for part in text.split("{{").skip(1) {
        let inner = part.split("}}").next().unwrap_or_default().trim();
        if inner.starts_with(['#', '^', '/']) {
            continue;
        }
        let id = inner.split('|').next().unwrap_or_default().trim();
        if id != "oggi" && !id.starts_with("risposta") && !fields.iter().any(|f| f.id == id) {
            return Err(tf("{w}: «{c}» non è l'id di un campo.", &[("w", &what), ("c", &id)]));
        }
    }
    Ok(())
}

/// A name as Windows takes it: / \ : become dashes (a date, "S/N"), what a file
/// name cannot hold goes, no dots or spaces at the end, no reserved device name.
pub(crate) fn safe_name(name: &str, ext: &str) -> String {
    let mut clean = String::new();
    for c in name.chars() {
        match c {
            '/' | '\\' | ':' => clean.push('-'),
            '*' | '?' | '"' | '<' | '>' | '|' => {}
            c if c.is_control() => clean.push(' '),
            c => clean.push(c),
        }
    }
    let one = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let dotted = format!(".{ext}");
    let plain = match one.get(one.len().saturating_sub(dotted.len())..) {
        Some(end) if end.eq_ignore_ascii_case(&dotted) => one.get(..one.len() - dotted.len()).unwrap_or_default(),
        _ => one.as_str(),
    };
    let cut: String = plain.chars().take(120).collect();
    let out = cut.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    let stem = out.split('.').next().unwrap_or_default().to_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.ends_with(|c: char| c.is_ascii_digit()));
    if device {
        format!("_{out}")
    } else {
        out
    }
}

/// What a document is called: `file`, the name the description asks for, or the
/// slug of `name`.
fn base_of(name: &str, file: &str, ext: &str) -> String {
    let own = safe_name(file, ext);
    if !own.is_empty() {
        return own;
    }
    let base: String = crate::skills::slug(name).chars().take(60).collect();
    if base.is_empty() {
        "documento".to_string()
    } else {
        base
    }
}

/// A finished document: into the Vassoio and, when the description says so, a
/// copy into its folder.
pub(crate) fn deliver(base: &str, ext: &str, bytes: &[u8], folder: &str) -> Result<crate::files::DroppedFile, String> {
    let stamp = crate::msgraph::random(4).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let work = std::env::temp_dir().join(format!("easyisland-doc-{stamp}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let done = (|| {
        let out = work.join(format!("{base}.{ext}"));
        std::fs::write(&out, bytes).map_err(|e| e.to_string())?;
        let file = crate::files::ingest(&out.to_string_lossy())?;
        if !folder.trim().is_empty() {
            let target = PathBuf::from(expand_env(folder.trim()));
            std::fs::create_dir_all(&target).map_err(|e| tf("Cartella del documento non raggiungibile: {e}", &[("e", &e.to_string())]))?;
            std::fs::write(free_path(&target, base, ext), bytes).map_err(|e| tf("Documento non copiato nella cartella: {e}", &[("e", &e.to_string())]))?;
        }
        Ok(file)
    })();
    let _ = std::fs::remove_dir_all(&work);
    done
}

/// A document of a record (the template already filled by the island).
pub fn document(name: &str, ext: &str, text: &str, file: &str, folder: &str) -> Result<crate::files::DroppedFile, String> {
    let ext = match ext {
        "md" => "md",
        "csv" => "csv",
        _ => "html",
    };
    deliver(&base_of(name, file, ext), ext, text.as_bytes(), folder)
}

/// "%USERPROFILE%\WORK" → the same with the variable's value; unknown ones stay.
pub(crate) fn expand_env(path: &str) -> String {
    let mut out = String::new();
    let mut rest = path;
    while let Some(start) = rest.find('%') {
        let after = rest.get(start + 1..).unwrap_or_default();
        let Some(end) = after.find('%') else { break };
        let name = after.get(..end).unwrap_or_default();
        out.push_str(rest.get(..start).unwrap_or_default());
        match std::env::var(name) {
            Ok(value) => out.push_str(&value),
            Err(_) => out.push_str(rest.get(start..start + end + 2).unwrap_or_default()),
        }
        rest = after.get(end + 1..).unwrap_or_default();
    }
    out.push_str(rest);
    out
}

/// "x.pdf" in a folder, or "x (2).pdf" if there is one: a document is never overwritten.
fn free_path(folder: &Path, base: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("{base}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..10_000).map(|n| folder.join(format!("{base} ({n}).{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// The page of a document printed in PDF.
pub async fn pdf(app: &AppHandle, name: &str, html: &str, file: &str, folder: &str) -> Result<crate::files::DroppedFile, String> {
    let stamp = crate::msgraph::random(4).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let work = std::env::temp_dir().join(format!("easyisland-pdf-{stamp}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let page = work.join("documento.html");
    let made = async {
        std::fs::write(&page, html).map_err(|e| e.to_string())?;
        let bytes = crate::pdf::print(app, &page).await?;
        deliver(&base_of(name, file, "pdf"), "pdf", &bytes, folder)
    }.await;
    let _ = std::fs::remove_dir_all(&work);
    made
}

/// The folder of an integration's own files, `integrazioni\<id>`.
fn assets_dir(id: &str) -> PathBuf {
    dir().join(id)
}

/// Pictures every integration can use with {{file:…}} (a logo for all the documents):
/// `integrazioni\_comune`, a name no integration can have (ids have no «_»).
pub fn common_dir() -> PathBuf {
    dir().join("_comune")
}

fn mime_of(name: &str) -> Option<&'static str> {
    let ext = name.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// A plain file name: no folders, no way out of the integration's folder.
fn asset_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 120 && !name.contains("..") && name.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

/// {{file:nome}}: a picture as a data: URI, looked for in the integration's folder,
/// then in the one of the integration whose template it uses (`templateFrom`),
/// then in `integrazioni\_comune`. The real path is checked too, so a link in a
/// folder does not lead out of it.
pub fn asset(id: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let missing = || tf("{{file:{n}}}: non c'è in integrazioni\\{id} né in integrazioni\\_comune.", &[("n", &name.to_string()), ("id", &c.id)]);
    if !asset_name_ok(name) {
        return Err(tf("{{file:{n}}}: solo il nome di un file, senza cartelle.", &[("n", &name.to_string())]));
    }
    let mime = mime_of(name).ok_or_else(|| tf("{{file:{n}}}: solo immagini png, jpg, gif, webp o svg.", &[("n", &name.to_string())]))?;
    let mut folders = vec![assets_dir(&c.id)];
    if valid_id(&c.template_from) {
        folders.push(assets_dir(&c.template_from));
    }
    folders.push(common_dir());
    let path = folders
        .iter()
        .find_map(|f| {
            let root = f.canonicalize().ok()?;
            let p = root.join(name).canonicalize().ok()?;
            (p.starts_with(&root) && p.is_file()).then_some(p)
        })
        .ok_or_else(missing)?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_ASSET {
        return Err(tf("{{file:{n}}}: al massimo 5 MB.", &[("n", &name.to_string())]));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)))
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
    let chat = crate::claude::Chat::plain();
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
    /// The answer read as JSON when it is, else as text (cut at 2 MB); for a
    /// file, { file, type, size } (so {{risposta.file}} and store work).
    pub data: Value,
    /// A file the service answered with (audio, picture, PDF…), in a temp folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// 2 MB: a list of a service's models with their voices (optionsFrom) is long, and cut it is no longer JSON.
const MAX_ANSWER: usize = 2 * 1024 * 1024;
/// A file answered by a service: at most this (a long audio or a short video).
const MAX_FILE: usize = 200 * 1024 * 1024;

/// Files answered by the services, until kept or a day old: %TEMP%\EasyIsland\risposte.
fn answers_dir() -> PathBuf {
    std::env::temp_dir().join("EasyIsland").join("risposte")
}

/// The extension of a file by its Content-Type; None for text and JSON (read as data).
fn file_ext(content_type: &str, bytes: &[u8]) -> Option<&'static str> {
    let ct = content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let text = ct.starts_with("text/") || ct.contains("json") || ct.contains("xml") || ct.contains("javascript") || ct == "application/x-www-form-urlencoded";
    if text {
        return None;
    }
    let ext = match ct.as_str() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/aac" => "aac",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/webm" => "weba",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => "m4a",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        // Without a type: text stays text, anything else is a file.
        "" if std::str::from_utf8(bytes.get(..bytes.len().min(4096)).unwrap_or_default()).is_ok() => return None,
        _ => "bin",
    };
    Some(ext)
}

/// A file answered by a service, in answers_dir (the ones older than a day go).
fn answer_file(bytes: &[u8], ext: &str) -> Result<PathBuf, String> {
    let dir = answers_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(list) = std::fs::read_dir(&dir) {
        for e in list.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 24 * 3600);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let stamp = crate::msgraph::random(4).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let path = dir.join(format!("risposta-{stamp}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// A file answered by a service kept: in `folder` (never over another file)
/// and, with `tray` or without a folder, in the Vassoio. Only files of
/// answers_dir. The path of the copy to show.
pub fn keep(path: &str, filename: &str, folder: &str, tray: bool) -> Result<String, String> {
    let src = PathBuf::from(path);
    let inside = src.parent().is_some_and(|p| p == answers_dir()) && src.is_file();
    if !inside {
        return Err(t("Non è un file ricevuto da un servizio.").into());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_string();
    let base = base_of("risposta", filename, &ext);
    let mut shown = String::new();
    if !folder.trim().is_empty() {
        let target = PathBuf::from(expand_env(folder.trim()));
        std::fs::create_dir_all(&target).map_err(|e| tf("Cartella non raggiungibile: {e}", &[("e", &e.to_string())]))?;
        let out = free_path(&target, &base, &ext);
        std::fs::copy(&src, &out).map_err(|e| tf("File non salvato nella cartella: {e}", &[("e", &e.to_string())]))?;
        shown = out.display().to_string();
    }
    if folder.trim().is_empty() || tray {
        // Into the Vassoio with its own name (ingest keeps the name).
        let named = src.with_file_name(format!("{base}.{ext}"));
        let from = if named.exists() {
            src.clone()
        } else {
            std::fs::copy(&src, &named).map_err(|e| e.to_string())?;
            named
        };
        let file = crate::files::ingest(&from.to_string_lossy());
        if from != src {
            let _ = std::fs::remove_file(&from);
        }
        let file = file?;
        if shown.is_empty() {
            shown = file.path;
        }
    }
    Ok(shown)
}

/// The keys of an integration for one of its own scripts, as
/// EASYISLAND_SECRET_<NOME> variables: only when `script` is the text of a
/// script action of its approved description; never shown or logged.
pub fn script_secrets(id: &str, script: &str) -> Vec<(String, String)> {
    let Some(c) = get(id) else { return Vec::new() };
    if !c.actions.iter().any(|a| a.kind == "script" && a.script == script) {
        return Vec::new();
    }
    c.secrets
        .iter()
        .filter_map(|name| {
            let value = crate::secrets::get(&format!("custom:{id}:{name}"))?;
            Some((secret_var(name), value))
        })
        .collect()
}

/// "api key" → EASYISLAND_SECRET_API_KEY.
pub fn secret_var(name: &str) -> String {
    let var: String = name.trim().chars().map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_uppercase() } else { '_' }).collect();
    format!("EASYISLAND_SECRET_{var}")
}

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
    // 60 s: a voice or a picture made by the service takes a while.
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
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
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let bytes = resp.bytes().await.map_err(|e| e.without_url().to_string())?;
    if let Some(ext) = file_ext(&content_type, &bytes) {
        if bytes.len() > MAX_FILE {
            return Err(t("Il file ricevuto supera i 200 MB.").into());
        }
        let path = answer_file(&bytes, ext)?.display().to_string();
        let mime = content_type.split(';').next().unwrap_or_default().trim().to_string();
        let data = json!({ "file": path, "type": mime, "size": bytes.len() });
        return Ok(Reply { status: status.as_u16(), ok: status.is_success(), data, file: Some(path) });
    }
    let cut = bytes.get(..bytes.len().min(MAX_ANSWER)).unwrap_or_default();
    let text = String::from_utf8_lossy(cut).to_string();
    let data = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
    Ok(Reply { status: status.as_u16(), ok: status.is_success(), data, file: None })
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

/// A description changed by hand reaches the island without a restart: asleep on
/// ReadDirectoryChangesW until the folder changes, then a moment for the editor
/// to finish writing. Only a real change of the descriptions is sent.
pub fn watch(app: AppHandle) {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadDirectoryChangesW, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE,
        FILE_NOTIFY_CHANGE_SIZE, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use std::os::windows::ffi::OsStrExt;

    std::thread::spawn(move || {
        let folder = dir();
        if let Err(e) = std::fs::create_dir_all(&folder) {
            crate::log::line(format!("integrazioni personali: cartella non creata: {e}"));
            return;
        }
        let wide: Vec<u16> = folder.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let handle = match unsafe {
            CreateFileW(PCWSTR(wide.as_ptr()), FILE_LIST_DIRECTORY.0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)
        } {
            Ok(h) => h,
            Err(e) => {
                crate::log::line(format!("integrazioni personali: cartella non osservabile: {e}"));
                return;
            }
        };
        let mut last = list();
        // DWORD-aligned, as ReadDirectoryChangesW wants; the names do not matter here.
        let mut buf = vec![0u32; 1024];
        loop {
            let mut got = 0u32;
            let ok = unsafe {
                ReadDirectoryChangesW(
                    handle,
                    buf.as_mut_ptr().cast(),
                    (buf.len() * 4) as u32,
                    false,
                    FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE,
                    Some(&mut got),
                    None,
                    None,
                )
            };
            if let Err(e) = ok {
                crate::log::line(format!("integrazioni personali: osservazione finita: {e}"));
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
            let now = list();
            if now != last {
                last = now.clone();
                let _ = app.emit("customs-changed", now);
            }
        }
        unsafe {
            let _ = CloseHandle(handle);
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
    let c = parse_def(args)?;
    check_links(&normalize(c.clone())?)?;
    let c = save(app, c, true)?;
    Ok(tf("Integrazione «{name}» creata: è nel menu dell'isola con {n} campi. Puoi cambiarla con custom_update.", &[("name", &c.name), ("n", &c.fields.len().to_string())]))
}

/// The pieces `custom_update` can be given instead of the whole `definition`
/// (Edoardo, 11 Nov 2026: a 5.000-character template sent again to rename a field).
const PATCH_KEYS: &[&str] = &[
    "name", "description", "icon", "color", "title", "titleField", "template", "templateFrom", "field", "fields", "remove_fields", "action",
    "actions", "remove_actions", "source", "remove_sources", "secrets",
];

/// The description after a `custom_update`: `definition` whole, or the old one
/// with the pieces given (a field or an action replaced by its id or label, or
/// added; some taken away; name, template…). Returns (old, new), new not normalized.
fn updated(args: &Value) -> Result<(Custom, Custom), String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default().trim();
    let whole = args.get("definition").is_some_and(|d| !d.is_null());
    let mut c = if whole { parse_def(args)? } else { Custom::default() };
    let key = if id.is_empty() { c.name.clone() } else { id.to_string() };
    let old = get(&key).or_else(|| get(&c.name)).ok_or(t("Integrazione non trovata: usa custom_create per una nuova."))?;
    if !whole {
        if !PATCH_KEYS.iter().any(|k| args.get(*k).is_some()) && args.get("new_id").is_none() {
            return Err(t("custom_update: definition intera, oppure i pezzi da cambiare (name, template, field, remove_fields, action…).").into());
        }
        c = patched(&old, args)?;
    }
    c.id = old.id.clone();
    c.enabled = old.enabled;
    Ok((old, c))
}

/// The old description with the pieces of `args` put in.
fn patched(old: &Custom, args: &Value) -> Result<Custom, String> {
    let mut c = old.clone();
    let text = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
    if let Some(v) = text("name") { c.name = v; }
    if let Some(v) = text("description") { c.description = v; }
    if let Some(v) = text("icon") { c.icon = v; }
    if let Some(v) = text("color") { c.color = v; }
    if let Some(v) = text("title") { c.title = v; }
    if let Some(v) = text("titleField") { c.title_field = v; }
    if let Some(v) = text("template") { c.template = v; }
    if let Some(v) = text("templateFrom") { c.template_from = v; }
    if let Some(v) = args.get("secrets").and_then(Value::as_array) {
        c.secrets = v.iter().filter_map(Value::as_str).map(str::to_string).collect();
    }
    // A field: in place of the one with its id, or at the end (`after`: behind that id).
    let mut fields: Vec<Value> = args.get("fields").and_then(Value::as_array).cloned().unwrap_or_default();
    if let Some(f) = args.get("field").filter(|f| f.is_object()) {
        fields.push(f.clone());
    }
    for raw in fields {
        let after = raw.get("after").and_then(Value::as_str).map(str::to_string);
        let f: Field = serde_json::from_value(raw).map_err(|e| tf("field: {e}", &[("e", &e.to_string())]))?;
        let at = c.fields.iter().position(|x| !f.id.is_empty() && x.id == f.id);
        match (at, after.and_then(|a| c.fields.iter().position(|x| x.id == a))) {
            (Some(i), _) => c.fields[i] = f,
            (None, Some(j)) => c.fields.insert(j + 1, f),
            (None, None) => c.fields.push(f),
        }
    }
    for id in args.get("remove_fields").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        c.fields.retain(|x| x.id != id);
    }
    let mut actions: Vec<Value> = args.get("actions").and_then(Value::as_array).cloned().unwrap_or_default();
    if let Some(a) = args.get("action").filter(|a| a.is_object()) {
        actions.push(a.clone());
    }
    for raw in actions {
        let a: Action = serde_json::from_value(raw).map_err(|e| tf("action: {e}", &[("e", &e.to_string())]))?;
        match c.actions.iter().position(|x| x.label == a.label) {
            Some(i) => c.actions[i] = a,
            None => c.actions.push(a),
        }
    }
    for label in args.get("remove_actions").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        c.actions.retain(|x| x.label != label);
    }
    if let Some(raw) = args.get("source").filter(|s| s.is_object()) {
        let s: Source = serde_json::from_value(raw.clone()).map_err(|e| tf("source: {e}", &[("e", &e.to_string())]))?;
        match c.sources.iter().position(|x| x.id == s.id) {
            Some(i) => c.sources[i] = s,
            None => c.sources.push(s),
        }
    }
    for id in args.get("remove_sources").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        c.sources.retain(|x| x.id != id);
    }
    Ok(c)
}

pub fn tool_update(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (old, c) = updated(args)?;
    let new = normalize(c.clone())?;
    check_links(&new)?;
    let new_id = args.get("new_id").and_then(Value::as_str).map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty() && *s != old.id);
    if let Some(n) = &new_id {
        rename_check(n)?;
    }
    let notes = changes(&old, &new, &records(&old.id));
    // The description as it was, dated, before it is replaced (the saved records are another file and stay).
    let copy = keep_version(&old.id)?;
    let mut c = save(app, c, false)?;
    let mut msg = tf("Integrazione «{name}» aggiornata. Versione di prima in {path}.", &[("name", &c.name), ("path", &copy.display().to_string())]);
    if let Some(n) = new_id {
        let moved = rename_id(app, &old.id, &n)?;
        c.id = n.clone();
        msg.push_str(&format!("\n{}", tf("Id cambiato da «{a}» a «{b}»: {n} collegamenti di altre integrazioni aggiornati, e il menu e la Panoramica la ritrovano.", &[("a", &old.id), ("b", &n), ("n", &moved.to_string())])));
    }
    if !notes.is_empty() {
        msg.push_str(&format!("\n{}\n- {}", t("Cosa è cambiato (dillo all'utente):"), notes.join("\n- ")));
    }
    Ok(msg)
}

// ── Preview without saving (Edoardo, 11 Nov 2026: saving a record to see the
// document used up a DDT number) ────────────────────────────────────────────

/// The numbers the next record would get, without taking them: { counter field: "DDT-2026-014" }.
pub fn next_counters(id: &str) -> Map<String, Value> {
    let Some(c) = get(id) else { return Map::new() };
    let all = records(&c.id);
    c.fields.iter().filter(|f| f.kind == "counter").map(|f| (f.id.clone(), json!(next_counter(f, &all)))).collect()
}

/// The page of a preview, in the temp folder (never in the Vassoio, never a record).
pub fn preview_file(id: &str, html: &str) -> Result<PathBuf, String> {
    let folder = std::env::temp_dir().join("EasyIsland").join("anteprime");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    let path = folder.join(format!("{}.html", if safe.is_empty() { "anteprima" } else { &safe }));
    std::fs::write(&path, html.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Previews asked of the island by `custom_preview`, waiting for its page.
static PREVIEWS: std::sync::Mutex<Option<std::collections::HashMap<String, tokio::sync::oneshot::Sender<(String, String)>>>> =
    std::sync::Mutex::new(None);

/// The island's answer (lib.rs `custom_preview_done`): the page and its text.
pub fn preview_done(req: &str, html: String, text: String) {
    let tx = PREVIEWS.lock().unwrap().as_mut().and_then(|m| m.remove(req));
    if let Some(tx) = tx {
        let _ = tx.send((html, text));
    }
}

/// `custom_preview`: the document with the values given (or empty), made by the
/// island exactly as «Documento» makes it, saved in a temp file. Nothing saved,
/// no number taken: a counter shows the number the next record would get.
pub async fn tool_preview(app: &AppHandle, args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
    let c = get(id).ok_or(t("Integrazione non trovata."))?;
    let mut values = args.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
    let counters = next_counters(&c.id);
    for (k, v) in &counters {
        let empty = values.get(k).is_none_or(|x| x.is_null() || x.as_str().is_some_and(str::is_empty));
        if empty {
            values.insert(k.clone(), v.clone());
        }
    }
    let req = format!("p{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let (tx, rx) = tokio::sync::oneshot::channel();
    PREVIEWS.lock().unwrap().get_or_insert_with(Default::default).insert(req.clone(), tx);
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "custom-preview", json!({ "req": req, "id": c.id, "values": values }));
    let got = tokio::time::timeout(std::time::Duration::from_secs(20), rx).await;
    PREVIEWS.lock().unwrap().as_mut().map(|m| m.remove(&req));
    let (html, text) = match got {
        Ok(Ok(v)) => v,
        _ => return Err(t("L'isola non ha composto l'anteprima (è aperta?). Riprova.").into()),
    };
    if html.is_empty() {
        return Err(text);
    }
    let path = preview_file(&c.id, &html)?;
    let mut out = tf("Anteprima di «{name}» in {path} (aprila con preview_open per vederla). Niente è stato salvato.", &[("name", &c.name), ("path", &path.display().to_string())]);
    if !counters.is_empty() {
        out.push_str(&format!(" {}", t("Il numero mostrato è quello che avrebbe la prossima scheda: non è stato usato.")));
    }
    let text: String = text.chars().take(8000).collect();
    out.push_str(&format!("\n\n{text}"));
    Ok(out)
}

/// A new id for an integration: valid and not taken.
fn rename_check(new_id: &str) -> Result<(), String> {
    if !valid_id(new_id) {
        return Err(t("new_id: lettere minuscole, cifre e trattini.").into());
    }
    if def_file(new_id).exists() {
        return Err(tf("new_id: c'è già un'integrazione «{id}».", &[("id", &new_id.to_string())]));
    }
    Ok(())
}

/// Moves an integration to a new id (Edoardo, 11 Nov 2026: «Clienti» still
/// called `clienti-ddt`): its description, records and folder; the links of
/// the other integrations that pick from it; and in the settings, every
/// profile too, each place that names `custom:<old>` (order, groups, icons,
/// colours). Returns how many links of other integrations it changed.
fn rename_id(app: &AppHandle, old_id: &str, new_id: &str) -> Result<usize, String> {
    rename_check(new_id)?;
    let mut c = get(old_id).ok_or(t("Integrazione non trovata."))?;
    c.id = new_id.to_string();
    let bytes = serde_json::to_vec_pretty(&c).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&def_file(new_id), &bytes).map_err(|e| e.to_string())?;
    if records_file(old_id).exists() {
        std::fs::rename(records_file(old_id), records_file(new_id)).map_err(|e| e.to_string())?;
    }
    if assets_dir(old_id).is_dir() {
        std::fs::rename(assets_dir(old_id), assets_dir(new_id)).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(def_file(old_id));
    // The links of the others (a link to itself moved with it above).
    let mut moved = 0;
    for mut other in list().into_iter().filter(|o| o.id != new_id) {
        let mut touched = false;
        if other.template_from == old_id {
            other.template_from = new_id.to_string();
            touched = true;
        }
        for f in &mut other.fields {
            if f.kind == "link" && f.source == old_id {
                f.source = new_id.to_string();
                touched = true;
            }
            for col in f.columns.iter_mut().filter(|x| x.kind == "link" && x.source == old_id) {
                col.source = new_id.to_string();
                touched = true;
            }
        }
        if touched {
            moved += 1;
            let bytes = serde_json::to_vec_pretty(&other).map_err(|e| e.to_string())?;
            crate::settings::write_atomic(&def_file(&other.id), &bytes).map_err(|e| e.to_string())?;
        }
    }
    let (from, to) = (format!("custom:{old_id}"), format!("custom:{new_id}"));
    crate::agent::update_settings(app, |s| {
        if let Ok(v) = serde_json::to_value(&*s) {
            if let Ok(back) = serde_json::from_value(renamed_task(v, &from, &to)) {
                *s = back;
            }
        }
    })?;
    crate::log::line(format!("integrazioni personali: {old_id} → {new_id}"));
    changed(app);
    Ok(moved)
}

/// Every string equal to `from`, and every key, become `to` (the settings, profiles included).
fn renamed_task(v: Value, from: &str, to: &str) -> Value {
    match v {
        Value::String(s) if s == from => Value::String(to.to_string()),
        Value::Array(a) => Value::Array(a.into_iter().map(|x| renamed_task(x, from, to)).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, x)| (if k == from { to.to_string() } else { k }, renamed_task(x, from, to))).collect()),
        other => other,
    }
}

/// Before the Consenti / Nega card of a `custom_update`: what it changes, in
/// `tool_input._changes`, so the card shows it (src/island/hooks.ts). Only
/// added for the card: the decision sent back is a word, never the input.
pub fn annotate(payload: &mut Value) {
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    if tool != "custom_update" && !tool.ends_with("__custom_update") {
        return;
    }
    let Some(input) = payload.get("tool_input") else { return };
    let Ok((old, c)) = updated(input) else { return };
    let Ok(new) = normalize(c) else { return };
    let mut notes = changes(&old, &new, &records(&old.id));
    if let Some(n) = input.get("new_id").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty() && *n != old.id) {
        notes.push(tf("L'id cambia da «{a}» a «{b}»: schede, cartella e collegamenti delle altre integrazioni seguono.", &[("a", &old.id), ("b", &n.to_string())]));
    }
    if let Some(obj) = payload.get_mut("tool_input").and_then(Value::as_object_mut) {
        obj.insert("_changes".into(), json!(notes));
        obj.insert("_name".into(), json!(old.name));
    }
}

/// Older descriptions of an integration: `integrazioni\versioni\<id>-<data>.json`
/// (a subfolder: `list` reads only the files of `integrazioni`).
fn versions_dir() -> PathBuf {
    dir().join("versioni")
}

/// Copies `<id>.json` into `versioni\` and keeps the last 20 of that id.
fn keep_version(id: &str) -> Result<PathBuf, String> {
    let from = def_file(id);
    let bytes = std::fs::read(&from).map_err(|e| e.to_string())?;
    let vdir = versions_dir();
    std::fs::create_dir_all(&vdir).map_err(|e| e.to_string())?;
    let to = vdir.join(format!("{id}-{}.json", crate::hooks::stamp()));
    crate::settings::write_atomic(&to, &bytes).map_err(|e| e.to_string())?;
    let prefix = format!("{id}-");
    let mut mine: Vec<PathBuf> = std::fs::read_dir(&vdir)
        .map(|r| r.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    mine.retain(|p| {
        p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
            // "<id>-20261110-081500.json": the id itself may have dashes, the stamp has none but one.
            n.strip_prefix(&prefix).and_then(|rest| rest.strip_suffix(".json")).is_some_and(|s| s.len() == 15 && s.chars().all(|c| c.is_ascii_digit() || c == '-'))
        })
    });
    mine.sort();
    let extra = mine.len().saturating_sub(20);
    for p in mine.iter().take(extra) {
        let _ = std::fs::remove_file(p);
    }
    Ok(to)
}

/// What an update changes that the user may not expect, in words: fields that
/// go (their values stop showing in the saved records), kinds, the counter,
/// the template, the actions.
pub fn changes(old: &Custom, new: &Custom, saved: &[Record]) -> Vec<String> {
    let mut out = Vec::new();
    let filled = |id: &str| {
        saved.iter().filter(|r| r.values.get(id).is_some_and(|v| match v {
            Value::Null => false,
            Value::String(s) => !s.trim().is_empty(),
            Value::Array(a) => !a.is_empty(),
            _ => true,
        })).count()
    };
    for f in &old.fields {
        match new.fields.iter().find(|n| n.id == f.id) {
            None => {
                let n = filled(&f.id);
                out.push(if n > 0 {
                    tf("Tolto il campo «{label}» ({id}), compilato nelle schede salvate: {n}. Lì il valore non si vedrà più, e si perde se una di quelle schede viene salvata di nuovo.",
                        &[("label", &f.label), ("id", &f.id), ("n", &n.to_string())])
                } else {
                    tf("Tolto il campo «{label}» ({id}).", &[("label", &f.label), ("id", &f.id)])
                });
            }
            Some(n) if n.kind != f.kind => out.push(tf("Il campo «{label}» cambia tipo: da {a} a {b}.", &[("label", &f.label), ("a", &f.kind), ("b", &n.kind)])),
            Some(n) if f.kind == "counter" && n.prefix != f.prefix => out.push(tf(
                "Il numeratore «{label}» cambia prefisso da «{a}» a «{b}»: la numerazione riparte per il prefisso nuovo, le schede salvate tengono il loro numero.",
                &[("label", &f.label), ("a", &f.prefix), ("b", &n.prefix)],
            )),
            Some(n) if f.kind == "rows" => {
                for col in f.columns.iter().filter(|c| !n.columns.iter().any(|x| x.id == c.id)) {
                    out.push(tf("Tolta la colonna «{col}» dalla tabella «{label}».", &[("col", &col.label), ("label", &f.label)]));
                }
            }
            _ => {}
        }
    }
    let added: Vec<&str> = new.fields.iter().filter(|n| !old.fields.iter().any(|f| f.id == n.id)).map(|n| n.label.as_str()).collect();
    if !added.is_empty() {
        out.push(tf("Campi nuovi (vuoti nelle schede salvate): {list}.", &[("list", &added.join(", "))]));
    }
    if new.template != old.template {
        let (a, b) = (old.template.chars().count(), new.template.chars().count());
        out.push(if b * 10 < a * 7 {
            tf("Il modello del documento è molto più corto: da {a} a {b} caratteri.", &[("a", &a.to_string()), ("b", &b.to_string())])
        } else {
            tf("Cambia il modello del documento ({a} → {b} caratteri).", &[("a", &a.to_string()), ("b", &b.to_string())])
        });
    }
    for a in &old.actions {
        match new.actions.iter().find(|n| n.label == a.label) {
            None => out.push(tf("Tolta l'azione «{label}».", &[("label", &a.label)])),
            Some(n) if n.kind == "script" && n.script != a.script => out.push(tf("Cambia lo script dell'azione «{label}».", &[("label", &a.label)])),
            _ => {}
        }
    }
    out
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
        // In a JSON body: between quotes the text escaped, outside them a value
        // ("speed": {{velocita}} with "0,9" → 0.9; other text → "quoted").
        let quoted = json_body && in_json_string(&out);
        match values.get(key) {
            _ if key.starts_with("secret:") => out.push_str(whole),
            Some(Value::String(s)) if encode => out.push_str(&url_encode(s)),
            Some(Value::String(s)) if quoted => out.push_str(&json_inner(s)),
            Some(Value::String(s)) if json_body => out.push_str(&json_bare(s)),
            Some(v) if quoted => out.push_str(&json_inner(&v.to_string())),
            Some(Value::String(s)) => out.push_str(s),
            Some(v) if encode => out.push_str(&url_encode(&v.to_string())),
            Some(v) => out.push_str(&v.to_string()),
            None => out.push_str(if json_body && !quoted { "null" } else { "" }),
        }
        rest = after.get(end + 2..).unwrap_or_default();
    }
    out.push_str(rest);
    out
}

/// Whether the end of a JSON text being written is inside a string (odd unescaped quotes).
fn in_json_string(text: &str) -> bool {
    let mut inside = false;
    let mut escaped = false;
    for ch in text.chars() {
        match ch {
            _ if escaped => escaped = false,
            '\\' if inside => escaped = true,
            '"' => inside = !inside,
            _ => {}
        }
    }
    inside
}

/// A text escaped for inside a JSON string: quotes, backslashes, new lines, controls.
fn json_inner(s: &str) -> String {
    let q = serde_json::to_string(s).unwrap_or_default();
    q.get(1..q.len().saturating_sub(1)).unwrap_or_default().to_string()
}

/// A text outside quotes in a JSON body: a number when it reads as one ("0,9"
/// → 0.9), true/false/null as they are, anything else as a JSON string.
fn json_bare(s: &str) -> String {
    let t = s.trim();
    if matches!(t, "true" | "false" | "null") {
        return t.to_string();
    }
    let n = if t.contains(',') && !t.contains('.') { t.replace(',', ".") } else { t.to_string() };
    if serde_json::from_str::<serde_json::Number>(&n).is_ok() {
        n
    } else {
        serde_json::to_string(s).unwrap_or_default()
    }
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
    if let Some(file) = &r.file {
        let kept = if r.ok && (!a.folder.trim().is_empty() || !a.filename.trim().is_empty()) {
            keep(file, &fill_values(&a.filename, &values, false, false), &a.folder, a.tray)?
        } else {
            file.clone()
        };
        let kind = r.data.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
        return Ok(tf("HTTP {s}: un file ({kind}) in {path}", &[("s", &r.status.to_string()), ("kind", &kind), ("path", &kept)]));
    }
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
    fn an_update_says_what_the_saved_records_lose() {
        let field = |id: &str, kind: &str| Field { id: id.into(), label: id.into(), kind: kind.into(), ..Default::default() };
        let mut numero = field("numero", "counter");
        numero.prefix = "DDT-{anno}-".into();
        let old = Custom {
            fields: vec![numero.clone(), field("destinatario", "text"), field("note", "textarea")],
            template: "x".repeat(1000),
            actions: vec![Action { label: "PDF".into(), kind: "document".into(), ..Default::default() }],
            ..Default::default()
        };
        let mut rap = numero;
        rap.prefix = "RAP-{anno}-".into();
        let new = Custom {
            fields: vec![rap, field("cliente", "text"), field("note", "textarea"), field("servizi", "rows")],
            template: "x".repeat(300),
            ..Default::default()
        };
        let saved = [
            Record { values: [("destinatario".to_string(), json!("Farmacia"))].into_iter().collect(), ..Default::default() },
            Record { values: [("destinatario".to_string(), json!(""))].into_iter().collect(), ..Default::default() },
        ];
        let all = changes(&old, &new, &saved).join("\n");
        assert!(all.contains("«destinatario»") && all.contains("schede salvate: 1."), "{all}");
        assert!(all.contains("RAP-{anno}-"), "{all}");
        assert!(all.contains("cliente, servizi"), "{all}");
        assert!(all.contains("molto più corto"), "{all}");
        assert!(all.contains("«PDF»"), "{all}");
        assert!(!all.contains("«note»"), "{all}");
        // Nothing changed, nothing said.
        assert!(changes(&old, &old, &saved).is_empty());
    }

    #[test]
    fn an_update_by_pieces_keeps_the_rest() {
        let field = |id: &str, kind: &str| Field { id: id.into(), label: id.into(), kind: kind.into(), ..Default::default() };
        let old = Custom {
            id: "ddt".into(),
            name: "DDT".into(),
            fields: vec![field("numero", "counter"), field("cliente", "text"), field("note", "textarea")],
            template: "<div>lungo</div>".repeat(300),
            actions: vec![Action { label: "PDF".into(), kind: "pdf".into(), ..Default::default() }],
            ..Default::default()
        };
        let args = json!({
            "id": "ddt",
            "name": "Rapportino",
            "field": { "id": "ore", "label": "Ore", "kind": "number", "after": "cliente" },
            "fields": [{ "id": "cliente", "label": "Cliente finale", "kind": "text" }],
            "remove_fields": ["note"],
            "action": { "label": "Salva", "kind": "save" }
        });
        let c = patched(&old, &args).unwrap();
        assert_eq!(c.name, "Rapportino");
        assert_eq!(c.template, old.template, "the template stays when not given");
        assert_eq!(c.fields.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["numero", "cliente", "ore"]);
        assert_eq!(c.fields[1].label, "Cliente finale");
        assert_eq!(c.actions.iter().map(|a| a.label.as_str()).collect::<Vec<_>>(), ["PDF", "Salva"]);
        assert!(normalize(c).is_ok());
    }

    #[test]
    fn a_new_id_follows_into_the_settings() {
        let s = json!({
            "pillOrder": ["integration_weather", "custom:clienti-ddt"],
            "menuGroups": [{ "id": "g1", "items": ["custom:clienti-ddt"] }],
            "integrationColors": { "custom:clienti-ddt": "#22c55e" },
            "profiles": [{ "values": { "pillOrder": ["custom:clienti-ddt"] } }],
            "other": "custom:clienti-ddt-2"
        });
        let r = renamed_task(s, "custom:clienti-ddt", "custom:clienti");
        assert_eq!(r["pillOrder"][1], "custom:clienti");
        assert_eq!(r["menuGroups"][0]["items"][0], "custom:clienti");
        assert_eq!(r["integrationColors"]["custom:clienti"], "#22c55e");
        assert_eq!(r["profiles"][0]["values"]["pillOrder"][0], "custom:clienti");
        assert_eq!(r["other"], "custom:clienti-ddt-2", "only the whole name");
    }

    #[test]
    fn a_file_answer_is_told_from_text_by_its_type() {
        assert_eq!(file_ext("audio/mpeg", b"ID3"), Some("mp3"));
        assert_eq!(file_ext("image/png; charset=binary", b""), Some("png"));
        assert_eq!(file_ext("application/octet-stream", b""), Some("bin"));
        assert_eq!(file_ext("application/json; charset=utf-8", b"{}"), None);
        assert_eq!(file_ext("text/plain", b"ciao"), None);
        assert_eq!(file_ext("", b"{\"a\":1}"), None, "no type and text: data");
        assert_eq!(file_ext("", &[0xff, 0xfb, 0x90, 0x00]), Some("bin"), "no type and not text: a file");
    }

    #[test]
    fn only_answered_files_are_kept_and_keys_get_plain_names() {
        let outside = std::env::temp_dir().join("easyisland-test-keep.mp3");
        std::fs::write(&outside, b"x").unwrap();
        assert!(keep(&outside.to_string_lossy(), "", "", false).is_err());
        let _ = std::fs::remove_file(&outside);
        assert_eq!(secret_var("api key"), "EASYISLAND_SECRET_API_KEY");
        assert_eq!(secret_var("openrouter"), "EASYISLAND_SECRET_OPENROUTER");
    }

    #[test]
    fn a_borrowed_template_is_not_replaced_by_the_default_one() {
        let base = Custom { id: "registro".into(), name: "Registro".into(), fields: vec![Field { id: "a".into(), label: "A".into(), kind: "text".into(), ..Default::default() }], ..Default::default() };
        let mut c = base.clone();
        c.template_from = " DDT-Easytech ".into();
        let n = normalize(c).unwrap();
        assert_eq!(n.template_from, "ddt-easytech");
        assert!(n.template.is_empty());
        assert!(!normalize(base.clone()).unwrap().template.is_empty(), "no template, none borrowed: the default one");
        let mut own = base;
        own.template_from = "registro".into();
        assert!(normalize(own).is_err(), "not its own");
    }

    #[test]
    fn a_link_fills_other_fields_and_columns() {
        let field = |id: &str, kind: &str| Field { id: id.into(), label: id.into(), kind: kind.into(), ..Default::default() };
        let mut cliente = field("cliente", "link");
        cliente.source = "clienti".into();
        cliente.fill = [("indirizzo".to_string(), " indirizzo ".to_string()), ("recapito".to_string(), "{{cap}} {{citta}}".to_string())].into();
        let col = |id: &str, kind: &str| Column { id: id.into(), label: id.into(), kind: kind.into(), ..Default::default() };
        let mut servizio = col("servizio", "link");
        servizio.source = "listino".into();
        servizio.fill = [("prezzo".to_string(), "prezzo".to_string())].into();
        let mut righe = field("righe", "rows");
        righe.columns = vec![servizio, col("prezzo", "money"), col("totale", "computed")];
        righe.columns[2].formula = "prezzo".into();
        let base = Custom { name: "Rapportino".into(), fields: vec![cliente, field("indirizzo", "text"), field("recapito", "text"), righe], ..Default::default() };
        let ok = normalize(base.clone()).expect("valid");
        assert_eq!(ok.fields[0].fill.get("indirizzo").map(String::as_str), Some("indirizzo"));

        // A computed value, a table, itself or a field that is not there: refused, with the reason.
        for bad in ["righe", "cliente", "manca"] {
            let mut c = base.clone();
            c.fields[0].fill = [(bad.to_string(), "x".to_string())].into();
            assert!(normalize(c).is_err(), "{bad}");
        }
        let mut c = base.clone();
        c.fields[3].columns[0].fill = [("totale".to_string(), "prezzo".to_string())].into();
        assert!(normalize(c).is_err());
        let mut c = base;
        c.fields[3].columns[0].source = String::new();
        assert!(normalize(c).is_err());
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
    fn a_json_body_gets_numbers_bare_and_text_escaped() {
        let v: Map<String, Value> = serde_json::from_value(json!({ "vel": "0,9", "testo": "a \"b\"\nc", "voce": "alloy", "n": 2 })).unwrap();
        let body = fill_values(r#"{"input":"{{testo}}","speed":{{vel}},"voice":{{voce}},"n":"{{n}}"}"#, &v, false, true);
        assert_eq!(body, r#"{"input":"a \"b\"\nc","speed":0.9,"voice":"alloy","n":"2"}"#);
        assert!(serde_json::from_str::<Value>(&body).is_ok());
        assert_eq!(json_bare("007"), "\"007\"");
        assert_eq!(json_bare("1.5"), "1.5");
    }

    #[test]
    fn a_select_takes_its_choices_from_a_source_of_its_own() {
        let mut c: Custom = serde_json::from_value(json!({
            "name": "TTS",
            "sources": [{ "id": "motori", "url": "https://openrouter.ai/api/v1/models", "items": "data" }],
            "fields": [
                { "id": "modello", "label": "Motore", "kind": "select", "optionsFrom": { "source": "motori", "value": "id", "label": "name" }, "fill": { "prezzo": "pricing.prompt" } },
                { "id": "voce", "label": "Voce", "kind": "select", "optionsFrom": { "source": "motori", "match": { "id": "{{modello}}" }, "list": "supported_voices" } },
                { "id": "prezzo", "label": "Prezzo", "kind": "text" }
            ]
        })).unwrap();
        let n = normalize(c.clone()).unwrap();
        assert_eq!(n.fields[1].options_from.as_ref().unwrap().matching.get("id").map(String::as_str), Some("{{modello}}"));
        assert_eq!(n.fields[0].fill.get("prezzo").map(String::as_str), Some("pricing.prompt"));
        // Written as the source's label: saved with its id, the one the card looks for.
        let mut by_label = c.clone();
        by_label.sources[0].label = "Motori TTS".into();
        by_label.fields[0].options_from.as_mut().unwrap().source = "motori_tts".into();
        assert_eq!(normalize(by_label).unwrap().fields[0].options_from.as_ref().unwrap().source, "motori");
        c.fields[0].options_from.as_mut().unwrap().source = "altro".into();
        assert!(normalize(c).unwrap_err().contains("optionsFrom"));
    }

    #[test]
    fn a_script_needs_its_commands_and_a_shell() {
        let mut c = quote();
        c.actions.push(Action { label: "Crea".into(), kind: "script".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("script"));
        let mut c = quote();
        c.actions.push(Action { label: "Crea".into(), kind: "script".into(), script: "Get-Date".into(), shell: "bash".into(), ..Default::default() });
        assert_eq!(normalize(c).unwrap().actions.last().unwrap().shell, "powershell");
        let mut c = quote();
        c.actions.push(Action { label: "Crea".into(), kind: "script".into(), script: "x".repeat(MAX_SCRIPT + 1), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("20.000"));
    }

    #[test]
    fn a_file_name_as_windows_takes_it() {
        assert_eq!(base_of("x", "DDT-2026-002 TALENTI S.p.A.", "pdf"), "DDT-2026-002 TALENTI S.p.A");
        assert_eq!(base_of("x", "Offerta 07/11/2026 a:b", "pdf"), "Offerta 07-11-2026 a-b");
        assert_eq!(base_of("x", "un \"bel\" <nome>?\nsu due righe", "pdf"), "un bel nome su due righe");
        assert_eq!(base_of("x", "prova.PDF", "pdf"), "prova");
        assert_eq!(base_of("x", "..\\..\\fuori", "pdf"), "-..-fuori");
        assert_eq!(base_of("x", "con", "pdf"), "_con");
        assert_eq!(base_of("x", "COM3.bak", "pdf"), "_COM3.bak");
        assert_eq!(base_of("x", "Cometa", "pdf"), "Cometa");
        assert_eq!(base_of("x", &"è".repeat(300), "pdf").chars().count(), 120);
        // Nothing left of the name asked for: the usual one.
        assert_eq!(base_of("DDT Easytech", " ... ", "pdf"), "ddt-easytech");
        assert_eq!(base_of("", "", "pdf"), "documento");
    }

    #[test]
    fn a_title_and_a_file_name_use_fields_it_has() {
        let mut c = normalize(quote()).unwrap();
        c.title = format!("{{{{{}}}}} · {{{{oggi|lunga}}}}", c.fields[0].id);
        c.actions.push(Action { label: "PDF".into(), kind: "pdf".into(), filename: format!(" {{{{{}}}}} ", c.fields[0].id), ..Default::default() });
        let id = c.fields[0].id.clone();
        let done = normalize(c.clone()).unwrap();
        assert_eq!(done.actions.last().unwrap().filename, format!("{{{{{id}}}}}"));
        c.title = "{{clienet}}".into();
        assert!(normalize(c.clone()).unwrap_err().contains("clienet"));
        c.title = String::new();
        c.actions.last_mut().unwrap().filename = "x".repeat(201);
        assert!(normalize(c).unwrap_err().contains("filename"));
    }

    #[test]
    fn a_document_keeps_its_name_and_goes_to_its_folder() {
        let folder = std::env::temp_dir().join(format!("easyisland-prova-nome-{}", std::process::id()));
        let f = folder.to_string_lossy().to_string();
        let first = document("x", "html", "<p>uno</p>", "DDT 1 Rossi", &f).unwrap();
        assert!(first.name.starts_with("DDT 1 Rossi"));
        document("x", "html", "<p>due</p>", "DDT 1 Rossi", &f).unwrap();
        assert_eq!(std::fs::read_to_string(folder.join("DDT 1 Rossi.html")).unwrap(), "<p>uno</p>");
        assert_eq!(std::fs::read_to_string(folder.join("DDT 1 Rossi (2).html")).unwrap(), "<p>due</p>");
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_pdf_is_a_document_with_its_folder() {
        let mut c = quote();
        c.actions.push(Action { label: "PDF".into(), kind: "pdf".into(), folder: "%USERPROFILE%\\DDT".into(), ..Default::default() });
        let c = normalize(c).unwrap();
        let a = c.actions.last().unwrap();
        assert_eq!((a.kind.as_str(), a.format.as_str()), ("document", "pdf"));
        let mut c = quote();
        c.actions[0].format = "pdf".into();
        assert_eq!(normalize(c).unwrap().actions[0].format, "pdf");
        let mut c = quote();
        c.actions.push(Action { label: "PDF".into(), kind: "pdf".into(), folder: "cartella".into(), ..Default::default() });
        assert!(normalize(c).unwrap_err().contains("folder"));
    }

    #[test]
    fn variables_in_a_folder_and_documents_never_overwritten() {
        std::env::set_var("EASYISLAND_PROVA", "C:\\x");
        assert_eq!(expand_env("%EASYISLAND_PROVA%\\DDT"), "C:\\x\\DDT");
        assert_eq!(expand_env("%NON_ESISTE_PROVA%\\DDT"), "%NON_ESISTE_PROVA%\\DDT");
        assert_eq!(expand_env("C:\\100%"), "C:\\100%");
        let folder = std::env::temp_dir().join(format!("easyisland-prova-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        assert!(free_path(&folder, "ddt", "pdf").ends_with("ddt.pdf"));
        std::fs::write(folder.join("ddt.pdf"), b"x").unwrap();
        assert!(free_path(&folder, "ddt", "pdf").ends_with("ddt (2).pdf"));
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_file_of_an_integration_stays_in_its_folder() {
        assert!(asset_name_ok("logo.png") && asset_name_ok("logo easytech-2.jpg"));
        for bad in ["", "..", "../segreto.png", "..\\segreto.png", "a/b.png", "a\\b.png", "C:\\x.png", "logo..png"] {
            assert!(!asset_name_ok(bad), "{bad}");
        }
        assert_eq!(mime_of("Logo.PNG"), Some("image/png"));
        assert_eq!(mime_of("segreto.json"), None);
    }

    #[test]
    fn no_actions_means_save() {
        let mut c = quote();
        c.actions.clear();
        assert_eq!(normalize(c).unwrap().actions[0].kind, "save");
    }
}
