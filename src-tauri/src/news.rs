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
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::{t, tf};

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
    let own = own_names();
    let rejected: Vec<String> = load().rejected.iter().map(|x| x.to_lowercase()).collect();
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
        if names.iter().any(|n| excluded.contains(&n.to_lowercase()) || rejected.contains(&n.to_lowercase()) || is_own_name(n, &own)) || is_person(p, &all) {
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

/// The user's own names (the Windows account, its parts): never a subject.
fn own_names() -> Vec<String> {
    let mut out = Vec::new();
    for v in ["USERNAME", "USERPROFILE"] {
        if let Ok(x) = std::env::var(v) {
            let last = x.rsplit(['\\', '/']).next().unwrap_or_default().to_lowercase();
            out.extend(last.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() > 2).map(str::to_string));
        }
    }
    out.sort();
    out.dedup();
    out
}

/// «Edoardo», «edoardo rossi», «Edoardo86»: the user, not a subject.
fn is_own_name(name: &str, own: &[String]) -> bool {
    let words: Vec<String> = name
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| w.chars().count() > 2)
        .map(str::to_lowercase)
        .collect();
    !words.is_empty() && words.iter().all(|w| own.iter().any(|o| o.starts_with(w.as_str()) || w == o))
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
/// News per subject at each check, at most: PER_TOPIC moved by the subject's
/// taste («Di più» +1, «Non mi interessa» −1, within ±MAX_TASTE), never below
/// MIN_PER_TOPIC nor above MAX_PER_TOPIC.
const PER_TOPIC: i32 = 5;
const MIN_PER_TOPIC: i32 = 2;
const MAX_PER_TOPIC: i32 = 10;
const MAX_TASTE: i32 = 5;
/// «Di più»: news on the same story searched at once, at most.
const MORE_LIKE: usize = 3;
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
    /// One line about it (Bing gives it, Google does not).
    #[serde(default)]
    pub summary: String,
    /// Its thumbnail: the article's picture (Bing) or the paper's logo (Google);
    /// fetched by `news_image`, never by the island.
    #[serde(default)]
    pub image: String,
}

/// One news as a feed gives it.
#[derive(Clone, Debug, Default)]
struct Found {
    title: String,
    link: String,
    source: String,
    at: i64,
    summary: String,
    image: String,
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
    /// What the user said of each subject's news: «Di più» +1, «Non mi interessa» −1.
    #[serde(default)]
    taste: HashMap<String, i32>,
    /// Proposals the engine already looked at (not asked again) and those it
    /// found unfit for news (never proposed again, as excluded).
    #[serde(default)]
    judged: Vec<String>,
    #[serde(default)]
    rejected: Vec<String>,
    /// The last automatic choice of subjects (`auto_topics`).
    #[serde(default)]
    last_auto: i64,
}

/// One load-change-save of notizie.json at a time (the check, a click in the island).
static LOCK: Mutex<()> = Mutex::new(());

fn per_topic(store: &Store, topic: &str) -> usize {
    (PER_TOPIC + store.taste.get(topic).copied().unwrap_or(0)).clamp(MIN_PER_TOPIC, MAX_PER_TOPIC) as usize
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
    /// Switched off in Impostazioni → Notizie: kept, not searched.
    #[serde(default)]
    off: bool,
}

fn followed(app: &AppHandle) -> Vec<Followed> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Vec::new() };
    let news = shared.settings.lock().unwrap().news.clone();
    serde_json::from_value::<Vec<Followed>>(news.get("topics").cloned().unwrap_or_default())
        .unwrap_or_default()
        .into_iter()
        .filter(|f| !f.name.trim().is_empty() && !f.off)
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

/// Impostazioni → Notizie → Fonte: Google News (default), Bing News (with
/// pictures and a summary line) or both mixed; chosen by Edoardo on 30 October 2026.
/// The feeds to read, as "is it Bing".
fn sources(app: &AppHandle) -> Vec<bool> {
    let chosen = app
        .try_state::<crate::Shared>()
        .and_then(|s| s.settings.lock().unwrap().news.get("source").and_then(serde_json::Value::as_str).map(str::to_string));
    match chosen.as_deref() {
        Some("bing") => vec![true],
        Some("both") => vec![false, true],
        _ => vec![false],
    }
}

