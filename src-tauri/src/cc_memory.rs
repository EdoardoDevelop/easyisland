//! The memory Claude Code keeps by itself (its "auto memory", 9 November 2026,
//! Edoardo: «far vedere a EasyIsland anche la memoria interna di Claude Code»):
//! `<config>/projects/<folder>/memory/*.md`, one fact per file with a front
//! matter (name, description, type), MEMORY.md as its index. Every Claude Code
//! account on this PC is read (`~/.claude`, `~/.claude-*`, CLAUDE_CONFIG_DIR).
//!
//! Read only: those files are Claude Code's and nothing here writes them.
//! They are a source of their own («Claude Code» in the memory window, origin
//! [`ORIGIN`]), never copied into EasyIsland's memory (copies would drift
//! apart): memory_search and the field at the top find them, memory_page
//! opens one. Lines that look like a secret are hidden (redact.rs), as in
//! the rest of the memory. Off with «Memoria di Claude Code» in Impostazioni.
//!
//! A note that says what EasyIsland's memory already says (Claude Code may
//! save there too) is left out of memory_search, and in the map it is a line
//! to that note instead of a node of its own ([`twin`]). Every note carries its
//! date: the engine weighs an old one, and EasyIsland's memory wins. The files
//! are read again only when one changes ([`notes`]).

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

use crate::brain::{fold, key_words, similarity, Edge, Event, Graph, Node};
use crate::i18n::{t, tf};

/// The origin of its nodes in the memory window ("claude-code|…").
pub const ORIGIN: &str = "claude-code";
/// Files read in all (Claude Code keeps a few dozen).
const MAX_FILES: usize = 600;
/// A note larger than this is not one of Claude Code's.
const MAX_BYTES: u64 = 64 * 1024;
/// The preface's length at most.
const MAX_PREFACE: usize = 2_500;

static ON: AtomicBool = AtomicBool::new(true);

/// The files as last read (path, time, size) and their notes.
type Stamp = Vec<(PathBuf, SystemTime, u64)>;
static CACHE: Mutex<Option<(Stamp, Vec<Note>)>> = Mutex::new(None);
/// project_label by folder: finding the real folder walks the disk.
static LABELS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// From the settings (`memory_claude_code`).
pub fn set_on(on: bool) {
    ON.store(on, Ordering::Relaxed);
}

pub fn on() -> bool {
    ON.load(Ordering::Relaxed)
}

#[derive(Clone, Debug)]
pub struct Note {
    /// "claude" for `~/.claude`, "account-easytech" for `~/.claude-account-easytech`.
    pub account: String,
    /// The project's folder as Claude Code names it ("C--Users-Edoardo").
    pub folder: String,
    pub name: String,
    pub description: String,
    /// user, feedback, project, reference (or empty).
    pub kind: String,
    pub body: String,
    pub day: String,
    pub path: PathBuf,
}

impl Note {
    fn id(&self) -> String {
        format!("{ORIGIN}|n:{}/{}/{}", self.account, self.folder, crate::brain::slug(&self.name))
    }

    fn project_id(&self) -> String {
        format!("{ORIGIN}|s:{}/{}", self.account, self.folder)
    }

    /// Where it comes from, in words: "Claude Code · WORK\EasyIsland (account-easytech)".
    pub fn place(&self) -> String {
        let project = project_label(&self.folder);
        if self.account == "claude" {
            format!("Claude Code · {project}")
        } else {
            format!("Claude Code · {project} ({})", self.account)
        }
    }
}

/// The configuration folders of Claude Code on this PC.
fn roots() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(d) = crate::claude_cli::claude_dir() {
        out.push(d);
    }
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        out.push(home.join(".claude"));
        if let Ok(r) = std::fs::read_dir(&home) {
            for e in r.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with(".claude-") && e.path().join("projects").is_dir() {
                    out.push(e.path());
                }
            }
        }
    }
    let mut seen = BTreeSet::new();
    out.retain(|p| p.join("projects").is_dir() && seen.insert(p.to_string_lossy().to_lowercase()));
    out
}

fn account_of(root: &Path) -> String {
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    match name.strip_prefix(".claude-") {
        Some(rest) if !rest.is_empty() => rest.to_string(),
        _ => "claude".into(),
    }
}

