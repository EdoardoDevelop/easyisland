// The Zammad integration: the agent's ticket overviews (assigned to me,
// unassigned and open, escalated) with their counts, and an alert when a new
// unassigned ticket comes in. It runs as a check through widgets.rs.
//
// The address (`zammad-url`, https://helpdesk.cliente.it) and the access token
// (`zammad-token`: Profile → Token di accesso, permission `ticket.agent`) live
// in the Credential Manager, like n8n's, never in settings.json.
//
// The counts come from /api/v1/ticket_overviews, the same list the agent sees
// on the left in Zammad, so it works with or without Elasticsearch. Overviews
// are matched by their `link`, which stays the same whatever the language.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;

use crate::widgets::{client, FieldValue, Widget, WidgetResult};
use crate::i18n::{t, tf};

const MY_ASSIGNED: &str = "my_assigned";
const UNASSIGNED: &str = "all_unassigned";
const ESCALATED: &str = "all_escalated";

/// Last unassigned count per widget: a rise means a new ticket came in. The
/// first check of a session only sets the baseline.
static LAST_UNASSIGNED: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);

/// The base address, without a trailing slash or a pasted `/#…` page.
fn base_url(url: &str) -> String {
    let u = url.trim();
    let u = u.split('#').next().unwrap_or(u);
    u.trim_end_matches('/').to_string()
}