fn source_name(sources: &[bool]) -> String {
    match sources {
        [true] => "Bing News".to_string(),
        [false] => "Google News".to_string(),
        _ => t("Google News e Bing News").to_string(),
    }
}

/// Several feeds' items taken in turn, one from each, so a per-subject limit
/// keeps some of every source; the same story twice is left out by `take_new`.
fn mix(lists: Vec<Vec<Found>>) -> Vec<Found> {
    let mut iters: Vec<_> = lists.into_iter().map(Vec::into_iter).collect();
    let mut out = Vec::new();
    loop {
        let before = out.len();
        for it in &mut iters {
            out.extend(it.next());
        }
        if out.len() == before {
            return out;
        }
    }
}

/// Bing's search: the same words; no `when:` (the age filter is ours).
fn bing_url(q: &str) -> String {
    let q = q.trim_end().strip_suffix("when:3d").unwrap_or(q).trim_end();
    let (lang, cc) = if crate::i18n::english() { ("en", "US") } else { ("it", "IT") };
    format!("https://www.bing.com/news/search?q={}&format=rss&setlang={lang}&cc={cc}", url_encode(q))
}

pub(crate) fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while let Some(&c0) = b.get(i) {
        match c0 {
            b'%' => match s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(v) => {
                    out.push(v);
                    i += 3;
                    continue;
                }
                None => out.push(b'%'),
            },
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The value of `name="…"` inside a tag's opening (`<source url="…">`).
fn attr(xml: &str, tag_name: &str, name: &str) -> Option<String> {
    let open = xml.find(&format!("<{tag_name} "))?;
    let head = xml.get(open..)?;
    let head = head.get(..head.find('>')?)?;
    let at = head.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = head.get(at..)?;
    Some(unescape(rest.get(..rest.find('"')?)?))
}

/// Text without tags (Bing's descriptions are plain, but just in case).
fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for c in s.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            c if !inside => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
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

/// The feed's items, Google News' or Bing News': title (without « - Fonte»),
/// link (Bing's own redirect unwrapped), source, date, summary, thumbnail.
fn parse_feed(xml: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<item>") {
        let Some(after) = rest.get(i + 6..) else { break };
        let Some(end) = after.find("</item>") else { break };
        let item = after.get(..end).unwrap_or_default();
        rest = after.get(end + 7..).unwrap_or_default();
        let source = tag(item, "source").or_else(|| tag(item, "News:Source")).map(unescape).unwrap_or_default();
        let mut title = tag(item, "title").map(unescape).unwrap_or_default();
        if !source.is_empty() {
            if let Some(t) = title.strip_suffix(&format!(" - {source}")) {
                title = t.trim().to_string();
            }
        }
        let mut link = tag(item, "link").map(unescape).unwrap_or_default();
        // Bing: apiclick.aspx?…&url=<the article>&…
        if link.contains("bing.com/news/apiclick.aspx") {
            if let Some(u) = link.split(['?', '&']).find_map(|kv| kv.strip_prefix("url=")) {
                link = url_decode(u);
            }
        }
        let at = tag(item, "pubDate").and_then(|d| rfc2822(&unescape(d))).unwrap_or(0);
        let description = tag(item, "description").map(unescape).unwrap_or_default();
        // Google's description is only the title again, as a link.
        let summary = if description.contains("<a ") { String::new() } else { plain(&description) };
        let image = match tag(item, "News:Image").map(unescape) {
            Some(img) if img.starts_with("http") => format!("{}&w=320&h=180&c=14", img.replacen("http://", "https://", 1)),
            _ => attr(item, "source", "url")
                .and_then(|u| u.split("://").nth(1).map(|h| h.split('/').next().unwrap_or_default().to_string()))
                .filter(|h| !h.is_empty())
                .map(|host| format!("https://www.google.com/s2/favicons?domain={host}&sz=64"))
                .unwrap_or_default(),
        };
        if !title.is_empty() && link.starts_with("https://") {
            out.push(Found { title, link, source, at, summary, image });
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

/// «Di più»: the story's own words (the longest of the title), all of them, in the same window.
fn story_query(title: &str, avoid: &[String]) -> String {
    let mut words = story_words(title);
    words.sort_by(|a, b| b.chars().count().cmp(&a.chars().count()));
    words.truncate(4);
    let mut q = words.join(" ");
    for a in avoid.iter().filter(|a| !a.trim().is_empty()) {
        let a = a.trim().replace('"', "");
        q.push_str(&if a.contains(' ') { format!(" -\"{a}\"") } else { format!(" -{a}") });
    }
    q.push_str(" when:3d");
    q
}

/// Keeps what is new, `limit` at most: not seen, not too old, no word to avoid, not the same story again.
fn take_new(store: &mut Store, f: &Followed, found: Vec<Found>, t: i64, limit: usize) -> usize {
    let avoid: Vec<String> = f.avoid.iter().map(|a| a.trim().to_lowercase()).filter(|a| !a.is_empty()).collect();
    let mut added = 0;
    for Found { title, link, source, at, summary, image } in found {
        if added >= limit {
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
        store.items.push(NewsItem { id: key, title, source, link, at: if at > 0 { at } else { t }, found: t, topic: f.name.clone(), summary, image });
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

/// One search on Google News or Bing News: the feed's items, or None when it does not answer.
async fn search_one(client: &reqwest::Client, q: &str, bing: bool) -> Option<Vec<Found>> {
    match client.get(if bing { bing_url(q) } else { feed_url(q) }).send().await {
        Ok(r) if r.status().is_success() => {
            let body = r.text().await.unwrap_or_default();
            Some(parse_feed(body.get(..body.len().min(MAX_FEED_BYTES)).unwrap_or_default()))
        }
        _ => None,
    }
}

/// The same search on every chosen source, mixed; None only when none answers.
async fn search(client: &reqwest::Client, q: &str, sources: &[bool]) -> Option<Vec<Found>> {
    let mut lists = Vec::new();
    for &bing in sources {
        lists.extend(search_one(client, q, bing).await);
    }
    if lists.is_empty() { None } else { Some(mix(lists)) }
}

/// One check of every followed subject; the new news count.
async fn check(app: &AppHandle) -> Result<usize, String> {
    let topics = followed(app);
    let stamp = now();
    let sources = sources(app);
    let Some(client) = crate::widgets::client() else { return Err(t("Connessione non disponibile").to_string()) };
    // The searches first, then the file: a click in the island meanwhile is not lost.
    let mut results = Vec::new();
    let mut failed = 0;
    for f in &topics {
        match search(&client, &query(f), &sources).await {
            Some(found) => results.push((f, found)),
            None => failed += 1,
        }
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load();
    store.last_check = stamp;
    // Subjects no longer followed: their news and their taste go.
    let names: HashSet<String> = topics.iter().map(|f| f.name.clone()).collect();
    store.items.retain(|i| names.contains(&i.topic));
    store.taste.retain(|k, _| names.contains(k));
    store.checked = topics.iter().map(|f| f.name.clone()).collect();
    let mut added = 0;
    for (f, found) in results {
        let limit = per_topic(&store, &f.name);
        added += take_new(&mut store, f, found, stamp, limit);
    }
    trim(&mut store, stamp);
    save(&store);
    forget_images(&store);
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", &store.items);
    if failed > 0 && failed == topics.len() {
        return Err(tf("{name} non risponde", &[("name", &source_name(&sources))]));
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
            if load().last_auto + AUTO_EVERY <= now() {
                if let Err(e) = auto_topics(&app).await {
                    crate::log::line(format!("notizie, argomenti automatici: {e}"));
                }
            }
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
                let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
                let mut store = load();
                store.items.clear();
                save(&store);
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", Vec::<NewsItem>::new());
            }
            // Asleep until the next check; every 5 minutes at most a look at
            // the settings, so a subject just added is searched soon.
            tokio::time::sleep(Duration::from_secs(due.clamp(60, 300) as u64)).await;
        }
    });
}

// ── Subjects chosen by themselves (asked by Edoardo on 30 October 2026) ──────
//
// Once a day the memory's new proposals go to an engine (the memory's, else
// the chat's) which keeps only real news subjects (products, technologies,
// companies, sectors, places) and leaves out people, the user, customers,
// internal projects and generic words. Those it keeps are followed at once
// (`auto: true`); the user switches them off or removes them (then they are
// excluded). Each proposal is judged once (`judged`); the ones turned down
// are never proposed again (`rejected`). Off with «Aggiungi da soli» in
// Impostazioni → Notizie (`news.auto` false).

/// Between two automatic choices.
const AUTO_EVERY: i64 = 24 * 3600;
/// Proposals sent to the engine at once, at most.
const AUTO_BATCH: usize = 24;

#[derive(Deserialize, Default)]
struct Judged {
    #[serde(default)]
    topics: Vec<JudgedTopic>,
}

#[derive(Deserialize, Default)]
struct JudgedTopic {
    #[serde(default)]
    name: String,
    #[serde(default)]
    words: Vec<String>,
}

fn judge_prompt(cands: &[Topic]) -> String {
    let mut list = String::new();
    for c in cands {
        let summary = if c.summary.is_empty() { String::new() } else { format!(" — {}", c.summary) };
        list.push_str(&format!("- «{}»{summary} [alias: {}]\n", c.name, c.words.join(", ")));
    }
    tf(
        "Scegli, tra questi argomenti presi dalla memoria dell'utente, quelli su cui ha senso cercare notizie sul web (Google News).

ARGOMENTI:
{list}
Tieni solo: prodotti, programmi e tecnologie, aziende e marchi conosciuti, settori, normative, luoghi, temi pubblici. Lascia fuori: persone (anche l'utente stesso), clienti e fornitori privati, progetti o cartelle interne, nomi di file, parole generiche o vaghe, cose che non finirebbero mai in un articolo.
Per ognuno che tieni, le parole di ricerca più adatte (1–3, come le scriverebbe un giornale; anche in inglese se è un prodotto internazionale).
Rispondi SOLO con un oggetto JSON, senza altro testo, così:
{\"topics\":[{\"name\":\"nome esatto come nell'elenco\",\"words\":[\"parola\",\"altra parola\"]}]}
Se nessuno va bene rispondi {\"topics\":[]}.",
        &[("list", &list)],
    )
}

fn parse_judged(text: &str) -> Option<Judged> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// The memory's new proposals, judged by an engine; the good ones followed at once.
async fn auto_topics(app: &AppHandle) -> Result<usize, String> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Ok(0) };
    let (news, engine) = {
        let s = shared.settings.lock().unwrap();
        let engine = if s.memory_engine.is_empty() { s.chat_engine.clone() } else { s.memory_engine.clone() };
        (s.news.clone(), engine)
    };
    let stamp_done = || {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = load();
        store.last_auto = now();
        save(&store);
    };
    if news.get("auto").and_then(serde_json::Value::as_bool) == Some(false) {
        stamp_done();
        return Ok(0);
    }
    let excluded: Vec<String> = news.get("excluded").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let topics: Vec<Followed> = news.get("topics").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
    let judged: Vec<String> = load().judged.iter().map(|x| x.to_lowercase()).collect();
    let cands: Vec<Topic> = tauri::async_runtime::spawn_blocking(move || proposals(&excluded))
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|c| !judged.contains(&c.name.to_lowercase()) && !topics.iter().any(|f| f.name.eq_ignore_ascii_case(&c.name)))
        .take(AUTO_BATCH)
        .collect();
    if cands.is_empty() {
        stamp_done();
        return Ok(0);
    }
    let chat = crate::claude::Chat::default();
    let reply = crate::chat_turn(app, &chat, judge_prompt(&cands), None, Some(engine.clone()), None, false, crate::Channel::Helper, &|_| {}).await;
    if engine == "opencode" {
        crate::opencode::forget(chat.cli_session());
    }
    // A failed engine is retried at the next look, not in a day.
    let judged = parse_judged(&reply?.text).ok_or_else(|| t("Il motore non ha risposto nel formato chiesto: riprova, o scegli un altro motore.").to_string())?;
    let mut kept = Vec::new();
    for j in judged.topics {
        if let Some(c) = cands.iter().find(|c| c.name.eq_ignore_ascii_case(j.name.trim())) {
            let words: Vec<String> = j.words.into_iter().map(|w| w.trim().to_string()).filter(|w| !w.is_empty()).take(3).collect();
            kept.push(serde_json::json!({ "name": c.name, "words": if words.is_empty() { c.words.clone() } else { words }, "avoid": [], "fromMemory": true, "auto": true }));
        }
    }
    let added = kept.len();
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = load();
        for c in &cands {
            store.judged.push(c.name.clone());
            if !kept.iter().any(|k| k["name"] == c.name.as_str()) {
                store.rejected.push(c.name.clone());
            }
        }
        store.last_auto = now();
        save(&store);
    }
    if added > 0 {
        crate::agent::update_settings(app, |s| {
            if !s.news.is_object() {
                s.news = serde_json::json!({ "topics": [], "excluded": [] });
            }
            if let Some(list) = s.news.get_mut("topics").and_then(serde_json::Value::as_array_mut) {
                list.extend(kept);
            } else {
                s.news["topics"] = serde_json::Value::Array(kept);
            }
        })?;
    }
    crate::log::line(format!("notizie: {added} argomenti aggiunti da soli su {} proposte", cands.len()));
    Ok(added)
}

/// «Scegli adesso» in Impostazioni → Notizie: the automatic choice now.
#[tauri::command]
pub async fn news_auto(app: AppHandle) -> Result<usize, String> {
    auto_topics(&app).await
}

// ── Thumbnails ────────────────────────────────────────────────────────────────
//
// The island never loads a picture from the web (its CSP allows none): it asks
// `news_image`, which fetches the item's thumbnail once from the same service
// (bing.com, or google.com for a paper's logo), keeps it in
// %LOCALAPPDATA%\EasyIsland\notizie-img\<id> and hands it back as a data URL.
// Pictures of news no longer kept are deleted at each check.

const MAX_IMAGE_BYTES: usize = 400 * 1024;

fn images_dir() -> std::path::PathBuf {
    crate::settings::local_dir().join("notizie-img")
}

fn mime_of(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [0, 0, 1, 0, ..] => Some("image/x-icon"),
        _ => None,
    }
}

fn data_url(bytes: &[u8]) -> Option<String> {
    Some(format!("data:{};base64,{}", mime_of(bytes)?, crate::claude::base64_for(bytes)))
}

/// Pictures of news gone from the list.
fn forget_images(store: &Store) {
    let Ok(rd) = std::fs::read_dir(images_dir()) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !store.items.iter().any(|i| i.id == name) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// A news' thumbnail as a data URL, or None (no picture, not reachable).
#[tauri::command]
pub async fn news_image(id: String) -> Option<String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let path = images_dir().join(&id);
    if let Ok(bytes) = std::fs::read(&path) {
        return data_url(&bytes);
    }
    let url = load().items.into_iter().find(|i| i.id == id)?.image;
    if !(url.starts_with("https://www.bing.com/") || url.starts_with("https://www.google.com/s2/favicons")) {
        return None;
    }
    let r = crate::widgets::client()?.get(&url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let bytes = r.bytes().await.ok()?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let out = data_url(&bytes)?;
    let _ = std::fs::create_dir_all(images_dir());
    let _ = std::fs::write(&path, &bytes);
    Some(out)
}

/// The latest `n` news kept (Telegram's /notizie).
pub fn latest(n: usize) -> Vec<NewsItem> {
    load().items.into_iter().take(n).collect()
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

/// What the user said of each subject (the island proposes to stop following
/// one at −3 or below).
#[tauri::command]
pub fn news_taste() -> HashMap<String, i32> {
    load().taste
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feedback {
    topic: String,
    taste: i32,
    /// «Di più»: news on the same story found now.
    added: usize,
}

/// «Non mi interessa» (`more` false): the news goes and its subject drops a
/// step. «Di più»: the subject rises a step and the same story is searched now.
#[tauri::command]
pub async fn news_feedback(app: AppHandle, id: String, more: bool) -> Result<Feedback, String> {
    let (item, taste) = {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = load();
        let Some(item) = store.items.iter().find(|i| i.id == id).cloned() else { return Err(t("Notizia non più disponibile").to_string()) };
        let taste = store.taste.entry(item.topic.clone()).or_insert(0);
        *taste = (*taste + if more { 1 } else { -1 }).clamp(-MAX_TASTE, MAX_TASTE);
        let taste = *taste;
        if !more {
            store.items.retain(|i| i.id != id);
        }
        save(&store);
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", &store.items);
        (item, taste)
    };
    let mut added = 0;
    if more {
        let f = followed(&app).into_iter().find(|f| f.name == item.topic).unwrap_or(Followed { name: item.topic.clone(), ..Default::default() });
        let client = crate::widgets::client().ok_or_else(|| t("Connessione non disponibile").to_string())?;
        let sources = sources(&app);
        let found = search(&client, &story_query(&item.title, &f.avoid), &sources).await.ok_or_else(|| tf("{name} non risponde", &[("name", &source_name(&sources))]))?;
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = load();
        added = take_new(&mut store, &f, found, now(), MORE_LIKE);
        trim(&mut store, now());
        save(&store);
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "news", &store.items);
    }
    Ok(Feedback { topic: item.topic, taste, added })
}

/// «Tienilo» on the proposal to stop following a subject: its taste starts again from zero.
#[tauri::command]
pub fn news_keep(topic: String) {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load();
    store.taste.remove(&topic);
    save(&store);
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
        let f = &items[0];
        assert_eq!(f.title, "Windows 11 riceve un aggiornamento & altro");
        assert_eq!(f.source, "Il Sito");
        assert!(f.link.starts_with("https://news.google.com/"));
        assert_eq!(f.at, rfc2822("30 Oct 2026 07:05:00 +0000").unwrap());
        assert_eq!(f.summary, "", "Google's description is the title again");
        assert_eq!(f.image, "https://www.google.com/s2/favicons?domain=ilsito.it&sz=64");
        assert_eq!(rfc2822("Thu, 30 Oct 2026 09:05:00 +0200"), rfc2822("Thu, 30 Oct 2026 07:05:00 GMT"));
    }

    #[test]
    fn reads_bing_news_items() {
        let xml = r#"<rss><channel><item><title>Windows 11 KB5127936 porta 41 novit&#224;</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;url=https%3a%2f%2fwww.sito.it%2f2026%2fwin11%2f&amp;c=84&amp;mkt=it-it</link><description>Corregge il blocco di Remote Desktop.</description><pubDate>Thu, 29 Oct 2026 09:40:00 GMT</pubDate><News:Source>Matrice Digitale</News:Source><News:Image>http://www.bing.com/th?id=ONUT.Zob&amp;pid=News</News:Image></item></channel></rss>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 1);
        let f = &items[0];
        assert_eq!(f.link, "https://www.sito.it/2026/win11/");
        assert_eq!(f.source, "Matrice Digitale");
        assert_eq!(f.summary, "Corregge il blocco di Remote Desktop.");
        assert_eq!(f.image, "https://www.bing.com/th?id=ONUT.Zob&pid=News&w=320&h=180&c=14");
        assert!(bing_url("UniFi -offerta when:3d").ends_with("q=UniFi%20-offerta&format=rss&setlang=it&cc=IT") || crate::i18n::english());
        assert_eq!(mime_of(&[0xFF, 0xD8, 0xFF]), Some("image/jpeg"));
        assert_eq!(mime_of(b"<html>"), None);
    }

    #[test]
    fn query_has_words_avoid_and_window() {
        let f = Followed { name: "UniFi".into(), words: vec!["UniFi".into(), "Dream Machine".into()], avoid: vec!["offerta".into()], ..Default::default() };
        assert_eq!(query(&f), "UniFi OR \"Dream Machine\" -offerta when:3d");
        let g = Followed { name: "Tauri".into(), words: vec![], avoid: vec![], ..Default::default() };
        assert_eq!(query(&g), "Tauri when:3d");
    }

    #[test]
    fn two_sources_are_mixed_in_turn() {
        let n = |title: &str| Found { title: title.into(), ..Default::default() };
        let got = mix(vec![vec![n("g1"), n("g2"), n("g3")], vec![n("b1")]]);
        let titles: Vec<&str> = got.iter().map(|f| f.title.as_str()).collect();
        assert_eq!(titles, ["g1", "b1", "g2", "g3"]);
        assert_eq!(source_name(&[false, true]), "Google News e Bing News");
    }

    #[test]
    fn same_story_and_avoided_words_are_left_out() {
        let mut store = Store::default();
        let f = Followed { name: "Tauri".into(), words: vec![], avoid: vec!["sponsor".into()], ..Default::default() };
        let t0 = 2_000_000_000;
        let n = |title: &str, link: &str, source: &str, at: i64| Found { title: title.into(), link: link.into(), source: source.into(), at, ..Default::default() };
        let found = vec![
            n("Tauri 3 esce con il supporto mobile", "https://a.it/1", "A", t0 - 100),
            n("Esce Tauri 3 con il supporto mobile", "https://b.it/2", "B", t0 - 50),
            n("Tauri, contenuto sponsor", "https://c.it/3", "C", t0),
            n("Tauri vecchia notizia", "https://d.it/4", "D", t0 - MAX_AGE - 10),
        ];
        assert_eq!(take_new(&mut store, &f, found.clone(), t0, 5), 1);
        assert_eq!(store.items[0].source, "A");
        // Seen once: never again.
        assert_eq!(take_new(&mut store, &f, found, t0 + 60, 5), 0);
    }

    #[test]
    fn the_user_is_never_a_subject() {
        let own = vec!["edoardo".to_string(), "rossi".to_string()];
        assert!(is_own_name("Edoardo", &own));
        assert!(is_own_name("Edoardo Rossi", &own));
        assert!(!is_own_name("Windows 11", &own));
        assert!(!is_own_name("UniFi", &own));
        assert!(!is_own_name("AI", &own), "short words are not a name");
    }

    #[test]
    fn reads_the_engine_choice() {
        let j = parse_judged("Ecco:
{\"topics\":[{\"name\":\"UniFi\",\"words\":[\"UniFi\",\"Ubiquiti\"]}]}
Fine").unwrap();
        assert_eq!(j.topics.len(), 1);
        assert_eq!(j.topics[0].words, vec!["UniFi", "Ubiquiti"]);
        assert!(parse_judged("niente").is_none());
        assert!(judge_prompt(&[]).contains("JSON"));
    }

    #[test]
    fn taste_moves_how_many_per_subject() {
        let mut store = Store::default();
        assert_eq!(per_topic(&store, "UniFi"), 5);
        store.taste.insert("UniFi".into(), 3);
        assert_eq!(per_topic(&store, "UniFi"), 8);
        store.taste.insert("UniFi".into(), -5);
        assert_eq!(per_topic(&store, "UniFi"), 2, "never below two");
    }

    #[test]
    fn more_like_searches_the_story_words() {
        let q = story_query("Windows 11, Modern Standby ancora più smart: meno consumo di batteria", &["beta".into(), "Insider Preview".into()]);
        assert!(q.starts_with("standby batteria consumo ancora") || q.contains("standby"), "{q}");
        assert!(!q.contains(" di "), "short words left out: {q}");
        assert!(q.ends_with(" -beta -\"Insider Preview\" when:3d"), "{q}");
    }

    /// `cargo test live_google_news -- --ignored --nocapture`: one real search.
    #[test]
    #[ignore]
    fn live_google_news() {
        let f = Followed { name: "Windows 11".into(), words: vec![], avoid: vec![], ..Default::default() };
        let body = tauri::async_runtime::block_on(async {
            crate::widgets::client().unwrap().get(feed_url(&query(&f))).send().await.unwrap().text().await.unwrap()
        });
        for f in parse_feed(&body).into_iter().take(8) {
            println!("{} {} — {} [{}]", f.at, f.source, f.title, f.image);
        }
    }
}
