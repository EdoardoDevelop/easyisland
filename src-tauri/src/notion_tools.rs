// Notion through EasyIsland's own integration, for every engine of the chat
// (asked by Edoardo on 19 October 2026: Antigravity had no way to Notion,
// and a model with Notion's own tools made eight empty pages by putting
// `parent` in the wrong place). These are easyisland tools (agent.rs): the
// token stays in Credential Manager, the database is found in the map
// (notion_map.rs) and the values are checked against its properties before
// anything is written, so a row cannot end up outside its database.
//
// Reading is free; adding and changing rows ask Consenti / Nega like the
// other tools that change something. Nothing here deletes or archives.

use serde_json::{json, Map as JsonMap, Value};

use crate::notion::{call, client, API};
use crate::notion_map::{Db, Prop};

const MAX_ROWS: usize = 200;

fn need_key() -> Result<(), String> {
    crate::secrets::get("notion-api-key")
        .map(|_| ())
        .ok_or_else(|| "Notion non è collegato a EasyIsland (Impostazioni → Integrazioni → Notion).".to_string())
}

fn plain(rich: Option<&Value>) -> String {
    rich.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| t.get("plain_text").and_then(Value::as_str)).collect::<String>())
        .unwrap_or_default()
}

fn is_id(s: &str) -> bool {
    let hex = s.replace('-', "");
    hex.len() == 32 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// The id at the end of a Notion link, or the text itself.
fn id_of(s: &str) -> String {
    let s = s.trim();
    let tail = s.split(['?', '#']).next().unwrap_or(s).rsplit(['/', '-']).next().unwrap_or(s);
    if is_id(tail) { tail.to_string() } else { s.to_string() }
}

/// The database a name, an id or a link points to: from the map, or read
/// from Notion when the map does not have it.
async fn database(which: &str) -> Result<Db, String> {
    let which = which.trim();
    if which.is_empty() {
        return Err("Manca il database (nome o id, vedi notion_map).".into());
    }
    let id = id_of(which);
    let map = crate::notion_map::databases();
    if is_id(&id) {
        if let Some(d) = map.iter().find(|d| crate::notion_map::same_id(&d.id, &id)) {
            return Ok(d.clone());
        }
        let v = call(client().get(format!("{API}/databases/{id}"))).await?;
        return Ok(Db {
            id: id.clone(),
            title: plain(v.get("title")),
            url: v.get("url").and_then(Value::as_str).unwrap_or_default().to_string(),
            properties: crate::notion_map::props_of(&v),
            ..Default::default()
        });
    }
    let q = which.to_lowercase();
    if let Some(d) = map.iter().find(|d| d.title.trim().to_lowercase() == q) {
        return Ok(d.clone());
    }
    let found: Vec<&Db> = map.iter().filter(|d| d.title.to_lowercase().contains(&q)).collect();
    match found.as_slice() {
        [d] => Ok((*d).clone()),
        [] if map.is_empty() => Err(format!("Nessun database «{which}»: la mappa di Notion è vuota (Impostazioni → Integrazioni → Notion → Sincronizza), oppure passa l'id.")),
        [] => Err(format!("Nessun database «{which}» nella mappa. Ci sono: {}.", map.iter().map(|d| d.title.as_str()).collect::<Vec<_>>().join(", "))),
        more => Err(format!("«{which}» indica più database: {}. Scegline uno.", more.iter().map(|d| d.title.as_str()).collect::<Vec<_>>().join(", "))),
    }
}

/// One property of a row as text.
fn value_text(p: &Value) -> String {
    value_text_with(p, &std::collections::HashMap::new())
}

/// The value as text; relations by title when `titles` knows them.
fn value_text_with(p: &Value, titles: &std::collections::HashMap<String, String>) -> String {
    let kind = p.get("type").and_then(Value::as_str).unwrap_or_default();
    let v = p.get(kind).unwrap_or(&Value::Null);
    let name = |x: &Value| x.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    match kind {
        "title" | "rich_text" => plain(Some(v)),
        "number" => v.as_f64().map(|n| n.to_string()).unwrap_or_default(),
        "select" | "status" => name(v),
        "multi_select" => v.as_array().map(|a| a.iter().map(name).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
        "date" => match (v.get("start").and_then(Value::as_str), v.get("end").and_then(Value::as_str)) {
            (Some(s), Some(e)) => format!("{s} → {e}"),
            (Some(s), None) => s.to_string(),
            _ => String::new(),
        },
        "checkbox" => if v.as_bool() == Some(true) { "sì".into() } else { "no".into() },
        "url" | "email" | "phone_number" | "created_time" | "last_edited_time" => v.as_str().unwrap_or_default().to_string(),
        "relation" => v.as_array().map(|a| a.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).map(|id| titles.get(id).cloned().unwrap_or_else(|| id.to_string())).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
        "people" => v.as_array().map(|a| a.iter().filter_map(|u| u.get("name").and_then(Value::as_str)).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
        "formula" => {
            let t = v.get("type").and_then(Value::as_str).unwrap_or_default();
            match v.get(t) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::Bool(b)) => if *b { "sì".into() } else { "no".into() },
                Some(d @ Value::Object(_)) => d.get("start").and_then(Value::as_str).unwrap_or_default().to_string(),
                _ => String::new(),
            }
        }
        // "Tipo" (Uscita / Entrata) is a rollup of a select: an array of values.
        "rollup" => match v.get("type").and_then(Value::as_str) {
            Some("array") => v.get("array").and_then(Value::as_array).map(|a| a.iter().map(|x| value_text_with(x, titles)).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
            Some("date") => v.pointer("/date/start").and_then(Value::as_str).unwrap_or_default().to_string(),
            _ => v.get("number").and_then(Value::as_f64).map(|n| n.to_string()).unwrap_or_default(),
        },
        _ => String::new(),
    }
}

/// A row as a few lines: title, link, then the properties that have a value.
fn row_text(row: &Value) -> String {
    let id = row.get("id").and_then(Value::as_str).unwrap_or_default();
    let url = row.get("url").and_then(Value::as_str).unwrap_or_default();
    let props = row.get("properties").and_then(Value::as_object);
    let mut title = String::new();
    let mut rest = Vec::new();
    let mut list: Vec<(&String, &Value)> = props.into_iter().flatten().collect();
    list.sort_by_key(|(n, _)| n.to_lowercase());
    for (name, p) in list {
        let text = value_text(p);
        if p.get("type").and_then(Value::as_str) == Some("title") {
            title = text;
        } else if !text.is_empty() {
            rest.push(format!("{name}: {text}"));
        }
    }
    let title = if title.trim().is_empty() { "(senza titolo)".to_string() } else { title };
    let mut s = format!("- {title} — id {id} — {url}");
    if !rest.is_empty() {
        s.push_str("\n  ");
        s.push_str(&rest.join(" · "));
    }
    s
}

/// Rows as one compact table: the column names once, a line per row, and
/// the totals of the number columns. The rows of a month as "- title — id —
/// link" plus every property's name were 11,500 tokens for 38 rows, and the
/// model then took 13 s adding them up (20 October 2026).
fn rows_table(rows: &[Value], titles: &std::collections::HashMap<String, String>) -> String {
    let props = |r: &Value| r.get("properties").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut title_col = String::new();
    let mut cols: Vec<String> = Vec::new();
    let mut numeric: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for r in rows {
        for (name, p) in props(r) {
            if p.get("type").and_then(Value::as_str) == Some("title") {
                title_col = name;
                continue;
            }
            let text = value_text_with(&p, titles);
            if text.is_empty() {
                continue;
            }
            let is_num = text.parse::<f64>().is_ok() && !matches!(p.get("type").and_then(Value::as_str), Some("rich_text" | "title" | "select" | "status"));
            let e = numeric.entry(name.clone()).or_insert(true);
            *e &= is_num;
            if !cols.contains(&name) {
                cols.push(name);
            }
        }
    }
    cols.sort_by_key(|n| n.to_lowercase());
    let cell = |s: String| s.replace(['|', '\n', '\r'], " ").trim().to_string();
    let title_name = if title_col.is_empty() { "Titolo".to_string() } else { title_col.clone() };
    let mut out = format!("id | {title_name} | {}", cols.join(" | "));
    let mut sums: Vec<f64> = vec![0.0; cols.len()];
    for r in rows {
        let p = props(r);
        let id = r.get("id").and_then(Value::as_str).unwrap_or_default().replace('-', "");
        let title = p.get(&title_col).map(|v| value_text_with(v, titles)).unwrap_or_default();
        let mut line = format!("{id} | {}", cell(if title.trim().is_empty() { "(senza titolo)".into() } else { title }));
        for (i, c) in cols.iter().enumerate() {
            let v = p.get(c).map(|v| value_text_with(v, titles)).unwrap_or_default();
            if let Ok(n) = v.parse::<f64>() {
                sums[i] += n;
            }
            line.push_str(" | ");
            line.push_str(&cell(v));
        }
        out.push('\n');
        out.push_str(&line);
    }
    let totals: Vec<String> = cols.iter().zip(&sums)
        .filter(|(c, _)| numeric.get(*c) == Some(&true))
        .map(|(c, s)| format!("{c} = {}", (s * 100.0).round() / 100.0))
        .collect();
    if !totals.is_empty() {
        out.push_str(&format!("\nTotali di queste righe: {}", totals.join(" · ")));
    }
    out.push_str(&group_totals(rows, titles));
    out
}

/// Sums split by the few-valued choices (a select, a status, a rollup of one):
/// "Per Tipo: Uscita 1679.45 · Entrata 1830", and the first two together.
/// A model took 1,830 € of income out of a total by itself and got it wrong
/// by 2 € (20 October 2026); with these it only reads.
fn group_totals(rows: &[Value], titles: &std::collections::HashMap<String, String>) -> String {
    let kind = |p: &Value| p.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
    let first = rows.first().and_then(|r| r.get("properties")).and_then(Value::as_object).cloned().unwrap_or_default();
    // The amounts: the number properties (formulas only when there are none).
    let mut amounts: Vec<String> = first.iter().filter(|(_, p)| kind(p) == "number").map(|(n, _)| n.clone()).collect();
    if amounts.is_empty() {
        return String::new();
    }
    amounts.sort();
    let value = |r: &Value, name: &str| r.pointer(&format!("/properties/{}", name.replace('~', "~0").replace('/', "~1"))).map(|p| value_text_with(p, titles)).unwrap_or_default();
    // A row without the choice still counts: every split adds up to the total.
    let choice_of = |r: &Value, name: &str| {
        let v = value(r, name);
        if v.is_empty() { "(vuoto)".to_string() } else { v }
    };
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for (name, p) in &first {
        let k = kind(p);
        let choice = matches!(k.as_str(), "select" | "status") || (k == "rollup" && p.pointer("/rollup/type").and_then(Value::as_str) == Some("array"));
        if !choice {
            continue;
        }
        let mut values: Vec<String> = Vec::new();
        for r in rows {
            let v = choice_of(r, name);
            if !values.contains(&v) {
                values.push(v);
            }
        }
        if (2..=6).contains(&values.len()) {
            groups.push((name.clone(), values));
        }
    }
    groups.sort_by(|a, b| a.1.len().cmp(&b.1.len()).then(a.0.cmp(&b.0)));
    let sum = |keep: &dyn Fn(&Value) -> bool, amount: &str| -> f64 {
        rows.iter().filter(|r| keep(r)).filter_map(|r| value(r, amount).parse::<f64>().ok()).sum()
    };
    let money = |x: f64| ((x * 100.0).round() / 100.0).to_string();
    let mut out = String::new();
    for amount in &amounts {
        for (name, values) in &groups {
            let parts: Vec<String> = values.iter().map(|v| format!("{v} {}", money(sum(&|r| choice_of(r, name) == *v, amount)))).collect();
            out.push_str(&format!("\n{amount} per {name}: {}", parts.join(" · ")));
        }
        if let [(a, va), (b, vb), ..] = groups.as_slice() {
            let mut parts = Vec::new();
            for x in va {
                for y in vb {
                    let n = rows.iter().filter(|r| choice_of(r, a) == *x && choice_of(r, b) == *y).count();
                    if n > 0 {
                        parts.push(format!("{x}/{y} {} ({n})", money(sum(&|r| choice_of(r, a) == *x && choice_of(r, b) == *y, amount))));
                    }
                }
            }
            out.push_str(&format!("\n{amount} per {a} e {b}: {}", parts.join(" · ")));
        }
    }
    out
}

/// Titles of related pages, kept for the app's life (categories do not change often).
static TITLES: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> = std::sync::Mutex::new(None);

async fn relation_titles(rows: &[Value]) -> std::collections::HashMap<String, String> {
    let mut known = TITLES.lock().unwrap().clone().unwrap_or_default();
    let mut missing: Vec<String> = Vec::new();
    for r in rows {
        for p in r.get("properties").and_then(Value::as_object).into_iter().flat_map(|o| o.values()) {
            if p.get("type").and_then(Value::as_str) != Some("relation") {
                continue;
            }
            for id in p.get("relation").and_then(Value::as_array).into_iter().flatten().filter_map(|x| x.get("id").and_then(Value::as_str)) {
                if !known.contains_key(id) && !missing.iter().any(|m| m == id) {
                    missing.push(id.to_string());
                }
            }
        }
    }
    // At most 40 at a time, side by side: a month of rows has a dozen categories.
    let mut set = tokio::task::JoinSet::new();
    for id in missing.into_iter().take(40) {
        set.spawn(async move {
            let page = call(client().get(format!("{API}/pages/{id}"))).await.ok()?;
            let title = page.get("properties").and_then(Value::as_object)?.values()
                .find(|p| p.get("type").and_then(Value::as_str) == Some("title"))
                .map(value_text)?;
            Some((id, title))
        });
    }
    let mut fresh = false;
    while let Some(done) = set.join_next().await {
        if let Ok(Some((id, title))) = done {
            known.insert(id, title);
            fresh = true;
        }
    }
    if fresh {
        *TITLES.lock().unwrap() = Some(known.clone());
    }
    known
}

/// Answers of notion_query for two minutes: two questions in a row do not
/// read the same rows again. A write empties it.
static ANSWERS: std::sync::Mutex<Vec<(String, std::time::Instant, String)>> = std::sync::Mutex::new(Vec::new());
const ANSWER_TTL: std::time::Duration = std::time::Duration::from_secs(120);

fn forget_answers() {
    ANSWERS.lock().unwrap().clear();
}

fn as_list(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).collect(),
        Value::String(s) => s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        _ => Vec::new(),
    }
}

