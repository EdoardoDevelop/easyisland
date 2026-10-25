// The memory as a second brain (asked by Edoardo on 24 October 2026): next to
// MEMORIA.md and the diary (memory.rs), still plain Markdown the user reads
// and edits, in %APPDATA%\EasyIsland\memoria:
//
// - `pagine/<nome>.md`: one page per subject (a person, a customer, a project,
//   a concept), linked to the others with [[Titolo]]; a line
//   "- relazione: [[Altra]]" names how two pages are related (the concept map).
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

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

use serde::Serialize;

use crate::i18n::{t, tf};

/// A page, at most (characters).
const MAX_PAGE: usize = 20_000;
/// A source given to the agent, at most (characters).
const MAX_SOURCE: usize = 30_000;
/// Files read as text from da-leggere.
const READABLE: &[&str] = &["md", "txt", "csv", "json", "html", "htm", "eml", "log", "xml", "yaml", "yml", "ini"];
/// Notes or pages untouched for longer are "old" in the check.
const OLD_DAYS: i64 = 180;
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
}

#[derive(Debug, Clone)]
pub struct Page {
    pub slug: String,
    pub title: String,
    pub source: String,
    pub updated: String,
    /// The text under the header.
    pub body: String,
    pub links: Vec<Link>,
}

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
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let after = rest.get(start + 2..).unwrap_or_default();
            let Some(end) = after.find("]]") else { break };
            let inner = after.get(..end).unwrap_or_default();
            // [[Titolo|testo mostrato]] and [[Titolo#sezione]] point at Titolo.
            let target = inner.split(['|', '#']).next().unwrap_or_default().trim();
            if !target.is_empty() && target.chars().count() <= 120 {
                let link = Link { rel: rel.clone(), target: target.to_string() };
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
    Page { slug: slug.to_string(), title, source, updated, body, links }
}

fn page_file(slug: &str) -> PathBuf {
    pages_dir().join(format!("{slug}.md"))
}

/// Every page, by title.
pub fn pages() -> Vec<Page> {
    let mut out: Vec<Page> = std::fs::read_dir(pages_dir())
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
    let page = pages().into_iter().find(|p| p.title.to_lowercase() == low)?;
    let text = std::fs::read_to_string(page_file(&page.slug)).ok()?;
    Some((page, text))
}

/// Pages that link to `title`.
fn backlinks(title: &str, all: &[Page]) -> Vec<String> {
    let key = slug(title);
    all.iter().filter(|p| p.links.iter().any(|l| slug(&l.target) == key)).map(|p| p.title.clone()).collect()
}

