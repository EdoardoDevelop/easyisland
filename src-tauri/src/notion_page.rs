//! The mini Notion of the card (views/notionpage.ts): a page's blocks or a
//! database's rows, simplified for drawing, and the edits made there (text,
//! check boxes, new blocks, a block's type, properties, rows). Deleting is
//! Notion's archive: the page or block goes to Notion's trash. Everything
//! from the API is read with `get`: a block of an unknown type is kept as
//! "unsupported" with a link to Notion, never a panic.

use serde_json::{json, Map, Value};

use crate::i18n::t;
use crate::notion::{call, check_id, client, one, API};

/// Top-level blocks read from one page.
const MAX_TOP: usize = 300;
/// Requests for nested blocks (toggles, lists, columns) on one page.
const MAX_NESTED: usize = 40;
/// Rows read from one database.
const MAX_ROWS: usize = 100;
/// A picture brought into the card.
const MAX_IMAGE: usize = 6 * 1024 * 1024;

/// Block types whose text can be edited, and the ones a new block can be.
const TEXT_KINDS: &[&str] = &[
    "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
    "to_do", "toggle", "quote", "callout", "code",
];

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// A rich_text array as spans: text with b/i/s/u/c (code), a link, a colour.
fn spans(rich: Option<&Value>) -> Value {
    let list = rich.and_then(Value::as_array).cloned().unwrap_or_default();
    Value::Array(list.iter().map(|r| {
        let a = r.get("annotations").cloned().unwrap_or(Value::Null);
        let flag = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(false);
        let mut m = Map::new();
        m.insert("t".into(), json!(s(r, "plain_text")));
        for (k, n) in [("bold", "b"), ("italic", "i"), ("strikethrough", "s"), ("underline", "u"), ("code", "c")] {
            if flag(k) {
                m.insert(n.into(), json!(true));
            }
        }
        if let Some(h) = r.get("href").and_then(Value::as_str) {
            m.insert("href".into(), json!(h));
        }
        let color = s(&a, "color");
        if !color.is_empty() && color != "default" {
            m.insert("color".into(), json!(color));
        }
        // A mention (a page, a date, a person) is shown as its text.
        if s(r, "type") == "mention" {
            m.insert("mention".into(), json!(true));
        }
        Value::Object(m)
    }).collect())
}

const COLORS: &[&str] = &[
    "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
    "gray_background", "brown_background", "orange_background", "yellow_background", "green_background",
    "blue_background", "purple_background", "pink_background", "red_background",
];

/// Spans from the card back to rich_text: at most 100 pieces of 2000 characters.
fn rich_from(spans: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    for sp in spans.as_array().into_iter().flatten().take(100) {
        let text = s(sp, "t");
        if text.is_empty() {
            continue;
        }
        let flag = |k: &str| sp.get(k).and_then(Value::as_bool).unwrap_or(false);
        let color = s(sp, "color");
        let color = if COLORS.contains(&color.as_str()) { color } else { "default".into() };
        let href = s(sp, "href");
        let link = if href.starts_with("https://") || href.starts_with("http://") || href.starts_with('/') {
            json!({ "url": href })
        } else {
            Value::Null
        };
        let chars: Vec<char> = text.chars().collect();
        for c in chars.chunks(2000) {
            let mut piece = json!({
                "type": "text",
                "text": { "content": c.iter().collect::<String>() },
                "annotations": {
                    "bold": flag("b"), "italic": flag("i"), "strikethrough": flag("s"),
                    "underline": flag("u"), "code": flag("c"), "color": color,
                },
            });
            if !link.is_null() {
                piece["text"]["link"] = link.clone();
            }
            out.push(piece);
        }
    }
    out
}

/// A page's or a database's emoji (an uploaded icon is a picture: its url).
fn icon(obj: &Value) -> Value {
    let Some(i) = obj.get("icon") else { return Value::Null };
    match i.get("type").and_then(Value::as_str) {
        Some("emoji") => json!({ "emoji": s(i, "emoji") }),
        Some("external") => json!({ "url": i.get("external").map(|e| s(e, "url")).unwrap_or_default() }),
        Some("file") => json!({ "url": i.get("file").map(|e| s(e, "url")).unwrap_or_default() }),
        _ => Value::Null,
    }
}