/// "6,40 €" → 6.4.
fn number(v: &Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    let s: String = v.as_str()?.chars().filter(|c| c.is_ascii_digit() || matches!(c, ',' | '.' | '-')).collect();
    // "1.234,56": the last separator is the decimal one.
    let s = match (s.rfind(','), s.rfind('.')) {
        (Some(c), Some(d)) if c > d => s.replace('.', "").replace(',', "."),
        (Some(_), None) => s.replace(',', "."),
        _ => s.replace(',', ""),
    };
    s.parse().ok()
}

/// An option of a select or status, matched without case; None if it is not one of them.
fn option<'a>(p: &'a Prop, wanted: &str) -> Option<&'a str> {
    p.options.iter().find(|o| o.trim().eq_ignore_ascii_case(wanted.trim())).map(String::as_str)
}

/// Pages of the related database whose title matches `name` (for a relation given by name).
async fn related(db_id: &str, name: &str) -> Result<String, String> {
    let other = database(db_id).await?;
    let title = other.properties.iter().find(|p| p.kind == "title").map(|p| p.name.clone()).unwrap_or_default();
    let body = json!({ "page_size": 5, "filter": { "property": title, "title": { "contains": name } } });
    let v = call(client().post(format!("{API}/databases/{}/query", other.id)).json(&body)).await?;
    let rows: Vec<&Value> = v.get("results").and_then(Value::as_array).into_iter().flatten().collect();
    let exact: Vec<&&Value> = rows
        .iter()
        .filter(|r| r.get("properties").and_then(|p| p.get(&title)).map(value_text).is_some_and(|t| t.trim().eq_ignore_ascii_case(name.trim())))
        .collect();
    let pick = match (exact.as_slice(), rows.as_slice()) {
        ([one], _) => *one,
        ([], [one]) => one,
        ([], []) => return Err(format!("In «{}» non c'è «{name}».", other.title)),
        _ => return Err(format!("In «{}» ci sono più voci per «{name}»: passa l'id (notion_query).", other.title)),
    };
    Ok(pick.get("id").and_then(Value::as_str).unwrap_or_default().to_string())
}