/// "C--Users-Edoardo-WORK-EasyIsland" → "WORK\EasyIsland": the folder Claude
/// Code made from the path (its "-" were "\", ":" or "-": only a guess), without
/// the user's own folder.
pub fn project_label(folder: &str) -> String {
    if let Some(known) = LABELS.lock().ok().and_then(|l| l.as_ref().and_then(|m| m.get(folder).cloned())) {
        return known;
    }
    let label = label_of(folder);
    if let Ok(mut l) = LABELS.lock() {
        l.get_or_insert_with(HashMap::new).insert(folder.to_string(), label.clone());
    }
    label
}

fn label_of(folder: &str) -> String {
    if let Some(real) = real_path(folder) {
        let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
        return match real.strip_prefix(&home) {
            Ok(rest) if rest.as_os_str().is_empty() => t("cartella utente").to_string(),
            Ok(rest) => rest.to_string_lossy().into_owned(),
            Err(_) => real.to_string_lossy().into_owned(),
        };
    }
    let parts: Vec<&str> = folder.split('-').filter(|s| !s.is_empty()).collect();
    let user = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
    let start = parts.iter().position(|p| !user.is_empty() && p.to_lowercase() == user).map(|i| i + 1).unwrap_or(0);
    let rest = parts.get(start..).unwrap_or_default();
    if rest.is_empty() {
        t("cartella utente").to_string()
    } else {
        rest.join("\\")
    }
}

/// The folder on disk Claude Code's name stands for: it wrote every character
/// that is not a letter or a digit as "-", so each step looks for the child
/// whose name, written the same way, matches the most of what is left.
fn real_path(folder: &str) -> Option<PathBuf> {
    let (drive, rest) = folder.split_once("--")?;
    if drive.len() != 1 || !drive.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mangle = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().to_lowercase();
    let mut path = PathBuf::from(format!("{drive}:\\"));
    let mut left = rest.to_lowercase();
    while !left.is_empty() {
        let best = std::fs::read_dir(&path)
            .ok()?
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| {
                let m = mangle(name);
                left == m || left.starts_with(&format!("{m}-"))
            })
            .max_by_key(String::len)?;
        left = left.get(mangle(&best).len()..).unwrap_or_default().trim_start_matches('-').to_string();
        path.push(best);
    }
    Some(path)
}

/// name, description, type and the text of a note; the front matter may keep
/// `type` under `metadata:`.
fn parse(text: &str) -> (String, String, String, String) {
    let (mut name, mut description, mut kind) = (String::new(), String::new(), String::new());
    let mut body = text;
    if let Some(rest) = text.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let head = rest.get(..end).unwrap_or_default();
            body = rest.get(end + 4..).unwrap_or_default();
            for line in head.lines() {
                let Some((k, v)) = line.trim().split_once(':') else { continue };
                let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                match k.trim() {
                    "name" => name = v,
                    "description" => description = v,
                    "type" => kind = v,
                    _ => {}
                }
            }
        }
    }
    (name, description, kind, body.trim().to_string())
}

/// A note's file, before reading it.
struct File {
    account: String,
    folder: String,
    path: PathBuf,
    modified: SystemTime,
    len: u64,
}

/// The note files of every account (a listing: no file is read).
fn files() -> Vec<File> {
    let mut out = Vec::new();
    for root in roots() {
        let account = account_of(&root);
        let Ok(projects) = std::fs::read_dir(root.join("projects")) else { continue };
        for p in projects.flatten() {
            let Ok(entries) = std::fs::read_dir(p.path().join("memory")) else { continue };
            let folder = p.file_name().to_string_lossy().into_owned();
            for e in entries.flatten() {
                let file = e.file_name().to_string_lossy().into_owned();
                if !file.ends_with(".md") || file.eq_ignore_ascii_case("MEMORY.md") {
                    continue;
                }
                let Ok(meta) = e.metadata() else { continue };
                if meta.len() > MAX_BYTES {
                    continue;
                }
                if out.len() >= MAX_FILES {
                    return out;
                }
                out.push(File { account: account.clone(), folder: folder.clone(), path: e.path(), modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), len: meta.len() });
            }
        }
    }
    out
}

