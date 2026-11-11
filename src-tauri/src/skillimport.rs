// Abilità → «Importa…» (asked by Edoardo on 11 November 2026, docs/idee.md):
// Markdown files written for other agents become skills. Three shapes are known:
//
//   - an agent: a header with `name` / `description` (The Agency, Claude Code's
//     ~/.claude/agents, Copilot, opencode…), extra fields such as `color`,
//     `model` or Claude Code's `tools` dropped: they mean nothing here;
//   - a skill of Claude Code: `<folder>/SKILL.md`, named after its folder when
//     the header has no name;
//   - plain Markdown: only when the user picked that very file.
//
// Nothing is written while scanning: the settings page lists what was found,
// the user ticks what to keep, and only then `import` saves. The engine's
// rewrite (`adapt_prompt` / `adapted`) is optional and shown before saving.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::i18n::{t, tf};
use crate::skills::{self, Skill};

/// A file larger than this is not instructions.
const MAX_FILE: u64 = 200_000;
const MAX_FILES: usize = 2_000;
const MAX_DEPTH: usize = 6;
const MAX_DESCRIPTION: usize = 300;

/// Files of a repository that are about it, not instructions for an agent.
const SKIP_FILES: [&str; 10] = [
    "readme", "changelog", "license", "licence", "contributing", "code_of_conduct", "security", "agents", "claude", "gemini",
];
const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", "vendor"];

/// One future skill, as the settings page shows it.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// The file it comes from.
    pub path: String,
    pub id: String,
    pub name: String,
    pub description: String,
    /// The folder it sits in (The Agency's «division»), "" at the top.
    pub group: String,
    /// "agent", "skill" or "markdown".
    pub kind: String,
    pub body: String,
    /// The header's fields left out (color, model, tools…).
    pub dropped: Vec<String>,
    /// A skill with this id is already there.
    pub exists: bool,
    /// Longer than a skill may be: only an engine's rewrite can bring it in.
    pub too_long: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    /// What was picked, for the title of the list.
    pub root: String,
    pub items: Vec<Candidate>,
    /// Markdown files that are not instructions (README, guides…).
    pub ignored: usize,
    /// Stopped at MAX_FILES.
    pub truncated: bool,
    /// Skills there are now, for «oltre il limite».
    pub existing: usize,
    pub max: usize,
}

/// What the user kept, possibly rewritten by an engine and edited.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Pick {
    pub name: String,
    pub description: String,
    pub body: String,
    /// The skill with the same id goes; otherwise this one is saved as «… (2)».
    #[serde(default)]
    pub replace: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub saved: Vec<String>,
    /// [name, why].
    pub errors: Vec<(String, String)>,
}

// ── Reading ──────────────────────────────────────────────────────────────────

/// The files and folders picked → the skills they would become.
pub fn scan(paths: &[String]) -> Scan {
    let existing: HashSet<String> = skills::list().into_iter().map(|s| s.id).collect();
    let mut out = Scan { existing: existing.len(), max: skills::MAX_SKILLS, ..Default::default() };
    out.root = paths.iter().map(|p| p.trim()).filter(|p| !p.is_empty()).collect::<Vec<_>>().join("; ");
    let mut seen = 0usize;
    for p in paths {
        let path = PathBuf::from(p.trim());
        if path.is_dir() {
            walk(&path, &path, 0, &mut seen, &mut out);
        } else if path.is_file() {
            match read(&path, None, true) {
                Some(c) => out.items.push(c),
                None => out.ignored += 1,
            }
        }
    }
    // Two files with the same name: the second becomes «… (2)».
    let mut ids: HashSet<String> = HashSet::new();
    for c in &mut out.items {
        if ids.contains(&c.id) {
            let base = c.name.clone();
            for n in 2..100 {
                let name = format!("{base} ({n})");
                let id = skills::slug(&name);
                if !ids.contains(&id) {
                    c.name = name;
                    c.id = id;
                    break;
                }
            }
        }
        ids.insert(c.id.clone());
        c.exists = existing.contains(&c.id);
    }
    out.items.sort_by(|a, b| (a.group.to_lowercase(), a.name.to_lowercase()).cmp(&(b.group.to_lowercase(), b.name.to_lowercase())));
    out
}

