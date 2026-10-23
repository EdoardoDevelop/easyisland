// Abilità (asked by Edoardo on 23 October 2026, EasyIsland as a personal agent
// that can be programmed like any AI agent, docs/idee.md): procedures the user
// writes once and the chat and the tasks use when they fit. Plain Markdown in
// %APPDATA%\EasyIsland\abilita, one file each, readable and editable:
//
//   ---
//   nome: Resoconto cliente
//   descrizione: quando l'utente chiede il resoconto mensile di un cliente
//   motore: subscription            (optional: the engine it prefers)
//   strumenti: notion_query, notion_add_row   (optional: the tools it uses)
//   ---
//   The instructions, step by step.
//
// Only the names and descriptions ride in front of a new conversation (a few
// lines); the engine reads a whole skill with skill_read when it needs it, as
// agents with skills do. In the chat each skill is also a «/command».

use std::path::PathBuf;

use serde::Serialize;

use crate::i18n::{t, tf};

/// The index in front of a conversation, at most.
const MAX_INDEX: usize = 3_000;
/// One skill's file, at most.
const MAX_BODY: usize = 20_000;
const MAX_SKILLS: usize = 200;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// The file's name without .md: also the «/command».
    pub id: String,
    pub name: String,
    pub description: String,
    /// The engine it prefers ("" = whatever runs it).
    pub engine: String,
    pub tools: Vec<String>,
    pub body: String,
}

pub fn dir() -> PathBuf {
    crate::settings::config_dir().join("abilita")
}

/// "Resoconto cliente" → "resoconto-cliente".
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(40).collect()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The file's text → a skill. The header is optional: without it the name is the id.
pub fn parse(id: &str, text: &str) -> Skill {
    let mut skill = Skill { id: id.to_string(), name: id.replace('-', " "), ..Default::default() };
    let text = text.trim_start_matches('\u{feff}');
    let mut body = text;
    if let Some(rest) = text.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let head = rest.get(..end).unwrap_or_default();
            body = rest.get(end + 4..).unwrap_or_default();
            for line in head.lines() {
                let Some((k, v)) = line.split_once(':') else { continue };
                let v = v.trim().to_string();
                match k.trim().to_lowercase().as_str() {
                    "nome" | "name" => skill.name = v,
                    "descrizione" | "description" => skill.description = v,
                    "motore" | "engine" => skill.engine = v,
                    "strumenti" | "tools" => {
                        skill.tools = v.split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect();
                    }
                    _ => {}
                }
            }
        }
    }
    skill.body = body.trim().to_string();
    skill
}

/// The file written for a skill.
pub fn render(s: &Skill) -> String {
    let mut out = format!("---\nnome: {}\ndescrizione: {}\n", one_line(&s.name), one_line(&s.description));
    if !s.engine.is_empty() {
        out.push_str(&format!("motore: {}\n", one_line(&s.engine)));
    }
    if !s.tools.is_empty() {
        out.push_str(&format!("strumenti: {}\n", s.tools.join(", ")));
    }
    out.push_str("---\n\n");
    out.push_str(s.body.trim());
    out.push('\n');
    out
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn list() -> Vec<Skill> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir()) else { return out };
    for e in entries.flatten().take(MAX_SKILLS * 2) {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|x| x.to_str()).map(str::to_string) else { continue };
        if !valid_id(&id) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        out.push(parse(&id, text.get(..text.len().min(MAX_BODY)).unwrap_or(&text)));
        if out.len() >= MAX_SKILLS {
            break;
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// By id, or by name (the engine may use either).
pub fn find(name: &str) -> Option<Skill> {
    let want = name.trim();
    let id = slug(want);
    list().into_iter().find(|s| s.id == id || s.name.eq_ignore_ascii_case(want))
}

/// Saves a skill; `old` is the id it had (renamed: the old file goes).
pub fn save(skill: &Skill, old: &str) -> Result<Skill, String> {
    let name = skill.name.trim();
    if name.is_empty() {
        return Err(t("Dai un nome all'abilità.").into());
    }
    if skill.body.trim().is_empty() {
        return Err(t("Scrivi le istruzioni dell'abilità.").into());
    }
    let id = slug(name);
    if !valid_id(&id) {
        return Err(t("Usa nel nome almeno una lettera o una cifra.").into());
    }
    let text = render(&Skill { id: id.clone(), ..skill.clone() });
    if text.len() > MAX_BODY {
        return Err(t("Abilità troppo lunga: al massimo 20.000 caratteri.").into());
    }
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&dir().join(format!("{id}.md")), text.as_bytes()).map_err(|e| e.to_string())?;
    let old = old.trim();
    if !old.is_empty() && old != id && valid_id(old) {
        let _ = std::fs::remove_file(dir().join(format!("{old}.md")));
    }
    crate::log::line(format!("abilità: salvata {id}"));
    Ok(parse(&id, &text))
}

