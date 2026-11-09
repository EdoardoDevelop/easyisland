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

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::brain::{fold, Edge, Event, Graph, Node};
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

/// Every note of every account, newest first.
pub fn notes() -> Vec<Note> {
    if !on() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut files = 0;
    for root in roots() {
        let account = account_of(&root);
        let Ok(projects) = std::fs::read_dir(root.join("projects")) else { continue };
        for p in projects.flatten() {
            let Ok(entries) = std::fs::read_dir(p.path().join("memory")) else { continue };
            let folder = p.file_name().to_string_lossy().into_owned();
            for e in entries.flatten() {
                let path = e.path();
                let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if !file.ends_with(".md") || file.eq_ignore_ascii_case("MEMORY.md") {
                    continue;
                }
                let Ok(meta) = e.metadata() else { continue };
                if meta.len() > MAX_BYTES {
                    continue;
                }
                files += 1;
                if files > MAX_FILES {
                    break;
                }
                let Ok(text) = std::fs::read_to_string(&path) else { continue };
                let (name, description, kind, body) = parse(&text);
                let name = if name.is_empty() { file.trim_end_matches(".md").to_string() } else { name };
                let day = meta.modified().map(crate::brain::file_day).unwrap_or_default();
                out.push(Note {
                    account: account.clone(),
                    folder: folder.clone(),
                    name,
                    description: crate::redact::redact(&description),
                    kind,
                    body: crate::redact::redact(&body),
                    day,
                    path: path.clone(),
                });
            }
        }
    }
    out.sort_by(|a, b| b.day.cmp(&a.day).then(a.name.cmp(&b.name)));
    out
}

/// In front of a new conversation: how the user wants to be worked with, as
/// Claude Code learnt it (notes of type user or feedback). Only those of the
/// user's own folder, the general ones: a project's stay with memory_search.
pub fn preface() -> Option<String> {
    let mut lines = Vec::new();
    let mut size = 0;
    for n in notes().into_iter().filter(|n| matches!(n.kind.as_str(), "user" | "feedback") && project_label(&n.folder) == t("cartella utente")) {
        let line = format!("- {}: {}", n.name, if n.description.is_empty() { first_line(&n.body) } else { n.description.clone() });
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

/// memory_search: the notes with every word, one line each.
pub fn search(words: &[String], max: usize) -> Vec<String> {
    let words: Vec<String> = words.iter().map(|w| fold(w)).collect();
    if words.is_empty() {
        return Vec::new();
    }
    notes()
        .into_iter()
        .filter(|n| {
            let all = fold(&format!("{} {} {}", n.name, n.description, n.body));
            words.iter().all(|w| all.contains(w.as_str()))
        })
        .take(max)
        .map(|n| {
            let about = if n.description.is_empty() { first_line(&n.body) } else { n.description.clone() };
            format!("[{}] {}: {about}", n.place(), n.name)
        })
        .collect()
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
        tf("(Nota della memoria di Claude Code, {place}: si legge soltanto, la scrive Claude Code.)", &[("place", &n.place())]),
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
/// from, the [[links]] between them and, given `pages` (id, title), the pages
/// of this PC each one names.
pub fn graph(pages: &[(String, String)]) -> Graph {
    let all = notes();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut events = Vec::new();
    let mut projects: BTreeSet<String> = BTreeSet::new();
    let by_name: HashMap<(String, String), String> = all.iter().map(|n| ((n.project_id(), fold(&n.name)), n.id())).collect();
    let titles: Vec<(&String, String)> = pages.iter().map(|(id, title)| (id, fold(title))).filter(|(_, t)| t.chars().count() >= 4).collect();
    for n in &all {
        let id = n.id();
        let text = format!("{}\n{}", n.description, n.body);
        if projects.insert(n.project_id()) {
            nodes.push(Node { id: n.project_id(), kind: "source", label: n.place(), date: String::new(), text: String::new(), weight: 0, origin: ORIGIN.into() });
        }
        nodes.push(Node { id: id.clone(), kind: "note", label: n.name.clone(), date: n.day.clone(), text: crate::brain::cut(&text, 1_200), weight: 0, origin: ORIGIN.into() });
        edges.push(Edge { from: id.clone(), to: n.project_id(), label: t("da").into(), strength: 2 });
        events.push(Event { date: n.day.clone(), lane: "note", text: format!("Claude Code: {}", n.name), node: id.clone() });
        for target in wiki_links(&n.body) {
            if let Some(to) = by_name.get(&(n.project_id(), fold(&target))) {
                if *to != id {
                    edges.push(Edge { from: id.clone(), to: to.clone(), label: String::new(), strength: 3 });
                }
            }
        }
        let low = fold(&text);
        for (page, title) in &titles {
            if names(&low, title) {
                edges.push(Edge { from: id.clone(), to: (*page).clone(), label: String::new(), strength: 2 });
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
    }
}
