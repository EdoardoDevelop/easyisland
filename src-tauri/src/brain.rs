// The memory as a second brain (asked by Edoardo on 24 October 2026): next to
// MEMORIA.md and the diary (memory.rs), still plain Markdown the user reads
// and edits, in %APPDATA%\EasyIsland\memoria:
//
// - `pagine/<nome>.md`: one page per subject (a person, a customer, a project,
//   a concept), linked to the others with [[Titolo]]; a line
//   "- relazione: [[Altra]]" names how two pages are related (the concept map).
//   Optional header lines "riassunto:" (one sentence on who or what it is) and
//   "alias:" (other names, comma separated): the search finds a page by its
//   aliases, [[Alias]] links reach it, and a linked page shows its summary.
//   The agent writes them (memory_page_write) without asking, like
//   memory_note, but never over a page that changed after it read it: every
//   read gives the page's version (a hash) and a write with an old one fails.
// - `da-leggere/`: what the user drops in to be learnt (articles, notes,
//   transcripts, mails). The evening digest, or «Leggi adesso», reads each
//   one, writes or updates pages with the source named, then moves it to
//   `fonti/`, untouched. Files that are not text are named with their path:
//   an engine with its own file tools (Claude Code) can still read them.
// - The check (`check`): duplicate notes, links to missing pages, lone pages,
//   old notes; the agent adds the contradictions it finds and proposes the
//   fixes, and does only those approved. Nothing is deleted: memory_forget
//   moves a note or a page to the archive.
//
// `graph` gives the memory window (src/memory/) its nodes, links and timeline.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::i18n::{t, tf};

/// A page, at most (characters).
const MAX_PAGE: usize = 20_000;
/// A source given to the agent, at most (characters).
const MAX_SOURCE: usize = 30_000;
/// Files read as text from da-leggere.
const READABLE: &[&str] = &["md", "txt", "csv", "json", "html", "htm", "eml", "log", "xml", "yaml", "yml", "ini", "pdf", "docx", "dotx", "docm"];
/// Notes or pages untouched for longer are "old" in the check.
const OLD_DAYS: i64 = 180;
/// Pages two links away the search adds, at most.
const MAX_SECOND_HOP: usize = 4;
/// Links shown on a page's card.
const MAX_BRIEF_LINKS: usize = 30;
/// Steps memory_path walks at most: further than this two things are not really tied.
const MAX_PATH: usize = 6;
/// Lines of the diary the window gets, newest.
const MAX_DIARY_EVENTS: usize = 3_000;

pub fn pages_dir() -> PathBuf {
    crate::memory::dir().join("pagine")
}

pub fn inbox_dir() -> PathBuf {
    crate::memory::dir().join("da-leggere")
}

fn sources_dir() -> PathBuf {
    crate::memory::dir().join("fonti")
}

fn archive_dir() -> PathBuf {
    crate::memory::dir().join("archivio")
}

/// The file name of a title: lower case, letters and digits, dashes.
pub fn slug(title: &str) -> String {
    let mut out = String::new();
    for c in title.trim().chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(80).collect();
    if out.is_empty() { "pagina".into() } else { out }
}

/// A page's version: FNV-1a of its text, stable between runs.
pub fn version(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    /// "" or the relation of a "- relazione: [[X]]" line.
    pub rel: String,
    pub target: String,
    /// The line ends with "(dedotto)": an engine worked it out, no source says it.
    pub inferred: bool,
}

impl Link {
    /// " (cliente di)", " (cliente di, dedotto)", " (dedotto)" or nothing.
    fn tag(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        if !self.rel.is_empty() {
            parts.push(&self.rel);
        }
        if self.inferred {
            parts.push(t("dedotto"));
        }
        if parts.is_empty() { String::new() } else { format!(" ({})", parts.join(", ")) }
    }
}

#[derive(Debug, Clone)]
pub struct Page {
    pub slug: String,
    pub title: String,
    pub source: String,
    pub updated: String,
    /// "riassunto:" in the header, "" if none.
    pub summary: String,
    /// "alias:" in the header: other names of the subject.
    pub aliases: Vec<String>,
    /// The text under the header.
    pub body: String,
    pub links: Vec<Link>,
}

/// At the end of a link's line: an engine worked it out (memory_ai.rs, memory_page_write).
pub const INFERRED: &str = "(dedotto)";

/// The [[links]] of a text, with their relation when the line names one.
pub fn links_in(text: &str) -> Vec<Link> {
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        // "- lavora con: [[Rossi]]" → "lavora con".
        let rel = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .and_then(|rest| {
                let colon = rest.find(':')?;
                let first = rest.find("[[")?;
                (colon < first).then(|| rest.get(..colon).unwrap_or_default().trim().to_string())
            })
            .filter(|r| !r.is_empty() && r.chars().count() <= 40)
            .unwrap_or_default();
        let inferred = line.trim_end().to_lowercase().ends_with(INFERRED);
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let after = rest.get(start + 2..).unwrap_or_default();
            let Some(end) = after.find("]]") else { break };
            let inner = after.get(..end).unwrap_or_default();
            // [[Titolo|testo mostrato]] and [[Titolo#sezione]] point at Titolo.
            let target = inner.split(['|', '#']).next().unwrap_or_default().trim();
            if !target.is_empty() && target.chars().count() <= 120 {
                let link = Link { rel: rel.clone(), target: target.to_string(), inferred };
                if !out.contains(&link) {
                    out.push(link);
                }
            }
            rest = after.get(end + 2..).unwrap_or_default();
        }
    }
    out
}

/// A page from its file: "# Titolo", then "fonte:" and "aggiornata:" lines, then the text.
pub fn parse(slug: &str, text: &str) -> Page {
    let mut title = String::new();
    let mut source = String::new();
    let mut updated = String::new();
    let mut summary = String::new();
    let mut aliases = Vec::new();
    let mut lines = text.lines().peekable();
    let mut body_start = 0usize;
    let mut offset = 0usize;
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        let next = offset + line.len() + 1;
        if title.is_empty() && trimmed.is_empty() {
            offset = next;
            continue;
        }
        if title.is_empty() {
            if let Some(t) = trimmed.strip_prefix("# ") {
                title = t.trim().to_string();
                offset = next;
                body_start = next;
                continue;
            }
            break;
        }
        if let Some(v) = trimmed.strip_prefix("fonte:") {
            source = v.trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("aggiornata:") {
            updated = v.trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("riassunto:") {
            summary = v.trim().to_string();
        } else if let Some(v) = trimmed.strip_prefix("alias:") {
            aliases = alias_list(v);
        } else if !trimmed.is_empty() {
            break;
        }
        offset = next;
        body_start = next;
    }
    let body = text.get(body_start.min(text.len())..).unwrap_or_default().trim().to_string();
    if title.is_empty() {
        title = slug.replace('-', " ");
    }
    let links = links_in(&body);
    Page { slug: slug.to_string(), title, source, updated, summary, aliases, links, body }
}

/// "UDM, Dream Machine" → the names, without blanks or doubles.
fn alias_list(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for a in text.split([',', ';']) {
        let a = a.split_whitespace().collect::<Vec<_>>().join(" ");
        let a: String = a.chars().filter(|c| !matches!(c, '[' | ']')).take(60).collect();
        if !a.is_empty() && !out.iter().any(|o| o.to_lowercase() == a.to_lowercase()) {
            out.push(a);
        }
    }
    out.truncate(12);
    out
}

impl Page {
    /// Whether a [[link]] (by its slug) means this page: its title or one of its aliases.
    pub fn answers_to(&self, key: &str) -> bool {
        self.slug == key || self.aliases.iter().any(|a| slug(a) == key)
    }

    /// One line on the page for a link to it: the summary, else its first line.
    fn gist(&self) -> String {
        let line = if self.summary.is_empty() { self.body.lines().find(|l| !l.trim().is_empty()).unwrap_or_default().trim() } else { self.summary.as_str() };
        line.chars().take(200).collect()
    }
}

/// The slug a [[link]] reaches: the page with that title or alias, else its own.
fn target_of(all: &[Page], target: &str) -> String {
    let s = slug(target);
    all.iter().find(|p| p.answers_to(&s)).map(|p| p.slug.clone()).unwrap_or(s)
}

fn page_file(slug: &str) -> PathBuf {
    pages_dir().join(format!("{slug}.md"))
}

/// Every page, by title.
pub fn pages() -> Vec<Page> {
    pages_in(&pages_dir())
}

/// The pages of a folder (this PC's or the copy of another PC's memory).
pub(crate) fn pages_in(dir: &Path) -> Vec<Page> {
    let mut out: Vec<Page> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
                .filter_map(|e| {
                    let path = e.path();
                    let slug = path.file_stem()?.to_string_lossy().into_owned();
                    let text = std::fs::read_to_string(&path).ok()?;
                    Some(parse(&slug, &text))
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|p| p.title.to_lowercase());
    out
}

/// The page with this title (or file name), with its whole text.
fn find(title: &str) -> Option<(Page, String)> {
    let key = slug(title);
    let low = title.trim().to_lowercase();
    if let Ok(text) = std::fs::read_to_string(page_file(&key)) {
        return Some((parse(&key, &text), text));
    }
    let page = pages().into_iter().find(|p| p.title.to_lowercase() == low || p.answers_to(&key))?;
    let text = std::fs::read_to_string(page_file(&page.slug)).ok()?;
    Some((page, text))
}

/// Pages that link to `title`.
fn backlinks(title: &str, all: &[Page]) -> Vec<String> {
    let key = target_of(all, title);
    all.iter().filter(|p| p.links.iter().any(|l| target_of(all, &l.target) == key)).map(|p| p.title.clone()).collect()
}

/// Words of a text for comparing two notes or titles.
fn words(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.chars().count() > 2)
        .collect()
}

/// Words that say nothing about the subject (Italian and English).
const STOP: &[&str] = &[
    "che", "chi", "con", "per", "dei", "del", "della", "delle", "degli", "dal", "dalla", "nel", "nella", "nei", "sul", "sulla", "una", "uno",
    "gli", "le", "lo", "non", "sono", "come", "anche", "più", "solo", "quando", "dove", "questo", "questa", "quello", "quella", "sempre",
    "mai", "già", "poi", "fare", "fatto", "essere", "stato", "ogni", "tutto", "tutti", "alla", "alle", "agli", "suo", "sua", "loro", "the",
    "and", "for", "with", "that", "this", "from", "are", "was", "not", "you", "your", "all", "has", "have", "regola", "nota", "memoria",
];

/// The words of `text` that can tie it to a subject: no stop words, no numbers or dates.
fn key_words(text: &str) -> BTreeSet<String> {
    words(text).into_iter().filter(|w| !STOP.contains(&w.as_str()) && !w.chars().all(|c| c.is_ascii_digit())).collect()
}

/// The targets of `[[…]]` in a text.
fn wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        let Some(after) = rest.get(i + 2..) else { break };
        let Some(j) = after.find("]]") else { break };
        if let Some(t) = after.get(..j) {
            let t = t.split('|').next().unwrap_or(t).trim();
            if !t.is_empty() {
                out.push(t.to_string());
            }
        }
        rest = after.get(j + 2..).unwrap_or_default();
    }
    out
}

fn similarity(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let common = a.intersection(b).count() as f32;
    common / (a.len() + b.len()) as f32 * 2.0
}

// ── Tools ────────────────────────────────────────────────────────────────────