/// (link → count) from the overview list; overviews without a count are skipped.
fn counts(list: &Value) -> HashMap<String, i64> {
    list.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|o| Some((o.get("link")?.as_str()?.to_string(), o.get("count")?.as_i64()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// Titles of the newest tickets in an overview's data (`?view=<link>`), newest first.
fn newest_titles(data: &Value, max: usize) -> Vec<String> {
    titled(data).into_iter().take(max).map(|(_, t)| t).collect()
}

/// The tickets of an overview's data as (id, "#number title — who"), newest first.
fn titled(data: &Value) -> Vec<(i64, String)> {
    let Some(ids) = data.pointer("/index/tickets").and_then(Value::as_array) else { return Vec::new() };
    let tickets = data.pointer("/assets/Ticket");
    let mut list: Vec<(i64, String)> = ids
        .iter()
        .filter_map(|t| {
            let id = t.get("id")?.as_i64()?;
            let ticket = tickets?.get(id.to_string())?;
            let number = ticket.get("number").and_then(Value::as_str).unwrap_or("");
            let title = ticket.get("title").and_then(Value::as_str).unwrap_or(crate::i18n::t("(senza titolo)"));
            let title = if number.is_empty() { title.to_string() } else { format!("#{number} {title}") };
            // Who it is for, after " — ": the company, else the customer (RDM's
            // "Connessioni" on the ticket searches by it, src/views/integrations.ts).
            let who = client_of(data, ticket);
            Some((id, if who.is_empty() { title } else { format!("{title} — {who}") }))
        })
        .collect();
    list.sort_by(|a, b| b.0.cmp(&a.0));
    list
}

/// The tickets assigned to me at the last check, per widget: the closed ones
/// go to the second brain (brain_watch.rs), the new ones get «Prepara»
/// (moments.rs, `ticket`). The first check of a session only sets the baseline.
static LAST_MINE: Mutex<Option<HashMap<String, Vec<(i64, String)>>>> = Mutex::new(None);

type Titled = Vec<(i64, String)>;

/// Tickets that (left, came into) «assigned to me» since the last check of this widget.
fn mine_changes(id: &str, now: Titled) -> (Titled, Titled) {
    let mut guard = LAST_MINE.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    let changes = match map.get(id) {
        Some(before) => (
            before.iter().filter(|(t, _)| !now.iter().any(|(n, _)| n == t)).cloned().collect(),
            now.iter().filter(|(n, _)| !before.iter().any(|(t, _)| t == n)).cloned().collect(),
        ),
        None => (Vec::new(), Vec::new()),
    };
    map.insert(id.to_string(), now);
    changes
}

/// Is «Prepara» on for a ticket newly assigned to me (Impostazioni → Notifiche → Proposte).
fn wants_prepare() -> bool {
    crate::brain_watch::app()
        .and_then(|app| tauri::Manager::try_state::<crate::Shared>(app).map(|s| s.settings.lock().unwrap().moment_tickets))
        .unwrap_or(false)
}

/// A ticket that left my list: if Zammad says it is closed, its last
/// messages go to the second brain (what the problem was, how it was solved).
async fn closed_ticket(c: &reqwest::Client, base: &str, token: &str, id: i64, title: &str) {
    let Ok(ticket) = get_json(c, &format!("{base}/api/v1/tickets/{id}?expand=true"), token).await else { return };
    let state = ticket.get("state").and_then(Value::as_str).unwrap_or_default().to_lowercase();
    if !state.contains("closed") && !state.contains("chius") {
        return;
    }
    let Ok(articles) = get_json(c, &format!("{base}/api/v1/ticket_articles/by_ticket/{id}"), token).await else { return };
    crate::brain_watch::note(crate::brain_watch::Happened {
        kind: "ticket",
        title: tf("Ticket chiuso: {title}", &[("title", &title)]),
        text: ticket_story(&articles),
        link: format!("{base}/#ticket/zoom/{id}"),
    });
}

/// The ticket's messages, oldest first, without HTML: the first (the problem)
/// and the last ones (the solution), at most about 3000 characters.
fn ticket_story(articles: &Value) -> String {
    let list: Vec<String> = articles.as_array().into_iter().flatten()
        .filter_map(|a| {
            let body = a.get("body").and_then(Value::as_str)?;
            let html = a.get("content_type").and_then(Value::as_str).unwrap_or_default().contains("html");
            let text = if html { crate::brain::html_text(body) } else { body.trim().to_string() };
            let from = a.get("from").and_then(Value::as_str).unwrap_or_default();
            let note = if a.get("internal").and_then(Value::as_bool) == Some(true) { format!(" ({})", t("nota interna")) } else { String::new() };
            let text: String = text.chars().take(900).collect();
            (!text.trim().is_empty()).then(|| format!("{from}{note}: {text}"))
        })
        .collect();
    let picked: Vec<&String> = match list.len() {
        0..=4 => list.iter().collect(),
        n => list.first().into_iter().chain(list.get(n - 3..).into_iter().flatten()).collect(),
    };
    let story = picked.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n---\n");
    story.chars().take(3000).collect()
}

fn plural(n: i64, one: &str, many: &str) -> String {
    if n == 1 { format!("1 {one}") } else { format!("{n} {many}") }
}

/// Level, summary and fields for the three counts.
fn describe(mine: i64, unassigned: i64, escalated: i64) -> (&'static str, String, Vec<FieldValue>) {
    let fields = vec![
        FieldValue { label: t("Assegnati a me").into(), value: mine.to_string() },
        FieldValue { label: t("Non assegnati").into(), value: unassigned.to_string() },
        FieldValue { label: t("In escalation").into(), value: escalated.to_string() },
    ];
    let mut parts = Vec::new();
    if escalated > 0 {
        parts.push(plural(escalated, t("ticket in escalation"), t("ticket in escalation")));
    }
    if unassigned > 0 {
        parts.push(plural(unassigned, t("non assegnato"), t("non assegnati")));
    }
    parts.push(plural(mine, t("assegnato a te"), t("assegnati a te")));
    let level = if escalated > 0 { "warn" } else { "ok" };
    (level, parts.join(" · "), fields)
}

/// A new unassigned ticket since the last check of this widget.
fn new_ticket_event(id: &str, unassigned: i64) -> Option<i64> {
    let mut guard = LAST_UNASSIGNED.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    let before = map.insert(id.to_string(), unassigned)?;
    (unassigned > before).then_some(unassigned - before)
}

async fn get_json(c: &reqwest::Client, url: &str, token: &str) -> Result<Value, String> {
    let resp = c
        .get(url)
        .header("Authorization", format!("Token token={token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { t("Zammad non risponde (tempo scaduto)").to_string() } else { tf("Zammad non raggiungibile: {e}", &[("e", &e)]) })?;
    match resp.status().as_u16() {
        200..=299 => resp.json().await.map_err(|_| t("Risposta di Zammad non leggibile").to_string()),
        401 => Err(t("Token non valido o scaduto (401)").into()),
        403 => Err(t("Il token non ha il permesso ticket.agent (403)").into()),
        404 => Err(t("Indirizzo di Zammad non trovato (404)").into()),
        code => Err(format!("Zammad: HTTP {code}")),
    }
}

/// The ticket's organization name, else its customer's name, from the assets.
fn client_of(data: &Value, ticket: &Value) -> String {
    let asset = |kind: &str, key: &str| -> Option<&Value> {
        let id = ticket.get(key)?.as_i64()?;
        data.pointer(&format!("/assets/{kind}/{id}"))
    };
    if let Some(name) = asset("Organization", "organization_id").and_then(|o| o.get("name")?.as_str()) {
        return name.trim().to_string();
    }
    asset("User", "customer_id")
        .map(|u| {
            let f = u.get("firstname").and_then(Value::as_str).unwrap_or("");
            let l = u.get("lastname").and_then(Value::as_str).unwrap_or("");
            format!("{f} {l}").trim().to_string()
        })
        .unwrap_or_default()
}

/// A ticket found from the island's field at the top (src/views/search.ts).
#[derive(serde::Serialize)]
pub struct TicketHit {
    /// "#12345 Titolo — Cliente", as in the card.
    pub title: String,
    pub url: String,
}

/// The tickets Zammad finds for `query` (number, title, customer…), newest
/// first. /api/v1/tickets/search works without Elasticsearch too, on fewer
/// fields (title and number).
pub async fn search(query: &str, max: usize) -> Result<Vec<TicketHit>, String> {
    let base = base_url(&crate::secrets::get("zammad-url").unwrap_or_default());
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return Ok(Vec::new());
    }
    let Some(token) = crate::secrets::get("zammad-token") else { return Ok(Vec::new()) };
    let Some(c) = client() else { return Ok(Vec::new()) };
    let url = reqwest::Url::parse_with_params(&format!("{base}/api/v1/tickets/search"), &[("query", query), ("limit", &max.to_string())])
        .map_err(|e| e.to_string())?;
    let data = get_json(&c, url.as_str(), token.trim()).await?;
    Ok(tickets_found(&data, &base, max))
}

/// The search's answer ({tickets: [ids], assets}) as hits, in Zammad's order.
fn tickets_found(data: &Value, base: &str, max: usize) -> Vec<TicketHit> {
    let Some(ids) = data.get("tickets").and_then(Value::as_array) else { return Vec::new() };
    ids.iter()
        .filter_map(|id| {
            let id = id.as_i64()?;
            let ticket = data.pointer(&format!("/assets/Ticket/{id}"))?;
            let number = ticket.get("number").and_then(Value::as_str).unwrap_or("");
            let title = ticket.get("title").and_then(Value::as_str).unwrap_or(t("(senza titolo)"));
            let mut text = if number.is_empty() { title.to_string() } else { format!("#{number} {title}") };
            let who = client_of(data, ticket);
            if !who.is_empty() {
                text = format!("{text} — {who}");
            }
            Some(TicketHit { title: text, url: format!("{base}/#ticket/zoom/{id}") })
        })
        .take(max)
        .collect()
}

// ── «Prepara» ─────────────────────────────────────────────────────────────────
// A ticket of mine, before answering (asked by Edoardo on 31 October 2026):
// what the memory knows of the customer, how similar tickets were solved, and
// the question for a draft reply. Everything is read here, so any engine of
// the chat can answer; nothing is sent to Zammad.

/// What the chat gets: the context (shown as attached) and the question.
#[derive(serde::Serialize)]
pub struct TicketPrep {
    pub label: String,
    pub context: String,
    pub question: String,
}

/// Words that say nothing about what a ticket is about.
const GENERIC: &[&str] = &[
    "problema", "problemi", "richiesta", "assistenza", "supporto", "urgente", "ticket", "info", "informazioni", "aiuto",
    "della", "delle", "dello", "degli", "nella", "nelle", "sulla", "dalla", "come", "dopo", "prima", "sono", "questo",
    "questa", "quando", "anche", "ancora", "funziona", "riesco", "please", "issue", "request", "help", "with", "from",
];

/// The words of a title to look for similar tickets: the longest 3 that say something.
fn keywords(title: &str) -> Vec<String> {
    let mut words: Vec<String> = title
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.chars().count() >= 4 && !w.chars().all(|c| c.is_ascii_digit()) && !GENERIC.contains(&w.as_str()))
        .collect();
    // Stable: equally long words keep the title's order.
    words.sort_by_key(|w| std::cmp::Reverse(w.chars().count()));
    let mut out: Vec<String> = Vec::new();
    for w in words {
        if !out.contains(&w) && out.len() < 3 {
            out.push(w);
        }
    }
    out
}

/// Ids found by more keywords first, then the newest; never `skip`.
fn rank_similar(found: &[Vec<i64>], skip: i64, max: usize) -> Vec<i64> {
    let mut score: HashMap<i64, usize> = HashMap::new();
    for ids in found {
        for id in ids {
            if *id != skip {
                *score.entry(*id).or_default() += 1;
            }
        }
    }
    let mut list: Vec<(i64, usize)> = score.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    list.into_iter().take(max).map(|(id, _)| id).collect()
}

/// "#number title — who" of an expanded ticket (?expand=true).
fn expanded_title(ticket: &Value) -> String {
    let s = |k: &str| ticket.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let title = if s("title").is_empty() { t("(senza titolo)").to_string() } else { s("title") };
    let head = if s("number").is_empty() { title } else { format!("#{} {title}", s("number")) };
    let who = if !s("organization").is_empty() { s("organization") } else { s("customer") };
    if who.is_empty() || who.contains('@') { head } else { format!("{head} — {who}") }
}

fn closed_state(ticket: &Value) -> bool {
    let state = ticket.get("state").and_then(Value::as_str).unwrap_or_default().to_lowercase();
    state.contains("closed") || state.contains("chius")
}

/// How many messages ticket `id` has, whether it is closed, and "#number
/// title — who": the advice follows it with this (ticket_advice.rs).
pub async fn stamp(id: i64) -> Result<(u64, bool, String), String> {
    let z = Conn::open()?;
    let ticket = get_json(&z.c, &format!("{}/api/v1/tickets/{id}?expand=true", z.base), &z.token).await?;
    let articles = ticket.get("article_count").and_then(Value::as_u64).unwrap_or(0);
    Ok((articles, closed_state(&ticket), expanded_title(&ticket)))
}

/// «Prepara» on ticket `id`.
pub async fn prepare(id: i64) -> Result<TicketPrep, String> {
    let z = Conn::open()?;
    let (c, base, token) = (&z.c, z.base.as_str(), z.token.as_str());

    let ticket = get_json(&c, &format!("{base}/api/v1/tickets/{id}?expand=true"), token).await?;
    let articles = get_json(&c, &format!("{base}/api/v1/ticket_articles/by_ticket/{id}"), token).await.unwrap_or(Value::Null);
    let title = expanded_title(&ticket);
    let mut parts = vec![format!("{title}\n{base}/#ticket/zoom/{id}\n\n{}", ticket_story(&articles))];

    // The customer in the memory: the organization, else the customer's name.
    let who = ["organization", "customer"].iter().filter_map(|k| ticket.get(*k).and_then(Value::as_str)).find_map(crate::brain::page_named);
    if let Some(page) = who.as_deref() {
        if let Some(text) = crate::brain::page_text(page, 2500) {
            parts.push(format!("{}\n{text}", tf("Memoria, pagina «{page}»:", &[("page", &page)])));
        }
    }

    // Similar tickets: Zammad's search on each keyword (title and number
    // without Elasticsearch), the closed ones first, with how they ended.
    let raw_title = ticket.get("title").and_then(Value::as_str).unwrap_or_default();
    let mut found = Vec::new();
    for w in keywords(raw_title) {
        let Ok(url) = reqwest::Url::parse_with_params(&format!("{base}/api/v1/tickets/search"), &[("query", w.as_str()), ("limit", "10")]) else { continue };
        if let Ok(data) = get_json(&c, url.as_str(), token).await {
            found.push(data.get("tickets").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default());
        }
    }
    let mut similar: Vec<(bool, i64, Value)> = Vec::new();
    for other in rank_similar(&found, id, 6) {
        if let Ok(o) = get_json(&c, &format!("{base}/api/v1/tickets/{other}?expand=true"), token).await {
            similar.push((closed_state(&o), other, o));
        }
    }
    similar.sort_by_key(|(closed, _, _)| !*closed);
    let mut lines = Vec::new();
    for (n, (closed, other, o)) in similar.into_iter().take(3).enumerate() {
        let story = match get_json(&c, &format!("{base}/api/v1/ticket_articles/by_ticket/{other}"), token).await {
            Ok(a) => ticket_story(&a).chars().take(1500).collect::<String>(),
            Err(_) => String::new(),
        };
        let state = if closed { t("chiuso") } else { t("aperto") };
        lines.push(format!("{}. {} ({state}, {base}/#ticket/zoom/{other})\n{story}", n + 1, expanded_title(&o)));
    }
    if !lines.is_empty() {
        parts.push(format!("{}\n{}", t("Ticket simili:"), lines.join("\n\n")));
    }

    let context: String = parts.join("\n\n").chars().take(12_000).collect();
    let question = match who {
        Some(_) => t("Ho questo ticket da gestire (i dati sono allegati). Dimmi in breve: cosa sappiamo del cliente, come si sono risolti i ticket simili e cosa proverei per primo. Poi scrivi una bozza di risposta al cliente, breve e cordiale, nella sua lingua. Non inviare niente."),
        None => t("Ho questo ticket da gestire (i dati sono allegati). Cerca il cliente nella memoria con memory_search. Dimmi in breve cosa sappiamo di lui, come si sono risolti i ticket simili e cosa proverei per primo. Poi scrivi una bozza di risposta al cliente, breve e cordiale, nella sua lingua. Non inviare niente."),
    };
    Ok(TicketPrep { label: title, context, question: question.to_string() })
}

// ── The card: tickets, their conversation, a reply, owner, state, priority ───
// Asked by Edoardo on 4 November 2026: work a ticket without opening Zammad.
// The lists are the agent's overviews (no Elasticsearch needed); a ticket is
// `?all=true` (raw ids, users, group, the owners allowed per group in
// `form_meta`) plus its articles. Writing: an internal note, or a reply by
// email to the customer (the card asks a second click); state, owner and
// priority are Zammad's selects, saved at once.

/// Address, token and HTTP client, or what to set in the settings.
struct Conn {
    c: reqwest::Client,
    base: String,
    token: String,
}

impl Conn {
    fn open() -> Result<Conn, String> {
        let base = base_url(&crate::secrets::get("zammad-url").unwrap_or_default());
        if !base.starts_with("https://") && !base.starts_with("http://") {
            return Err(t("Scrivi l'indirizzo di Zammad (https://…) in Impostazioni → Integrazioni").into());
        }
        let token = crate::secrets::get("zammad-token").ok_or_else(|| t("Incolla il token di accesso in Impostazioni → Integrazioni → Zammad").to_string())?;
        let c = client().ok_or_else(|| t("HTTP non disponibile").to_string())?;
        Ok(Conn { c, base, token: token.trim().to_string() })
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        get_json(&self.c, &format!("{}{path}", self.base), &self.token).await
    }

    /// A PUT or POST with a JSON body; Zammad's own message when it refuses.
    async fn send(&self, method: reqwest::Method, path: &str, body: &Value) -> Result<Value, String> {
        let resp = self
            .c
            .request(method, format!("{}{path}", self.base))
            .header("Authorization", format!("Token token={}", self.token))
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| if e.is_timeout() { t("Zammad non risponde (tempo scaduto)").to_string() } else { tf("Zammad non raggiungibile: {e}", &[("e", &e)]) })?;
        let status = resp.status().as_u16();
        let v: Value = resp.json().await.unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(v);
        }
        Err(refusal(status, &v))
    }
}

/// Why Zammad refused a change: its `error_human`/`error`, else the status.
fn refusal(status: u16, v: &Value) -> String {
    let msg = ["error_human", "error"].iter().find_map(|k| v.get(*k).and_then(Value::as_str)).unwrap_or_default().trim();
    match status {
        401 => t("Token non valido o scaduto (401)").into(),
        403 if msg.is_empty() => t("Zammad non permette questa modifica a questo utente (403)").into(),
        _ if !msg.is_empty() => tf("Zammad: {e}", &[("e", &msg)]),
        code => format!("Zammad: HTTP {code}"),
    }
}

/// One choice of a select (a state, a priority, an agent).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Opt {
    pub id: i64,
    pub name: String,
    /// A state's kind: new, open, pending, closed (`state_kind`); empty otherwise.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub kind: String,
}

