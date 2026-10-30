// «Notizie» (asked by Edoardo on 30 October 2026, docs/idee.md → «Notizie dal
// web sugli argomenti della memoria»), step 1: the subjects the user cares
// about, read from the memory (brain.rs pages, MEMORIA.md notes, this month's
// diary). Nothing here goes on the network: it only proposes. A subject is
// searched only after the user added it in Impostazioni → Notizie, and the
// excluded ones never come back as proposals (`news.excluded` in settings).
//
// Pages about people and customers are never proposed: a search for them
// would send a name to an outside service. A page counts as one when its
// header says so («tipo: persona», «tipo: cliente»), when it holds an email
// address or a phone number, or when it is linked with a relation that names
// a person («cliente», «collega», «referente»…).

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::t;

use crate::brain::{self, Page};

/// Proposals shown, at most.
const MAX_PROPOSALS: usize = 24;
/// A page updated within these days counts as recent.
const RECENT_DAYS: i64 = 30;

/// Relations ("- cliente: [[X]]") that make X a person or a customer.
const PERSON_RELATIONS: &[&str] = &[
    "cliente", "clienti", "collega", "colleghi", "referente", "contatto", "persona", "lavora con", "lavora per", "capo", "responsabile",
    "fornitore", "moglie", "marito", "figlio", "figlia", "padre", "madre", "amico", "amica", "socio", "dipendente", "titolare",
    "customer", "colleague", "contact", "person", "works with", "boss", "supplier",
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    /// The page's title: what the user sees and adds.
    pub name: String,
    /// The words a search would use: the title and its aliases.
    pub words: Vec<String>,
    /// Its summary line, to recognise it.
    pub summary: String,
    /// Why it is proposed («citata da 4 pagine», «aggiornata di recente»…).
    pub why: Vec<String>,
    pub score: u32,
}

fn has_email(text: &str) -> bool {
    text.split_whitespace().any(|w| {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.');
        match w.split_once('@') {
            Some((a, b)) => !a.is_empty() && b.contains('.') && !b.starts_with('.'),
            None => false,
        }
    })
}

/// Nine digits or more in a row (single spaces, dashes or slashes allowed in between): a
/// phone number. Dots break the run, so IP addresses and versions are not phones.
fn has_phone(text: &str) -> bool {
    let mut run = 0;
    let mut gap = false;
    for c in text.chars() {
        if c.is_ascii_digit() {
            run += 1;
            gap = false;
            if run >= 9 {
                return true;
            }
        } else if matches!(c, ' ' | '-' | '/') && run > 0 && !gap {
            gap = true;
        } else if c == '+' && run == 0 {
        } else {
            run = 0;
            gap = false;
        }
    }
    false
}

/// The header's «tipo:» line, lowercase ("" if none).
fn kind_of(page: &Page) -> String {
    // parse() keeps unknown header lines in the body: the first lines say it.
    page.body
        .lines()
        .take(6)
        .find_map(|l| l.trim().strip_prefix("tipo:").map(|v| v.trim().to_lowercase()))
        .unwrap_or_default()
}

/// A page about a person or a customer: never proposed (see the top of the file).
fn is_person(page: &Page, all: &[Page]) -> bool {
    let kind = kind_of(page);
    if ["persona", "cliente", "contatto", "person", "customer", "contact"].iter().any(|k| kind.contains(k)) {
        return true;
    }
    if has_email(&page.body) || has_phone(&page.body) {
        return true;
    }
    let names: Vec<String> = std::iter::once(page.title.to_lowercase()).chain(page.aliases.iter().map(|a| a.to_lowercase())).collect();
    all.iter().any(|p| {
        p.links.iter().any(|l| {
            let rel = l.rel.to_lowercase();
            names.contains(&l.target.to_lowercase()) && PERSON_RELATIONS.iter().any(|r| rel == *r || rel.starts_with(&format!("{r} ")))
        })
    })
}