/// The values given by the model, as Notion properties, checked against the database.
async fn properties(db: &Db, given: &Value) -> Result<Value, String> {
    let given = given.as_object().ok_or("properties deve essere un oggetto { \"Nome proprietà\": valore }.")?;
    let names = || db.properties.iter().map(|p| format!("{} ({})", p.name, p.kind)).collect::<Vec<_>>().join(", ");
    let mut out = JsonMap::new();
    for (key, v) in given {
        let Some(p) = db.properties.iter().find(|p| p.name == *key).or_else(|| db.properties.iter().find(|p| p.name.eq_ignore_ascii_case(key.trim()))) else {
            return Err(format!("«{}» non ha la proprietà «{key}». Proprietà: {}.", db.title, names()));
        };
        if v.is_null() {
            continue;
        }
        let text = v.as_str().map(str::trim).unwrap_or_default().to_string();
        let bad = |what: &str| format!("«{}» ({}): {what}", p.name, p.kind);
        let value = match p.kind.as_str() {
            "title" => json!({ "title": crate::notion::rich(&text) }),
            "rich_text" => json!({ "rich_text": crate::notion::rich(&text) }),
            "number" => json!({ "number": number(v).ok_or_else(|| bad("serve un numero"))? }),
            "select" | "status" => {
                let o = option(p, &text).ok_or_else(|| bad(&format!("«{text}» non è tra le opzioni: {}", p.options.join(", "))))?;
                json!({ p.kind.as_str(): { "name": o } })
            }
            "multi_select" => {
                let mut list = Vec::new();
                for x in as_list(v) {
                    let o = option(p, &x).ok_or_else(|| bad(&format!("«{x}» non è tra le opzioni: {}", p.options.join(", "))))?;
                    list.push(json!({ "name": o }));
                }
                json!({ "multi_select": list })
            }
            "date" => {
                let (start, end) = match v {
                    Value::Object(o) => (o.get("start").and_then(Value::as_str).unwrap_or_default().to_string(), o.get("end").and_then(Value::as_str).map(String::from)),
                    _ => (text.clone(), None),
                };
                if start.len() < 10 || !start.get(..4).is_some_and(|y| y.chars().all(|c| c.is_ascii_digit())) {
                    return Err(bad("serve una data AAAA-MM-GG (anche con l'ora, es. 2026-10-19T13:00:00+02:00)"));
                }
                json!({ "date": { "start": start, "end": end } })
            }
            "checkbox" => json!({ "checkbox": match v {
                Value::Bool(b) => *b,
                _ => matches!(text.to_lowercase().as_str(), "sì" | "si" | "true" | "yes" | "1" | "x"),
            } }),
            "url" => json!({ "url": text }),
            "email" => json!({ "email": text }),
            "phone_number" => json!({ "phone_number": text }),
            "relation" => {
                let mut ids = Vec::new();
                for x in as_list(v) {
                    let id = id_of(&x);
                    let id = if is_id(&id) { id } else if p.relation.is_empty() { return Err(bad("serve l'id della pagina collegata")) } else { related(&p.relation, &x).await? };
                    ids.push(json!({ "id": id }));
                }
                json!({ "relation": ids })
            }
            other => return Err(bad(&format!("il tipo {other} non si può impostare da qui"))),
        };
        out.insert(p.name.clone(), value);
    }
    if out.is_empty() {
        return Err(format!("Nessuna proprietà da scrivere. Proprietà di «{}»: {}.", db.title, names()));
    }
    Ok(Value::Object(out))
}