fn file_url(v: Option<&Value>) -> String {
    let Some(v) = v else { return String::new() };
    match v.get("type").and_then(Value::as_str) {
        Some("external") => v.get("external").map(|e| s(e, "url")).unwrap_or_default(),
        Some("file") => v.get("file").map(|e| s(e, "url")).unwrap_or_default(),
        _ => String::new(),
    }
}

fn plain_of(rich: Option<&Value>) -> String {
    rich.and_then(Value::as_array)
        .map(|a| a.iter().map(|r| s(r, "plain_text")).collect())
        .unwrap_or_default()
}

/// One block, simplified: {id, type, spans, checked, color, emoji, lang,
/// url, caption, title, hasChildren}. Children are added by `blocks`.
fn simplify(b: &Value) -> Option<Value> {
    let id = b.get("id")?.as_str()?;
    let kind = b.get("type")?.as_str()?;
    let body = b.get(kind).cloned().unwrap_or(Value::Null);
    let mut m = Map::new();
    m.insert("id".into(), json!(id));
    m.insert("type".into(), json!(kind));
    m.insert("hasChildren".into(), json!(b.get("has_children").and_then(Value::as_bool).unwrap_or(false)));
    match kind {
        k if TEXT_KINDS.contains(&k) => {
            m.insert("spans".into(), spans(body.get("rich_text")));
            if k == "to_do" {
                m.insert("checked".into(), json!(body.get("checked").and_then(Value::as_bool).unwrap_or(false)));
            }
            if k == "callout" {
                m.insert("emoji".into(), icon(&body).get("emoji").cloned().unwrap_or(json!("💡")));
            }
            if k == "code" {
                m.insert("lang".into(), json!(s(&body, "language")));
            }
            if k.starts_with("heading_") && body.get("is_toggleable").and_then(Value::as_bool).unwrap_or(false) {
                m.insert("toggle".into(), json!(true));
            }
            let color = s(&body, "color");
            if !color.is_empty() && color != "default" {
                m.insert("color".into(), json!(color));
            }
        }
        "image" | "video" | "file" | "pdf" | "audio" => {
            m.insert("url".into(), json!(file_url(Some(&body))));
            m.insert("caption".into(), json!(plain_of(body.get("caption"))));
            if kind != "image" {
                m.insert("title".into(), json!(s(&body, "name")));
            }
        }
        "bookmark" | "embed" | "link_preview" => {
            m.insert("url".into(), json!(s(&body, "url")));
            m.insert("caption".into(), json!(plain_of(body.get("caption"))));
        }
        "child_page" | "child_database" => {
            m.insert("title".into(), json!(s(&body, "title")));
        }
        "equation" => {
            m.insert("spans".into(), json!([{ "t": s(&body, "expression"), "c": true }]));
        }
        "table_row" => {
            let cells: Vec<Value> = body.get("cells").and_then(Value::as_array).into_iter().flatten()
                .map(|c| spans(Some(c))).collect();
            m.insert("cells".into(), Value::Array(cells));
        }
        "table" => {
            m.insert("header".into(), json!(body.get("has_column_header").and_then(Value::as_bool).unwrap_or(false)));
        }
        "link_to_page" => {
            let target = body.get("page_id").or_else(|| body.get("database_id")).and_then(Value::as_str).unwrap_or("");
            m.insert("target".into(), json!(target));
            m.insert("database".into(), json!(body.get("database_id").is_some()));
        }
        _ => {}
    }
    Some(Value::Object(m))
}

/// The children of a block or page, every page of results up to `limit`.
async fn children_of(id: &str, limit: usize) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut url = format!("{API}/blocks/{id}/children?page_size=100");
        if let Some(c) = &cursor {
            url.push_str(&format!("&start_cursor={c}"));
        }
        let v = call(client().get(url)).await?;
        out.extend(v.get("results").and_then(Value::as_array).into_iter().flatten().filter_map(simplify));
        cursor = v.get("next_cursor").and_then(Value::as_str).map(String::from);
        if cursor.is_none() || out.len() >= limit || v.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
    }
    out.truncate(limit);
    Ok(out)
}