/// How many times a subject's names appear in a text (whole words, any case).
fn mentions(text_lower: &str, names: &[String]) -> u32 {
    let mut n = 0u32;
    for name in names {
        let name = name.to_lowercase();
        if name.chars().count() < 3 {
            continue;
        }
        let mut rest = text_lower;
        while let Some(i) = rest.find(&name) {
            let before = rest.get(..i).and_then(|b| b.chars().last()).is_none_or(|c| !c.is_alphanumeric());
            let after_text = rest.get(i + name.len()..).unwrap_or_default();
            let after = after_text.chars().next().is_none_or(|c| !c.is_alphanumeric());
            if before && after {
                n += 1;
            }
            rest = after_text;
        }
    }
    n
}

/// The subjects the memory talks about, best first, without people and customers
/// and without `excluded` (names, any case).
pub fn proposals(excluded: &[String]) -> Vec<Topic> {
    let all = brain::pages();
    let notes = crate::memory::notes().join("\n").to_lowercase();
    let diary = crate::memory::diary_month().to_lowercase();
    let today = crate::memory::stamp().get(..10).and_then(brain::day_number).unwrap_or(0);
    let excluded: Vec<String> = excluded.iter().map(|x| x.trim().to_lowercase()).collect();
    // Links pointing at each page, by lowercase title or alias.
    let mut cited: HashMap<String, u32> = HashMap::new();
    for p in &all {
        for l in &p.links {
            *cited.entry(l.target.to_lowercase()).or_default() += 1;
        }
    }
    let mut out = Vec::new();
    for p in &all {
        let names: Vec<String> = std::iter::once(p.title.clone()).chain(p.aliases.iter().cloned()).collect();
        if names.iter().any(|n| excluded.contains(&n.to_lowercase())) || is_person(p, &all) {
            continue;
        }
        let mut why = Vec::new();
        let links: u32 = names.iter().map(|n| cited.get(&n.to_lowercase()).copied().unwrap_or(0)).sum();
        let in_notes = mentions(&notes, &names);
        let in_diary = mentions(&diary, &names);
        let recent = brain::day_number(&p.updated).is_some_and(|d| today - d <= RECENT_DAYS);
        if links > 0 {
            why.push(format!("links:{links}"));
        }
        if in_notes > 0 {
            why.push(format!("notes:{in_notes}"));
        }
        if in_diary > 0 {
            why.push(format!("diary:{in_diary}"));
        }
        if recent {
            why.push("recent".to_string());
        }
        let score = links * 3 + in_notes * 2 + in_diary.min(10) + if recent { 3 } else { 0 } + p.links.len().min(5) as u32;
        if score == 0 {
            continue;
        }
        out.push(Topic { name: p.title.clone(), words: names, summary: p.summary.clone(), why, score });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    out.truncate(MAX_PROPOSALS);
    out
}

/// Impostazioni → Notizie: what the memory proposes now.
#[tauri::command]
pub async fn news_proposals(excluded: Vec<String>) -> Result<Vec<Topic>, String> {
    tauri::async_runtime::spawn_blocking(move || proposals(&excluded)).await.map_err(|e| e.to_string())
}

// ── Step 2: the news, from Google News (chosen by Edoardo on 30 October 2026) ──
//
// For each subject the user follows, one search on Google News' RSS feed
// (no account, no key): the subject's words joined with OR, its words to avoid
// as -"word", the last three days. That is the only call: the filter (words to
// avoid again, news already seen, the same story from two papers) runs here.
// The check runs at start once the last one is older than CHECK_EVERY, then
// every CHECK_EVERY; between two checks the task sleeps. Kept in
// %LOCALAPPDATA%\EasyIsland\notizie.json: the news shown and what was seen.


/// Between two checks.
const CHECK_EVERY: i64 = 4 * 3600;
/// News per subject at each check, at most.
const PER_TOPIC: usize = 5;
/// News kept for the island, newest first.
const MAX_ITEMS: usize = 80;
/// Titles and links remembered as seen, and for how long.
const MAX_SEEN: usize = 3000;
const SEEN_DAYS: i64 = 30;
/// Older news are left out.
const MAX_AGE: i64 = 3 * 86_400;
/// Two titles this alike are the same story.
const SAME_STORY: f32 = 0.75;
const MAX_FEED_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub source: String,
    pub link: String,
    /// Published, unix seconds.
    pub at: i64,
    /// When EasyIsland found it, unix seconds (the island counts the new ones).
    pub found: i64,
    pub topic: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    key: String,
    words: Vec<String>,
    at: i64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Store {
    #[serde(default)]
    items: Vec<NewsItem>,
    #[serde(default)]
    seen: Vec<Seen>,
    #[serde(default)]
    last_check: i64,
    /// The subjects of the last check: one added or removed is checked at once.
    #[serde(default)]
    checked: Vec<String>,
}

fn store_path() -> std::path::PathBuf {
    crate::settings::local_dir().join("notizie.json")
}

fn load() -> Store {
    std::fs::read_to_string(store_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(s: &Store) {
    if let Ok(text) = serde_json::to_string(s) {
        let _ = std::fs::write(store_path(), text);
    }
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// A followed subject, as Impostazioni → Notizie saves it.
#[derive(Deserialize, Default, Clone)]
struct Followed {
    #[serde(default)]
    name: String,
    #[serde(default)]
    words: Vec<String>,
    #[serde(default)]
    avoid: Vec<String>,
}

fn followed(app: &AppHandle) -> Vec<Followed> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Vec::new() };
    let news = shared.settings.lock().unwrap().news.clone();
    serde_json::from_value::<Vec<Followed>>(news.get("topics").cloned().unwrap_or_default())
        .unwrap_or_default()
        .into_iter()
        .filter(|f| !f.name.trim().is_empty())
        .collect()
}

fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The search: `"a b" OR c -"x" when:3d`.
fn query(f: &Followed) -> String {
    let quote = |w: &str| {
        let w = w.replace('"', "");
        if w.contains(' ') { format!("\"{w}\"") } else { w }
    };
    let words: Vec<String> = if f.words.is_empty() { vec![f.name.clone()] } else { f.words.clone() };
    let mut q = words.iter().filter(|w| !w.trim().is_empty()).map(|w| quote(w.trim())).collect::<Vec<_>>().join(" OR ");
    for a in f.avoid.iter().filter(|a| !a.trim().is_empty()) {
        q.push_str(&format!(" -{}", quote(a.trim())));
    }
    q.push_str(" when:3d");
    q
}

fn feed_url(q: &str) -> String {
    let (hl, gl, ceid) = if crate::i18n::english() { ("en-US", "US", "US:en") } else { ("it", "IT", "IT:it") };
    format!("https://news.google.com/rss/search?q={}&hl={hl}&gl={gl}&ceid={ceid}", url_encode(q))
}

fn unescape(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("<![CDATA[").and_then(|x| x.strip_suffix("]]>")).unwrap_or(s);
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// The text of `<tag …>…</tag>` inside `xml`, the first one.
fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}");
    let mut from = 0;
    loop {
        let i = from + xml.get(from..)?.find(&open)?;
        let after = xml.get(i + open.len()..)?;
        // <source …> but not <sourceX>.
        if after.starts_with('>') || after.starts_with(' ') {
            let gt = after.find('>')?;
            let body = after.get(gt + 1..)?;
            let end = body.find(&format!("</{name}>"))?;
            return body.get(..end);
        }
        from = i + open.len();
    }
}

/// "Thu, 30 Oct 2026 07:05:00 GMT" → unix seconds (times in GMT or ±hhmm).
fn rfc2822(s: &str) -> Option<i64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    let p = |i: usize| parts.get(i).copied();
    let (d, m, y, hms) = if p(0)?.ends_with(',') { (p(1)?, p(2)?, p(3)?, p(4)?) } else { (p(0)?, p(1)?, p(2)?, p(3)?) };
    let zone = parts.last().copied().unwrap_or("GMT");
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let mon = MONTHS.iter().position(|x| m.to_lowercase().starts_with(x))? + 1;
    let date = format!("{y:0>4}-{mon:02}-{:0>2}", d);
    let days = crate::brain::day_number(&date)?;
    let mut t = hms.split(':').map(|x| x.parse::<i64>().unwrap_or(0));
    let secs = t.next().unwrap_or(0) * 3600 + t.next().unwrap_or(0) * 60 + t.next().unwrap_or(0);
    let offset = if (zone.starts_with('+') || zone.starts_with('-')) && zone.len() == 5 {
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let hh: i64 = zone.get(1..3)?.parse().ok()?;
        let mm: i64 = zone.get(3..5)?.parse().ok()?;
        sign * (hh * 3600 + mm * 60)
    } else {
        0
    };
    Some(days * 86_400 + secs - offset)
}