/// States, priorities and who I am, read once every 10 minutes.
#[derive(Clone)]
struct Meta {
    base: String,
    at: std::time::Instant,
    states: Vec<Opt>,
    priorities: Vec<Opt>,
    me: i64,
}

static META: Mutex<Option<Meta>> = Mutex::new(None);

async fn meta(z: &Conn) -> Meta {
    if let Some(m) = META.lock().unwrap().as_ref().filter(|m| m.base == z.base && m.at.elapsed().as_secs() < 600) {
        return m.clone();
    }
    let states = z.get("/api/v1/ticket_states?expand=true").await.map(|v| options(&v, true)).unwrap_or_default();
    let priorities = z.get("/api/v1/ticket_priorities").await.map(|v| options(&v, false)).unwrap_or_default();
    let me = z.get("/api/v1/users/me").await.ok().and_then(|v| v.get("id")?.as_i64()).unwrap_or(0);
    let m = Meta { base: z.base.clone(), at: std::time::Instant::now(), states, priorities, me };
    if !m.states.is_empty() {
        *META.lock().unwrap() = Some(m.clone());
    }
    m
}

/// The active records of a list as options; for states, with their kind.
fn options(list: &Value, states: bool) -> Vec<Opt> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|o| o.get("active").and_then(Value::as_bool) != Some(false))
        .filter_map(|o| {
            let name = o.get("name")?.as_str()?.to_string();
            let kind = if states {
                // `state_type` with ?expand=true; the name when it is missing.
                state_kind(o.get("state_type").and_then(Value::as_str).unwrap_or(&name)).to_string()
            } else {
                String::new()
            };
            Some(Opt { id: o.get("id")?.as_i64()?, name, kind })
        })
        .collect()
}