/// Every note of every account, newest first. Read again only when a file is
/// added, removed or changed: search, map and the field at the top ask often.
pub fn notes() -> Vec<Note> {
    if !on() {
        return Vec::new();
    }
    let files = files();
    let stamp: Stamp = files.iter().map(|f| (f.path.clone(), f.modified, f.len)).collect();
    if let Some(known) = CACHE.lock().ok().and_then(|c| c.as_ref().filter(|(s, _)| *s == stamp).map(|(_, n)| n.clone())) {
        return known;
    }
    let mut out = Vec::new();
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f.path) else { continue };
        let (name, description, kind, body) = parse(&text);
        let name = if name.is_empty() { f.path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() } else { name };
        out.push(Note {
            account: f.account,
            folder: f.folder,
            name,
            description: crate::redact::redact(&description),
            kind,
            body: crate::redact::redact(&body),
            day: crate::brain::file_day(f.modified),
            path: f.path,
        });
    }
    out.sort_by(|a, b| b.day.cmp(&a.day).then(a.name.cmp(&b.name)));
    if let Ok(mut c) = CACHE.lock() {
        *c = Some((stamp, out.clone()));
    }
    out
}

/// What a note says in short: its description, else its first line.
fn about(n: &Note) -> String {
    if n.description.is_empty() {
        first_line(&n.body)
    } else {
        n.description.clone()
    }
}

/// A note's name as words ("no-ssh-config" → "no ssh config").
fn name_words(n: &Note) -> String {
    n.name.replace(['-', '_'], " ")
}

/// Two texts saying the same thing: at least three key words in common, and
/// most of them shared (or most of the shorter one's).
fn same(a: &BTreeSet<String>, b: &BTreeSet<String>) -> bool {
    let common = a.intersection(b).count();
    if common < 3 {
        return false;
    }
    similarity(a, b) >= 0.5 || common as f32 / a.len().min(b.len()) as f32 >= 0.8
}

/// EasyIsland's memory as [`twin`] reads it: (id, text of a note or title of
/// a page, is a page, key words of a note).
type Local = Vec<(String, String, bool, BTreeSet<String>)>;

fn local(rows: impl Iterator<Item = (String, String, bool)>) -> Local {
    rows.map(|(id, text, page)| {
        let words = if page { BTreeSet::new() } else { key_words(&text) };
        (id, text, page, words)
    })
    .collect()
}

/// This PC's notes of MEMORIA.md and titles of its pages (memory_search).
fn local_memory() -> Local {
    let notes = crate::memory::notes_of(&crate::memory::read_main()).into_iter().map(|l| (String::new(), crate::brain::note_parts(&l).1, false));
    let pages = crate::brain::pages().into_iter().map(|p| (String::new(), p.title, true));
    local(notes.chain(pages))
}

/// The note or page of EasyIsland's memory a note of Claude Code repeats: a
/// note saying the same, or a page with the note's very name.
fn twin<'a>(n: &Note, mine: &'a Local) -> Option<&'a str> {
    let words = key_words(&format!("{} {}", name_words(n), about(n)));
    let name = fold(&name_words(n));
    mine.iter().find(|(_, text, page, w)| if *page { fold(text) == name } else { same(&words, w) }).map(|(id, ..)| id.as_str())
}

/// In front of a new conversation: how the user wants to be worked with, as
/// Claude Code learnt it (notes of type user or feedback). Only those of the
/// user's own folder, the general ones: a project's stay with memory_search.
pub fn preface() -> Option<String> {
    let mut lines = Vec::new();
    let mut size = 0;
    for n in notes().into_iter().filter(|n| matches!(n.kind.as_str(), "user" | "feedback") && project_label(&n.folder) == t("cartella utente")) {
        let line = format!("- {} ({}): {}", n.name, n.day, about(&n));
        size += line.chars().count();
        if size > MAX_PREFACE {
            break;
        }
        lines.push(line);
    }
    if lines.is_empty() {
        return None;
    }
    let head = t("[Indicazioni dell'utente che Claude Code ha imparato (la sua memoria, si legge soltanto; il testo intero con memory_page e il titolo):");
    Some(format!("{head}\n{}]\n\n", lines.join("\n")))
}

/// memory_search: the notes with every word, one line each with place and
/// date; those EasyIsland's memory already says are left out.
pub fn search(words: &[String], max: usize) -> Vec<String> {
    let words: Vec<String> = words.iter().map(|w| fold(w)).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let found: Vec<Note> = notes()
        .into_iter()
        .filter(|n| {
            let all = fold(&format!("{} {} {}", n.name, n.description, n.body));
            words.iter().all(|w| all.contains(w.as_str()))
        })
        .collect();
    if found.is_empty() {
        return Vec::new();
    }
    let mine = local_memory();
    found.into_iter().filter(|n| twin(n, &mine).is_none()).take(max).map(|n| format!("[{}, {}] {}: {}", n.place(), n.day, n.name, about(&n))).collect()
}