/// The feed's items: title (without « - Fonte»), link, source, date.
fn parse_feed(xml: &str) -> Vec<(String, String, String, i64)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<item>") {
        let Some(after) = rest.get(i + 6..) else { break };
        let Some(end) = after.find("</item>") else { break };
        let item = after.get(..end).unwrap_or_default();
        rest = after.get(end + 7..).unwrap_or_default();
        let source = tag(item, "source").map(unescape).unwrap_or_default();
        let mut title = tag(item, "title").map(unescape).unwrap_or_default();
        if !source.is_empty() {
            if let Some(t) = title.strip_suffix(&format!(" - {source}")) {
                title = t.trim().to_string();
            }
        }
        let link = tag(item, "link").map(unescape).unwrap_or_default();
        let at = tag(item, "pubDate").and_then(|d| rfc2822(&unescape(d))).unwrap_or(0);
        if !title.is_empty() && link.starts_with("https://") {
            out.push((title, link, source, at));
        }
    }
    out
}

/// A title's words for spotting the same story told twice.
fn story_words(title: &str) -> Vec<String> {
    let mut w: Vec<String> = title
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.chars().count() > 3)
        .collect();
    w.sort();
    w.dedup();
    w
}

fn alike(a: &[String], b: &[String]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let set: HashSet<&String> = a.iter().collect();
    let common = b.iter().filter(|w| set.contains(w)).count() as f32;
    common * 2.0 / (a.len() + b.len()) as f32
}

