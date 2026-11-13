// Suppliers' portals the user taught EasyIsland (asked by Edoardo on 12 Nov
// 2026: «questi siti non devono finire nel codice, dovrò addestrare
// EasyIsland»). No site is known to the code: a portal is a recipe the chat
// writes with the user (portal_save, after a test search that found
// products) and keeps here, in the user's data — how to search it, what the
// answer looks like, whether it needs a login and which Devolutions entry
// holds it (only the reference). portal_search then runs the recipes without
// an engine (preview::extract), each in a tab of its own behind the user's.
//
// Never buys or orders: the preview refuses those clicks (preview.rs FIND).

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Mutex;
use tauri::AppHandle;

use crate::i18n::{t, tf};

const MAX_PORTALS: usize = 40;
const MAX_KEYS: usize = 20;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Portal {
    pub id: String,
    pub name: String,
    /// https://host, from the search address.
    pub site: String,
    /// The search, with {q} where the words go.
    pub search_url: String,
    /// The search answers in JSON when asked for it (Accept: application/json).
    pub json: bool,
    /// JSON: the path of the list of products ("products"); empty = found by itself.
    pub items: String,
    /// JSON: our field → path in a product ("price": "price_amount").
    pub fields: Map<String, Value>,
    /// HTML without structured data: item, name, price, sku, url, image… (CSS, "img@src").
    pub selectors: Map<String, Value>,
    /// Prices only after the login.
    pub login: bool,
    /// Devolutions Cloud entry with the login (its name or id, never the password).
    pub dvc_entry: String,
    /// The prices it shows include VAT: true, false, or unknown.
    pub vat_included: Option<bool>,
    /// What the user said about it, for the chat (net price is the second column…).
    pub notes: String,
    pub created: String,
    /// Last search that found something, and the last failure.
    pub last_ok: String,
    pub last_error: String,
    pub uses: u32,
}

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> std::path::PathBuf {
    crate::settings::config_dir().join("portali.json")
}

pub fn list() -> Vec<Portal> {
    std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_all(all: &[Portal]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&file(), &bytes).map_err(|e| e.to_string())
}

/// "https://shop.example.it/cerca?q={q}" → "https://shop.example.it".
fn origin_of(url: &str) -> Option<String> {
    let u = tauri::Url::parse(url).ok()?;
    if !matches!(u.scheme(), "https" | "http") {
        return None;
    }
    let host = u.host_str()?;
    Some(match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    })
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(40).collect();
    if out.is_empty() { "portale".into() } else { out }
}

/// Keeps strings only, short, at most MAX_KEYS.
fn small_map(v: Option<&Value>) -> Map<String, Value> {
    v.and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.chars().take(40).collect::<String>(), json!(s.chars().take(300).collect::<String>()))))
                .filter(|(k, _)| !k.is_empty())
                .take(MAX_KEYS)
                .collect()
        })
        .unwrap_or_default()
}

/// A recipe from the chat's arguments (or an imported one), checked.
fn from_args(args: &Value) -> Result<Portal, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let name: String = s("name").chars().take(80).collect();
    if name.is_empty() {
        return Err(t("Manca name: il nome del portale.").into());
    }
    let search_url = s("search_url");
    if !search_url.contains("{q}") || search_url.chars().count() > 500 {
        return Err(t("search_url deve essere l'indirizzo della ricerca con {q} al posto delle parole cercate.").into());
    }
    let site = origin_of(&search_url.replace("{q}", "x")).ok_or_else(|| t("search_url non è un indirizzo web valido.").to_string())?;
    let vat = args.get("vat_included").and_then(Value::as_bool);
    Ok(Portal {
        id: slug(&name),
        name,
        site,
        search_url,
        json: args.get("json").and_then(Value::as_bool).unwrap_or(false),
        items: s("items").chars().take(120).collect(),
        fields: small_map(args.get("fields")),
        selectors: small_map(args.get("selectors")),
        login: args.get("login").and_then(Value::as_bool).unwrap_or(false),
        dvc_entry: s("dvc_entry").chars().take(120).collect(),
        vat_included: vat,
        notes: s("notes").chars().take(1000).collect(),
        ..Default::default()
    })
}

/// What preview::extract is given to run a recipe for `query`.
fn extract_args(p: &Portal, query: &str, limit: u64) -> Value {
    let mut a = json!({ "limit": limit, "json": p.json, "network": !p.json });
    if p.json {
        a["url"] = json!(search_address(p, query));
    }
    if !p.items.is_empty() {
        a["items"] = json!(p.items);
    }
    if !p.fields.is_empty() {
        a["fields"] = Value::Object(p.fields.clone());
    }
    if !p.selectors.is_empty() {
        a["selectors"] = Value::Object(p.selectors.clone());
    }
    a
}

fn search_address(p: &Portal, query: &str) -> String {
    p.search_url.replace("{q}", &url_encode(query.trim()))
}

fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// One search on one portal: (text for the chat, products found).
async fn search_one(app: &AppHandle, p: &Portal, query: &str, limit: u64) -> (String, bool) {
    let head = format!("## {} ({})", p.name, crate::memory::stamp());
    let address = search_address(p, query);
    // The search page itself in the portal's tab: its session, its cookies.
    let id = match crate::preview::load_behind(app, &format!("portale:{}", p.id), &address, 20).await {
        Ok(id) => id,
        Err(e) => return (format!("{head}\n{} {e}", t("ERRORE:")), false),
    };
    let found = crate::preview::extract_found(app, id, &extract_args(p, query, limit)).await;
    if let Ok((text, n)) = &found {
        if *n > 0 {
            let vat = match p.vat_included {
                Some(true) => t(" Prezzi IVA inclusa."),
                Some(false) => t(" Prezzi IVA esclusa."),
                None => "",
            };
            let notes = if p.notes.is_empty() { String::new() } else { format!("\n{}: {}", t("Note"), p.notes) };
            return (format!("{head}{vat}{notes}\n{text}"), true);
        }
    }
    let why = if crate::preview::asks_login(app, id).await {
        tf("serve l'accesso: entra nel portale nella scheda {id} dell'Anteprima (o con preview_login), poi rifai la ricerca.", &[("id", &id.to_string())])
    } else {
        match found {
            Err(e) => e,
            Ok(_) => t("nessun prodotto: la ricerca non ha risultati, oppure il sito è cambiato e il portale va riaddestrato (guarda la scheda e correggi la ricetta con portal_save).").into(),
        }
    };
    (format!("{head}\n{why}"), false)
}

/// The result of a search remembered on the recipe (when it worked, when not).
fn note_result(id: &str, ok: bool, error: &str) {
    let _g = LOCK.lock().unwrap();
    let mut all = list();
    if let Some(p) = all.iter_mut().find(|p| p.id == id) {
        p.uses = p.uses.saturating_add(1);
        if ok {
            p.last_ok = crate::memory::stamp();
            p.last_error.clear();
        } else {
            p.last_error = format!("{} {}", crate::memory::stamp(), error.chars().take(200).collect::<String>());
        }
        let _ = save_all(&all);
    }
}

fn describe(p: &Portal) -> String {
    let mut how = vec![if p.json { t("ricerca in JSON").to_string() } else if !p.selectors.is_empty() { t("selettori").to_string() } else { t("dati della pagina").to_string() }];
    if p.login {
        how.push(if p.dvc_entry.is_empty() { t("con accesso").to_string() } else { tf("con accesso (Devolutions: {e})", &[("e", &p.dvc_entry)]) });
    }
    match p.vat_included {
        Some(true) => how.push(t("IVA inclusa").into()),
        Some(false) => how.push(t("IVA esclusa").into()),
        None => {}
    }
    let state = if !p.last_error.is_empty() { tf("ultimo errore {e}", &[("e", &p.last_error)]) } else if !p.last_ok.is_empty() { tf("funziona ({d})", &[("d", &p.last_ok)]) } else { t("mai usato").into() };
    format!("- {} [{}] {} — {}; {}", p.name, p.id, p.site, how.join(", "), state)
}