/// Zammad's state type as new, open, pending, closed, or hidden (merged, removed).
fn state_kind(kind: &str) -> &'static str {
    let k = kind.to_lowercase();
    if k.starts_with("pending") || k.contains("attesa") {
        "pending"
    } else if k == "new" || k == "nuovo" {
        "new"
    } else if k.contains("closed") || k.contains("chius") {
        "closed"
    } else if k == "merged" || k == "removed" || k.contains("unit") {
        "hidden"
    } else {
        "open"
    }
}

/// A user of the assets by id: "Nome Cognome", else the email or login.
fn person(data: &Value, id: Option<i64>) -> String {
    let Some(u) = id.and_then(|id| data.pointer(&format!("/assets/User/{id}"))) else { return String::new() };
    user_name(u)
}

fn user_name(u: &Value) -> String {
    let s = |k: &str| u.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let full = format!("{} {}", s("firstname"), s("lastname")).trim().to_string();
    if !full.is_empty() && full != "-" {
        full
    } else if !s("email").is_empty() {
        s("email")
    } else {
        s("login")
    }
}

/// An overview of the agent (left in Zammad) with its count.
#[derive(serde::Serialize)]
pub struct OverviewTab {
    pub link: String,
    pub name: String,
    pub count: i64,
}

/// A ticket in a list of the card.
#[derive(Debug, serde::Serialize)]
pub struct TicketRow {
    pub id: i64,
    pub number: String,
    pub title: String,
    /// The company, else the customer.
    pub who: String,
    pub state: String,
    pub kind: String,
    pub priority: String,
    pub priority_id: i64,
    /// Empty when nobody has it (owner 1 in Zammad).
    pub owner: String,
    pub owner_id: i64,
    pub updated: String,
    pub articles: i64,
    pub url: String,
}

#[derive(serde::Serialize)]
pub struct TicketList {
    pub overviews: Vec<OverviewTab>,
    pub view: String,
    pub tickets: Vec<TicketRow>,
    pub me: i64,
}

fn name_of(list: &[Opt], id: i64) -> String {
    list.iter().find(|o| o.id == id).map(|o| o.name.clone()).unwrap_or_default()
}