/// memory_page: a page with its version and who links to it; without a title
/// the list of the pages and of what waits in da-leggere.
pub fn tool_read(title: &str) -> Result<String, String> {
    let all = pages();
    if title.trim().is_empty() {
        let mut out = String::new();
        if all.is_empty() {
            out.push_str(t("Nessuna pagina in memoria."));
        } else {
            out.push_str(&tf("Pagine ({n}):", &[("n", &all.len().to_string())]));
            for p in &all {
                out.push_str(&format!("\n- {} ({} {})", p.title, p.links.len(), t("collegamenti")));
            }
        }
        let waiting = inbox_files();
        if !waiting.is_empty() {
            out.push_str(&format!("\n\n{}", tf("Da leggere: {list}", &[("list", &waiting.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join(", "))])));
        }
        return Ok(out);
    }
    let Some((page, text)) = find(title) else { return Err(no_page(title, &all)) };
    let back = backlinks(&page.title, &all);
    let mut out = format!("{}\n\n---\n{}: {}", text.trim_end(), t("versione"), version(&text));
    if !back.is_empty() {
        out.push_str(&format!("\n{}: {}", t("collegata da"), back.join(", ")));
    }
    Ok(out)
}

fn no_page(title: &str, all: &[Page]) -> String {
    let want = words(title);
    let near: Vec<String> = all.iter().filter(|p| similarity(&want, &words(&p.title)) > 0.3 || p.title.to_lowercase().contains(&title.trim().to_lowercase())).map(|p| p.title.clone()).take(8).collect();
    if near.is_empty() {
        tf("Nessuna pagina «{t}»: puoi crearla con memory_page_write.", &[("t", &title.trim().to_string())])
    } else {
        tf("Nessuna pagina «{t}». Simili: {near}", &[("t", &title.trim().to_string()), ("near", &near.join(", "))])
    }
}

/// A page without its text: what it is, what it links to, who cites it.
pub(crate) fn brief_of(page: &Page, all: &[Page]) -> String {
    let mut out = format!("# {}", page.title);
    let gist = page.gist();
    if !gist.is_empty() {
        out.push_str(&format!("\n{gist}"));
    }
    if !page.aliases.is_empty() {
        out.push_str(&format!("\n{}: {}", t("alias"), page.aliases.join(", ")));
    }
    if !page.source.is_empty() {
        out.push_str(&format!("\n{}: {}", t("fonte"), page.source));
    }
    if !page.updated.is_empty() {
        out.push_str(&format!("\n{}: {}", t("aggiornata"), page.updated));
    }
    out.push_str(&format!("\n{}", tf("Testo intero: {n} caratteri", &[("n", &page.body.chars().count().to_string())])));
    for l in page.links.iter().take(MAX_BRIEF_LINKS) {
        out.push_str(&format!("\n- [[{}]]{}", l.target, l.tag()));
    }
    if page.links.len() > MAX_BRIEF_LINKS {
        out.push_str(&format!("\n- {}", tf("altri {n} collegamenti", &[("n", &(page.links.len() - MAX_BRIEF_LINKS).to_string())])));
    }
    let back = backlinks(&page.title, all);
    if !back.is_empty() {
        out.push_str(&format!("\n{}: {}", t("collegata da"), back.join(", ")));
    }
    out
}

/// memory_page with brief: the card of a page; without a title the list.
pub fn tool_brief(title: &str) -> Result<String, String> {
    if title.trim().is_empty() {
        return tool_read(title);
    }
    let all = pages();
    let Some((page, _)) = find(title) else { return Err(no_page(title, &all)) };
    Ok(brief_of(&page, &all))
}

/// One step of a way between two pages, seen from where it starts.
struct Step {
    to: usize,
    rel: String,
    inferred: bool,
    /// The link is written in the page the step starts from.
    forward: bool,
}

/// The shortest way between two pages, whichever way the links are written;
/// between ways as short, the one with fewer inferred steps.
pub(crate) fn path_text(all: &[Page], from: &str, to: &str) -> Result<String, String> {
    let index = |name: &str| {
        let key = slug(name);
        all.iter().position(|p| p.answers_to(&key)).ok_or_else(|| no_page(name, all))
    };
    let (start, end) = (index(from)?, index(to)?);
    if start == end {
        return Ok(t("È la stessa pagina.").to_string());
    }
    let by_slug: HashMap<&str, usize> = all.iter().enumerate().map(|(i, p)| (p.slug.as_str(), i)).collect();
    let mut around: Vec<Vec<Step>> = all.iter().map(|_| Vec::new()).collect();
    for (i, p) in all.iter().enumerate() {
        for l in &p.links {
            let Some(&j) = by_slug.get(target_of(all, &l.target).as_str()) else { continue };
            if i == j {
                continue;
            }
            if let Some(steps) = around.get_mut(i) {
                steps.push(Step { to: j, rel: l.rel.clone(), inferred: l.inferred, forward: true });
            }
            if let Some(steps) = around.get_mut(j) {
                steps.push(Step { to: i, rel: l.rel.clone(), inferred: l.inferred, forward: false });
            }
        }
    }
    let mut best: HashMap<usize, (usize, usize)> = HashMap::from([(start, (0, 0))]);
    let mut came: HashMap<usize, (usize, usize)> = HashMap::new();
    let mut queue = BinaryHeap::from([Reverse(((0usize, 0usize), start))]);
    while let Some(Reverse((cost, at))) = queue.pop() {
        if best.get(&at).is_some_and(|b| *b < cost) || cost.0 >= MAX_PATH {
            continue;
        }
        for (k, step) in around.get(at).map(Vec::as_slice).unwrap_or_default().iter().enumerate() {
            let next = (cost.0 + 1, cost.1 + usize::from(step.inferred));
            if best.get(&step.to).is_none_or(|b| next < *b) {
                best.insert(step.to, next);
                came.insert(step.to, (at, k));
                queue.push(Reverse((next, step.to)));
            }
        }
    }
    let name = |i: usize| all.get(i).map(|p| p.title.clone()).unwrap_or_default();
    let Some(&(hops, inferred)) = best.get(&end) else {
        return Err(tf("Nessun collegamento tra «{a}» e «{b}» entro {n} passi.", &[("a", &name(start)), ("b", &name(end)), ("n", &MAX_PATH.to_string())]));
    };
    let mut lines = Vec::new();
    let mut at = end;
    while let Some(&(before, k)) = came.get(&at) {
        if let Some(step) = around.get(before).and_then(|s| s.get(k)) {
            let arrow = match (step.forward, step.rel.is_empty()) {
                (true, true) => "→".to_string(),
                (true, false) => format!("→ {} →", step.rel),
                (false, true) => "←".to_string(),
                (false, false) => format!("← {} ←", step.rel),
            };
            let mark = if step.inferred { format!(" ({})", t("dedotto")) } else { String::new() };
            lines.push(format!("[[{}]] {arrow} [[{}]]{mark}", name(before), name(at)));
        }
        if before == start {
            break;
        }
        at = before;
    }
    lines.reverse();
    let mut out = tf("Da [[{a}]] a [[{b}]] (passi: {n}):", &[("a", &name(start)), ("b", &name(end)), ("n", &hops.to_string())]);
    out.push('\n');
    out.push_str(&lines.join("\n"));
    if inferred > 0 {
        out.push_str(&format!("\n{}", t("Almeno un passo è dedotto, non scritto in una fonte.")));
    }
    Ok(out)
}

/// memory_path: how two pages are linked.
pub fn tool_path(from: &str, to: &str) -> Result<String, String> {
    path_text(&pages(), from, to)
}

/// memory_page_write: creates a page or replaces it. An existing page needs
/// the version read with memory_page: written only if it did not change since.
pub fn tool_write(title: &str, text: &str, expected: &str, source: &str) -> Result<String, String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(t("title: il titolo della pagina.").into());
    }
    // A "# Titolo" first line written by the model is the header's, not the text's.
    let mut body = text.trim();
    if let Some(rest) = body.strip_prefix("# ") {
        body = rest.split_once('\n').map(|(_, b)| b.trim()).unwrap_or_default();
    }
    // "riassunto:" and "alias:" first lines go to the header; without them the page keeps its own.
    let mut new_summary = None;
    let mut new_aliases = None;
    loop {
        let (first, rest) = body.split_once('\n').unwrap_or((body, ""));
        let first = first.trim();
        if let Some(v) = first.strip_prefix("riassunto:") {
            new_summary = Some(v.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect::<String>());
        } else if let Some(v) = first.strip_prefix("alias:") {
            new_aliases = Some(alias_list(v));
        } else if !(first.starts_with("fonte:") || first.starts_with("aggiornata:")) {
            break;
        }
        body = rest.trim();
    }
    if body.is_empty() {
        return Err(t("text: il testo della pagina.").into());
    }
    let body: String = body.chars().take(MAX_PAGE).collect();
    let existing = find(&title);
    let (summary, aliases) = match &existing {
        Some((page, _)) => (new_summary.unwrap_or_else(|| page.summary.clone()), new_aliases.unwrap_or_else(|| page.aliases.clone())),
        None => (new_summary.unwrap_or_default(), new_aliases.unwrap_or_default()),
    };
    let (name, mut kept_source, title) = match &existing {
        Some((page, current)) => {
            let expected = expected.trim();
            if expected.is_empty() {
                return Err(t("La pagina esiste già: leggila con memory_page e riscrivila partendo da quella, con la sua versione.").into());
            }
            if expected != version(current) {
                return Err(t("La pagina è cambiata dopo che l'hai letta (forse l'ha modificata l'utente): rileggila con memory_page e riscrivila partendo da quella.").into());
            }
            (page.slug.clone(), page.source.clone(), page.title.clone())
        }
        None => (slug(&title), String::new(), title),
    };
    let source = source.trim();
    if !source.is_empty() && !kept_source.split(", ").any(|s| s == source) {
        kept_source = if kept_source.is_empty() { source.to_string() } else { format!("{kept_source}, {source}") };
    }
    let day: String = crate::memory::stamp().chars().take(10).collect();
    let mut out = format!("# {title}\n");
    if !kept_source.is_empty() {
        out.push_str(&format!("fonte: {kept_source}\n"));
    }
    out.push_str(&format!("aggiornata: {day}\n"));
    if !summary.is_empty() {
        out.push_str(&format!("riassunto: {summary}\n"));
    }
    if !aliases.is_empty() {
        out.push_str(&format!("alias: {}\n", aliases.join(", ")));
    }
    out.push_str(&format!("\n{body}\n"));
    std::fs::create_dir_all(pages_dir()).map_err(|e| e.to_string())?;
    crate::memory::write_whole(&page_file(&name), &out)?;
    let all = pages();
    let missing: Vec<String> = links_in(&body).into_iter().map(|l| l.target).filter(|t| !all.iter().any(|p| p.answers_to(&slug(t)))).collect();
    let mut reply = tf("Pagina «{t}» salvata. versione: {v}", &[("t", &title), ("v", &version(&out))]);
    if !missing.is_empty() {
        reply.push_str(&format!("\n{}", tf("Collegamenti a pagine che non esistono ancora: {list}", &[("list", &missing.join(", "))])));
    }
    Ok(reply)
}

pub struct InboxFile {
    pub name: String,
    pub path: PathBuf,
    pub readable: bool,
}