pub async fn search(query: &str) -> Result<String, String> {
    need_key()?;
    let found = crate::notion::search(query, 15, None).await?;
    if found.is_empty() {
        return Ok(format!("Nessun risultato per «{}» (EasyIsland vede solo ciò che è condiviso con la sua integrazione).", query.trim()));
    }
    let lines: Vec<String> = found
        .iter()
        .map(|p| {
            let s = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            let kind = if p.get("database").and_then(Value::as_bool) == Some(true) || s("kind") == "database" { "database" } else { "pagina" };
            format!("- {} ({kind}) — id {} — {}", s("title"), s("id"), s("url"))
        })
        .collect();
    Ok(lines.join("\n"))
}

pub async fn read(page: &str) -> Result<String, String> {
    need_key()?;
    let id = id_of(page);
    if !is_id(&id) {
        return Err("Serve l'id o il link della pagina (notion_search).".into());
    }
    let row = call(client().get(format!("{API}/pages/{id}"))).await?;
    // A row with no text inside is still worth its properties.
    let (title, text) = match crate::notion::page_text(&id).await {
        Ok(found) => found,
        Err(_) => (row.get("properties").and_then(|p| p.as_object()).and_then(|p| p.values().find(|x| x.get("type").and_then(Value::as_str) == Some("title"))).map(value_text).unwrap_or_default(), String::new()),
    };
    let mut out = format!("# {title}\n{}", row_text(&row));
    if !text.trim().is_empty() {
        out.push_str("\n\n");
        out.push_str(&text);
    }
    Ok(out)
}