fn walk(root: &Path, dir: &Path, depth: usize, seen: &mut usize, out: &mut Scan) {
    if depth > MAX_DEPTH || out.truncated {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_lowercase();
        if path.is_dir() {
            if !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) {
                walk(root, &path, depth + 1, seen, out);
            }
            continue;
        }
        if !is_markdown(&path) {
            continue;
        }
        *seen += 1;
        if *seen > MAX_FILES {
            out.truncated = true;
            return;
        }
        match read(&path, Some(root), false) {
            Some(c) => out.items.push(c),
            None => out.ignored += 1,
        }
    }
}

fn is_markdown(path: &Path) -> bool {
    matches!(path.extension().and_then(|x| x.to_str()).map(str::to_lowercase).as_deref(), Some("md" | "markdown"))
}

/// One file → a future skill; None when it is not one. `chosen`: the user picked
/// this very file, so plain Markdown counts too.
fn read(path: &Path, root: Option<&Path>, chosen: bool) -> Option<Candidate> {
    if !is_markdown(path) || std::fs::metadata(path).map(|m| m.len() > MAX_FILE).unwrap_or(true) {
        return None;
    }
    let stem = path.file_stem().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let lower = stem.to_lowercase();
    let is_skill = lower == "skill";
    if !chosen && !is_skill && SKIP_FILES.contains(&lower.as_str()) {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    let (head, body) = front_matter(&text);
    let field = |k: &str| head.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let parent = path.parent();
    let folder_name = |p: Option<&Path>| p.and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let (kind, fallback, group_dir) = if is_skill {
        ("skill", folder_name(parent), parent.and_then(Path::parent))
    } else if field("name").is_some() || field("nome").is_some() || field("description").is_some() || field("descrizione").is_some() {
        ("agent", stem.clone(), parent)
    } else if chosen {
        ("markdown", stem.clone(), parent)
    } else {
        return None;
    };
    let name = pretty_name(&field("name").or_else(|| field("nome")).unwrap_or(fallback));
    let mut body = body.trim().to_string();
    if body.is_empty() {
        return None;
    }
    // A skill of Claude Code may come with scripts and references next to it.
    if is_skill {
        if let Some(dir) = parent {
            let others = std::fs::read_dir(dir).map(|e| e.flatten().filter(|e| !e.file_name().eq_ignore_ascii_case("SKILL.md")).count()).unwrap_or(0);
            if others > 0 {
                body.push_str("\n\n");
                body.push_str(&tf("(Altri file di questa abilità nella cartella originale: {path})", &[("path", &dir.display())]));
            }
        }
    }
    let description = field("description").or_else(|| field("descrizione")).map(|d| clean_description(&d)).unwrap_or_default();
    let known = ["name", "nome", "description", "descrizione"];
    let mut dropped: Vec<String> = head.keys().filter(|k| !known.contains(&k.as_str())).cloned().collect();
    dropped.sort();
    // The first folder under the one picked (The Agency's division, with its
    // own subfolders inside); nothing for a file at the top.
    let group = match (root, group_dir) {
        (Some(root), Some(g)) => g.strip_prefix(root).ok()
            .and_then(|rel| rel.components().next())
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .unwrap_or_default(),
        _ => String::new(),
    };
    let id = skills::slug(&name);
    if !skills::valid_id(&id) {
        return None;
    }
    let too_long = skills::render(&Skill { name: name.clone(), description: description.clone(), body: body.clone(), ..Default::default() }).len() > skills::MAX_BODY;
    Some(Candidate { path: path.display().to_string(), id, name, description, group, kind: kind.into(), body, dropped, exists: false, too_long })
}

/// "code-reviewer" → "Code reviewer"; names with spaces stay as they are.
fn pretty_name(name: &str) -> String {
    let name = name.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    if name.contains(' ') || !(name.contains('-') || name.contains('_')) {
        return name.to_string();
    }
    let spaced = name.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// One line, without Claude Code's `<example>` blocks, at most MAX_DESCRIPTION characters.
fn clean_description(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text.replace("\\n", "\n");
    for tag in ["example", "commentary"] {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        while let Some(start) = rest.find(&open) {
            let end = rest.get(start..).and_then(|r| r.find(&close)).map(|e| start + e + close.len()).unwrap_or(rest.len());
            rest.replace_range(start..end, " ");
        }
    }
    for word in rest.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    // «Examples:» left alone at the end of the sentence.
    for tail in ["Examples:", "Example:", "Esempi:"] {
        if let Some(s) = out.strip_suffix(tail) {
            out = s.trim_end().to_string();
        }
    }
    if out.chars().count() > MAX_DESCRIPTION {
        out = out.chars().take(MAX_DESCRIPTION - 1).collect::<String>().trim_end().to_string();
        out.push('…');
    }
    out
}

/// A YAML-like header between `---` lines → its top-level fields, and the rest.
/// Enough YAML for agents' files: `key: value`, quoted values, `|` and `>` blocks,
/// lists under a key (joined with commas).
fn front_matter(text: &str) -> (HashMap<String, String>, &str) {
    let mut fields = HashMap::new();
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else { return (fields, text) };
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let Some(rest) = rest.strip_prefix('\n') else { return (fields, text) };
    let end = if rest.starts_with("---") { Some(0) } else { rest.find("\n---").map(|e| e + 1) };
    let Some(end) = end else { return (fields, text) };
    let head = rest.get(..end).unwrap_or_default();
    let after = rest.get(end + 3..).unwrap_or_default();
    let body = after.split_once('\n').map(|(_, b)| b).unwrap_or("");

    let lines: Vec<&str> = head.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines.get(i).copied().unwrap_or_default();
        i += 1;
        if line.starts_with([' ', '\t', '#']) || line.trim().is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let key = key.trim().to_lowercase();
        let value = value.trim();
        // The indented lines that follow belong to this key.
        let mut block = Vec::new();
        while let Some(next) = lines.get(i) {
            if next.trim().is_empty() || next.starts_with([' ', '\t']) {
                block.push(next.trim());
                i += 1;
            } else {
                break;
            }
        }
        let value = if value.starts_with('|') || value.starts_with('>') || value.is_empty() {
            let items: Vec<&str> = block.iter().map(|l| l.strip_prefix("- ").unwrap_or(l)).filter(|l| !l.is_empty()).collect();
            if value.is_empty() && block.iter().any(|l| l.starts_with("- ")) { items.join(", ") } else { items.join("\n") }
        } else {
            let mut v = value.to_string();
            for more in &block {
                v.push(' ');
                v.push_str(more);
            }
            unquote(&v)
        };
        fields.insert(key, value);
    }
    (fields, body)
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    let quoted = |q: char| v.len() >= 2 && v.starts_with(q) && v.ends_with(q);
    if quoted('"') {
        v.get(1..v.len() - 1).unwrap_or_default().replace("\\\"", "\"").replace("\\n", "\n")
    } else if quoted('\'') {
        v.get(1..v.len() - 1).unwrap_or_default().replace("''", "'")
    } else {
        v.to_string()
    }
}

// ── Saving ───────────────────────────────────────────────────────────────────

/// Saves what the user kept, one by one: one that fails does not stop the others.
pub fn import(picks: &[Pick]) -> Report {
    let mut report = Report::default();
    let mut ids: HashSet<String> = skills::list().into_iter().map(|s| s.id).collect();
    for p in picks {
        let mut name = p.name.trim().to_string();
        let mut id = skills::slug(&name);
        if ids.contains(&id) && !p.replace {
            if let Some(free) = (2..100).map(|n| format!("{} ({n})", p.name.trim())).find(|n| !ids.contains(&skills::slug(n))) {
                id = skills::slug(&free);
                name = free;
            }
        }
        if !ids.contains(&id) && ids.len() >= skills::MAX_SKILLS {
            report.errors.push((name, tf("Ci sono già {n} abilità, il massimo.", &[("n", &skills::MAX_SKILLS)])));
            continue;
        }
        let skill = Skill { id: String::new(), name: name.clone(), description: p.description.clone(), engine: String::new(), tools: Vec::new(), body: p.body.clone() };
        match skills::save(&skill, "") {
            Ok(saved) => {
                ids.insert(saved.id.clone());
                report.saved.push(saved.id);
            }
            Err(e) => report.errors.push((name, e)),
        }
    }
    crate::log::line(format!("abilità: importate {}, non riuscite {}", report.saved.len(), report.errors.len()));
    report
}

// ── Engine's rewrite ─────────────────────────────────────────────────────────

/// What the engine is asked: the skill rewritten for EasyIsland, in the user's language.
pub fn adapt_prompt(name: &str, description: &str, body: &str) -> String {
    tf(
        "Adatta queste istruzioni scritte per un altro agente AI in un'abilità di EasyIsland, l'assistente sul PC Windows dell'utente. Non usare strumenti: rispondi solo con il testo.\n\nRegole:\n- scrivi in italiano;\n- tieni il ruolo, le regole e i passi che servono, togli esempi ripetuti, presentazioni e frasi di contorno; al massimo 12.000 caratteri;\n- togli i riferimenti a strumenti, comandi o file che EasyIsland non ha (Read, Write, Bash, Task, agenti secondari, cartelle del progetto originale); dove serve scrivi «usa gli strumenti disponibili»;\n- la descrizione è una riga sola che dice quando usarla;\n- rispondi esattamente in questo formato, senza altro testo prima o dopo:\n---\nnome: …\ndescrizione: …\n---\nle istruzioni in Markdown\n\nNome: {name}\nDescrizione: {description}\n\nIstruzioni:\n{body}",
        &[("name", &name), ("description", &description), ("body", &body)],
    )
}

/// The engine's answer → name, description, instructions; the originals fill what it left out.
pub fn adapted(reply: &str, name: &str, description: &str) -> Result<Pick, String> {
    let mut text = reply.trim();
    // An answer wrapped in ``` … ```.
    if let Some(inner) = text.strip_prefix("```") {
        let inner = inner.split_once('\n').map(|(_, b)| b).unwrap_or_default();
        text = inner.trim_end().strip_suffix("```").unwrap_or(inner).trim();
    }
    // Some engines say something before the header.
    if !text.starts_with("---") {
        if let Some(at) = text.find("\n---\n") {
            text = text.get(at + 1..).unwrap_or(text);
        }
    }
    let s = skills::parse("x", text);
    if s.body.trim().is_empty() {
        return Err(t("Il motore non ha risposto con le istruzioni.").into());
    }
    let keep = |new: &str, old: &str| if new.trim().is_empty() || new == "x" { old.to_string() } else { new.trim().to_string() };
    Ok(Pick { name: keep(&s.name, name), description: keep(&s.description, description), body: s.body, replace: false })
}

/// «Da Claude Code»: its agents' and skills' folders that are there.
pub fn claude_code_dirs() -> Vec<String> {
    let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) else { return Vec::new() };
    ["agents", "skills"].iter().map(|d| home.join(".claude").join(d)).filter(|p| p.is_dir()).map(|p| p.display().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGENCY: &str = "---\nname: Frontend Developer\ndescription: Expert frontend developer for React, Vue and performance\ncolor: cyan\n---\n\n# Frontend Developer\n\n## Core Mission\nBuild fast UIs.\n";
    const CLAUDE_AGENT: &str = "---\nname: code-reviewer\ndescription: \"Use this agent after writing code.\\n\\n<example>\\nuser: review this\\nassistant: ok\\n</example>\"\ntools: Read, Grep\nmodel: sonnet\n---\nYou review code.\n";
    const BLOCK: &str = "---\nname: Writer\ndescription: >\n  Writes long\n  documents\ntools:\n  - Read\n  - Write\n---\nWrite.\n";

    #[test]
    fn an_agency_agent_keeps_name_and_description() {
        let (head, body) = front_matter(AGENCY);
        assert_eq!(head.get("name").map(String::as_str), Some("Frontend Developer"));
        assert_eq!(head.get("color").map(String::as_str), Some("cyan"));
        assert!(body.trim_start().starts_with("# Frontend Developer"));
    }

    #[test]
    fn claude_code_descriptions_lose_their_examples() {
        let (head, body) = front_matter(CLAUDE_AGENT);
        let d = clean_description(head.get("description").unwrap());
        assert_eq!(d, "Use this agent after writing code.");
        assert_eq!(head.get("tools").map(String::as_str), Some("Read, Grep"));
        assert_eq!(body.trim(), "You review code.");
        assert_eq!(pretty_name("code-reviewer"), "Code reviewer");
        assert_eq!(pretty_name("Frontend Developer"), "Frontend Developer");
    }

    #[test]
    fn yaml_blocks_and_lists() {
        let (head, body) = front_matter(BLOCK);
        assert_eq!(clean_description(head.get("description").unwrap()), "Writes long documents");
        assert_eq!(head.get("tools").map(String::as_str), Some("Read, Write"));
        assert_eq!(body.trim(), "Write.");
    }

    #[test]
    fn no_header_is_all_body() {
        let (head, body) = front_matter("# Title\n\ntext");
        assert!(head.is_empty());
        assert_eq!(body, "# Title\n\ntext");
        let (head, _) = front_matter("---\nname: x\nno end");
        assert!(head.is_empty(), "an open header is not a header");
    }

    #[test]
    fn long_descriptions_are_cut() {
        let d = clean_description(&"word ".repeat(200));
        assert!(d.chars().count() <= MAX_DESCRIPTION && d.ends_with('…'));
    }

    #[test]
    fn a_folder_lists_agents_skills_and_skips_the_rest() {
        let root = std::env::temp_dir().join(format!("ei-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let write = |rel: &str, text: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        };
        write("README.md", "---\nname: Not me\n---\nabout the repo");
        write("engineering/frontend-developer.md", AGENCY);
        write("engineering/notes.md", "just notes, no header");
        write("support/code-reviewer.md", CLAUDE_AGENT);
        write("skills/pdf-tools/SKILL.md", "---\ndescription: PDF things\n---\nUse the script.");
        write("skills/pdf-tools/script.py", "print(1)");
        write(".git/x.md", AGENCY);
        let scan = scan(&[root.display().to_string()]);
        let names: Vec<(&str, &str, &str)> = scan.items.iter().map(|c| (c.group.as_str(), c.name.as_str(), c.kind.as_str())).collect();
        assert_eq!(names, vec![("engineering", "Frontend Developer", "agent"), ("skills", "Pdf tools", "skill"), ("support", "Code reviewer", "agent")]);
        assert_eq!(scan.ignored, 2, "README and the notes");
        let pdf = scan.items.iter().find(|c| c.kind == "skill").unwrap();
        assert!(pdf.body.contains("pdf-tools"), "points to the folder with the script");
        let reviewer = scan.items.iter().find(|c| c.id == "code-reviewer").unwrap();
        assert_eq!(reviewer.dropped, vec!["model", "tools"]);
        // The notes, picked on their own, are a skill too.
        let one = super::scan(&[root.join("engineering/notes.md").display().to_string()]);
        assert_eq!(one.items.first().map(|c| c.kind.as_str()), Some("markdown"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `EI_IMPORT=<cartella> cargo test --lib skillimport::tests::live_scan -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_scan() {
        let Ok(dir) = std::env::var("EI_IMPORT") else { return };
        let scan = scan(&[dir]);
        for c in &scan.items {
            println!("{:<22} {:<40} {:>6} {:<8} {}{} | {}", c.group, c.name, c.body.len(), c.kind, if c.too_long { "LUNGA " } else { "" }, c.dropped.join(","), c.description.chars().take(90).collect::<String>());
        }
        println!("trovate {}, saltate {}, troncata {}", scan.items.len(), scan.ignored, scan.truncated);
    }

    #[test]
    fn the_engines_answer_is_read_back() {
        let p = adapted("```markdown\n---\nnome: Sviluppatore frontend\ndescrizione: per le interfacce web\n---\n\n# Ruolo\nCostruisci.\n```", "Frontend Developer", "x").unwrap();
        assert_eq!((p.name.as_str(), p.description.as_str(), p.body.as_str()), ("Sviluppatore frontend", "per le interfacce web", "# Ruolo\nCostruisci."));
        let p = adapted("Ecco:\n---\ndescrizione: d\n---\nTesto", "Nome", "old").unwrap();
        assert_eq!((p.name.as_str(), p.body.as_str()), ("Nome", "Testo"));
        assert!(adapted("", "a", "b").is_err());
    }
}