/// A page's blocks with what is nested in them (two levels below the top),
/// within MAX_NESTED requests: what is left keeps `hasChildren` and opens in Notion.
async fn blocks(id: &str) -> Result<Vec<Value>, String> {
    let mut top = children_of(id, MAX_TOP).await?;
    let mut budget = MAX_NESTED;
    for b in top.iter_mut() {
        fill(b, 1, &mut budget).await;
    }
    Ok(top)
}

async fn fill(b: &mut Value, depth: u8, budget: &mut usize) {
    let nested = b.get("hasChildren").and_then(Value::as_bool).unwrap_or(false);
    let kind = s(b, "type");
    if !nested || kind == "child_page" || kind == "child_database" || *budget == 0 || depth > 3 {
        return;
    }
    *budget -= 1;
    let id = s(b, "id");
    let Ok(mut kids) = children_of(&id, 100).await else { return };
    for k in kids.iter_mut() {
        Box::pin(fill(k, depth + 1, budget)).await;
    }
    b["children"] = Value::Array(kids);
}

/// The title property's name and text of a page.
fn page_title(page: &Value) -> (String, String) {
    for (name, p) in page.get("properties").and_then(Value::as_object).into_iter().flatten() {
        if p.get("type").and_then(Value::as_str) == Some("title") {
            return (name.clone(), plain_of(p.get("title")));
        }
    }
    ("title".into(), String::new())
}

/// A page to draw: title, icon, cover, its properties when it is a row of a
/// database, and its blocks.
pub async fn page(id: &str) -> Result<Value, String> {
    check_id(id)?;
    let p = call(client().get(format!("{API}/pages/{id}"))).await?;
    let (_, title) = page_title(&p);
    let in_db = p.get("parent").and_then(|x| x.get("database_id")).and_then(Value::as_str).map(String::from);
    let props: Vec<Value> = if in_db.is_some() {
        p.get("properties").and_then(Value::as_object).into_iter().flatten()
            .filter(|(_, v)| v.get("type").and_then(Value::as_str) != Some("title"))
            .map(|(name, v)| json!({ "name": name, "cell": cell(v) }))
            .collect()
    } else {
        Vec::new()
    };
    let blocks = blocks(id).await?;
    Ok(json!({
        "kind": "page", "id": id, "title": title, "icon": icon(&p), "cover": file_url(p.get("cover")),
        "url": s(&p, "url"), "database": in_db, "props": props, "blocks": blocks,
    }))
}

/// A property's value as the card shows it: {kind, text, color, checked,
/// items: [[name, color]], date}.
fn cell(p: &Value) -> Value {
    let kind = s(p, "type");
    let body = p.get(&kind).cloned().unwrap_or(Value::Null);
    let mut m = Map::new();
    m.insert("kind".into(), json!(kind));
    let text: String = match kind.as_str() {
        "title" | "rich_text" => plain_of(Some(&body)),
        "number" => body.as_f64().map(|n| if n.fract() == 0.0 { format!("{n:.0}") } else { n.to_string() }).unwrap_or_default(),
        "select" | "status" => {
            m.insert("color".into(), json!(s(&body, "color")));
            s(&body, "name")
        }
        "multi_select" => {
            let items: Vec<Value> = body.as_array().into_iter().flatten().map(|o| json!([s(o, "name"), s(o, "color")])).collect();
            let names: Vec<String> = items.iter().filter_map(|i| i.get(0).and_then(Value::as_str).map(String::from)).collect();
            m.insert("items".into(), Value::Array(items));
            names.join(", ")
        }
        "checkbox" => {
            m.insert("checked".into(), json!(body.as_bool().unwrap_or(false)));
            String::new()
        }
        "date" => {
            let start = s(&body, "start");
            m.insert("date".into(), json!(start));
            let end = s(&body, "end");
            if end.is_empty() { start } else { format!("{start} → {end}") }
        }
        "url" | "email" | "phone_number" => body.as_str().unwrap_or("").to_string(),
        "people" | "created_by" | "last_edited_by" => {
            let list = if body.is_array() { body.as_array().cloned().unwrap_or_default() } else { vec![body.clone()] };
            list.iter().map(|u| s(u, "name")).filter(|n| !n.is_empty()).collect::<Vec<_>>().join(", ")
        }
        "created_time" | "last_edited_time" => {
            let d = body.as_str().unwrap_or("").to_string();
            m.insert("date".into(), json!(d));
            d
        }
        "relation" => {
            let n = body.as_array().map(Vec::len).unwrap_or(0);
            if n == 0 { String::new() } else { format!("↗ {n}") }
        }
        "formula" => {
            let k = s(&body, "type");
            match body.get(&k) {
                Some(Value::String(x)) => x.clone(),
                Some(Value::Number(x)) => x.to_string(),
                Some(Value::Bool(x)) => if *x { "✓".into() } else { String::new() },
                Some(Value::Object(o)) => o.get("start").and_then(Value::as_str).unwrap_or("").to_string(),
                _ => String::new(),
            }
        }
        "unique_id" => {
            let n = body.get("number").and_then(Value::as_i64).map(|n| n.to_string()).unwrap_or_default();
            let pre = s(&body, "prefix");
            if pre.is_empty() { n } else { format!("{pre}-{n}") }
        }
        "rollup" => match s(&body, "type").as_str() {
            "number" => body.get("number").and_then(Value::as_f64).map(|n| n.to_string()).unwrap_or_default(),
            "array" => body.get("array").and_then(Value::as_array).map(|a| a.len().to_string()).unwrap_or_default(),
            _ => String::new(),
        },
        "files" => body.as_array().map(|a| if a.is_empty() { String::new() } else { format!("📎 {}", a.len()) }).unwrap_or_default(),
        _ => String::new(),
    };
    m.insert("text".into(), json!(text));
    Value::Object(m)
}