/// The tickets of an overview's data, in Zammad's order.
fn rows(data: &Value, base: &str, states: &[Opt], priorities: &[Opt]) -> Vec<TicketRow> {
    let Some(ids) = data.pointer("/index/tickets").and_then(Value::as_array) else { return Vec::new() };
    ids.iter()
        .filter_map(|x| {
            let id = x.get("id").and_then(Value::as_i64).or_else(|| x.as_i64())?;
            let tk = data.pointer(&format!("/assets/Ticket/{id}"))?;
            let n = |k: &str| tk.get(k).and_then(Value::as_i64).unwrap_or(0);
            let s = |k: &str| tk.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            let state = states.iter().find(|o| o.id == n("state_id"));
            let owner_id = n("owner_id");
            Some(TicketRow {
                id,
                number: s("number"),
                title: if s("title").is_empty() { t("(senza titolo)").to_string() } else { s("title") },
                who: client_of(data, tk),
                state: state.map(|o| o.name.clone()).unwrap_or_default(),
                kind: state.map(|o| o.kind.clone()).unwrap_or_else(|| "open".into()),
                priority: name_of(priorities, n("priority_id")),
                priority_id: n("priority_id"),
                owner: if owner_id > 1 { person(data, Some(owner_id)) } else { String::new() },
                owner_id,
                updated: s("updated_at"),
                articles: n("article_count"),
                url: format!("{base}/#ticket/zoom/{id}"),
            })
        })
        .collect()
}

/// The overviews with their counts, and the tickets of `view` (else «assigned to me», else the first).
pub async fn tickets(view: Option<String>) -> Result<TicketList, String> {
    let z = Conn::open()?;
    let list = z.get("/api/v1/ticket_overviews").await?;
    let overviews: Vec<OverviewTab> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|o| Some(OverviewTab {
            link: o.get("link")?.as_str()?.to_string(),
            name: o.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
            count: o.get("count").and_then(Value::as_i64).unwrap_or(0),
        }))
        .collect();
    if overviews.is_empty() {
        return Err(t("Nessuna vista dei ticket: l'utente del token è un agente?").into());
    }
    let has = |l: &str| overviews.iter().any(|o| o.link == l);
    let view = match view {
        Some(v) if has(&v) => v,
        _ if has(MY_ASSIGNED) => MY_ASSIGNED.to_string(),
        _ => overviews[0].link.clone(),
    };
    let m = meta(&z).await;
    let url = reqwest::Url::parse_with_params(&format!("{}/api/v1/ticket_overviews", z.base), &[("view", view.as_str())]).map_err(|e| e.to_string())?;
    let data = get_json(&z.c, url.as_str(), &z.token).await?;
    Ok(TicketList { tickets: rows(&data, &z.base, &m.states, &m.priorities), overviews, view, me: m.me })
}

/// A message of the ticket.
#[derive(Debug, serde::Serialize)]
pub struct Article {
    pub id: i64,
    pub from: String,
    pub to: String,
    /// Customer, Agent or System.
    pub sender: String,
    /// email, note, phone, web…
    pub kind: String,
    pub internal: bool,
    pub at: String,
    pub subject: String,
    pub text: String,
    pub files: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct TicketDetail {
    pub id: i64,
    pub number: String,
    pub title: String,
    pub url: String,
    pub customer: String,
    pub org: String,
    pub group: String,
    pub state_id: i64,
    pub priority_id: i64,
    pub owner_id: i64,
    pub created: String,
    pub updated: String,
    pub pending: String,
    pub states: Vec<Opt>,
    pub priorities: Vec<Opt>,
    pub owners: Vec<Opt>,
    pub articles: Vec<Article>,
    pub me: i64,
    /// Where a reply by email goes: the customer's last address, else theirs.
    pub reply_to: String,
}

/// The articles (by_ticket?expand=true) as the card's messages, oldest first.
fn articles(list: &Value) -> Vec<Article> {
    let mut out: Vec<Article> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
            let body = s("body");
            let text = if s("content_type").contains("html") { crate::brain::html_text(&body) } else { body };
            let files = a.get("attachments").and_then(Value::as_array).into_iter().flatten()
                .filter_map(|f| f.get("filename")?.as_str().map(str::to_string))
                .collect();
            Some(Article {
                id: a.get("id")?.as_i64()?,
                from: s("from"),
                to: s("to"),
                sender: s("sender"),
                kind: s("type"),
                internal: a.get("internal").and_then(Value::as_bool) == Some(true),
                at: s("created_at"),
                subject: s("subject"),
                text: text.chars().take(20_000).collect(),
                files,
            })
        })
        .collect();
    out.sort_by_key(|a| a.id);
    out
}

/// The address of a reply by email: the customer's last message (reply-to, else from).
fn reply_address(list: &[Article], raw: &Value) -> String {
    let from_raw = |id: i64, k: &str| -> String {
        raw.as_array().into_iter().flatten()
            .find(|a| a.get("id").and_then(Value::as_i64) == Some(id))
            .and_then(|a| a.get(k)?.as_str())
            .unwrap_or_default().trim().to_string()
    };
    list.iter()
        .rev()
        .filter(|a| a.sender == "Customer" && !a.internal)
        .map(|a| {
            let r = from_raw(a.id, "reply_to");
            if r.is_empty() { a.from.clone() } else { r }
        })
        .find(|x| x.contains('@'))
        .unwrap_or_default()
}

/// The agents who can own a ticket of `group`: Zammad's `form_meta` of `?all=true`.
fn owners_allowed(all: &Value, group: i64) -> Vec<i64> {
    all.pointer(&format!("/form_meta/dependencies/group_id/{group}/owner_id"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|x| x.as_i64().or_else(|| x.as_str()?.parse().ok()))
        .filter(|id| *id > 1)
        .collect()
}

/// The states this ticket can take: `form_meta`'s filter, else every visible one.
fn states_allowed(all: &Value, states: &[Opt], current: i64) -> Vec<Opt> {
    let filter: Vec<i64> = all
        .pointer("/form_meta/filter/state_id")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|x| x.as_i64().or_else(|| x.as_str()?.parse().ok()))
        .collect();
    states
        .iter()
        .filter(|o| o.id == current || if filter.is_empty() { o.kind != "hidden" } else { filter.contains(&o.id) })
        .cloned()
        .collect()
}