fn first_line(text: &str) -> String {
    text.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).unwrap_or_default().chars().take(200).collect()
}

/// memory_page for a note of Claude Code: its whole text.
pub fn page(title: &str) -> Option<String> {
    let want = fold(title.trim());
    let n = notes().into_iter().find(|n| fold(&n.name) == want)?;
    Some(format!(
        "{}\n\n# {}\n{}\n\n{}",
        tf(
            "(Nota della memoria di Claude Code, {place}, del {day}: si legge soltanto, la scrive Claude Code. Se contraddice la memoria di EasyIsland, vale quella.)",
            &[("place", &n.place()), ("day", &n.day)]
        ),
        n.name,
        n.description,
        n.body
    ))
}

/// «Apri il file» in the memory window: a note's file, or a project's memory folder.
pub fn file_of(id: &str) -> Option<PathBuf> {
    notes().into_iter().find_map(|n| {
        if n.id() == id {
            Some(n.path.clone())
        } else if n.project_id() == id {
            n.path.parent().map(Path::to_path_buf)
        } else {
            None
        }
    })
}

/// The notes for the memory window: one node each, one per project they come
/// from, the [[links]] between them and, given this PC's map (`local`), the
/// pages each one names. A note EasyIsland's memory already says is no node
/// of its own: its project gets a line to that note or page instead.
pub fn graph(local_map: &[Node]) -> Graph {
    let all = notes();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut events = Vec::new();
    let mut projects: BTreeSet<String> = BTreeSet::new();
    let mine = local(
        local_map
            .iter()
            .filter(|n| n.origin.is_empty() && matches!(n.kind, "note" | "page"))
            .map(|n| (n.id.clone(), if n.kind == "page" { n.label.clone() } else { n.text.clone() }, n.kind == "page")),
    );
    let titles: Vec<(&String, String)> = mine.iter().filter(|(_, _, page, _)| *page).map(|(id, title, ..)| (id, fold(title))).filter(|(_, t)| t.chars().count() >= 4).collect();
    let mut drawn: HashMap<(String, String), String> = HashMap::new();
    for n in &all {
        if projects.insert(n.project_id()) {
            nodes.push(Node { id: n.project_id(), kind: "source", label: n.place(), date: String::new(), text: String::new(), weight: 0, origin: ORIGIN.into() });
        }
        if let Some(to) = twin(n, &mine) {
            edges.push(Edge { from: n.project_id(), to: to.to_string(), label: t("anche in Claude Code").into(), strength: 2 });
            continue;
        }
        let id = n.id();
        drawn.insert((n.project_id(), fold(&n.name)), id.clone());
        let text = format!("{}\n{}", n.description, n.body);
        nodes.push(Node { id: id.clone(), kind: "note", label: n.name.clone(), date: n.day.clone(), text: crate::brain::cut(&text, 1_200), weight: 0, origin: ORIGIN.into() });
        edges.push(Edge { from: id.clone(), to: n.project_id(), label: t("da").into(), strength: 2 });
        events.push(Event { date: n.day.clone(), lane: "note", text: format!("Claude Code: {}", n.name), node: id.clone() });
        let low = fold(&text);
        for (page, title) in &titles {
            if names(&low, title) {
                edges.push(Edge { from: id.clone(), to: (*page).clone(), label: String::new(), strength: 2 });
            }
        }
    }
    // [[links]] between the notes drawn.
    for n in &all {
        let Some(from) = drawn.get(&(n.project_id(), fold(&n.name))) else { continue };
        for target in wiki_links(&n.body) {
            if let Some(to) = drawn.get(&(n.project_id(), fold(&target))) {
                if to != from {
                    edges.push(Edge { from: from.clone(), to: to.clone(), label: String::new(), strength: 3 });
                }
            }
        }
    }
    Graph { nodes, edges, events, check: Vec::new(), inbox: Vec::new(), folder: String::new(), sources: Vec::new() }
}

/// "[[a]] e [[b]]" → ["a", "b"].
fn wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        let after = rest.get(i + 2..).unwrap_or_default();
        let Some(j) = after.find("]]") else { break };
        let inner = after.get(..j).unwrap_or_default();
        let target = inner.split('|').next().unwrap_or_default().trim();
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = after.get(j + 2..).unwrap_or_default();
    }
    out
}