/// A database to draw: its columns (title first, options of select and
/// status) and its rows, as Notion sorts them by default.
pub async fn database(id: &str) -> Result<Value, String> {
    check_id(id)?;
    let d = call(client().get(format!("{API}/databases/{id}"))).await?;
    let title = plain_of(d.get("title"));
    let mut cols: Vec<Value> = Vec::new();
    for (name, p) in d.get("properties").and_then(Value::as_object).into_iter().flatten() {
        let kind = s(p, "type");
        let options: Vec<Value> = match kind.as_str() {
            "select" | "multi_select" | "status" => p.get(&kind).and_then(|x| x.get("options")).and_then(Value::as_array)
                .into_iter().flatten().map(|o| json!([s(o, "name"), s(o, "color")])).collect(),
            _ => Vec::new(),
        };
        let col = json!({ "name": name, "kind": kind, "options": options });
        if kind == "title" { cols.insert(0, col) } else { cols.push(col) }
    }
    let mut rows = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut body = json!({ "page_size": 100 });
        if let Some(c) = &cursor {
            body["start_cursor"] = json!(c);
        }
        let v = call(client().post(format!("{API}/databases/{id}/query")).json(&body)).await?;
        rows.extend(v.get("results").and_then(Value::as_array).into_iter().flatten().filter_map(row));
        cursor = v.get("next_cursor").and_then(Value::as_str).map(String::from);
        if cursor.is_none() || rows.len() >= MAX_ROWS {
            break;
        }
    }
    rows.truncate(MAX_ROWS);
    Ok(json!({
        "kind": "database", "id": id, "title": title, "icon": icon(&d), "cover": file_url(d.get("cover")),
        "url": s(&d, "url"), "columns": cols, "rows": rows,
    }))
}

fn row(p: &Value) -> Option<Value> {
    let id = p.get("id")?.as_str()?;
    let mut cells = Map::new();
    for (name, v) in p.get("properties").and_then(Value::as_object).into_iter().flatten() {
        cells.insert(name.clone(), cell(v));
    }
    Some(json!({ "id": id, "url": s(p, "url"), "icon": icon(p), "cover": file_url(p.get("cover")), "cells": cells }))
}

fn check_kind(kind: &str) -> Result<(), String> {
    if TEXT_KINDS.contains(&kind) || kind == "divider" {
        Ok(())
    } else {
        Err(t("Questo tipo di blocco non si può modificare qui").into())
    }
}