fn id_of(link: &str) -> String {
    format!("{:016x}", link.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3)))
}

/// Keeps what is new: not seen, not too old, no word to avoid, not the same story again.
fn take_new(store: &mut Store, f: &Followed, found: Vec<(String, String, String, i64)>, t: i64) -> usize {
    let avoid: Vec<String> = f.avoid.iter().map(|a| a.trim().to_lowercase()).filter(|a| !a.is_empty()).collect();
    let mut added = 0;
    for (title, link, source, at) in found {
        if added >= PER_TOPIC {
            break;
        }
        let lower = title.to_lowercase();
        if (at > 0 && t - at > MAX_AGE) || avoid.iter().any(|a| lower.contains(a.as_str())) {
            continue;
        }
        let key = id_of(&link);
        let words = story_words(&title);
        if store.seen.iter().any(|s| s.key == key || alike(&s.words, &words) >= SAME_STORY) {
            continue;
        }
        store.seen.push(Seen { key: key.clone(), words, at: t });
        store.items.push(NewsItem { id: key, title, source, link, at: if at > 0 { at } else { t }, found: t, topic: f.name.clone() });
        added += 1;
    }
    added
}

fn trim(store: &mut Store, t: i64) {
    store.seen.retain(|s| t - s.at <= SEEN_DAYS * 86_400);
    let extra = store.seen.len().saturating_sub(MAX_SEEN);
    store.seen.drain(..extra);
    store.items.sort_by(|a, b| b.at.cmp(&a.at));
    store.items.truncate(MAX_ITEMS);
}

