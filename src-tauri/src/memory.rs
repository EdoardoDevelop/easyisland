// The chat's memory (asked by Edoardo on 21 October 2026: "una memoria
// interna in timeline… più intelligente e autonomo ma senza il rischio di
// utilizzare troppi token"). Plain Markdown in %APPDATA%\EasyIsland\memoria,
// readable and editable by the user:
//
// - `MEMORIA.md`: what is worth knowing every time (preferences, people,
//   customers, how things are done). Short on purpose: it rides in front of
//   the first question of each conversation, cut at MAX_INJECT characters.
//   The chat adds to it with memory_note (or the user with «/ricorda …»);
//   past MAX_LINES the oldest notes move to `archivio.md`.
// - `diario/AAAA-MM.md`: the timeline, one line per answered question,
//   written here without asking any model (no tokens). The chat looks into it
//   only when it needs to, with memory_search.
//
// Off with Impostazioni → Chat → Cronologia (`chat_history`), like the
// history: then nothing is written or sent. Nothing leaves the PC except the
// MEMORIA.md text that goes to the chat's own engine.

use std::io::Write;
use std::path::PathBuf;

use crate::i18n::{t, tf};

/// What goes in front of a new conversation, at most.
const MAX_INJECT: usize = 4_000;
/// Notes kept in MEMORIA.md before the oldest move to archivio.md.
const MAX_LINES: usize = 60;
/// One line of the timeline: the question and the answer, cut.
const DIARY_CHARS: usize = 160;
/// Lines memory_search gives back.
const MAX_FOUND: usize = 20;

pub fn dir() -> PathBuf {
    crate::settings::config_dir().join("memoria")
}

fn main_file() -> PathBuf {
    dir().join("MEMORIA.md")
}

fn header() -> String {
    format!(
        "# {}\n\n{}\n\n",
        t("Memoria di EasyIsland"),
        t("Cose da ricordare in ogni chat, una per riga: oltre 60 le più vecchie passano in archivio.md. Puoi modificarle o cancellarle qui.")
    )
}

/// "2026-10-21 14:30", local time.
fn stamp() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute)
}

/// On one line, at most `max` characters.
fn short(text: &str, max: usize) -> String {
    let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= max {
        return one;
    }
    let cut: String = one.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

/// The notes of MEMORIA.md (its "- " lines).
fn notes_of(text: &str) -> Vec<String> {
    text.lines().filter(|l| l.trim_start().starts_with("- ")).map(|l| l.trim().to_string()).collect()
}

fn read_main() -> String {
    std::fs::read_to_string(main_file()).unwrap_or_default()
}

/// The text in front of a new conversation: the notes, newest first, cut.
/// `tools`: the engine has memory_search and memory_note.
pub fn preface(tools: bool) -> Option<String> {
    let notes = notes_of(&read_main());
    if notes.is_empty() && !tools {
        return None;
    }
    let mut body = String::new();
    for n in notes.iter().rev() {
        if body.len() + n.len() + 1 > MAX_INJECT {
            break;
        }
        body.push_str(n);
        body.push('\n');
    }
    let how = if tools {
        t("Se serve qualcosa di una conversazione passata, cercalo con memory_search (il diario delle domande, per data). Quando l'utente dice qualcosa che vale per le prossime volte (una preferenza, un cliente, come si fa una cosa), salvalo con memory_note in una riga, senza chiedere e senza dirlo a lungo.")
    } else {
        ""
    };
    if body.is_empty() {
        return Some(format!("[{}]\n\n", how));
    }
    Some(tf(
        "[Memoria dell'utente, da tenere presente senza citarla:\n{body}{how}]\n\n",
        &[("body", &body), ("how", &how)],
    ))
}

/// A note for MEMORIA.md (memory_note, «/ricorda»). The same note twice is
/// kept once; past MAX_LINES the oldest go to archivio.md.
pub fn note(text: &str) -> Result<String, String> {
    let text = short(text, 300);
    if text.is_empty() {
        return Err(t("Nota vuota.").into());
    }
    let current = read_main();
    let mut notes = notes_of(&current);
    let day = stamp().chars().take(10).collect::<String>();
    let key = text.to_lowercase();
    if notes.iter().any(|n| n.to_lowercase().ends_with(&key)) {
        return Ok(t("Era già in memoria.").into());
    }
    notes.push(format!("- {day}: {text}"));
    let mut moved = Vec::new();
    while notes.len() > MAX_LINES {
        moved.push(notes.remove(0));
    }
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    if !moved.is_empty() {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir().join("archivio.md")).map_err(|e| e.to_string())?;
        for m in &moved {
            let _ = writeln!(f, "{m}");
        }
    }
    let out = format!("{}{}\n", header(), notes.join("\n"));
    write_whole(&main_file(), &out)?;
    Ok(t("Salvato in memoria.").into())
}

fn write_whole(path: &std::path::Path, text: &str) -> Result<(), String> {
    let temp = path.with_extension(format!("md.tmp-{}", std::process::id()));
    std::fs::write(&temp, text).and_then(|()| std::fs::rename(&temp, path)).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })
}