/// The body of a new block of `kind` with `spans`.
fn new_block(kind: &str, spans: &Value) -> Result<Value, String> {
    check_kind(kind)?;
    if kind == "divider" {
        return Ok(json!({ "object": "block", "type": "divider", "divider": {} }));
    }
    let mut body = json!({ "rich_text": rich_from(spans) });
    match kind {
        "to_do" => body["checked"] = json!(false),
        "callout" => body["icon"] = json!({ "type": "emoji", "emoji": "💡" }),
        "code" => body["language"] = json!("plain text"),
        _ => {}
    }
    Ok(json!({ "object": "block", "type": kind, kind: body }))
}

/// A block's text, with its formatting.
pub async fn set_text(id: &str, kind: &str, spans: &Value) -> Result<(), String> {
    check_id(id)?;
    if !TEXT_KINDS.contains(&kind) {
        return Err(t("Questo tipo di blocco non si può modificare qui").into());
    }
    let body = one(kind, json!({ "rich_text": rich_from(spans) }));
    call(client().patch(format!("{API}/blocks/{id}")).json(&body)).await?;
    Ok(())
}

pub async fn set_checked(id: &str, checked: bool) -> Result<(), String> {
    check_id(id)?;
    call(client().patch(format!("{API}/blocks/{id}")).json(&json!({ "to_do": { "checked": checked } }))).await?;
    Ok(())
}

/// A new block in `parent` (a page or a block), after `after` or at the end.
pub async fn add(parent: &str, after: Option<&str>, kind: &str, spans: &Value) -> Result<Value, String> {
    check_id(parent)?;
    let mut body = json!({ "children": [new_block(kind, spans)?] });
    if let Some(a) = after.filter(|a| !a.is_empty()) {
        check_id(a)?;
        body["after"] = json!(a);
    }
    let v = call(client().patch(format!("{API}/blocks/{parent}/children")).json(&body)).await?;
    // Notion answers with the parent's children; with `after` the new one follows it.
    let list = v.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
    let pos = after.and_then(|a| list.iter().position(|b| s(b, "id").replace('-', "") == a.replace('-', "")));
    let new = match pos {
        Some(i) => list.get(i + 1),
        None => list.last(),
    };
    new.and_then(simplify).ok_or_else(|| t("Notion non ha restituito il blocco nuovo").to_string())
}

/// Notion cannot change a block's type: a new one in its place, the old one
/// to the trash. Only for blocks without anything nested.
pub async fn retype(parent: &str, id: &str, kind: &str, spans: &Value) -> Result<Value, String> {
    check_id(id)?;
    let new = add(parent, Some(id), kind, spans).await?;
    archive_block(id).await?;
    Ok(new)
}

pub async fn archive_block(id: &str) -> Result<(), String> {
    check_id(id)?;
    call(client().delete(format!("{API}/blocks/{id}"))).await?;
    Ok(())
}

/// A page's title (its title property, whatever it is called).
pub async fn set_title(id: &str, title: &str) -> Result<(), String> {
    check_id(id)?;
    let p = call(client().get(format!("{API}/pages/{id}"))).await?;
    let (prop, _) = page_title(&p);
    let body = json!({ "properties": one(&prop, json!({ "title": crate::notion::rich(title) })) });
    call(client().patch(format!("{API}/pages/{id}")).json(&body)).await?;
    Ok(())
}

/// A property's new value, from the card: text, a number, an option, the box, a day.
fn prop_value(kind: &str, value: &Value) -> Result<Value, String> {
    let text = value.as_str().unwrap_or("").trim().to_string();
    Ok(match kind {
        "title" => json!({ "title": crate::notion::rich(&text) }),
        "rich_text" => json!({ "rich_text": crate::notion::rich(&text) }),
        "number" => json!({ "number": text.replace(',', ".").parse::<f64>().ok() }),
        "select" => json!({ "select": if text.is_empty() { Value::Null } else { json!({ "name": text }) } }),
        "status" => json!({ "status": if text.is_empty() { Value::Null } else { json!({ "name": text }) } }),
        "multi_select" => json!({ "multi_select": value.as_array().into_iter().flatten()
            .filter_map(Value::as_str).map(|n| json!({ "name": n })).collect::<Vec<_>>() }),
        "checkbox" => json!({ "checkbox": value.as_bool().unwrap_or(false) }),
        "date" => json!({ "date": if text.is_empty() { Value::Null } else { json!({ "start": text }) } }),
        "url" => json!({ "url": if text.is_empty() { Value::Null } else { json!(text) } }),
        "email" => json!({ "email": if text.is_empty() { Value::Null } else { json!(text) } }),
        "phone_number" => json!({ "phone_number": if text.is_empty() { Value::Null } else { json!(text) } }),
        _ => return Err(t("Questa proprietà non si può modificare qui").into()),
    })
}