/// What waits in da-leggere, oldest first.
pub fn inbox_files() -> Vec<InboxFile> {
    let mut out: Vec<(std::time::SystemTime, InboxFile)> = std::fs::read_dir(inbox_dir())
        .map(|r| {
            r.flatten()
                .filter_map(|e| {
                    let meta = e.metadata().ok()?;
                    if !meta.is_file() {
                        return None;
                    }
                    let path = e.path();
                    let name = path.file_name()?.to_string_lossy().into_owned();
                    let ext = path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                    let when = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                    Some((when, InboxFile { name, readable: READABLE.contains(&ext.as_str()), path }))
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|(when, _)| *when);
    out.into_iter().map(|(_, f)| f).collect()
}

/// A plain name in da-leggere (never a path).
fn inbox_file(name: &str) -> Result<InboxFile, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err(t("file: il nome di un file in da-leggere.").into());
    }
    inbox_files().into_iter().find(|f| f.name.eq_ignore_ascii_case(name)).ok_or_else(|| tf("«{f}» non è in da-leggere.", &[("f", &name.to_string())]))
}

/// HTML without its tags and scripts, for a source saved from the web.
pub(crate) fn html_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    let low = html.to_lowercase();
    let mut skip_until: Option<&str> = None;
    let mut pos = 0usize;
    while let Some(start) = rest.find('<') {
        if skip_until.is_none() {
            out.push_str(rest.get(..start).unwrap_or_default());
        }
        let after = rest.get(start..).unwrap_or_default();
        let end = after.find('>').map(|e| e + 1).unwrap_or(after.len());
        let tag = low.get(pos + start..pos + start + end).unwrap_or_default();
        match skip_until {
            Some(close) if tag.starts_with(close) => skip_until = None,
            Some(_) => {}
            None if tag.starts_with("<script") => skip_until = Some("</script"),
            None if tag.starts_with("<style") => skip_until = Some("</style"),
            None if ["<br", "<p", "</p", "<div", "</div", "<li", "<h", "</h", "<tr"].iter().any(|t| tag.starts_with(t)) => out.push('\n'),
            None => {}
        }
        pos += start + end;
        rest = after.get(end..).unwrap_or_default();
    }
    if skip_until.is_none() {
        out.push_str(rest);
    }
    let out = out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'");
    out.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

/// memory_inbox: one source of da-leggere as text (the oldest when `file` is
/// empty), with the list of the others.
pub fn tool_inbox(file: &str) -> Result<String, String> {
    let all = inbox_files();
    if all.is_empty() {
        return Ok(t("Niente da leggere: la cartella da-leggere è vuota.").into());
    }
    let pick = if file.trim().is_empty() {
        all.iter().find(|f| f.readable).or(all.first()).map(|f| f.name.clone()).unwrap_or_default()
    } else {
        inbox_file(file)?.name
    };
    let f = inbox_file(&pick)?;
    let others: Vec<String> = all.iter().filter(|o| o.name != f.name).map(|o| o.name.clone()).collect();
    let mut out = format!("{}: {}\n{}: {}\n", t("file"), f.name, t("percorso"), f.path.display());
    if f.readable {
        let ext = f.path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        // Word and PDF: their text (docx.rs, pdftext.rs).
        let text = match crate::docx::text_of_file(&f.path) {
            Some(read) => read.unwrap_or_else(|e| format!("[{e}]")),
            None => {
                let raw = std::fs::read(&f.path).map_err(|e| e.to_string())?;
                let text = String::from_utf8_lossy(&raw).into_owned();
                if ext == "html" || ext == "htm" { html_text(&text) } else { text }
            }
        };
        let total = text.chars().count();
        let cut: String = text.chars().take(MAX_SOURCE).collect();
        if total > MAX_SOURCE {
            out.push_str(&tf("({n} caratteri, qui i primi {m})\n", &[("n", &total.to_string()), ("m", &MAX_SOURCE.to_string())]));
        }
        out.push('\n');
        out.push_str(&cut);
    } else {
        out.push_str(&format!("\n{}", t("Non è un file di testo: se hai uno strumento per leggere i file (per esempio Read) aprilo dal percorso; altrimenti lascialo e dillo all'utente.")));
    }
    if !others.is_empty() {
        out.push_str(&format!("\n\n---\n{}", tf("Altri da leggere: {list}", &[("list", &others.join(", "))])));
    }
    Ok(out)
}

/// memory_inbox_done: the source read goes to fonti/, untouched.
pub fn tool_inbox_done(file: &str) -> Result<String, String> {
    let f = inbox_file(file)?;
    std::fs::create_dir_all(sources_dir()).map_err(|e| e.to_string())?;
    let mut dest = sources_dir().join(&f.name);
    if dest.exists() {
        let day: String = crate::memory::stamp().chars().take(10).collect();
        dest = sources_dir().join(format!("{day} {}", f.name));
    }
    std::fs::rename(&f.path, &dest).map_err(|e| e.to_string())?;
    Ok(tf("«{f}» spostato in fonti.", &[("f", &f.name)]))
}

/// memory_forget: a note of MEMORIA.md (by its text) or a page (by its title)
/// moves to the archive. Nothing is deleted.
pub fn tool_forget(note: &str, page: &str) -> Result<String, String> {
    if !page.trim().is_empty() {
        let (p, _) = find(page).ok_or_else(|| tf("Nessuna pagina «{t}».", &[("t", &page.trim().to_string())]))?;
        let folder = archive_dir().join("pagine");
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let mut dest = folder.join(format!("{}.md", p.slug));
        if dest.exists() {
            let day: String = crate::memory::stamp().chars().take(10).collect();
            dest = folder.join(format!("{}-{day}.md", p.slug));
        }
        std::fs::rename(page_file(&p.slug), dest).map_err(|e| e.to_string())?;
        return Ok(tf("Pagina «{t}» spostata nell'archivio.", &[("t", &p.title)]));
    }
    crate::memory::forget(note)
}

// ── The check ────────────────────────────────────────────────────────────────

/// Days since 1970 of "AAAA-MM-GG" (civil calendar).
pub(crate) fn day_number(date: &str) -> Option<i64> {
    let y: i64 = date.get(0..4)?.parse().ok()?;
    let m: i64 = date.get(5..7)?.parse().ok()?;
    let d: i64 = date.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// What the check finds, in lines for the agent (empty: nothing).
pub fn check() -> Vec<String> {
    let today_s = crate::memory::stamp();
    let today = today_s.get(..10).and_then(day_number).unwrap_or(0);
    check_at(today, &crate::memory::notes(), &pages())
}

fn check_at(today: i64, notes: &[String], all: &[Page]) -> Vec<String> {
    let mut out = Vec::new();
    // Notes that say the same thing.
    let sets: Vec<BTreeSet<String>> = notes.iter().map(|n| words(n.split_once(": ").map(|(_, b)| b).unwrap_or(n))).collect();
    for i in 0..notes.len() {
        for j in i + 1..notes.len() {
            if similarity(&sets[i], &sets[j]) >= 0.7 {
                out.push(tf("Note simili: «{a}» e «{b}»", &[("a", &notes[i]), ("b", &notes[j])]));
            }
        }
    }
    // Old notes.
    for n in notes {
        let date = n.trim_start_matches("- ");
        if let Some(d) = date.get(..10).and_then(day_number) {
            if today - d > OLD_DAYS {
                out.push(tf("Nota vecchia (oltre 6 mesi): «{n}»", &[("n", n)]));
            }
        }
    }
    let known: HashMap<String, &Page> = all.iter().map(|p| (p.slug.clone(), p)).collect();
    let mut linked: BTreeSet<String> = BTreeSet::new();
    for p in all {
        for l in &p.links {
            let s = target_of(all, &l.target);
            if known.contains_key(&s) {
                linked.insert(s);
            } else {
                out.push(tf("La pagina «{p}» porta a «{t}», che non esiste", &[("p", &p.title), ("t", &l.target)]));
            }
        }
    }
    for p in all {
        if p.links.is_empty() && !linked.contains(&p.slug) {
            out.push(tf("Pagina isolata, senza collegamenti: «{p}»", &[("p", &p.title)]));
        }
        if let Some(d) = p.updated.get(..10).and_then(day_number) {
            if today - d > OLD_DAYS {
                out.push(tf("Pagina non aggiornata da oltre 6 mesi: «{p}»", &[("p", &p.title)]));
            }
        }
    }
    // Pages about the same thing.
    // Words taken once per page: with many pages, once per pair made the map hang.
    let titles: Vec<BTreeSet<String>> = all.iter().map(|p| words(&p.title)).collect();
    let bodies: Vec<BTreeSet<String>> = all.iter().map(|p| words(&p.body)).collect();
    for i in 0..all.len() {
        for j in i + 1..all.len() {
            let same_title = similarity(&titles[i], &titles[j]) >= 0.67;
            let same_body = all[i].body.len() > 80 && similarity(&bodies[i], &bodies[j]) >= 0.75;
            if same_title || same_body {
                out.push(tf("Pagine forse sullo stesso argomento: «{a}» e «{b}»", &[("a", &all[i].title), ("b", &all[j].title)]));
            }
        }
    }
    out
}

/// memory_check: the check as text.
pub fn tool_check() -> String {
    let found = check();
    let waiting = inbox_files().len();
    let mut out = if found.is_empty() { t("Niente da sistemare nella memoria.").to_string() } else { found.join("\n") };
    if waiting > 0 {
        out.push_str(&format!("\n{}", tf("In da-leggere aspettano {n} file.", &[("n", &waiting.to_string())])));
    }
    out
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Lower case without accents, as the field at the top does: "citta" finds "Città".
fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

/// A node of the map found from the island's field at the top (src/views/search.ts).
#[derive(Serialize)]
pub struct PageHit {
    /// The node of the memory window ("p:<slug>", "lavoro|p:<slug>"), to select it there.
    pub id: String,
    pub title: String,
    pub gist: String,
    /// page, note, source, old
    pub kind: &'static str,
    /// The other PC it comes from (empty: this PC).
    pub origin: String,
}

/// What is searched of a page besides its label: the map's nodes carry only
/// the beginning of the text.
struct PageWords {
    names: String,
    text: String,
    gist: String,
}

fn page_words(p: &Page) -> PageWords {
    PageWords { names: fold(&p.aliases.join(" ")), text: fold(&format!("{} {}", p.summary, p.body)), gist: p.gist() }
}

/// The nodes of the map with every word of `query` (no case, no accents):
/// on this PC and in the copies of the others, whatever the map shows. Those
/// with them in their names first, then pages, notes, sources, archived notes.
pub fn find_nodes(query: &str, max: usize, other: Option<String>) -> Vec<PageHit> {
    let words: Vec<String> = query.split_whitespace().map(fold).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let g = graph_of("*", other);
    let mut pages_by_id: HashMap<String, PageWords> = pages().iter().map(|p| (format!("p:{}", p.slug), page_words(p))).collect();
    for name in &g.sources {
        for p in pages_in(&crate::memshare::copy_dir(name).join("pagine")) {
            pages_by_id.insert(format!("{name}|p:{}", p.slug), page_words(&p));
        }
    }
    rank_nodes(&g.nodes, &pages_by_id, &words, max)
}

/// "lavoro|p:rossi" → ("lavoro", "p:rossi"); on this PC ("", "p:rossi").
fn split_node(id: &str) -> (&str, &str) {
    id.split_once('|').unwrap_or(("", id))
}

/// What a new chat starts from: the node's name and its card, not the whole
/// page (the engine opens it if it needs it).
pub fn node_brief(id: &str) -> Option<(String, String)> {
    let (from, local) = split_node(id);
    if !from.is_empty() && !valid_source(from) {
        return None;
    }
    if let Some(slug) = local.strip_prefix("p:") {
        let all = if from.is_empty() { pages() } else { pages_in(&crate::memshare::copy_dir(from).join("pagine")) };
        let page = all.iter().find(|p| p.slug == slug)?;
        return Some((page.title.clone(), brief_of(page, &all)));
    }
    let g = graph_of(from, None);
    let n = g.nodes.iter().find(|n| n.id == id)?;
    Some((n.label.clone(), if n.text.is_empty() { n.label.clone() } else { n.text.clone() }))
}

fn rank_nodes(nodes: &[Node], pages_by_id: &HashMap<String, PageWords>, words: &[String], max: usize) -> Vec<PageHit> {
    let mut found: Vec<(u8, u8, &Node)> = Vec::new();
    for n in nodes {
        let order = match n.kind {
            "page" => 0,
            "note" => 1,
            "source" => 2,
            "old" => 3,
            _ => continue,
        };
        let page = pages_by_id.get(&n.id);
        let names = format!("{} {}", fold(&n.label), page.map(|p| p.names.as_str()).unwrap_or_default());
        let text = page.map(|p| p.text.clone()).unwrap_or_else(|| fold(&n.text));
        let rank = if words.iter().all(|w| names.contains(w.as_str())) {
            0
        } else if words.iter().all(|w| names.contains(w.as_str()) || text.contains(w.as_str())) {
            1
        } else {
            continue;
        };
        found.push((rank, order, n));
    }
    found.sort_by_key(|(rank, order, n)| (*rank, *order, Reverse(n.weight)));
    // The same page on two PCs: once, the most linked.
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|(_, _, n)| n.kind != "page" || seen.insert(fold(&n.label)))
        .take(max)
        .map(|(_, _, n)| PageHit { id: n.id.clone(), title: n.label.clone(), gist: pages_by_id.get(&n.id).map(|p| p.gist.clone()).unwrap_or_default(), kind: n.kind, origin: n.origin.clone() })
        .collect()
}

/// What changed in the memory since `since` ("AAAA-MM-GG"), for the weekly
/// recap (tasks.rs, memory "week"): pages written, notes, sources read.
pub fn week_report(since: &str) -> Vec<String> {
    let mut out = Vec::new();
    for p in pages().into_iter().filter(|p| p.updated.as_str() >= since) {
        out.push(tf("Pagina «{title}» ({day}): {gist}", &[("title", &p.title), ("day", &p.updated), ("gist", &p.gist())]));
    }
    for n in crate::memory::notes() {
        let day = n.trim_start_matches("- ").get(..10).unwrap_or_default().to_string();
        if day.as_str() >= since && day.chars().all(|c| c.is_ascii_digit() || c == '-') {
            out.push(tf("Nota: {n}", &[("n", &n.trim_start_matches("- "))]));
        }
    }
    if let Ok(dir) = std::fs::read_dir(sources_dir()) {
        for e in dir.flatten() {
            let day = e.metadata().and_then(|m| m.modified()).map(file_day).unwrap_or_default();
            if day.as_str() >= since {
                out.push(tf("Fonte letta: {f}", &[("f", &e.file_name().to_string_lossy())]));
            }
        }
    }
    out.truncate(80);
    out
}

/// "AAAA-MM-GG" `days` ago.
pub fn days_ago(days: u64) -> String {
    file_day(std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400))
}

/// The title of the page whose title or aliases hold every word of `query`
/// (no case, no accents): who a mail comes from (brain_watch.rs).
pub fn page_named(query: &str) -> Option<String> {
    let words: Vec<String> = query.split_whitespace().map(fold).filter(|w| w.chars().count() >= 2).collect();
    if words.is_empty() {
        return None;
    }
    pages().into_iter().find_map(|p| {
        let names = fold(&std::iter::once(p.title.as_str()).chain(p.aliases.iter().map(String::as_str)).collect::<Vec<_>>().join(" "));
        let names: Vec<&str> = names.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
        words.iter().all(|w| names.contains(&w.as_str())).then(|| p.title.clone())
    })
}

/// A page's summary and text by its title, at most `max` characters (for the
/// ticket preparation, zammad.rs).
pub fn page_text(title: &str, max: usize) -> Option<String> {
    let p = pages().into_iter().find(|p| p.title == title)?;
    let mut text = if p.summary.is_empty() { String::new() } else { format!("{}: {}\n", t("riassunto"), p.summary) };
    text.push_str(p.body.trim());
    Some(text.chars().take(max).collect())
}

/// memory_search in the pages: their lines with every word, then a line of
/// each page they link to (the links followed one step).
pub fn search(words: &[String], max: usize) -> Vec<String> {
    let all = pages();
    let mut found = Vec::new();
    let mut hit_pages: Vec<&Page> = Vec::new();
    for p in &all {
        // The title and the aliases count as part of every line: "UDM" finds the page "Dream Machine".
        let names = std::iter::once(p.title.as_str()).chain(p.aliases.iter().map(String::as_str)).collect::<Vec<_>>().join(" ").to_lowercase();
        let mut hit = false;
        let summary = (!p.summary.is_empty()).then(|| format!("{}: {}", t("riassunto"), p.summary));
        for line in summary.iter().map(String::as_str).chain(p.body.lines().filter(|l| !l.trim().is_empty())) {
            let low = format!("{names} {}", line.to_lowercase());
            if words.iter().all(|w| low.contains(w.as_str())) {
                found.push(format!("[[{}]] {}", p.title, line.trim()));
                hit = true;
                if found.len() >= max {
                    break;
                }
            }
        }
        if hit {
            hit_pages.push(p);
        }
        if found.len() >= max {
            break;
        }
    }
    let mut seen: BTreeSet<String> = hit_pages.iter().map(|p| p.slug.clone()).collect();
    let mut related = Vec::new();
    let mut first_hop: Vec<&Page> = Vec::new();
    for p in &hit_pages {
        for l in &p.links {
            let s = target_of(&all, &l.target);
            if !seen.insert(s.clone()) {
                continue;
            }
            if let Some(q) = all.iter().find(|q| q.slug == s) {
                related.push(format!("↳ [[{}]]{} {}", q.title, l.tag(), q.gist()));
                first_hop.push(q);
            }
        }
    }
    found.extend(related.into_iter().take(max));
    // One step further, only along strong links: a page the linked pages reach
    // with a named relation, or that two of the pages found or linked point at.
    // "↳ [[A]] → [[B]] (relazione) riassunto", a few at most.
    let mut votes: BTreeMap<String, (u32, bool, String, String)> = BTreeMap::new();
    for p in hit_pages.iter().copied().chain(first_hop.iter().copied()) {
        let mut counted = BTreeSet::new();
        for l in &p.links {
            let s = target_of(&all, &l.target);
            if seen.contains(&s) || !counted.insert(s.clone()) {
                continue;
            }
            let from_first = first_hop.iter().any(|q| q.slug == p.slug);
            let v = votes.entry(s).or_insert((0, false, String::new(), String::new()));
            v.0 += 1;
            if from_first && !l.rel.is_empty() && !v.1 {
                v.1 = true;
                v.2 = p.title.clone();
                v.3 = l.tag();
            } else if v.2.is_empty() {
                v.2 = p.title.clone();
            }
        }
    }
    let mut strong: Vec<(String, (u32, bool, String, String))> = votes.into_iter().filter(|(_, v)| v.0 >= 2 || v.1).collect();
    strong.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(b.1 .1.cmp(&a.1 .1)));
    for (s, (_, _, via, rel)) in strong.into_iter().take(MAX_SECOND_HOP) {
        if let Some(r) = all.iter().find(|r| r.slug == s) {
            found.push(format!("↳ [[{via}]] → [[{}]]{rel} {}", r.title, r.gist()));
        }
    }
    found
}