/// After an answered question (lib.rs chat_turn): one line in this month's diary.
pub fn diary(engine: &str, question: &str, answer: &str, telegram: bool) {
    let now = stamp();
    let Some(month) = now.get(..7) else { return };
    let folder = dir().join("diario");
    if std::fs::create_dir_all(&folder).is_err() {
        return;
    }
    let path = folder.join(format!("{month}.md"));
    let new = !path.exists();
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) else { return };
    if new {
        let _ = writeln!(f, "# {} {month}\n", t("Diario della chat"));
    }
    let via = if telegram { " · Telegram" } else { "" };
    let _ = writeln!(
        f,
        "- {now} · {engine}{via} · {} → {}",
        short(question, DIARY_CHARS),
        short(answer, DIARY_CHARS)
    );
}

/// memory_search: the lines of the memory and of the diary that have every
/// word of `query` (no case), newest first. `month` ("2026-10") limits the diary.
pub fn search(query: &str, month: &str) -> Result<String, String> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).filter(|w| w.chars().count() > 1).collect();
    let mut files: Vec<PathBuf> = vec![main_file(), dir().join("archivio.md")];
    let mut months: Vec<PathBuf> = std::fs::read_dir(dir().join("diario"))
        .map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    months.sort();
    months.reverse();
    let month = month.trim();
    files.extend(months.into_iter().filter(|p| month.is_empty() || p.file_stem().is_some_and(|s| s.to_string_lossy() == month)));
    let mut found = Vec::new();
    for path in files {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let mut lines: Vec<&str> = text.lines().filter(|l| l.starts_with("- ")).collect();
        lines.reverse();
        for l in lines {
            let low = l.to_lowercase();
            if words.iter().all(|w| low.contains(w.as_str())) {
                found.push(l.to_string());
                if found.len() >= MAX_FOUND {
                    break;
                }
            }
        }
        if found.len() >= MAX_FOUND {
            break;
        }
    }
    if found.is_empty() {
        return Ok(t("Niente in memoria su questo.").into());
    }
    Ok(found.join("\n"))
}

/// Impostazioni → Chat: how many notes and diary lines there are.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub notes: usize,
    pub days: usize,
    pub folder: String,
}

pub fn info() -> Info {
    let notes = notes_of(&read_main()).len();
    let mut days = std::collections::BTreeSet::new();
    if let Ok(r) = std::fs::read_dir(dir().join("diario")) {
        for e in r.flatten() {
            if let Ok(text) = std::fs::read_to_string(e.path()) {
                for l in text.lines().filter(|l| l.starts_with("- ")) {
                    if let Some(d) = l.get(2..12) {
                        days.insert(d.to_string());
                    }
                }
            }
        }
    }
    Info { notes, days: days.len(), folder: dir().to_string_lossy().into_owned() }
}

/// MEMORIA.md, created with its header when missing (to open it in an editor).
pub fn ensure_main() -> Result<PathBuf, String> {
    let path = main_file();
    if !path.exists() {
        std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
        write_whole(&path, &header())?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_cuts_and_flattens() {
        assert_eq!(short("a\n  b", 10), "a b");
        let s = short(&"parola ".repeat(50), 20);
        assert!(s.ends_with('…'));
        assert!(s.chars().count() <= 20);
    }

    /// The whole round on a temporary %APPDATA%: notes, the diary, search and
    /// what goes in front of a conversation.
    #[test]
    fn note_diary_search_and_preface() {
        let temp = std::env::temp_dir().join(format!("easyisland-memory-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::env::set_var("APPDATA", &temp);
        assert!(preface(false).is_none());
        assert_eq!(note("Il cliente Rossi paga a 60 giorni").unwrap(), t("Salvato in memoria."));
        assert_eq!(note("il cliente rossi paga a 60 giorni").unwrap(), t("Era già in memoria."));
        assert!(note("   ").is_err());
        diary("subscription", "Come si rinnova il certificato di Bianchi?", "Con certbot renew", false);
        let p = preface(true).unwrap();
        assert!(p.contains("Rossi paga a 60 giorni"));
        assert!(p.contains("memory_search"));
        assert!(search("certificato bianchi", "").unwrap().contains("certbot"));
        assert!(search("rossi", "").unwrap().contains("60 giorni"));
        assert_eq!(search("nessuno qui", "").unwrap(), t("Niente in memoria su questo."));
        for i in 0..MAX_LINES + 3 {
            note(&format!("nota numero {i}")).unwrap();
        }
        assert_eq!(notes_of(&read_main()).len(), MAX_LINES);
        assert!(std::fs::read_to_string(dir().join("archivio.md")).unwrap().contains("Rossi"));
        let info = info();
        assert_eq!((info.notes, info.days), (MAX_LINES, 1));
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn notes_are_the_dash_lines() {
        let n = notes_of("# Memoria\n\ntesto\n- 2026-10-21: uno\n- 2026-10-21: due\n");
        assert_eq!(n.len(), 2);
    }
}