/// Rows of a database: the most recently edited first, or as `sorts` says;
/// only those whose title contains `text` and that pass `filter` (Notion's own
/// filter object). Up to MAX_ROWS, a page of 100 at a time.
pub async fn query(which: &str, text: &str, filter: Option<&Value>, sorts: Option<&Value>, limit: Option<u64>) -> Result<String, String> {
    need_key()?;
    let db = database(which).await?;
    let limit = limit.map_or(20, |n| (n as usize).clamp(1, MAX_ROWS));
    let by_title = (!text.trim().is_empty())
        .then(|| db.properties.iter().find(|p| p.kind == "title"))
        .flatten()
        .map(|t| json!({ "property": t.name, "title": { "contains": text.trim() } }));
    let given = filter.filter(|f| f.as_object().is_some_and(|o| !o.is_empty())).cloned();
    let filter = match (by_title, given) {
        (Some(a), Some(b)) => Some(json!({ "and": [a, b] })),
        (a, b) => a.or(b),
    };
    let sorts = sorts.filter(|s| s.as_array().is_some_and(|a| !a.is_empty())).cloned()
        .unwrap_or_else(|| json!([{ "timestamp": "last_edited_time", "direction": "descending" }]));
    let key = format!("{}|{}|{}|{limit}", db.id, filter.as_ref().map(Value::to_string).unwrap_or_default(), sorts);
    {
        let mut a = ANSWERS.lock().unwrap();
        a.retain(|(_, at, _)| at.elapsed() < ANSWER_TTL);
        if let Some((_, _, text)) = a.iter().find(|(k, _, _)| *k == key) {
            return Ok(text.clone());
        }
    }
    let mut rows: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut more = false;
    while rows.len() < limit {
        let mut body = json!({ "page_size": (limit - rows.len()).min(100), "sorts": sorts });
        if let Some(f) = &filter {
            body["filter"] = f.clone();
        }
        if let Some(c) = &cursor {
            body["start_cursor"] = json!(c);
        }
        let v = call(client().post(format!("{API}/databases/{}/query", db.id)).json(&body)).await?;
        rows.extend(v.get("results").and_then(Value::as_array).into_iter().flatten().cloned());
        more = v.get("has_more").and_then(Value::as_bool) == Some(true);
        cursor = v.get("next_cursor").and_then(Value::as_str).map(str::to_string);
        if !more || cursor.is_none() {
            break;
        }
    }
    if rows.is_empty() {
        return Ok(format!("«{}»: nessuna riga.", db.title));
    }
    let more = if more { " (ce ne sono altre: per totali e conti restringi con filter o alza limit)" } else { " (sono tutte)" };
    let titles = relation_titles(&rows).await;
    let text = format!("«{}», {} righe{more}:\n{}", db.title, rows.len(), rows_table(&rows, &titles));
    ANSWERS.lock().unwrap().push((key, std::time::Instant::now(), text.clone()));
    Ok(text)
}