// ── The window ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    /// page, missing, note, old, source, day
    pub kind: &'static str,
    pub label: String,
    pub date: String,
    pub text: String,
    pub weight: u32,
    /// The other PC whose memory it comes from (empty: this PC).
    pub origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub label: String,
    /// 3: written in the files, or judged by the AI (memory_links.rs); 2: the
    /// note names the page, or between pages a link marked "(dedotto)"; 1: a
    /// guess from words in common.
    pub strength: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// "AAAA-MM-GG" or "AAAA-MM-GG HH:MM".
    pub date: String,
    /// note, page, diary, source
    pub lane: &'static str,
    pub text: String,
    pub node: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub events: Vec<Event>,
    pub check: Vec<String>,
    pub inbox: Vec<String>,
    pub folder: String,
    /// The other PCs whose memory is copied here (memshare.rs), for the window's choice.
    pub sources: Vec<String>,
}

fn cut(text: &str, max: usize) -> String {
    let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= max {
        return one;
    }
    format!("{}…", one.chars().take(max.saturating_sub(1)).collect::<String>().trim_end())
}

/// "- 2026-10-21: testo" → ("2026-10-21", "testo").
fn note_parts(line: &str) -> (String, String) {
    let rest = line.trim().trim_start_matches("- ");
    match rest.split_once(": ") {
        Some((d, text)) if day_number(d).is_some() => (d.to_string(), text.to_string()),
        _ => (String::new(), rest.to_string()),
    }
}

/// Everything the memory window draws: this PC's memory ("" ), the copy of
/// another PC's (its name in Agent Chat) or both ("*"). `other`: the PC whose
/// memory this one reads (memshare::source), the default of "*".
pub fn graph_of(source: &str, other: Option<String>) -> Graph {
    let mut sources = shared_sources();
    if let Some(o) = &other {
        if !sources.contains(o) {
            sources.push(o.clone());
        }
    }
    let mut g = match source {
        "" => graph(),
        "*" => {
            let mut g = graph();
            for name in sources.iter().filter(|n| crate::memshare::copy_dir(n).exists()) {
                let mut o = graph_in(&crate::memshare::copy_dir(name), false);
                tag(&mut o, name);
                // The same page on both PCs: one line between the two.
                let mine: HashMap<String, String> = g.nodes.iter().filter(|n| n.kind == "page").map(|n| (n.label.to_lowercase(), n.id.clone())).collect();
                for n in o.nodes.iter().filter(|n| n.kind == "page") {
                    if let Some(id) = mine.get(&n.label.to_lowercase()) {
                        g.edges.push(Edge { from: id.clone(), to: n.id.clone(), label: name.clone(), strength: 3 });
                    }
                }
                g.nodes.append(&mut o.nodes);
                g.edges.append(&mut o.edges);
                g.events.append(&mut o.events);
            }
            g.events.sort_by(|a, b| a.date.cmp(&b.date));
            g
        }
        name if valid_source(name) => {
            let mut g = graph_in(&crate::memshare::copy_dir(name), false);
            tag(&mut g, name);
            g.folder = crate::memshare::copy_dir(name).to_string_lossy().into_owned();
            g
        }
        _ => graph(),
    };
    g.sources = sources;
    g
}

/// A name of another PC usable as a folder name.
fn valid_source(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') && !name.starts_with('.')
}