pub async fn ticket(id: i64) -> Result<TicketDetail, String> {
    let z = Conn::open()?;
    let all = z.get(&format!("/api/v1/tickets/{id}?all=true")).await?;
    let tk = all.pointer(&format!("/assets/Ticket/{id}")).cloned().ok_or_else(|| t("Ticket non trovato").to_string())?;
    let n = |k: &str| tk.get(k).and_then(Value::as_i64).unwrap_or(0);
    let s = |k: &str| tk.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let m = meta(&z).await;
    let raw = z.get(&format!("/api/v1/ticket_articles/by_ticket/{id}?expand=true")).await.unwrap_or(Value::Null);
    let list = articles(&raw);

    // Who can own it: the group's agents, else every active agent, with me and the owner there.
    let group = n("group_id");
    let mut owner_ids = owners_allowed(&all, group);
    let mut owners: Vec<Opt> = owner_ids.iter().map(|uid| Opt { id: *uid, name: person(&all, Some(*uid)), kind: String::new() }).collect();
    if owners.is_empty() || owners.iter().any(|o| o.name.is_empty()) {
        let url = reqwest::Url::parse_with_params(&format!("{}/api/v1/users/search", z.base), &[("query", "*"), ("limit", "200"), ("role_ids[]", "2")]).map_err(|e| e.to_string())?;
        if let Ok(found) = get_json(&z.c, url.as_str(), &z.token).await {
            let agents: Vec<Opt> = found.as_array().into_iter().flatten()
                .filter(|u| u.get("active").and_then(Value::as_bool) != Some(false))
                .filter_map(|u| Some(Opt { id: u.get("id")?.as_i64()?, name: user_name(u), kind: String::new() }))
                .filter(|o| o.id > 1)
                .collect();
            if owner_ids.is_empty() {
                owners = agents;
            } else {
                for o in owners.iter_mut().filter(|o| o.name.is_empty()) {
                    o.name = name_of(&agents, o.id);
                }
            }
        }
    }
    owner_ids = owners.iter().map(|o| o.id).collect();
    for uid in [n("owner_id"), m.me] {
        if uid > 1 && !owner_ids.contains(&uid) {
            let name = person(&all, Some(uid));
            owners.push(Opt { id: uid, name: if name.is_empty() { format!("#{uid}") } else { name }, kind: String::new() });
        }
    }
    for o in owners.iter_mut().filter(|o| o.name.is_empty()) {
        o.name = format!("#{}", o.id);
    }
    owners.sort_by_key(|o| o.name.to_lowercase());
    owners.insert(0, Opt { id: 1, name: t("— nessuno —").into(), kind: String::new() });

    let customer_id = tk.get("customer_id").and_then(Value::as_i64);
    let mut reply_to = reply_address(&list, &raw);
    if reply_to.is_empty() {
        reply_to = customer_id
            .and_then(|c| all.pointer(&format!("/assets/User/{c}/email"))?.as_str().map(str::to_string))
            .unwrap_or_default();
    }
    let org = tk.get("organization_id").and_then(Value::as_i64)
        .and_then(|o| all.pointer(&format!("/assets/Organization/{o}/name"))?.as_str().map(str::to_string))
        .unwrap_or_default();
    let group_name = all.pointer(&format!("/assets/Group/{group}/name")).and_then(Value::as_str).unwrap_or_default().to_string();
    Ok(TicketDetail {
        id,
        number: s("number"),
        title: if s("title").is_empty() { t("(senza titolo)").to_string() } else { s("title") },
        url: format!("{}/#ticket/zoom/{id}", z.base),
        customer: person(&all, customer_id),
        org,
        group: group_name,
        state_id: n("state_id"),
        priority_id: n("priority_id"),
        owner_id: n("owner_id"),
        created: s("created_at"),
        updated: s("updated_at"),
        pending: s("pending_time"),
        states: states_allowed(&all, &m.states, n("state_id")),
        priorities: m.priorities.clone(),
        owners,
        articles: list,
        me: m.me,
        reply_to,
    })
}

/// A select of the card: state (with the reminder's date when pending), owner or priority.
pub async fn set(id: i64, field: &str, value: i64, pending: Option<String>) -> Result<TicketDetail, String> {
    if !["state_id", "owner_id", "priority_id"].contains(&field) {
        return Err(t("Campo non modificabile").into());
    }
    let z = Conn::open()?;
    let mut body = serde_json::json!({ field: value });
    if let Some(p) = pending.filter(|p| !p.trim().is_empty()) {
        body["pending_time"] = Value::String(p);
    }
    z.send(reqwest::Method::PUT, &format!("/api/v1/tickets/{id}"), &body).await?;
    ticket(id).await
}

/// Plain text as the HTML of an article: escaped, lines kept.
fn text_html(text: &str) -> String {
    text.trim()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace("\r\n", "\n")
        .replace('\n', "<br>")
}

/// An internal note, or a reply by email to the customer (sent by Zammad).
pub async fn reply(id: i64, text: &str, email: bool) -> Result<TicketDetail, String> {
    if text.trim().is_empty() {
        return Err(t("Scrivi il messaggio").into());
    }
    let z = Conn::open()?;
    let mut article = serde_json::json!({
        "ticket_id": id,
        "body": text_html(text),
        "content_type": "text/html",
        "type": "note",
        "internal": true,
        "sender": "Agent",
    });
    if email {
        let now = ticket(id).await?;
        if now.reply_to.is_empty() {
            return Err(t("Il cliente non ha un indirizzo email: rispondi da Zammad").into());
        }
        article["type"] = "email".into();
        article["internal"] = false.into();
        article["to"] = now.reply_to.into();
        article["subject"] = now.title.into();
    }
    z.send(reqwest::Method::POST, "/api/v1/ticket_articles", &article).await?;
    ticket(id).await
}