/// One check of every followed subject; the new news count.
async fn check(app: &AppHandle) -> Result<usize, String> {
    let topics = followed(app);
    let mut store = load();
    let stamp = now();
    store.last_check = stamp;
    // Subjects no longer followed: their news go.
    let names: HashSet<String> = topics.iter().map(|f| f.name.clone()).collect();
    store.items.retain(|i| names.contains(&i.topic));
    store.checked = topics.iter().map(|f| f.name.clone()).collect();
    let Some(client) = crate::widgets::client() else { return Err(t("Connessione non disponibile").to_string()) };
    let mut added = 0;
    let mut failed = 0;
    for f in &topics {
        let body = match client.get(feed_url(&query(f))).send().await {
            Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
            _ => {
                failed += 1;
                continue;
            }
        };
        let body = body.get(..body.len().min(MAX_FEED_BYTES)).unwrap_or_default();
        added += take_new(&mut store, f, parse_feed(body), stamp);
    }
    trim(&mut store, stamp);
    save(&store);
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", &store.items);
    if failed > 0 && failed == topics.len() {
        return Err(t("Google News non risponde").to_string());
    }
    crate::log::line(format!("notizie: {added} nuove da {} argomenti", topics.len()));
    Ok(added)
}

/// At start and every CHECK_EVERY, while some subject is followed; sleeps in between.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Not in the way of the launch.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let store = load();
            let topics = followed(&app);
            let names: Vec<String> = topics.iter().map(|f| f.name.clone()).collect();
            let due = store.last_check + CHECK_EVERY - now();
            if !topics.is_empty() && (due <= 0 || names != store.checked) {
                let _ = check(&app).await;
                continue;
            }
            if topics.is_empty() && !store.items.is_empty() {
                // Nothing followed any more: its news go too.
                save(&Store { seen: store.seen, last_check: store.last_check, ..Default::default() });
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", Vec::<NewsItem>::new());
            }
            // Asleep until the next check; every 5 minutes at most a look at
            // the settings, so a subject just added is searched soon.
            tokio::time::sleep(Duration::from_secs(due.clamp(60, 300) as u64)).await;
        }
    });
}

/// The news kept, newest first (the island at start).
#[tauri::command]
pub fn news_items() -> Vec<NewsItem> {
    load().items
}

/// «Aggiorna» in the island: a check now.
#[tauri::command]
pub async fn news_refresh(app: AppHandle) -> Result<usize, String> {
    check(&app).await
}