/// The copies of other PCs' memories on disk (memoria-condivise/<name>).
fn shared_sources() -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(crate::settings::config_dir().join("memoria-condivise"))
        .map(|r| r.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| valid_source(n) && !n.contains(".tmp-")).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// The ids of another PC's memory: «<name>|p:slug», with where they come from.
fn tag(g: &mut Graph, name: &str) {
    let id = |s: &str| if s.is_empty() { String::new() } else { format!("{name}|{s}") };
    for n in &mut g.nodes {
        n.id = id(&n.id);
        n.origin = name.to_string();
    }
    for e in &mut g.edges {
        e.from = id(&e.from);
        e.to = id(&e.to);
    }
    for e in &mut g.events {
        e.node = id(&e.node);
    }
}

/// This PC's memory.
pub fn graph() -> Graph {
    graph_in(&crate::memory::dir(), true)
}

/// The memory in `dir`; `local`: this PC's (sources, diary, check and da-leggere).
fn graph_in(dir: &Path, local: bool) -> Graph {
    let all = pages_in(&dir.join("pagine"));
    let mut nodes: Vec<Node> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut events: Vec<Event> = Vec::new();
    let mut ids: BTreeSet<String> = BTreeSet::new();
    let mut degree: HashMap<String, u32> = HashMap::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    // Pages, their links and sources.
    let titles: Vec<(String, String)> = all.iter().map(|p| (p.slug.clone(), p.title.to_lowercase())).filter(|(_, t)| t.chars().count() >= 3).collect();
    let page_ids: BTreeSet<String> = all.iter().map(|q| format!("p:{}", q.slug)).collect();
    for p in &all {
        let id = format!("p:{}", p.slug);
        ids.insert(id.clone());
        nodes.push(Node { id: id.clone(), kind: "page", label: p.title.clone(), date: p.updated.clone(), text: cut(&p.body, 1_200), weight: 0, origin: String::new() });
        if !p.updated.is_empty() {
            events.push(Event { date: p.updated.clone(), lane: "page", text: p.title.clone(), node: id.clone() });
        }
        for l in &p.links {
            let to = format!("p:{}", target_of(&all, &l.target));
            if !page_ids.contains(&to) && ids.insert(to.clone()) {
                nodes.push(Node { id: to.clone(), kind: "missing", label: l.target.clone(), date: String::new(), text: String::new(), weight: 0, origin: String::new() });
            }
            add_edge_at(&mut edges, &mut seen, &mut degree, id.clone(), to, l.rel.clone(), if l.inferred { 2 } else { 3 });
        }
        for s in p.source.split(", ").map(str::trim).filter(|s| !s.is_empty()) {
            let sid = format!("s:{}", s.to_lowercase());
            if ids.insert(sid.clone()) {
                nodes.push(Node { id: sid.clone(), kind: "source", label: s.to_string(), date: String::new(), text: String::new(), weight: 0, origin: String::new() });
            }
            add_edge(&mut edges, &mut seen, &mut degree, id.clone(), sid, t("fonte").into());
        }
    }
    // The sources read, with when they were moved.
    if let Ok(r) = std::fs::read_dir(dir.join("fonti")) {
        for e in r.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let sid = format!("s:{}", name.to_lowercase());
            let date = e.metadata().ok().and_then(|m| m.modified().ok()).map(file_day).unwrap_or_default();
            if !date.is_empty() {
                events.push(Event { date: date.clone(), lane: "source", text: name.clone(), node: sid.clone() });
            }
            if ids.insert(sid.clone()) {
                nodes.push(Node { id: sid, kind: "source", label: name, date, text: String::new(), weight: 0, origin: String::new() });
            } else if let Some(n) = nodes.iter_mut().find(|n| n.id == sid) {
                n.date = date;
            }
        }
    }
    // Notes: those in MEMORIA.md and the archived ones, linked to the pages they
    // name — by the whole title, by [[link]] or by shared key words — and to the
    // notes that say much the same. Before 25 Oct 2026 only the whole title
    // counted, and most notes floated alone (Edoardo, on the notebook).
    let archived: Vec<String> = std::fs::read_to_string(dir.join("archivio.md"))
        .map(|t| t.lines().filter(|l| l.starts_with("- ")).map(str::to_string).collect())
        .unwrap_or_default();
    let current = crate::memory::notes_of(&std::fs::read_to_string(dir.join("MEMORIA.md")).unwrap_or_default());
    let page_words: Vec<(String, BTreeSet<String>)> = all
        .iter()
        .map(|p| (p.slug.clone(), key_words(&format!("{} {} {} {}", p.title, p.aliases.join(" "), p.summary, cut(&p.body, 600)))))
        .collect();
    let title_words: Vec<BTreeSet<String>> = all.iter().map(|p| key_words(&format!("{} {}", p.title, p.aliases.join(" ")))).collect();
    let page_bodies: Vec<(String, String)> = all.iter().map(|p| (p.slug.clone(), p.body.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" "))).collect();
    // What the AI said about each note (memory_links.rs), by its text.
    let judged = crate::memory_links::load(dir);
    struct NoteRow { id: String, kind: &'static str, date: String, text: String, words: BTreeSet<String>, linked: bool, hash: String, judged: bool }
    let mut notes: Vec<NoteRow> = Vec::new();
    for (i, (line, kind)) in current.iter().map(|l| (l, "note")).chain(archived.iter().rev().take(300).map(|l| (l, "old"))).enumerate() {
        let (date, text) = note_parts(line);
        let id = format!("n:{i}");
        let words = key_words(&text);
        let hash = note_hash(&text);
        let judged_now = judged.contains_key(&hash);
        notes.push(NoteRow { id, kind, date, text, words, linked: false, hash, judged: judged_now });
    }
    let rarity = Rarity::new(notes.iter().map(|n| &n.words).chain(page_words.iter().map(|(_, w)| w)));
    let by_hash: HashMap<String, String> = notes.iter().map(|n| (n.hash.clone(), n.id.clone())).collect();
    for n in notes.iter_mut() {
        let low = n.text.to_lowercase();
        // Written: the whole title, a [[link]], a topic page quoting it ("- nota: …", memory_ai.rs).
        for (slug, title) in &titles {
            if low.contains(title.as_str()) {
                add_edge_at(&mut edges, &mut seen, &mut degree, n.id.clone(), format!("p:{slug}"), String::new(), 2);
                n.linked = true;
            }
        }
        let head: String = low.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect();
        if head.chars().count() >= 12 {
            for (slug, body) in &page_bodies {
                if body.contains(&head) {
                    add_edge_at(&mut edges, &mut seen, &mut degree, n.id.clone(), format!("p:{slug}"), String::new(), 2);
                    n.linked = true;
                }
            }
        }
        for target in wiki_links(&n.text) {
            let to = format!("p:{}", slug(&target));
            if page_ids.contains(&to) {
                add_edge(&mut edges, &mut seen, &mut degree, n.id.clone(), to, String::new());
                n.linked = true;
            }
        }
        if let Some(v) = judged.get(&n.hash) {
            // The AI's judgement replaces the guesses.
            for slug in &v.pages {
                let to = format!("p:{slug}");
                if page_ids.contains(&to) {
                    add_edge(&mut edges, &mut seen, &mut degree, n.id.clone(), to, String::new());
                    n.linked = true;
                }
            }
            for h in &v.notes {
                if let Some(other) = by_hash.get(h) {
                    add_edge(&mut edges, &mut seen, &mut degree, n.id.clone(), other.clone(), String::new());
                    n.linked = true;
                }
            }
            continue;
        }
        // A guess: the pages sharing a word of their title and a rare one, or two rare ones; the best three.
        let mut near: Vec<(f32, &String)> = page_words
            .iter()
            .zip(title_words.iter())
            .map(|((slug, pw), tw)| (rarity.page_score(&n.words, pw, tw, false), slug))
            .filter(|(s, _)| *s > 0.0)
            .collect();
        near.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        for (_, slug) in near.into_iter().take(3) {
            add_edge_at(&mut edges, &mut seen, &mut degree, n.id.clone(), format!("p:{slug}"), String::new(), 1);
            n.linked = true;
        }
    }
    // Notes that say much the same (weighed by rare words): each to its two closest.
    // Judged notes keep only what the AI said.
    for i in 0..notes.len() {
        if notes[i].judged {
            continue;
        }
        let mut best: Vec<(f32, usize)> = (0..notes.len())
            .filter(|&j| j != i && !notes[j].judged)
            .map(|j| (rarity.cosine(&notes[i].words, &notes[j].words), j))
            .filter(|(c, j)| *c >= 0.4 && notes[i].words.intersection(&notes[*j].words).count() >= 2)
            .collect();
        best.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        for (_, j) in best.into_iter().take(2) {
            let (from, to) = (notes[i].id.clone(), notes[j].id.clone());
            add_edge_at(&mut edges, &mut seen, &mut degree, from, to, String::new(), 1);
            notes[i].linked = true;
            notes[j].linked = true;
        }
    }
    // A name written with a capital in two or three notes or pages (a customer,
    // a server) ties them even when nothing else does. Before 3 Nov 2026 any
    // rare word chained its holders one to the next, and unrelated notes ended
    // up tied (Edoardo, on the work PC). A page holds only the names of its title
    // and aliases, and two pages are never tied this way: until 6 Nov «Diego» in
    // two bodies drew an arrow between an Imec user and a pharmacy group.
    {
        let capital = |text: &str, w: &str| {
            text.split(|c: char| !c.is_alphanumeric())
                .any(|t| t.to_lowercase() == w && t.chars().next().is_some_and(char::is_uppercase))
        };
        let docs: Vec<(String, &BTreeSet<String>, String)> = notes
            .iter()
            .filter(|n| !n.judged)
            .map(|n| (n.id.clone(), &n.words, n.text.clone()))
            .chain(all.iter().zip(title_words.iter()).map(|(p, w)| (format!("p:{}", p.slug), w, format!("{} {}", p.title, p.aliases.join(" ")))))
            .collect();
        let mut holders: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, (_, w, _)) in docs.iter().enumerate() {
            for word in w.iter().filter(|w| w.chars().count() >= 4 && !STOP.contains(&w.as_str())) {
                holders.entry(word.as_str()).or_default().push(i);
            }
        }
        let mut tied: HashSet<String> = HashSet::new();
        for (word, h) in holders.iter().filter(|(_, h)| (2..=3).contains(&h.len())) {
            if h.iter().filter(|i| docs.get(**i).is_some_and(|d| capital(&d.2, word))).count() < 2 {
                continue;
            }
            for (k, a) in h.iter().enumerate() {
                for b in h.iter().skip(k + 1) {
                    let (Some(x), Some(y)) = (docs.get(*a), docs.get(*b)) else { continue };
                    if x.0.starts_with("p:") && y.0.starts_with("p:") {
                        continue;
                    }
                    add_edge_at(&mut edges, &mut seen, &mut degree, x.0.clone(), y.0.clone(), String::new(), 1);
                    tied.insert(x.0.clone());
                    tied.insert(y.0.clone());
                }
            }
        }
        for n in notes.iter_mut() {
            n.linked |= tied.contains(&n.id);
        }
    }
    for n in notes {
        // An archived note tied to nothing is only noise on the map (it stays in the timeline).
        if !n.date.is_empty() {
            events.push(Event { date: n.date.clone(), lane: "note", text: cut(&n.text, 160), node: if n.kind == "old" && !n.linked { String::new() } else { n.id.clone() } });
        }
        if n.kind == "old" && !n.linked {
            continue;
        }
        nodes.push(Node { id: n.id, kind: n.kind, label: cut(&n.text, 60), date: n.date, text: n.text, weight: 0, origin: String::new() });
    }
    // The diary: one event per line; one node per day of the last 60 that
    // names a page.
    let mut months: Vec<PathBuf> = std::fs::read_dir(dir.join("diario"))
        .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    months.sort();
    months.reverse();
    let mut diary: Vec<(String, String)> = Vec::new();
    'files: for m in &months {
        let Ok(text) = std::fs::read_to_string(m) else { continue };
        for l in text.lines().rev().filter(|l| l.starts_with("- ")) {
            let rest = l.get(2..).unwrap_or_default();
            let date = rest.get(..16).unwrap_or_default().to_string();
            let body = rest.get(16..).unwrap_or_default().trim_start_matches(" · ").to_string();
            diary.push((date, body));
            if diary.len() >= MAX_DIARY_EVENTS {
                break 'files;
            }
        }
    }
    let mut days: BTreeMap<String, (u32, BTreeSet<String>)> = BTreeMap::new();
    let recent_from = diary.first().and_then(|(d, _)| d.get(..10)).and_then(day_number).unwrap_or(0) - 60;
    for (date, body) in &diary {
        events.push(Event { date: date.clone(), lane: "diary", text: cut(body, 200), node: String::new() });
        let Some(day) = date.get(..10) else { continue };
        if day_number(day).unwrap_or(0) < recent_from {
            continue;
        }
        let low = body.to_lowercase();
        let entry = days.entry(day.to_string()).or_default();
        entry.0 += 1;
        for (slug, title) in &titles {
            if low.contains(title.as_str()) {
                entry.1.insert(slug.clone());
            }
        }
    }
    for (day, (count, named)) in days {
        if named.is_empty() {
            continue;
        }
        let id = format!("d:{day}");
        for s in named {
            add_edge(&mut edges, &mut seen, &mut degree, id.clone(), format!("p:{s}"), String::new());
        }
        nodes.push(Node { id, kind: "day", label: day.clone(), date: day, text: tf("{n} domande alla chat", &[("n", &count.to_string())]), weight: 0, origin: String::new() });
    }
    for n in &mut nodes {
        n.weight = degree.get(&n.id).copied().unwrap_or(0);
    }
    events.sort_by(|a, b| a.date.cmp(&b.date));
    Graph {
        nodes,
        edges,
        events,
        check: if local { check() } else { Vec::new() },
        inbox: if local { inbox_files().into_iter().map(|f| f.name).collect() } else { Vec::new() },
        folder: dir.to_string_lossy().into_owned(),
        sources: Vec::new(),
    }
}