/// `title` in `text` as whole words (both already folded).
fn names(text: &str, title: &str) -> bool {
    let word = |c: Option<char>| c.is_some_and(char::is_alphanumeric);
    text.match_indices(title).any(|(i, m)| !word(text.get(..i).and_then(|s| s.chars().last())) && !word(text.get(i + m.len()..).and_then(|s| s.chars().next())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_is_read_with_type_under_metadata() {
        let (name, description, kind, body) = parse("---\nname: no-ssh\ndescription: configurare dall'interfaccia\nmetadata:\n  type: feedback\n---\n\nMai via SSH.\n**Why:** altri useranno il programma.\n");
        assert_eq!((name.as_str(), description.as_str(), kind.as_str()), ("no-ssh", "configurare dall'interfaccia", "feedback"));
        assert!(body.starts_with("Mai via SSH."));
        let (name, _, _, body) = parse("Solo testo, senza intestazione.");
        assert!(name.is_empty());
        assert_eq!(body, "Solo testo, senza intestazione.");
    }

    #[test]
    fn links_and_names_are_found() {
        assert_eq!(wiki_links("vedi [[a-b]] e [[Studio Rossi|Rossi]], non [[ ]]"), vec!["a-b", "Studio Rossi"]);
        assert!(names("il cliente studio rossi paga", "studio rossi"));
        assert!(!names("gli studi rossiccio", "rossi"));
    }

    fn note(name: &str, description: &str) -> Note {
        Note { account: "claude".into(), folder: "C--x".into(), name: name.into(), description: description.into(), kind: "feedback".into(), body: String::new(), day: "2026-11-01".into(), path: PathBuf::new() }
    }

    #[test]
    fn a_note_easyisland_already_has_is_its_twin() {
        let mine = local(
            [
                ("n:0".to_string(), "Le configurazioni si fanno dall'interfaccia del programma, mai via SSH: lo useranno altri tecnici".to_string(), false),
                ("n:1".to_string(), "Farmacia Falchi: resta solo il job di backup verso il NAS".to_string(), false),
                ("p:lavoro".to_string(), "Lavoro".to_string(), true),
            ]
            .into_iter(),
        );
        assert_eq!(twin(&note("no-ssh", "configurazioni dall'interfaccia del programma, mai SSH"), &mine), Some("n:0"));
        assert_eq!(twin(&note("lavoro", "il lavoro di Edoardo"), &mine), Some("p:lavoro"));
        assert_eq!(twin(&note("npm-pack", "lanciare npm run pack in background"), &mine), None);
        // Two words in common are not the same thing.
        assert_eq!(twin(&note("backup-com1", "job di backup su COM1"), &mine), None);
    }

    #[test]
    fn project_folders_read_as_paths() {
        std::env::set_var("USERNAME", "Edoardo");
        assert_eq!(project_label("C--Users-Edoardo-WORK-EasyIsland"), "WORK\\EasyIsland");
        assert_eq!(project_label("C--Users-Edoardo"), t("cartella utente"));
    }
}

#[cfg(test)]
mod live {
    /// On this PC: `cargo test --lib cc_memory::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_the_notes_of_this_pc() {
        let all = super::notes();
        println!("{} note", all.len());
        for n in all.iter().take(5) {
            println!("{} · {} · {} · {}", n.place(), n.kind, n.name, n.description);
        }
        println!("--- preface\n{}", super::preface().unwrap_or_default());
        println!("--- search ssh\n{}", super::search(&["ssh".into()], 5).join("\n"));
        let g = super::graph(&[]);
        println!("--- graph: {} nodi, {} archi", g.nodes.len(), g.edges.len());
        let mine = super::local_memory();
        let start = std::time::Instant::now();
        let again = super::notes().len();
        println!("--- seconda lettura: {again} note in {:?}", start.elapsed());
        let ids: Vec<(String, String, bool)> = mine.iter().enumerate().map(|(i, (_, text, page, _))| (format!("{i}"), text.clone(), *page)).collect();
        let mine = super::local(ids.into_iter());
        for n in &all {
            if let Some(i) = super::twin(n, &mine) {
                let i: usize = i.parse().unwrap_or(0);
                println!("DOPPIONE: {} · {}\n   = {}", n.name, super::about(n), mine[i].1);
            }
        }
    }
}