/// Only from the user's click in Impostazioni (never a tool).
pub fn delete(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(t("Abilità non trovata.").into());
    }
    std::fs::remove_file(dir().join(format!("{id}.md"))).map_err(|e| e.to_string())
}

/// The few lines in front of a new conversation: what skills there are.
pub fn index() -> Option<String> {
    let all = list();
    if all.is_empty() {
        return None;
    }
    let mut lines = String::new();
    for s in &all {
        let engine = if s.engine.is_empty() { String::new() } else { format!(" ({})", tf("motore preferito: {e}", &[("e", &s.engine)])) };
        let line = format!("- {}: {}{}\n", s.name, s.description, engine);
        if lines.len() + line.len() > MAX_INDEX {
            break;
        }
        lines.push_str(&line);
    }
    Some(tf(
        "[Abilità dell'utente: procedure scritte da lui. Quando una richiesta corrisponde a una di queste, leggila con skill_read e seguila.\n{lines}]\n\n",
        &[("lines", &lines)],
    ))
}

/// What the «/command» of a skill sends: its instructions, then what the user wrote.
pub fn as_prompt(skill: &Skill, arg: &str) -> String {
    let mut text = tf("[Usa l'abilità «{name}»:\n{body}]", &[("name", &skill.name), ("body", &skill.body)]);
    if !arg.trim().is_empty() {
        text.push_str("\n\n");
        text.push_str(arg.trim());
    }
    text
}

// ── Tools (agent.rs) ─────────────────────────────────────────────────────────

pub fn tool_read(name: &str) -> Result<String, String> {
    let s = find(name).ok_or_else(|| tf("Nessuna abilità «{name}». Elenco: {all}", &[("name", &name.to_string()), ("all", &list().iter().map(|s| s.name.clone()).collect::<Vec<_>>().join(", "))]))?;
    let mut out = format!("# {}\n{}\n", s.name, s.description);
    if !s.engine.is_empty() {
        out.push_str(&tf("Motore preferito: {e}\n", &[("e", &s.engine)]));
    }
    if !s.tools.is_empty() {
        out.push_str(&tf("Strumenti: {t}\n", &[("t", &s.tools.join(", "))]));
    }
    out.push('\n');
    out.push_str(&s.body);
    Ok(out)
}

pub fn tool_list() -> String {
    let all = list();
    if all.is_empty() {
        return t("Nessuna abilità. Si creano in Impostazioni → Compiti → Abilità, o con skill_save.").into();
    }
    all.iter().map(|s| format!("- {} ({}): {}", s.name, s.id, s.description)).collect::<Vec<_>>().join("\n")
}

/// skill_save from the chat: not read-only, so Consenti / Nega shows it first.
pub fn tool_save(args: &serde_json::Value) -> Result<String, String> {
    let s = |k: &str| args.get(k).and_then(serde_json::Value::as_str).unwrap_or_default().trim().to_string();
    let tools = args.get("tools").and_then(serde_json::Value::as_array)
        .map(|a| a.iter().filter_map(serde_json::Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let skill = Skill { id: String::new(), name: s("name"), description: s("description"), engine: s("engine"), tools, body: s("body") };
    let old = find(&skill.name).map(|x| x.id).unwrap_or_default();
    let saved = save(&skill, &old)?;
    Ok(tf("Abilità «{name}» salvata: la uso quando serve, ed è anche il comando /{id} nella chat.", &[("name", &saved.name), ("id", &saved.id)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_reads_its_header_and_body() {
        let s = parse("resoconto", "---\nnome: Resoconto cliente\ndescrizione: il resoconto mensile\nmotore: opencode\nstrumenti: notion_query, notion_add_row\n---\n\n1. Leggi i ticket\n2. Scrivi\n");
        assert_eq!(s.name, "Resoconto cliente");
        assert_eq!(s.description, "il resoconto mensile");
        assert_eq!(s.engine, "opencode");
        assert_eq!(s.tools, vec!["notion_query", "notion_add_row"]);
        assert_eq!(s.body, "1. Leggi i ticket\n2. Scrivi");
        assert_eq!(parse(&s.id, &render(&s)), s, "written and read back the same");
    }

    #[test]
    fn a_file_without_header_is_all_instructions() {
        let s = parse("controllo-backup", "Guarda i log del backup.");
        assert_eq!((s.name.as_str(), s.body.as_str()), ("controllo backup", "Guarda i log del backup."));
    }

    #[test]
    fn names_become_safe_file_names() {
        assert_eq!(slug("Resoconto mensile: cliente Rossi!"), "resoconto-mensile-cliente-rossi");
        assert_eq!(slug("Città più così"), "citta-piu-cosi");
        assert!(!valid_id(&slug("…")));
        for bad in ["../x", "A", "a b", "x.md"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }
}