fn add_edge(edges: &mut Vec<Edge>, seen: &mut HashSet<(String, String)>, degree: &mut HashMap<String, u32>, from: String, to: String, label: String) {
    add_edge_at(edges, seen, degree, from, to, label, 3);
}

#[allow(clippy::too_many_arguments)]
fn add_edge_at(edges: &mut Vec<Edge>, seen: &mut HashSet<(String, String)>, degree: &mut HashMap<String, u32>, from: String, to: String, label: String, strength: u8) {
    if from == to || seen.contains(&(to.clone(), from.clone())) || !seen.insert((from.clone(), to.clone())) {
        return;
    }
    *degree.entry(from.clone()).or_default() += 1;
    *degree.entry(to.clone()).or_default() += 1;
    edges.push(Edge { from, to, label, strength });
}

/// A note's id for the AI's judgement (memory_links.rs): stable while its text stays the same.
pub(crate) fn note_hash(text: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Words weighed by how rare they are among the notes and pages: a word in
/// every second note ties nothing, a customer's name in three ties them.
pub(crate) struct Rarity {
    docs: usize,
    df: HashMap<String, usize>,
}

impl Rarity {
    pub(crate) fn new<'a>(all: impl Iterator<Item = &'a BTreeSet<String>>) -> Rarity {
        let mut df: HashMap<String, usize> = HashMap::new();
        let mut docs = 0;
        for w in all {
            docs += 1;
            for word in w {
                *df.entry(word.clone()).or_default() += 1;
            }
        }
        Rarity { docs, df }
    }

    fn df(&self, w: &str) -> usize {
        self.df.get(w).copied().unwrap_or(0)
    }

    fn idf(&self, w: &str) -> f32 {
        ((self.docs as f32 + 1.0) / (self.df(w) as f32 + 0.5)).ln().max(0.0)
    }

    /// Few enough notes and pages have it to mean something.
    fn rare(&self, w: &str) -> bool {
        self.df(w) <= (self.docs / 12).max(3) && w.chars().count() >= 4
    }

    /// Two texts by their rare words: 0 nothing in common, 1 the same.
    fn cosine(&self, a: &BTreeSet<String>, b: &BTreeSet<String>) -> f32 {
        let w2 = |s: &BTreeSet<String>| s.iter().map(|w| self.idf(w).powi(2)).sum::<f32>();
        let (na, nb) = (w2(a), w2(b));
        if na <= 0.0 || nb <= 0.0 {
            return 0.0;
        }
        a.intersection(b).map(|w| self.idf(w).powi(2)).sum::<f32>() / (na.sqrt() * nb.sqrt())
    }

    /// A note and a page: the weight of what they share, 0 when it is too little
    /// to be a guess (a word of the title and a rare one, or two rare ones).
    /// `loose`: any rare word counts (the candidates the AI judges).
    fn page_score(&self, note: &BTreeSet<String>, page: &BTreeSet<String>, title: &BTreeSet<String>, loose: bool) -> f32 {
        let shared: Vec<&String> = note.intersection(page).collect();
        let rare = shared.iter().filter(|w| self.rare(w)).count();
        let in_title = shared.iter().any(|w| title.contains(*w));
        let ok = if loose { rare >= 1 || in_title } else { (in_title && rare >= 1) || rare >= 2 };
        if !ok {
            return 0.0;
        }
        shared.iter().map(|w| self.idf(w)).sum()
    }
}

/// A note with the pages and notes it may belong to, for the AI (memory_links.rs).
pub(crate) struct Candidates {
    pub hash: String,
    pub text: String,
    /// (slug, title, riassunto) of the pages it may be about.
    pub pages: Vec<(String, String, String)>,
    /// (hash, text) of the notes that may say something close.
    pub notes: Vec<(String, String)>,
}

/// The notes of `dir` (MEMORIA.md) with their candidates, those of `skip` left out.
pub(crate) fn candidates(dir: &Path, skip: &HashSet<String>) -> Vec<Candidates> {
    let all = pages_in(&dir.join("pagine"));
    let notes: Vec<String> = crate::memory::notes_of(&std::fs::read_to_string(dir.join("MEMORIA.md")).unwrap_or_default())
        .iter()
        .map(|l| note_parts(l).1)
        .collect();
    let note_words: Vec<BTreeSet<String>> = notes.iter().map(|t| key_words(t)).collect();
    let page_words: Vec<BTreeSet<String>> = all.iter().map(|p| key_words(&format!("{} {} {} {}", p.title, p.aliases.join(" "), p.summary, cut(&p.body, 600)))).collect();
    let title_words: Vec<BTreeSet<String>> = all.iter().map(|p| key_words(&format!("{} {}", p.title, p.aliases.join(" ")))).collect();
    let rarity = Rarity::new(note_words.iter().chain(page_words.iter()));
    let mut out = Vec::new();
    for (i, text) in notes.iter().enumerate() {
        let hash = note_hash(text);
        if skip.contains(&hash) {
            continue;
        }
        let low = text.to_lowercase();
        let Some(words) = note_words.get(i) else { continue };
        let mut scored: Vec<(f32, usize)> = all
            .iter()
            .enumerate()
            .map(|(j, p)| {
                let named = p.title.chars().count() >= 3 && low.contains(&p.title.to_lowercase());
                let s = match (page_words.get(j), title_words.get(j)) {
                    (Some(pw), Some(tw)) => rarity.page_score(words, pw, tw, true),
                    _ => 0.0,
                };
                (if named { s + 100.0 } else { s }, j)
            })
            .filter(|(s, _)| *s > 0.0)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let pages = scored.into_iter().take(6).filter_map(|(_, j)| all.get(j)).map(|p| (p.slug.clone(), p.title.clone(), p.summary.clone())).collect();
        let mut close: Vec<(f32, usize)> = note_words
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(j, w)| (rarity.cosine(words, w), j))
            .filter(|(c, _)| *c >= 0.15)
            .collect();
        close.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let near = close.into_iter().take(4).filter_map(|(_, j)| notes.get(j)).map(|t| (note_hash(t), t.clone())).collect();
        out.push(Candidates { hash, text: text.clone(), pages, notes: near });
    }
    out
}

fn file_day(time: std::time::SystemTime) -> String {
    let secs = time.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    // Civil date from days since 1970 (UTC is close enough for a day on the timeline).
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The file behind a node of the window, to open it in its editor.
pub fn node_file(id: &str) -> Option<PathBuf> {
    // Another PC's memory: its copy (memshare.rs), pages and notes only.
    if let Some((name, inner)) = id.split_once('|') {
        if !valid_source(name) {
            return None;
        }
        let copy = crate::memshare::copy_dir(name);
        let path = if let Some(s) = inner.strip_prefix("p:") {
            copy.join("pagine").join(format!("{}.md", slug(s)))
        } else if inner.starts_with("n:") {
            copy.join("MEMORIA.md")
        } else {
            return None;
        };
        return path.exists().then_some(path);
    }
    if let Some(s) = id.strip_prefix("p:") {
        let path = page_file(&slug(s));
        return path.exists().then_some(path);
    }
    if let Some(name) = id.strip_prefix("s:") {
        let found = std::fs::read_dir(sources_dir()).ok()?.flatten().map(|e| e.path()).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase() == name));
        return found;
    }
    if id.starts_with("n:") {
        return crate::memory::ensure_main().ok();
    }
    if let Some(day) = id.strip_prefix("d:") {
        let path = crate::memory::dir().join("diario").join(format!("{}.md", day.get(..7)?));
        return path.exists().then_some(path);
    }
    None
}

/// The memory read or written (a search, a note, a page; from the chat, Agent
/// Chat or another PC): the memory window's living network lights what it
/// touched (src/memory/neural.ts). Only words go, never a file.
pub fn activity(app: &tauri::AppHandle, kind: &str, text: &str) {
    use tauri::Emitter;
    let text: String = text.chars().take(300).collect();
    if !text.trim().is_empty() {
        let _ = app.emit_to(crate::MEMORY_LABEL, "memory-activity", serde_json::json!({ "kind": kind, "text": text }));
    }
}

/// After a write to the memory: the memory window, if open, draws it again.
pub fn changed(app: &tauri::AppHandle, result: Result<String, String>) -> Result<String, String> {
    if result.is_ok() {
        use tauri::Emitter;
        let _ = app.emit_to(crate::MEMORY_LABEL, "memory-refresh", ());
    }
    result
}

/// A file dropped on the memory window, into da-leggere (a plain name; the
/// same name twice gets a number).
pub fn inbox_add(name: &str, bytes: &[u8]) -> Result<String, String> {
    const MAX_BYTES: usize = 25 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(t("File troppo grande (al massimo 25 MB).").into());
    }
    let clean: String = name.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() {
        return Err(t("Nome del file non valido.").into());
    }
    let dir = ensure_inbox()?;
    let mut dest = dir.join(&clean);
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (clean.clone(), String::new()),
    };
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(clean))
}