pub async fn tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    match name {
        "portal_list" => {
            let all = list();
            if all.is_empty() {
                return Ok(t("Nessun portale insegnato. Per insegnarne uno: apri il portale con preview_open, fai una ricerca, guarda con preview_extract (o preview_network) come risponde, poi portal_save con una ricerca di prova.").into());
            }
            Ok(all.iter().map(|p| {
                let mut line = describe(p);
                if !p.notes.is_empty() {
                    line.push_str(&format!("\n  {}: {}", t("Note"), p.notes));
                }
                line
            }).collect::<Vec<_>>().join("\n"))
        }
        "portal_save" => {
            let mut p = from_args(args)?;
            let test = args.get("test_query").and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if test.is_empty() {
                return Err(t("Manca test_query: una ricerca di prova (un codice che il portale ha). La ricetta si salva solo se trova prodotti.").into());
            }
            let (text, ok) = search_one(app, &p, &test, 5).await;
            if !ok {
                return Err(tf("Ricetta non salvata, la prova non ha trovato prodotti:\n{t}", &[("t", &text)]));
            }
            let _g = LOCK.lock().unwrap();
            let mut all = list();
            p.last_ok = crate::memory::stamp();
            match all.iter_mut().find(|x| x.id == p.id || x.site == p.site && x.name.eq_ignore_ascii_case(&p.name)) {
                Some(old) => {
                    p.id = old.id.clone();
                    p.created = old.created.clone();
                    p.uses = old.uses;
                    *old = p.clone();
                }
                None => {
                    if all.len() >= MAX_PORTALS {
                        return Err(tf("Al massimo {n} portali.", &[("n", &MAX_PORTALS.to_string())]));
                    }
                    p.created = crate::memory::stamp();
                    all.push(p.clone());
                }
            }
            save_all(&all)?;
            Ok(tf("Portale «{n}» salvato ({id}). Prova:\n{t}", &[("n", &p.name), ("id", &p.id), ("t", &text)]))
        }
        "portal_search" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if query.is_empty() {
                return Err(t("Manca query: cosa cercare (un codice o delle parole).").into());
            }
            let wanted: Vec<String> = args.get("portals").and_then(Value::as_str).unwrap_or_default().split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(8).clamp(1, 30);
            let all: Vec<Portal> = list().into_iter().filter(|p| wanted.is_empty() || wanted.iter().any(|w| *w == p.id || *w == p.name.to_lowercase())).collect();
            if all.is_empty() {
                return Err(if wanted.is_empty() { t("Nessun portale insegnato: vedi portal_list.").into() } else { t("Nessun portale con quel nome: vedi portal_list.").into() });
            }
            let mut out = Vec::new();
            for p in &all {
                let (text, ok) = search_one(app, p, &query, limit).await;
                note_result(&p.id, ok, if ok { "" } else { text.lines().nth(1).unwrap_or_default() });
                out.push(text);
            }
            Ok(out.join("\n\n"))
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

// ── Impostazioni → Chat → Portali ────────────────────────────────────────────

pub fn delete(id: &str) -> Result<(), String> {
    let _g = LOCK.lock().unwrap();
    let mut all = list();
    all.retain(|p| p.id != id);
    save_all(&all)
}

/// The recipes as JSON for another EasyIsland (no secrets in them).
pub fn export() -> String {
    let all: Vec<Portal> = list().into_iter().map(|p| Portal { last_ok: String::new(), last_error: String::new(), uses: 0, ..p }).collect();
    serde_json::to_string_pretty(&all).unwrap_or_default()
}

/// Recipes from another EasyIsland, checked one by one: how many were added or updated.
pub fn import(text: &str) -> Result<usize, String> {
    let list_in: Vec<Value> = serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| match v {
            Value::Array(a) => Some(a),
            Value::Object(_) => Some(vec![v]),
            _ => None,
        })
        .ok_or_else(|| t("Non è un elenco di portali esportato da EasyIsland.").to_string())?;
    let _g = LOCK.lock().unwrap();
    let mut all = list();
    let mut n = 0;
    for v in list_in.iter().take(MAX_PORTALS) {
        // Exported in camelCase: the same names the chat uses, in snake_case.
        let mut a = v.clone();
        if let Some(o) = a.as_object_mut() {
            for (from, to) in [("searchUrl", "search_url"), ("dvcEntry", "dvc_entry"), ("vatIncluded", "vat_included")] {
                if let Some(x) = o.remove(from) {
                    o.insert(to.into(), x);
                }
            }
        }
        let Ok(mut p) = from_args(&a) else { continue };
        p.created = crate::memory::stamp();
        if let Some(i) = all.iter().position(|x| x.id == p.id) {
            all[i] = p;
        } else if all.len() < MAX_PORTALS {
            all.push(p);
        } else {
            continue;
        }
        n += 1;
    }
    save_all(&all)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recipe_from_the_chat() {
        let p = from_args(&json!({ "name": "Grossista Uno", "search_url": "https://shop.esempio.it/cerca?s={q}", "json": true, "fields": { "price": "price_amount", "x": 3 }, "vat_included": false })).unwrap();
        assert_eq!((p.id.as_str(), p.site.as_str()), ("grossista-uno", "https://shop.esempio.it"));
        assert!(p.json && p.fields.len() == 1 && p.vat_included == Some(false));
        assert!(from_args(&json!({ "name": "A", "search_url": "https://a.it/cerca" })).is_err());
        assert!(from_args(&json!({ "name": "", "search_url": "https://a.it/?q={q}" })).is_err());
        assert!(from_args(&json!({ "name": "A", "search_url": "file:///c:/x?{q}" })).is_err());
        assert_eq!(origin_of("http://localhost:8080/a?q=x").as_deref(), Some("http://localhost:8080"));
    }

    #[test]
    fn search_addresses_and_what_extract_gets() {
        let p = from_args(&json!({ "name": "B", "search_url": "https://b.it/s?q={q}&n=1", "json": true, "items": "products" })).unwrap();
        assert_eq!(search_address(&p, " U7 Pro/è "), "https://b.it/s?q=U7%20Pro%2F%C3%A8&n=1");
        let a = extract_args(&p, "x", 5);
        assert_eq!((a["url"].as_str(), a["items"].as_str(), a["network"].as_bool()), (Some("https://b.it/s?q=x&n=1"), Some("products"), Some(false)));
        let q = from_args(&json!({ "name": "C", "search_url": "https://c.it/?q={q}", "selectors": { "item": ".p", "price": ".pr" } })).unwrap();
        let a = extract_args(&q, "x", 5);
        assert!(a.get("url").is_none() && a["selectors"]["item"] == ".p" && a["network"] == true);
    }

    #[test]
    fn names_become_ids() {
        assert_eq!(slug("Grossista.Due B2B!"), "grossista-due-b2b");
        assert_eq!(slug("***"), "portale");
    }
}