pub async fn set_prop(page: &str, name: &str, kind: &str, value: &Value) -> Result<Value, String> {
    check_id(page)?;
    let body = json!({ "properties": one(name, prop_value(kind, value)?) });
    let p = call(client().patch(format!("{API}/pages/{page}")).json(&body)).await?;
    row(&p).ok_or_else(|| t("Notion non ha restituito la riga").to_string())
}

/// A new row of a database, titled, with one property already set (the
/// column of the board it was added to).
pub async fn add_row(db: &str, title: &str, preset: Option<(&str, &str, &Value)>) -> Result<Value, String> {
    check_id(db)?;
    let d = call(client().get(format!("{API}/databases/{db}"))).await?;
    let title_prop = d.get("properties").and_then(Value::as_object).into_iter().flatten()
        .find(|(_, p)| p.get("type").and_then(Value::as_str) == Some("title"))
        .map(|(n, _)| n.clone())
        .unwrap_or_else(|| "Name".into());
    let mut props = Map::new();
    props.insert(title_prop, json!({ "title": crate::notion::rich(title) }));
    if let Some((name, kind, value)) = preset {
        props.insert(name.to_string(), prop_value(kind, value)?);
    }
    let body = json!({ "parent": { "database_id": db }, "properties": props });
    let p = call(client().post(format!("{API}/pages")).json(&body)).await?;
    row(&p).ok_or_else(|| t("Notion non ha restituito la riga").to_string())
}

pub async fn archive_page(id: &str) -> Result<(), String> {
    check_id(id)?;
    call(client().patch(format!("{API}/pages/{id}")).json(&json!({ "archived": true }))).await?;
    Ok(())
}

/// Hosts a picture of a page may come from: Notion's own files (and covers).
fn notion_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?']).next().unwrap_or("");
    host.ends_with(".notion.so") || host == "notion.so" || host.ends_with(".notion-static.com")
        || host == "images.unsplash.com"
        || (host.ends_with(".amazonaws.com") && (host.starts_with("prod-files-secure.") || host.starts_with("s3.")))
        || host.ends_with(".notionusercontent.com")
}

/// A picture of a page as a data URL (the island loads no images from the web).
pub async fn image(url: &str) -> Result<String, String> {
    let url = if url.starts_with('/') { format!("https://www.notion.so{url}") } else { url.to_string() };
    if !notion_host(&url) {
        return Err(t("Immagine esterna: si apre nel browser").into());
    }
    let r = client().get(&url).send().await.map_err(|_| t("Immagine non raggiungibile").to_string())?;
    if !r.status().is_success() {
        return Err(t("Immagine non raggiungibile").into());
    }
    let mime = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/png").to_string();
    if !mime.starts_with("image/") {
        return Err(t("Immagine non raggiungibile").into());
    }
    let bytes = r.bytes().await.map_err(|_| t("Immagine non raggiungibile").to_string())?;
    if bytes.len() > MAX_IMAGE {
        return Err(t("Immagine troppo grande: si apre nel browser").into());
    }
    Ok(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)))
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn notion_open_page(id: String) -> Result<Value, String> {
    page(&id).await
}

#[tauri::command]
pub async fn notion_open_database(id: String) -> Result<Value, String> {
    database(&id).await
}

#[tauri::command]
pub async fn notion_block_text(id: String, kind: String, spans: Value) -> Result<(), String> {
    set_text(&id, &kind, &spans).await
}

#[tauri::command]
pub async fn notion_block_check(id: String, checked: bool) -> Result<(), String> {
    set_checked(&id, checked).await
}