/// What «Ricorda questo» captured (asked by Edoardo on 31 October 2026): the
/// selected text or what the user typed, with where it came from.
#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Remember {
    pub text: String,
    /// Who or what it is about, when the user says so: the page to put it in.
    pub about: String,
    pub app: String,
    pub title: String,
    pub url: String,
    /// Where it was captured: "pc" (the shortcut, the menu) or "telegram".
    pub from: String,
}

/// The source file of a capture: its name and its Markdown, at `stamp`
/// ("2026-10-31 18:05"). The agent that reads da-leggere finds in it what to
/// learn and where it came from.
fn remember_file(r: &Remember, stamp: &str) -> Result<(String, String), String> {
    let text = r.text.trim();
    if text.is_empty() {
        return Err(t("Scrivi o seleziona cosa ricordare.").into());
    }
    let text: String = text.chars().take(MAX_SOURCE).collect();
    let first: String = text.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
    let first: String = first.chars().filter(|c| c.is_alphanumeric() || " -'".contains(*c)).take(50).collect();
    let name = format!("{} {} {}.md", t("Ricorda"), stamp.replace(':', "."), first.trim()).replace("  ", " ");
    let mut head = vec![format!("# {}", t("Da ricordare")), String::new(), format!("{}: {stamp}", t("quando"))];
    let from = match (r.app.trim(), r.title.trim()) {
        ("", "") => String::new(),
        (a, "") | ("", a) => a.to_string(),
        (a, b) => format!("{a} — {b}"),
    };
    if r.from == "telegram" {
        head.push(format!("{}: Telegram", t("da")));
    } else if r.from == "telegram-voice" {
        head.push(format!("{}: {}", t("da"), t("un vocale su Telegram")));
    } else if !from.is_empty() {
        head.push(format!("{}: {from}", t("da")));
    }
    if !r.url.trim().is_empty() {
        head.push(format!("{}: {}", t("indirizzo"), r.url.trim()));
    }
    if !r.about.trim().is_empty() {
        head.push(format!("{}: {}", t("riguarda"), r.about.trim()));
    }
    head.push(String::new());
    head.push(t("L'utente ha scelto di ricordarlo (Ricorda questo): mettilo nella pagina giusta, quella di «riguarda» se c'è.").to_string());
    head.push(String::new());
    Ok((name, format!("{}{text}\n", head.join("\n") + "\n")))
}

/// «Ricorda questo»: the capture as a source in da-leggere; the file's name.
pub fn remember(r: &Remember) -> Result<String, String> {
    let (name, body) = remember_file(r, &crate::memory::stamp())?;
    inbox_add(&name, body.as_bytes())
}