pub async fn probe(w: &Widget) -> WidgetResult {
    let base = base_url(&crate::secrets::get("zammad-url").unwrap_or_default());
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return WidgetResult::new(&w.id, "error", t("Scrivi l'indirizzo di Zammad (https://…) in Impostazioni → Integrazioni"));
    }
    let Some(token) = crate::secrets::get("zammad-token") else {
        return WidgetResult::new(&w.id, "error", t("Incolla il token di accesso in Impostazioni → Integrazioni → Zammad"));
    };
    let Some(c) = client() else { return WidgetResult::new(&w.id, "error", t("HTTP non disponibile")) };

    let list = match get_json(&c, &format!("{base}/api/v1/ticket_overviews"), token.trim()).await {
        Ok(v) => v,
        Err(e) => return WidgetResult::new(&w.id, "error", e),
    };
    let n = counts(&list);
    if n.is_empty() {
        return WidgetResult::new(&w.id, "error", t("Nessuna vista dei ticket: l'utente del token è un agente?"));
    }
    let get = |k: &str| n.get(k).copied().unwrap_or(0);
    let (mine, unassigned, escalated) = (get(MY_ASSIGNED), get(UNASSIGNED), get(ESCALATED));
    let (level, summary, mut fields) = describe(mine, unassigned, escalated);

    // The newest unassigned tickets by title: one more call, only when there are any.
    let mut titles = Vec::new();
    if unassigned > 0 {
        if let Ok(data) = get_json(&c, &format!("{base}/api/v1/ticket_overviews?view={UNASSIGNED}"), token.trim()).await {
            titles = newest_titles(&data, 3);
        }
    }
    for t in &titles {
        fields.push(FieldValue { label: crate::i18n::t("Da assegnare").into(), value: t.clone() });
    }

    // My tickets, to notice the ones closed and the new ones: one more call,
    // only with the second brain or «Prepara» on.
    let (closed_on, prepare_on) = (crate::brain_watch::wants("ticket"), wants_prepare());
    if closed_on || prepare_on {
        if let Ok(data) = get_json(&c, &format!("{base}/api/v1/ticket_overviews?view={MY_ASSIGNED}"), token.trim()).await {
            let (gone, arrived) = mine_changes(&w.id, titled(&data));
            if closed_on {
                for (id, title) in gone {
                    closed_ticket(&c, &base, token.trim(), id, &title).await;
                }
            }
            if prepare_on {
                if let Some(app) = crate::brain_watch::app() {
                    for (id, title) in arrived.into_iter().take(3) {
                        crate::moments::emit(app, serde_json::json!({ "kind": "ticket", "id": id, "title": title, "url": format!("{base}/#ticket/zoom/{id}") }));
                    }
                }
            }
        }
    }

    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields = fields;
    if let Some(more) = new_ticket_event(&w.id, unassigned) {
        r.event = Some(match (more, titles.first()) {
            (1, Some(title)) => tf("Nuovo ticket: {title}", &[("title", &title)]),

            (1, None) => t("Nuovo ticket da assegnare").to_string(),
            (k, _) => tf("{k} nuovi ticket da assegnare", &[("k", &k)]),
        });
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn my_tickets_that_go_and_come() {
        let w = "test-gone";
        assert_eq!(mine_changes(w, vec![(1, "a".into()), (2, "b".into())]), (vec![], vec![]));
        assert_eq!(mine_changes(w, vec![(2, "b".into()), (3, "c".into())]), (vec![(1, "a".to_string())], vec![(3, "c".to_string())]));
        assert_eq!(mine_changes(w, vec![(2, "b".into()), (3, "c".into())]), (vec![], vec![]));
    }

    #[test]
    fn similar_tickets_by_the_words_that_matter() {
        assert_eq!(keywords("Problema stampante HP ufficio 2 — non stampa"), vec!["stampante", "ufficio", "stampa"]);
        assert!(keywords("Richiesta assistenza urgente").is_empty());
        assert_eq!(rank_similar(&[vec![5, 9, 1], vec![9, 4], vec![1, 7]], 7, 3), vec![9, 1, 5]);
        let o = json!({"number": "10007", "title": "VPN", "organization": "Rossi Srl", "state": "closed"});
        assert_eq!(expanded_title(&o), "#10007 VPN — Rossi Srl");
        assert!(closed_state(&o));
        assert_eq!(expanded_title(&json!({"title": "VPN", "customer": "a@b.it"})), "VPN");
    }

    #[test]
    fn a_ticket_story_keeps_the_problem_and_the_solution() {
        let a = |n: usize| json!({ "from": format!("U{n}"), "body": format!("<p>messaggio {n}</p>"), "content_type": "text/html", "internal": n == 6 });
        let story = ticket_story(&json!([a(1), a(2), a(3), a(4), a(5), a(6)]));
        assert!(story.starts_with("U1: messaggio 1"));
        assert!(!story.contains("messaggio 2") && !story.contains("messaggio 3"));
        assert!(story.contains("U6 (nota interna): messaggio 6"));
        assert!(ticket_story(&json!([])).is_empty());
    }

    #[test]
    fn search_answer_becomes_hits() {
        let data = json!({
            "tickets": [7, 3, 99],
            "assets": {
                "Ticket": {
                    "7": {"number": "10007", "title": "Stampante ferma", "organization_id": 1},
                    "3": {"number": "10003", "title": "VPN", "customer_id": 5}
                },
                "Organization": {"1": {"name": "Rossi Srl"}},
                "User": {"5": {"firstname": "Anna", "lastname": "Bianchi"}}
            }
        });
        let hits = tickets_found(&data, "https://help.x.it", 5);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "#10007 Stampante ferma — Rossi Srl");
        assert_eq!(hits[0].url, "https://help.x.it/#ticket/zoom/7");
        assert_eq!(hits[1].title, "#10003 VPN — Anna Bianchi");
        assert!(tickets_found(&json!({}), "https://x", 5).is_empty());
    }

    #[test]
    fn card_rows_in_zammads_order() {
        let states = options(&json!([
            {"id": 1, "name": "nuovo", "state_type": "new"},
            {"id": 2, "name": "aperto", "state_type": "open"},
            {"id": 3, "name": "in attesa", "state_type": "pending reminder"},
            {"id": 4, "name": "chiuso", "state_type": "closed"},
            {"id": 5, "name": "unito", "state_type": "merged"},
            {"id": 9, "name": "vecchio", "active": false}
        ]), true);
        assert_eq!(states.iter().map(|o| o.kind.as_str()).collect::<Vec<_>>(), vec!["new", "open", "pending", "closed", "hidden"]);
        let prios = options(&json!([{"id": 2, "name": "2 normale"}]), false);
        let data = json!({
            "index": {"tickets": [{"id": 12}, {"id": 7}]},
            "assets": {
                "Ticket": {
                    "7": {"number": "31007", "title": "Stampante", "state_id": 3, "priority_id": 2, "owner_id": 4, "customer_id": 8, "article_count": 5, "updated_at": "2026-11-04T08:00:00Z"},
                    "12": {"number": "31012", "title": "", "state_id": 1, "owner_id": 1, "organization_id": 6}
                },
                "User": {"4": {"firstname": "Edoardo", "lastname": "R"}, "8": {"firstname": "Anna", "lastname": "Bianchi"}},
                "Organization": {"6": {"name": "Rossi Srl"}}
            }
        });
        let r = rows(&data, "https://h.it", &states, &prios);
        assert_eq!(r.len(), 2);
        assert_eq!((r[0].id, r[0].title.as_str(), r[0].who.as_str(), r[0].kind.as_str(), r[0].owner.as_str()), (12, "(senza titolo)", "Rossi Srl", "new", ""));
        assert_eq!((r[1].owner.as_str(), r[1].state.as_str(), r[1].priority.as_str(), r[1].articles), ("Edoardo R", "in attesa", "2 normale", 5));
        assert_eq!(r[1].url, "https://h.it/#ticket/zoom/7");
    }

    #[test]
    fn conversation_owners_and_states() {
        let raw = json!([
            {"id": 30, "from": "Agente", "sender": "Agent", "type": "note", "internal": true, "body": "provo io", "content_type": "text/plain"},
            {"id": 21, "from": "Anna <anna@rossi.it>", "reply_to": "help@rossi.it", "sender": "Customer", "type": "email", "body": "<p>Non stampa</p><p>grazie</p>", "content_type": "text/html", "attachments": [{"filename": "foto.jpg"}]}
        ]);
        let list = articles(&raw);
        assert_eq!(list.iter().map(|a| a.id).collect::<Vec<_>>(), vec![21, 30]);
        assert_eq!(list[0].text, "Non stampa\ngrazie");
        assert_eq!(list[0].files, vec!["foto.jpg"]);
        assert!(list[1].internal);
        assert_eq!(reply_address(&list, &raw), "help@rossi.it");

        let all = json!({"form_meta": {
            "dependencies": {"group_id": {"3": {"owner_id": [1, 4, "7"]}}},
            "filter": {"state_id": [2, 4]}
        }});
        assert_eq!(owners_allowed(&all, 3), vec![4, 7]);
        assert!(owners_allowed(&all, 9).is_empty());
        let st = vec![
            Opt { id: 1, name: "nuovo".into(), kind: "new".into() },
            Opt { id: 2, name: "aperto".into(), kind: "open".into() },
            Opt { id: 4, name: "chiuso".into(), kind: "closed".into() },
            Opt { id: 5, name: "unito".into(), kind: "hidden".into() },
        ];
        assert_eq!(states_allowed(&all, &st, 1).iter().map(|o| o.id).collect::<Vec<_>>(), vec![1, 2, 4]);
        assert_eq!(states_allowed(&json!({}), &st, 2).iter().map(|o| o.id).collect::<Vec<_>>(), vec![1, 2, 4]);
    }

    #[test]
    fn writing_and_refusals() {
        assert_eq!(text_html(" Ciao <Anna> & co\nriga 2 "), "Ciao &lt;Anna&gt; &amp; co<br>riga 2");
        assert_eq!(refusal(422, &json!({"error_human": "Manca la data"})), "Zammad: Manca la data");
        assert_eq!(refusal(500, &Value::Null), "Zammad: HTTP 500");
    }

    #[test]
    fn base_url_is_cleaned() {
        assert_eq!(base_url(" https://help.cliente.it/#ticket/view/my_assigned "), "https://help.cliente.it");
        assert_eq!(base_url("https://help.cliente.it/"), "https://help.cliente.it");
    }

    #[test]
    fn counts_by_link() {
        let list = json!([
            {"name": "I miei ticket assegnati", "link": "my_assigned", "count": 4},
            {"name": "Non assegnati e aperti", "link": "all_unassigned", "count": 2},
            {"name": "Senza conteggio", "link": "x"}
        ]);
        let n = counts(&list);
        assert_eq!(n.get("my_assigned"), Some(&4));
        assert_eq!(n.get("all_unassigned"), Some(&2));
        assert!(!n.contains_key("x"));
    }

    #[test]
    fn titles_newest_first() {
        let data = json!({
            "index": {"tickets": [{"id": 7}, {"id": 12}, {"id": 9}], "count": 3},
            "assets": {"Ticket": {
                "7": {"number": "31007", "title": "Stampante"},
                "12": {"number": "31012", "title": "VPN giù"},
                "9": {"title": "Senza numero"}
            }}
        });
        assert_eq!(newest_titles(&data, 2), vec!["#31012 VPN giù", "Senza numero"]);
        let with_client = serde_json::json!({
            "index": { "tickets": [{ "id": 3 }, { "id": 4 }] },
            "assets": {
                "Ticket": {
                    "3": { "number": "1", "title": "Stampante", "organization_id": 5 },
                    "4": { "number": "2", "title": "Mail", "customer_id": 8 }
                },
                "Organization": { "5": { "name": "Rossi Srl" } },
                "User": { "8": { "firstname": "Anna", "lastname": "Bianchi" } }
            }
        });
        assert_eq!(newest_titles(&with_client, 5), vec!["#2 Mail — Anna Bianchi", "#1 Stampante — Rossi Srl"]);
    }

    #[test]
    fn summary_and_level() {
        let (level, summary, _) = describe(3, 0, 0);
        assert_eq!((level, summary.as_str()), ("ok", "3 assegnati a te"));
        let (level, summary, _) = describe(1, 2, 1);
        assert_eq!(level, "warn");
        assert_eq!(summary, "1 ticket in escalation · 2 non assegnati · 1 assegnato a te");
    }

    #[test]
    fn only_a_rise_is_new() {
        assert_eq!(new_ticket_event("t1", 2), None); // baseline
        assert_eq!(new_ticket_event("t1", 2), None);
        assert_eq!(new_ticket_event("t1", 3), Some(1));
        assert_eq!(new_ticket_event("t1", 1), None);
    }
}