#[tauri::command]
pub async fn notion_block_add(parent: String, after: Option<String>, kind: String, spans: Value) -> Result<Value, String> {
    add(&parent, after.as_deref(), &kind, &spans).await
}

#[tauri::command]
pub async fn notion_block_retype(parent: String, id: String, kind: String, spans: Value) -> Result<Value, String> {
    retype(&parent, &id, &kind, &spans).await
}

#[tauri::command]
pub async fn notion_block_delete(id: String) -> Result<(), String> {
    archive_block(&id).await
}

#[tauri::command]
pub async fn notion_page_title(id: String, title: String) -> Result<(), String> {
    set_title(&id, &title).await
}

#[tauri::command]
pub async fn notion_row_set(page: String, name: String, kind: String, value: Value) -> Result<Value, String> {
    set_prop(&page, &name, &kind, &value).await
}

#[tauri::command]
pub async fn notion_row_add(db: String, title: String, name: Option<String>, kind: Option<String>, value: Option<Value>) -> Result<Value, String> {
    let preset = match (&name, &kind, &value) {
        (Some(n), Some(k), Some(v)) => Some((n.as_str(), k.as_str(), v)),
        _ => None,
    };
    add_row(&db, &title, preset).await
}

#[tauri::command]
pub async fn notion_page_delete(id: String) -> Result<(), String> {
    archive_page(&id).await
}

#[tauri::command]
pub async fn notion_image(url: String) -> Result<String, String> {
    image(&url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_round_trip_keeps_formatting() {
        let rich = json!([
            { "plain_text": "Ciao ", "annotations": { "bold": true, "color": "default" } },
            { "plain_text": "mondo", "href": "https://example.com", "annotations": { "italic": true, "color": "red" } },
        ]);
        let sp = spans(Some(&rich));
        assert_eq!(sp[0]["t"], "Ciao ");
        assert_eq!(sp[0]["b"], true);
        assert!(sp[0].get("color").is_none());
        assert_eq!(sp[1]["href"], "https://example.com");
        let back = rich_from(&sp);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0]["annotations"]["bold"], true);
        assert_eq!(back[1]["annotations"]["color"], "red");
        assert_eq!(back[1]["text"]["link"]["url"], "https://example.com");
    }

    #[test]
    fn bad_input_is_dropped_not_panicking() {
        assert!(rich_from(&json!("x")).is_empty());
        assert!(rich_from(&json!([{ "t": "" }, { "t": "a", "color": "javascript:" , "href": "javascript:alert(1)"}]))[0]["text"].get("link").is_none());
        assert!(simplify(&json!({ "id": "a" })).is_none());
        let odd = simplify(&json!({ "id": "a", "type": "synced_block" })).unwrap();
        assert_eq!(odd["type"], "synced_block");
        assert!(new_block("child_page", &json!([])).is_err());
        assert!(prop_value("relation", &json!("x")).is_err());
    }

    #[test]
    fn long_text_is_split_for_notion() {
        let long = "a".repeat(4500);
        assert_eq!(rich_from(&json!([{ "t": long }])).len(), 3);
    }

    #[test]
    fn cells_show_what_notion_shows() {
        assert_eq!(cell(&json!({ "type": "number", "number": 3.0 }))["text"], "3");
        assert_eq!(cell(&json!({ "type": "status", "status": { "name": "Fatto", "color": "green" } }))["color"], "green");
        assert_eq!(cell(&json!({ "type": "checkbox", "checkbox": true }))["checked"], true);
        assert_eq!(cell(&json!({ "type": "multi_select", "multi_select": [{ "name": "A", "color": "red" }] }))["text"], "A");
        assert_eq!(cell(&json!({ "type": "weird" }))["text"], "");
    }

    #[test]
    fn only_notion_pictures_are_fetched() {
        assert!(notion_host("https://prod-files-secure.s3.us-west-2.amazonaws.com/x.png"));
        assert!(notion_host("https://www.notion.so/images/page-cover/gradients_8.png"));
        assert!(!notion_host("https://evil.example.com/x.png"));
        assert!(!notion_host("http://www.notion.so/x.png"));
        assert!(!notion_host("https://notion.so.evil.com/x.png"));
    }
}