pub async fn add_row(which: &str, given: &Value) -> Result<String, String> {
    need_key()?;
    let db = database(which).await?;
    let props = properties(&db, given).await?;
    let body = json!({ "parent": { "database_id": db.id }, "properties": props });
    let row = call(client().post(format!("{API}/pages")).json(&body)).await?;
    forget_answers();
    crate::log::line(format!("notion: riga aggiunta in «{}»", db.title));
    Ok(format!("Riga aggiunta in «{}»:\n{}", db.title, row_text(&row)))
}

pub async fn update_row(page: &str, given: &Value) -> Result<String, String> {
    need_key()?;
    let id = id_of(page);
    if !is_id(&id) {
        return Err("Serve l'id o il link della riga (notion_query).".into());
    }
    let row = call(client().get(format!("{API}/pages/{id}"))).await?;
    let Some(db_id) = row.pointer("/parent/database_id").and_then(Value::as_str) else {
        return Err("Questa pagina non è una riga di un database: da qui si cambiano solo le proprietà delle righe.".into());
    };
    let db = database(db_id).await?;
    let props = properties(&db, given).await?;
    let row = call(client().patch(format!("{API}/pages/{id}")).json(&json!({ "properties": props }))).await?;
    forget_answers();
    crate::log::line(format!("notion: riga cambiata in «{}»", db.title));
    Ok(format!("Riga aggiornata in «{}»:\n{}", db.title, row_text(&row)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Db {
        let p = |name: &str, kind: &str, options: &[&str]| Prop { name: name.into(), kind: kind.into(), options: options.iter().map(|s| s.to_string()).collect(), relation: String::new() };
        Db {
            id: "0123456789abcdef0123456789abcdef".into(),
            title: "Spese".into(),
            properties: vec![p("Nome", "title", &[]), p("Importo", "number", &[]), p("Categoria", "select", &["Pranzo", "Gasolio"]), p("Data", "date", &[]), p("Tag", "multi_select", &["a", "b"]), p("Pagata", "checkbox", &[])],
            ..Default::default()
        }
    }

    #[test]
    fn numbers_in_italian() {
        assert_eq!(number(&json!("6,40 €")), Some(6.4));
        assert_eq!(number(&json!("1.234,5")), Some(1234.5));
        assert_eq!(number(&json!("1,234.5")), Some(1234.5));
        assert_eq!(number(&json!(3)), Some(3.0));
        assert_eq!(number(&json!("niente")), None);
    }

    #[test]
    fn ids_from_links() {
        assert_eq!(id_of("https://www.notion.so/Spese-0123456789abcdef0123456789abcdef?v=1"), "0123456789abcdef0123456789abcdef");
        assert_eq!(id_of("01234567-89ab-cdef-0123-456789abcdef"), "01234567-89ab-cdef-0123-456789abcdef");
        assert_eq!(id_of("Spese"), "Spese");
    }

    #[test]
    fn values_are_checked_against_the_database() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let d = db();
        let ok = rt
            .block_on(properties(&d, &json!({ "nome": "Pranzo", "Importo": "6,40", "Categoria": "pranzo", "Data": "2026-10-19", "Tag": "a, b", "Pagata": "sì" })))
            .unwrap();
        assert_eq!(ok["Importo"]["number"], json!(6.4));
        assert_eq!(ok["Categoria"]["select"]["name"], "Pranzo");
        assert_eq!(ok["Data"]["date"]["start"], "2026-10-19");
        assert_eq!(ok["Tag"]["multi_select"].as_array().unwrap().len(), 2);
        assert_eq!(ok["Pagata"]["checkbox"], true);
        assert_eq!(ok["Nome"]["title"][0]["text"]["content"], "Pranzo");
        assert!(rt.block_on(properties(&d, &json!({ "Costo": 3 }))).unwrap_err().contains("Importo"));
        assert!(rt.block_on(properties(&d, &json!({ "Categoria": "Cena" }))).unwrap_err().contains("Pranzo, Gasolio"));
        assert!(rt.block_on(properties(&d, &json!({ "Data": "domani" }))).is_err());
        assert!(rt.block_on(properties(&d, &json!({}))).is_err());
    }

    /// Reads only: `cargo test --lib notion_tools::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let first = crate::notion_map::databases().into_iter().next().expect("mappa vuota");
        println!("{}", rt.block_on(query(&first.title, "", None, None, Some(3))).unwrap());
        println!("{}", rt.block_on(search(&first.title)).unwrap());
        // Notion's own filter, more than one page of rows.
        if let Some(d) = crate::notion_map::databases().into_iter().find(|d| d.properties.iter().any(|p| p.kind == "date")) {
            let date = d.properties.iter().find(|p| p.kind == "date").unwrap().name.clone();
            let filter = json!({ "property": date, "date": { "on_or_after": "2026-01-01" } });
            let out = rt.block_on(query(&d.title, "", Some(&filter), None, Some(150))).unwrap();
            println!("{}", out.lines().next().unwrap_or_default());
        }
        // `LIVE_DB=Movimenti`: the whole answer, its size and the cache.
        if let Ok(db) = std::env::var("LIVE_DB") {
            let filter = json!({ "property": "Data", "date": { "on_or_after": "2026-10-01" } });
            let t = std::time::Instant::now();
            let out = rt.block_on(query(&db, "", Some(&filter), None, Some(200))).unwrap();
            let first = t.elapsed();
            let t = std::time::Instant::now();
            assert_eq!(rt.block_on(query(&db, "", Some(&filter), None, Some(200))).unwrap(), out);
            println!("{out}\n— {} caratteri, {:?} la prima volta, {:?} dalla cache", out.chars().count(), first, t.elapsed());
        }
        assert!(rt.block_on(properties(&first, &json!({ "NonEsiste": 1 }))).is_err());
    }

    #[test]
    fn rows_as_a_table_with_totals() {
        let row = |id: &str, name: &str, n: f64, cat: &str| json!({ "id": id, "url": "https://notion.so/x", "properties": {
            "Stato": { "type": "select", "select": { "name": if n > 10.0 { "Previsto" } else { "Pagato" } } },
            "Descrizione": { "type": "title", "title": [{ "plain_text": name }] },
            "Importo": { "type": "number", "number": n },
            "Note": { "type": "rich_text", "rich_text": [{ "plain_text": "a|b" }] },
            "Categoria": { "type": "relation", "relation": [{ "id": cat }] },
            "Tipo": { "type": "rollup", "rollup": { "type": "array", "array": [{ "type": "select", "select": { "name": "Uscita" } }] } },
            "Vuota": { "type": "rich_text", "rich_text": [] }
        }});
        let rows = vec![row("aa-bb", "Pranzo", 6.4, "c1"), row("cc-dd", "Gasolio", 30.0, "c2")];
        let titles = std::collections::HashMap::from([("c1".to_string(), "Pranzi".to_string())]);
        let t = rows_table(&rows, &titles);
        assert_eq!(t.lines().next().unwrap(), "id | Descrizione | Categoria | Importo | Note | Stato | Tipo");
        assert!(t.contains("aabb | Pranzo | Pranzi | 6.4 | a b | Pagato | Uscita"), "{t}");
        assert!(t.contains("ccdd | Gasolio | c2 | 30 |"), "{t}");
        assert!(t.contains("
Totali di queste righe: Importo = 36.4
"), "{t}");
        // One value only (Tipo) is no split; Stato is.
        assert!(t.ends_with("
Importo per Stato: Pagato 6.4 · Previsto 30"), "{t}");
        assert!(!t.contains("notion.so"));
    }

    #[test]
    fn rows_as_text() {
        let row = json!({ "id": "r1", "url": "https://notion.so/r1", "properties": {
            "Nome": { "type": "title", "title": [{ "plain_text": "Pranzo" }] },
            "Importo": { "type": "number", "number": 6.4 },
            "Note": { "type": "rich_text", "rich_text": [] }
        } });
        assert_eq!(row_text(&row), "- Pranzo — id r1 — https://notion.so/r1\n  Importo: 6.4");
    }
}