/// «Salva nella memoria»: the news goes to da-leggere, for the evening digest.
#[tauri::command]
pub fn news_save(title: String, link: String, source: String) -> Result<String, String> {
    let name: String = title.chars().filter(|c| c.is_alphanumeric() || *c == ' ').take(60).collect();
    let text = format!("# {title}\n\nfonte: {source}\nlink: {link}\n");
    crate::brain::inbox_add(&format!("{}.md", name.trim()), text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(title: &str, body: &str) -> Page {
        brain::parse(&brain::slug(title), &format!("# {title}\n\n{body}"))
    }

    #[test]
    fn people_and_customers_are_never_proposed() {
        let all = vec![
            page("UniFi", "Rete dell'ufficio.\n- usato da: [[Rossi Srl]]"),
            page("Rossi Srl", "tipo: cliente\nSede a Milano."),
            page("Mario Bianchi", "mario@esempio.it"),
            page("Luca", "Tel. 333 123 4567"),
            page("Anna", "Grafica."),
            page("Progetto X", "- referente: [[Anna]]"),
        ];
        assert!(!is_person(&all[0], &all));
        assert!(is_person(&all[1], &all), "tipo: cliente");
        assert!(is_person(&all[2], &all), "email");
        assert!(is_person(&all[3], &all), "phone");
        assert!(is_person(&all[4], &all), "linked as referente");
    }

    #[test]
    fn mentions_count_whole_words_only() {
        let names = vec!["Tauri".to_string()];
        assert_eq!(mentions("tauri e tauri 2, non tauriano", &names), 2);
        assert_eq!(mentions("", &names), 0);
    }

    /// `cargo test live_proposals -- --ignored --nocapture`: the proposals from this PC's memory.
    #[test]
    #[ignore]
    fn live_proposals() {
        for t in proposals(&[]) {
            println!("{:>3} {} {:?} {:?}", t.score, t.name, t.words, t.why);
        }
    }

    #[test]
    fn phone_numbers_and_not_dates() {
        assert!(has_phone("+39 02 1234 5678"));
        assert!(!has_phone("aggiornata: 2026-10-30"));
        assert!(!has_phone("versione 1.0.13"));
        assert!(!has_phone("server 192.168.100.123"));
    }

    #[test]
    fn reads_google_news_items() {
        let xml = r#"<rss><channel><title>x</title>
<item><title>Windows 11 riceve un aggiornamento &amp; altro - Il Sito</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Thu, 30 Oct 2026 07:05:00 GMT</pubDate><description>&lt;a&gt;</description><source url="https://ilsito.it">Il Sito</source></item>
<item><title>Senza link</title><link>javascript:x</link></item>
</channel></rss>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 1);
        let (title, link, source, at) = &items[0];
        assert_eq!(title, "Windows 11 riceve un aggiornamento & altro");
        assert_eq!(source, "Il Sito");
        assert!(link.starts_with("https://news.google.com/"));
        assert_eq!(*at, rfc2822("30 Oct 2026 07:05:00 +0000").unwrap());
        assert_eq!(rfc2822("Thu, 30 Oct 2026 09:05:00 +0200"), rfc2822("Thu, 30 Oct 2026 07:05:00 GMT"));
    }

    #[test]
    fn query_has_words_avoid_and_window() {
        let f = Followed { name: "UniFi".into(), words: vec!["UniFi".into(), "Dream Machine".into()], avoid: vec!["offerta".into()] };
        assert_eq!(query(&f), "UniFi OR \"Dream Machine\" -offerta when:3d");
        let g = Followed { name: "Tauri".into(), words: vec![], avoid: vec![] };
        assert_eq!(query(&g), "Tauri when:3d");
    }

    #[test]
    fn same_story_and_avoided_words_are_left_out() {
        let mut store = Store::default();
        let f = Followed { name: "Tauri".into(), words: vec![], avoid: vec!["sponsor".into()] };
        let t0 = 2_000_000_000;
        let found = vec![
            ("Tauri 3 esce con il supporto mobile".to_string(), "https://a.it/1".to_string(), "A".to_string(), t0 - 100),
            ("Esce Tauri 3 con il supporto mobile".to_string(), "https://b.it/2".to_string(), "B".to_string(), t0 - 50),
            ("Tauri, contenuto sponsor".to_string(), "https://c.it/3".to_string(), "C".to_string(), t0),
            ("Tauri vecchia notizia".to_string(), "https://d.it/4".to_string(), "D".to_string(), t0 - MAX_AGE - 10),
        ];
        assert_eq!(take_new(&mut store, &f, found.clone(), t0), 1);
        assert_eq!(store.items[0].source, "A");
        // Seen once: never again.
        assert_eq!(take_new(&mut store, &f, found, t0 + 60), 0);
    }

    /// `cargo test live_google_news -- --ignored --nocapture`: one real search.
    #[test]
    #[ignore]
    fn live_google_news() {
        let f = Followed { name: "Windows 11".into(), words: vec![], avoid: vec![] };
        let body = tauri::async_runtime::block_on(async {
            crate::widgets::client().unwrap().get(feed_url(&query(&f))).send().await.unwrap().text().await.unwrap()
        });
        for (title, _, source, at) in parse_feed(&body).into_iter().take(8) {
            println!("{at} {source} — {title}");
        }
    }
}