/// The inbox folder, made when missing (to drop files in).
pub fn ensure_inbox() -> Result<PathBuf, String> {
    let dir = inbox_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capture_becomes_a_source() {
        let r = Remember {
            text: "  Rossi vuole il preventivo: 3 switch entro venerdì.  ".into(),
            about: "Rossi Srl".into(),
            app: "outlook.exe".into(),
            title: "Re: preventivo".into(),
            url: String::new(),
            from: "pc".into(),
        };
        let (name, body) = remember_file(&r, "2026-10-31 18:05").unwrap();
        assert_eq!(name, "Ricorda 2026-10-31 18.05 Rossi vuole il preventivo 3 switch.md");
        assert!(body.contains("quando: 2026-10-31 18:05\nda: outlook.exe — Re: preventivo\nriguarda: Rossi Srl\n"));
        assert!(body.ends_with("Rossi vuole il preventivo: 3 switch entro venerdì.\n"));
        assert!(!body.contains("indirizzo:"));
        assert!(remember_file(&Remember { text: "   ".into(), ..Default::default() }, "x").is_err());
        let tg = Remember { text: "chiamare Bianchi".into(), from: "telegram".into(), ..Default::default() };
        assert!(remember_file(&tg, "2026-10-31 18:05").unwrap().1.contains("da: Telegram\n"));
    }

    #[test]
    fn fold_ignores_case_and_accents() {
        assert_eq!(fold("Città Perché ÀNCORA"), "citta perche ancora");
        assert!(find_nodes("   ", 5, None).is_empty());
    }

    /// The map of a memory copied from another PC: `APPDATA=<folder with EasyIsland\memoria>`
    /// `cargo test -p easyisland --lib brain::tests::live_graph -- --ignored --nocapture`
    #[test]
    fn notes_tie_by_links_and_key_words() {
        assert_eq!(wiki_links("vedi [[Clienti Easytech]] e [[Listino|prezzi]]"), vec!["Clienti Easytech".to_string(), "Listino".to_string()]);
        assert!(wiki_links("[[aperto").is_empty());
        let k = key_words("Il cliente Rossi: il dominio Active Directory è rossi.locale, 2026");
        assert!(k.contains("rossi") && k.contains("dominio") && !k.contains("2026") && !k.contains("che"));
    }

    #[test]
    #[ignore]
    fn live_graph() {
        let g = graph();
        let json = serde_json::to_string(&g).unwrap();
        println!("{} nodes, {} events, inbox {:?}, {} bytes", g.nodes.len(), g.events.len(), g.inbox, json.len());
        let alone: Vec<&str> = g.nodes.iter().filter(|n| n.weight == 0).map(|n| n.label.as_str()).collect();
        println!("{} edges, {} alone: {alone:?}", g.edges.len(), alone.len());
    }

    #[test]
    fn slugs_and_versions() {
        assert_eq!(slug("Cliente Rossi S.r.l."), "cliente-rossi-s-r-l");
        assert_eq!(slug("  Perché sì  "), "perché-sì");
        assert_eq!(slug("///"), "pagina");
        assert_eq!(version("a"), version("a"));
        assert_ne!(version("a"), version("b"));
    }

    #[test]
    fn links_with_relations() {
        let l = links_in("Lavora con [[Bianchi]] e [[Verdi|il signor Verdi]].\n- cliente di: [[Studio Neri#contatti]]\n- nota senza link: x");
        assert_eq!(l, vec![
            Link { rel: String::new(), target: "Bianchi".into(), inferred: false },
            Link { rel: String::new(), target: "Verdi".into(), inferred: false },
            Link { rel: "cliente di".into(), target: "Studio Neri".into(), inferred: false },
        ]);
        let l = links_in("- usa: [[Server]] (dedotto)\n- [[Rete]] (Dedotto) \nDa [[Mail]] (dedotto) ieri");
        assert_eq!(l.iter().map(|l| (l.rel.as_str(), l.inferred)).collect::<Vec<_>>(), vec![("usa", true), ("", true), ("", false)]);
    }

    #[test]
    fn the_field_finds_what_the_map_shows() {
        let node = |id: &str, kind: &'static str, label: &str, text: &str, weight: u32, origin: &str| Node { id: id.into(), kind, label: label.into(), date: String::new(), text: text.into(), weight, origin: origin.into() };
        let nodes = vec![
            node("n:0", "note", "Il server di Rossi è pieno", "Il server di Rossi è pieno", 1, ""),
            node("p:rossi", "page", "Rossi", "", 2, ""),
            node("lavoro|p:rossi", "page", "Rossi", "", 9, "lavoro"),
            node("lavoro|p:nas", "page", "NAS", "", 1, "lavoro"),
            node("s:mail", "source", "rossi.eml", "", 0, ""),
            node("d:1", "day", "rossi", "rossi", 0, ""),
            node("p:scritta", "missing", "Rossi due", "", 0, ""),
        ];
        let mut pages = HashMap::new();
        pages.insert("lavoro|p:nas".to_string(), page_words(&parse("nas", "# NAS\nriassunto: Quello di casa.\nalias: Synology\n\nDi Rossì, in fondo al testo.\n")));
        let found = rank_nodes(&nodes, &pages, &["rossi".to_string()], 10);
        let ids: Vec<&str> = found.iter().map(|h| h.id.as_str()).collect();
        // The names first, pages before notes and sources; the same page once; the text last.
        assert_eq!(ids, vec!["lavoro|p:rossi", "n:0", "s:mail", "lavoro|p:nas"]);
        assert_eq!(found[3].gist, "Quello di casa.");
        assert_eq!(found[0].origin, "lavoro");
        assert_eq!(rank_nodes(&nodes, &pages, &["synology".to_string()], 10)[0].id, "lavoro|p:nas");
    }

    #[test]
    fn a_node_says_whose_it_is() {
        assert_eq!(split_node("lavoro|p:rossi"), ("lavoro", "p:rossi"));
        assert_eq!(split_node("p:rossi"), ("", "p:rossi"));
        assert!(node_brief("../x|p:rossi").is_none());
    }

    #[test]
    fn a_card_has_no_text() {
        let a = parse("rossi", "# Rossi\nriassunto: Cliente storico.\nalias: RS\n\nPaga a 60 giorni.\n- usa: [[Server]] (dedotto)\n");
        let b = parse("neri", "# Neri\n\n- socio: [[Rossi]]\n");
        let card = brief_of(&a, &[a.clone(), b]);
        assert!(card.contains("Cliente storico.") && card.contains("RS"), "{card}");
        assert!(card.contains("[[Server]] (usa, dedotto)") && card.contains("Neri"), "{card}");
        assert!(!card.contains("60 giorni"), "{card}");
    }

    #[test]
    fn a_way_between_pages() {
        let all = vec![
            parse("a", "# A\nalias: Alfa\n\n- cliente di: [[B]]\n"),
            parse("b", "# B\n\nTesto.\n"),
            parse("c", "# C\n\n- usa: [[B]]\n- usa: [[D]] (dedotto)\n"),
            parse("d", "# D\n\n- [[A]] (dedotto)\n"),
            parse("e", "# E\n\nDa solo.\n"),
        ];
        let way = path_text(&all, "Alfa", "C").unwrap();
        assert!(way.contains("(passi: 2)"), "{way}");
        // Two ways as short: the written one wins.
        assert!(way.contains("[[A]] → cliente di → [[B]]") && way.contains("[[B]] ← usa ← [[C]]") && !way.contains("dedotto"), "{way}");
        let way = path_text(&all, "A", "D").unwrap();
        assert!(way.contains("[[A]] ← [[D]] (dedotto)") && way.contains("Almeno un passo"), "{way}");
        assert!(path_text(&all, "A", "E").unwrap_err().contains("Nessun collegamento"));
        assert!(path_text(&all, "A", "Z").is_err());
        assert_eq!(path_text(&all, "A", "Alfa").unwrap(), "È la stessa pagina.");
    }

    #[test]
    fn a_way_stops_after_the_last_step() {
        let mut all: Vec<Page> = (0..9).map(|i| parse(&format!("p{i}"), &format!("# P{i}\n\n- [[P{}]]\n", i + 1))).collect();
        all.push(parse("p9", "# P9\n\nFine.\n"));
        assert!(path_text(&all, "P0", "P6").is_ok());
        assert!(path_text(&all, "P0", "P7").is_err());
    }

    #[test]
    fn page_header_and_body() {
        let p = parse("rossi", "# Rossi\nfonte: mail.eml\naggiornata: 2026-10-24\n\nPaga a 60 giorni.\n- lavora con: [[Bianchi]]\n");
        assert_eq!((p.title.as_str(), p.source.as_str(), p.updated.as_str()), ("Rossi", "mail.eml", "2026-10-24"));
        assert!(p.body.starts_with("Paga"));
        assert_eq!(p.links.len(), 1);
        let bare = parse("senza-titolo", "Solo testo");
        assert_eq!(bare.title, "senza titolo");
        assert_eq!(bare.body, "Solo testo");
    }

    #[test]
    fn days_and_html() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2026-10-24").unwrap() - day_number("2026-04-24").unwrap(), 183);
        assert_eq!(file_day(std::time::UNIX_EPOCH + std::time::Duration::from_secs(86_400 * 365)), "1971-01-01");
        assert_eq!(html_text("<html><style>x{}</style><p>Ciao &amp; <b>tu</b></p><script>a()</script><div>due</div>"), "Ciao & tu\ndue");
    }

    #[test]
    fn the_check_finds_what_to_fix() {
        let today = day_number("2026-10-24").unwrap();
        let notes = vec!["- 2026-10-20: Il cliente Rossi paga a 60 giorni".to_string(), "- 2026-10-21: il cliente Rossi paga sempre a 60 giorni".to_string(), "- 2025-01-02: usa la stampante del piano terra".to_string()];
        let pages = vec![
            parse("rossi", "# Rossi\naggiornata: 2026-10-24\n\n- lavora con: [[Bianchi]]"),
            parse("verdi", "# Verdi\naggiornata: 2025-01-01\n\nniente"),
        ];
        let found = check_at(today, &notes, &pages).join("\n");
        assert!(found.contains("Note simili"), "{found}");
        assert!(found.contains("stampante"), "{found}");
        assert!(found.contains("«Bianchi», che non esiste"), "{found}");
        assert!(found.contains("isolata, senza collegamenti: «Verdi»"), "{found}");
        assert!(found.contains("da oltre 6 mesi: «Verdi»"), "{found}");
    }

    /// Two pages are tied only by what is written: a first name in both bodies
    /// is no link, and a note with that name reaches the page titled with it.
    #[test]
    fn a_name_in_two_bodies_ties_no_pages() {
        let dir = std::env::temp_dir().join(format!("easyisland-names-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pagine")).unwrap();
        for (file, text) in [
            ("claudio-lopopolo.md", "# Claudio Lopopolo\nDisco da chiarire con Diego.\n"),
            ("iaso-farmacie.md", "# Iaso Farmacie\nUtenti VPN: Betti, Diego.\n"),
            ("diego-bernardi.md", "# Diego Bernardi\nCollega.\n"),
        ] {
            std::fs::write(dir.join("pagine").join(file), text).unwrap();
        }
        std::fs::write(dir.join("MEMORIA.md"), "- 2026-11-06: Sentito Diego per le ferie\n").unwrap();
        let g = graph_in(&dir, false);
        let pages: Vec<_> = g.edges.iter().filter(|e| e.from.starts_with("p:") && e.to.starts_with("p:")).map(|e| (&e.from, &e.to)).collect();
        assert!(pages.is_empty(), "{pages:?}");
        let tied = |page: &str| g.edges.iter().any(|e| (e.from.starts_with("n:") && e.to == page) || (e.to.starts_with("n:") && e.from == page));
        assert!(tied("p:diego-bernardi") && !tied("p:iaso-farmacie"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The map's links: a common word ties nothing, a name with a capital in
    /// two notes ties them, and the AI's verdict replaces the guesses.
    #[test]
    fn links_guessed_carefully_and_judged_by_the_ai() {
        let dir = std::env::temp_dir().join(format!("easyisland-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pagine")).unwrap();
        std::fs::write(dir.join("pagine").join("server-proxmox.md"), "# Server Proxmox
Due dischi in RAID1.
").unwrap();
        std::fs::write(dir.join("pagine").join("studio-rossi.md"), "# Studio Rossi
Commercialisti.
").unwrap();
        let notes = [
            "Il server della stampante è lento",
            "Riavviato il server di casa",
            "Il server della posta va aggiornato",
            "Aggiornato il server delle foto",
            "Spento il server vecchio",
            "Chiamato Bianchini per il preventivo",
            "Bianchini paga a fine mese",
        ];
        let memoria: String = notes.iter().map(|n| format!("- 2026-11-01: {n}
")).collect();
        std::fs::write(dir.join("MEMORIA.md"), memoria).unwrap();
        let g = graph_in(&dir, false);
        let id_of = |text: &str| g.nodes.iter().find(|n| n.text == text).map(|n| n.id.clone()).unwrap();
        let linked = |a: &str, b: &str| g.edges.iter().any(|e| (e.from == a && e.to == b) || (e.from == b && e.to == a));
        let printer = id_of(notes[0]);
        assert!(!linked(&printer, "p:server-proxmox"), "a common word ties nothing: {:?}", g.edges.iter().map(|e| (&e.from, &e.to)).collect::<Vec<_>>());
        let (b1, b2) = (id_of(notes[5]), id_of(notes[6]));
        assert!(linked(&b1, &b2), "a name with a capital ties two notes");
        // The AI says the printer's server is the Proxmox one: a sure link, the guesses gone.
        let verdicts = format!("{{\"version\":1,\"notes\":{{\"{}\":{{\"pages\":[\"server-proxmox\"],\"notes\":[]}}}}}}", note_hash(notes[0]));
        std::fs::write(dir.join(crate::memory_links::FILE), verdicts).unwrap();
        let g = graph_in(&dir, false);
        let printer = g.nodes.iter().find(|n| n.text == notes[0]).unwrap().id.clone();
        let e = g.edges.iter().find(|e| e.from == printer && e.to == "p:server-proxmox").expect("the AI's link");
        assert_eq!(e.strength, 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Pages, safe writes, the inbox and the search on a temporary %APPDATA%.
    #[test]
    fn pages_inbox_and_search() {
        let _lock = crate::memory::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let temp = std::env::temp_dir().join(format!("easyisland-brain-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::env::set_var("APPDATA", &temp);
        let saved = tool_write("Rossi", "# Rossi\nPaga a 60 giorni.\n- lavora con: [[Bianchi]]", "", "mail.eml").unwrap();
        assert!(saved.contains("Bianchi"), "{saved}");
        // Again without the version, or with an old one: refused.
        assert!(tool_write("rossi", "altro", "", "").is_err());
        let read = tool_read("Rossi").unwrap();
        let v = read.lines().find_map(|l| l.strip_prefix("versione: ")).unwrap().to_string();
        assert!(tool_write("Rossi", "altro", "0000", "").is_err());
        // The user edits it after the read: the version no longer matches.
        let file = page_file("rossi");
        std::fs::write(&file, std::fs::read_to_string(&file).unwrap() + "Nota a mano.\n").unwrap();
        assert!(tool_write("Rossi", "Paga a 30 giorni.", &v, "").unwrap_err().contains("cambiata"));
        let v2 = tool_read("Rossi").unwrap().lines().find_map(|l| l.strip_prefix("versione: ")).unwrap().to_string();
        tool_write("Rossi", "Paga a 30 giorni.\n- lavora con: [[Bianchi]]\nNota a mano.", &v2, "telefonata.txt").unwrap();
        tool_write("Bianchi", "riassunto: Il commercialista di Rossi.\nalias: Studio Bianchi, Dott. Bianchi\nCommercialista.", "", "").unwrap();
        assert!(tool_read("Rossi").unwrap().contains("fonte: mail.eml, telefonata.txt"));
        assert!(tool_read("Bianchi").unwrap().contains("collegata da: Rossi"));
        let words = vec!["giorni".to_string()];
        let hits = search(&words, 10);
        assert!(hits[0].contains("[[Rossi]]"), "{hits:?}");
        assert!(hits.iter().any(|h| h.starts_with("↳ [[Bianchi]] (lavora con) Il commercialista di Rossi.")), "{hits:?}");
        // By an alias, summary first; a rewrite without the lines keeps them; a link to an alias reaches the page.
        let hits = search(&["dott.".to_string()], 10);
        assert!(hits[0].starts_with("[[Bianchi]] riassunto: Il commercialista"), "{hits:?}");
        let vb = tool_read("Bianchi").unwrap().lines().find_map(|l| l.strip_prefix("versione: ")).unwrap().to_string();
        tool_write("Bianchi", "Commercialista, a Torino.", &vb, "").unwrap();
        let b = tool_read("Studio Bianchi").unwrap();
        assert!(b.contains("riassunto: Il commercialista di Rossi.\nalias: Studio Bianchi, Dott. Bianchi\n\nCommercialista, a Torino."), "{b}");
        tool_write("Verdi", "- cliente di: [[Studio Bianchi]]", "", "").unwrap();
        assert!(tool_read("Bianchi").unwrap().contains("collegata da: Rossi, Verdi"));
        assert!(!check().iter().any(|c| c.contains("Studio Bianchi")), "{:?}", check());
        // Two links away: Rossi → Bianchi → Torino (named relation), not → Varie (plain link).
        let vb = tool_read("Bianchi").unwrap().lines().find_map(|l| l.strip_prefix("versione: ")).unwrap().to_string();
        tool_write("Bianchi", "Commercialista.\n- sede: [[Torino]]\n[[Varie]]", &vb, "").unwrap();
        tool_write("Torino", "riassunto: La città.\nCittà.", "", "").unwrap();
        tool_write("Varie", "Altro.", "", "").unwrap();
        let hits = search(&["giorni".to_string()], 10);
        assert!(hits.iter().any(|h| h == "↳ [[Bianchi]] → [[Torino]] (sede) La città."), "{hits:?}");
        assert!(!hits.iter().any(|h| h.contains("[[Varie]]")), "{hits:?}");
        // The inbox: read, then moved to fonti.
        let inbox = ensure_inbox().unwrap();
        std::fs::write(inbox.join("articolo.html"), "<p>Il nuovo server</p>").unwrap();
        std::fs::write(inbox.join("scansione.pdf"), [0u8, 1, 2]).unwrap();
        let read = tool_inbox("").unwrap();
        assert!(read.contains("Il nuovo server") && read.contains("scansione.pdf"), "{read}");
        assert!(tool_inbox("scansione.pdf").unwrap().contains("Non è un file PDF"));
        assert!(tool_inbox("../x").is_err());
        tool_inbox_done("articolo.html").unwrap();
        assert!(sources_dir().join("articolo.html").exists());
        assert_eq!(inbox_files().len(), 1);
        // The window's data.
        let g = graph();
        assert!(g.nodes.iter().any(|n| n.id == "p:rossi" && n.weight >= 2));
        assert!(g.edges.iter().any(|e| e.from == "p:rossi" && e.to == "p:bianchi" && e.label == "lavora con"));
        assert!(g.events.iter().any(|e| e.lane == "source" && e.text == "articolo.html"));
        // A dropped file: into da-leggere, the same name twice numbered, no paths.
        assert_eq!(inbox_add("nota.txt", b"ciao").unwrap(), "nota.txt");
        assert_eq!(inbox_add("nota.txt", b"ciao").unwrap(), "nota (2).txt");
        assert_eq!(inbox_add("..\\x/y.md", b"z").unwrap(), "_x_y.md");
        // Forget: the page goes to the archive.
        tool_forget("", "Bianchi").unwrap();
        assert!(archive_dir().join("pagine").join("bianchi.md").exists());
        assert!(tool_read("Bianchi").is_err());
        let _ = std::fs::remove_dir_all(&temp);
    }
}