/// Words of a text for comparing two notes or titles.
fn words(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.chars().count() > 2)
        .collect()
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
    let Some((page, text)) = find(title) else {
        let want = words(title);
        let near: Vec<String> = all.iter().filter(|p| similarity(&want, &words(&p.title)) > 0.3 || p.title.to_lowercase().contains(&title.trim().to_lowercase())).map(|p| p.title.clone()).take(8).collect();
        return Err(if near.is_empty() {
            tf("Nessuna pagina «{t}»: puoi crearla con memory_page_write.", &[("t", &title.trim().to_string())])
        } else {
            tf("Nessuna pagina «{t}». Simili: {near}", &[("t", &title.trim().to_string()), ("near", &near.join(", "))])
        });
    };
    let back = backlinks(&page.title, &all);
    let mut out = format!("{}\n\n---\n{}: {}", text.trim_end(), t("versione"), version(&text));
    if !back.is_empty() {
        out.push_str(&format!("\n{}: {}", t("collegata da"), back.join(", ")));
    }
    Ok(out)
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
    if body.is_empty() {
        return Err(t("text: il testo della pagina.").into());
    }
    let body: String = body.chars().take(MAX_PAGE).collect();
    let existing = find(&title);
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
    out.push_str(&format!("aggiornata: {day}\n\n{body}\n"));
    std::fs::create_dir_all(pages_dir()).map_err(|e| e.to_string())?;
    crate::memory::write_whole(&page_file(&name), &out)?;
    let all = pages();
    let missing: Vec<String> = links_in(&body).into_iter().map(|l| l.target).filter(|t| !all.iter().any(|p| p.slug == slug(t))).collect();
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
fn html_text(html: &str) -> String {
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
        let raw = std::fs::read(&f.path).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&raw).into_owned();
        let ext = f.path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        let text = if ext == "html" || ext == "htm" { html_text(&text) } else { text };
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
fn day_number(date: &str) -> Option<i64> {
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
            let s = slug(&l.target);
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

/// memory_search in the pages: their lines with every word, then a line of
/// each page they link to (the links followed one step).
pub fn search(words: &[String], max: usize) -> Vec<String> {
    let all = pages();
    let mut found = Vec::new();
    let mut hit_pages: Vec<&Page> = Vec::new();
    for p in &all {
        let title_low = p.title.to_lowercase();
        let mut hit = false;
        for line in p.body.lines().filter(|l| !l.trim().is_empty()) {
            let low = format!("{title_low} {}", line.to_lowercase());
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
    for p in &hit_pages {
        for l in &p.links {
            let s = slug(&l.target);
            if !seen.insert(s.clone()) {
                continue;
            }
            if let Some(q) = all.iter().find(|q| q.slug == s) {
                let first = q.body.lines().find(|l| !l.trim().is_empty()).unwrap_or_default().trim();
                let rel = if l.rel.is_empty() { String::new() } else { format!(" ({})", l.rel) };
                related.push(format!("↳ [[{}]]{rel} {}", q.title, first.chars().take(200).collect::<String>()));
            }
        }
    }
    found.extend(related.into_iter().take(max));
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub label: String,
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

/// Everything the memory window draws.
pub fn graph() -> Graph {
    let all = pages();
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
        nodes.push(Node { id: id.clone(), kind: "page", label: p.title.clone(), date: p.updated.clone(), text: cut(&p.body, 1_200), weight: 0 });
        if !p.updated.is_empty() {
            events.push(Event { date: p.updated.clone(), lane: "page", text: p.title.clone(), node: id.clone() });
        }
        for l in &p.links {
            let to = format!("p:{}", slug(&l.target));
            if !page_ids.contains(&to) && ids.insert(to.clone()) {
                nodes.push(Node { id: to.clone(), kind: "missing", label: l.target.clone(), date: String::new(), text: String::new(), weight: 0 });
            }
            add_edge(&mut edges, &mut seen, &mut degree, id.clone(), to, l.rel.clone());
        }
        for s in p.source.split(", ").map(str::trim).filter(|s| !s.is_empty()) {
            let sid = format!("s:{}", s.to_lowercase());
            if ids.insert(sid.clone()) {
                nodes.push(Node { id: sid.clone(), kind: "source", label: s.to_string(), date: String::new(), text: String::new(), weight: 0 });
            }
            add_edge(&mut edges, &mut seen, &mut degree, id.clone(), sid, t("fonte").into());
        }
    }
    // The sources read, with when they were moved.
    if let Ok(r) = std::fs::read_dir(sources_dir()) {
        for e in r.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let sid = format!("s:{}", name.to_lowercase());
            let date = e.metadata().ok().and_then(|m| m.modified().ok()).map(file_day).unwrap_or_default();
            if !date.is_empty() {
                events.push(Event { date: date.clone(), lane: "source", text: name.clone(), node: sid.clone() });
            }
            if ids.insert(sid.clone()) {
                nodes.push(Node { id: sid, kind: "source", label: name, date, text: String::new(), weight: 0 });
            } else if let Some(n) = nodes.iter_mut().find(|n| n.id == sid) {
                n.date = date;
            }
        }
    }
    // Notes: those in MEMORIA.md and the archived ones, linked to the pages they name.
    let archived: Vec<String> = std::fs::read_to_string(crate::memory::dir().join("archivio.md"))
        .map(|t| t.lines().filter(|l| l.starts_with("- ")).map(str::to_string).collect())
        .unwrap_or_default();
    let current = crate::memory::notes();
    for (i, (line, kind)) in current.iter().map(|l| (l, "note")).chain(archived.iter().rev().take(300).map(|l| (l, "old"))).enumerate() {
        let (date, text) = note_parts(line);
        let id = format!("n:{i}");
        let low = text.to_lowercase();
        for (slug, title) in &titles {
            if low.contains(title.as_str()) {
                add_edge(&mut edges, &mut seen, &mut degree, id.clone(), format!("p:{slug}"), String::new());
            }
        }
        if !date.is_empty() {
            events.push(Event { date: date.clone(), lane: "note", text: cut(&text, 160), node: id.clone() });
        }
        nodes.push(Node { id, kind, label: cut(&text, 60), date, text: text.clone(), weight: 0 });
    }
    // The diary: one event per line; one node per day of the last 60 that
    // names a page.
    let mut months: Vec<PathBuf> = std::fs::read_dir(crate::memory::dir().join("diario"))
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
        nodes.push(Node { id, kind: "day", label: day.clone(), date: day, text: tf("{n} domande alla chat", &[("n", &count.to_string())]), weight: 0 });
    }
    for n in &mut nodes {
        n.weight = degree.get(&n.id).copied().unwrap_or(0);
    }
    events.sort_by(|a, b| a.date.cmp(&b.date));
    Graph {
        nodes,
        edges,
        events,
        check: check(),
        inbox: inbox_files().into_iter().map(|f| f.name).collect(),
        folder: crate::memory::dir().to_string_lossy().into_owned(),
    }
}

fn add_edge(edges: &mut Vec<Edge>, seen: &mut HashSet<(String, String)>, degree: &mut HashMap<String, u32>, from: String, to: String, label: String) {
    if from == to || !seen.insert((from.clone(), to.clone())) {
        return;
    }
    *degree.entry(from.clone()).or_default() += 1;
    *degree.entry(to.clone()).or_default() += 1;
    edges.push(Edge { from, to, label });
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
            Link { rel: String::new(), target: "Bianchi".into() },
            Link { rel: String::new(), target: "Verdi".into() },
            Link { rel: "cliente di".into(), target: "Studio Neri".into() },
        ]);
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
        tool_write("Bianchi", "Commercialista.", "", "").unwrap();
        assert!(tool_read("Rossi").unwrap().contains("fonte: mail.eml, telefonata.txt"));
        assert!(tool_read("Bianchi").unwrap().contains("collegata da: Rossi"));
        let words = vec!["giorni".to_string()];
        let hits = search(&words, 10);
        assert!(hits[0].contains("[[Rossi]]"), "{hits:?}");
        assert!(hits.iter().any(|h| h.starts_with("↳ [[Bianchi]] (lavora con) Commercialista")), "{hits:?}");
        // The inbox: read, then moved to fonti.
        let inbox = ensure_inbox().unwrap();
        std::fs::write(inbox.join("articolo.html"), "<p>Il nuovo server</p>").unwrap();
        std::fs::write(inbox.join("scansione.pdf"), [0u8, 1, 2]).unwrap();
        let read = tool_inbox("").unwrap();
        assert!(read.contains("Il nuovo server") && read.contains("scansione.pdf"), "{read}");
        assert!(tool_inbox("scansione.pdf").unwrap().contains("Non è un file di testo"));
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
