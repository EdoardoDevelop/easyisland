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
pub(crate) fn stamp() -> String {
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
pub(crate) fn notes_of(text: &str) -> Vec<String> {
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
        t("Se serve qualcosa di una conversazione passata o di un argomento (persone, clienti, progetti), cercalo con memory_search (note, pagine collegate e diario delle domande); memory_page con brief dà la scheda di una pagina (riassunto e collegamenti), senza brief il testo intero: aprilo solo se la scheda non basta o per riscriverla; memory_path dice come sono collegate due pagine. Quando l'utente dice qualcosa che vale per le prossime volte (una preferenza, un cliente, come si fa una cosa), salvalo con memory_note in una riga, senza chiedere e senza dirlo a lungo.")
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
    // Never a password in the memory (redact.rs): it would go to every engine.
    let text = short(&crate::redact::redact(text), 300);
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
    if let Some(same) = notes.iter().find(|n| says_nothing_new(&text, n)) {
        return Ok(tf("Era già in memoria, detto così: {note}", &[("note", &same.trim_start_matches("- "))]));
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

/// The words of a note that carry meaning, lowercase.
fn words_of(text: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "del", "della", "delle", "dei", "degli", "dal", "dalla", "nel", "nella", "nei", "sul", "sulla", "con", "per", "tra", "fra",
        "che", "chi", "non", "una", "uno", "gli", "le", "lo", "il", "la", "sono", "sta", "stato", "stata", "anche", "come", "suo",
        "sua", "loro", "questo", "questa", "the", "and", "for", "with",
    ];
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '.' | '\\' | '/' | ':' | '_' | '-')))
        .map(|w| w.trim_matches(|c: char| matches!(c, '.' | ':' | '-')).to_string())
        // A number counts however short ("65 €"): it is the fact a note changes.
        .filter(|w| (w.chars().count() >= 3 || w.chars().any(|c| c.is_ascii_digit())) && !STOP.contains(&w.as_str()))
        .collect()
}

/// A new note that an old one already says (4 notes from the other PC, 7 Nov
/// 2026, all «the code is in C:\…» in other words): every number, path or
/// date of the new one is in the old one, and nearly all its words. A note
/// with a number or a path the old one lacks is news, and is kept.
fn says_nothing_new(new: &str, old: &str) -> bool {
    let fresh = words_of(new);
    let had: std::collections::HashSet<String> = words_of(old).into_iter().collect();
    if fresh.len() < 4 || had.is_empty() {
        return false;
    }
    let fact = |w: &str| w.chars().any(|c| c.is_ascii_digit()) || w.contains('\\') || w.contains('/');
    if fresh.iter().any(|w| fact(w) && !had.contains(w)) {
        return false;
    }
    // At most one word the old note lacks, and not a name ("usa Zammad" after "usa Jira" is news).
    let unknown: Vec<&String> = fresh.iter().filter(|w| !had.contains(*w)).collect();
    let a_name = |w: &str| new.split(|c: char| !c.is_alphanumeric()).any(|x| x.to_lowercase() == w && x.chars().next().is_some_and(char::is_uppercase));
    fresh.len() >= 5 && unknown.len() <= 1 && unknown.iter().all(|w| !a_name(w))
}

pub(crate) fn write_whole(path: &std::path::Path, text: &str) -> Result<(), String> {
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
        short(&crate::redact::redact(question), DIARY_CHARS),
        short(&crate::redact::redact(answer), DIARY_CHARS)
    );
}

/// Today's lines of the diary (the evening digest, tasks.rs), at most `max`.
pub fn diary_today(max: usize) -> Vec<String> {
    let now = stamp();
    let (Some(month), Some(day)) = (now.get(..7), now.get(..10)) else { return Vec::new() };
    let text = std::fs::read_to_string(dir().join("diario").join(format!("{month}.md"))).unwrap_or_default();
    let prefix = format!("- {day}");
    let lines: Vec<String> = text.lines().filter(|l| l.starts_with(&prefix)).map(str::to_string).collect();
    let skip = lines.len().saturating_sub(max);
    lines.into_iter().skip(skip).collect()
}

/// This month's diary, whole (news.rs counts the subjects in it).
pub fn diary_month() -> String {
    let now = stamp();
    let Some(month) = now.get(..7) else { return String::new() };
    std::fs::read_to_string(dir().join("diario").join(format!("{month}.md"))).unwrap_or_default()
}

/// The notes in MEMORIA.md now (the digest must not repeat them).
pub fn notes() -> Vec<String> {
    notes_of(&read_main())
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
    // The pages first (brain.rs), with the pages they link to.
    for line in crate::brain::search(&words, MAX_FOUND / 2) {
        found.push(line);
    }
    for path in files {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let mut lines: Vec<&str> = text.lines().filter(|l| l.starts_with("- ")).collect();
        lines.reverse();
        for l in lines {
            let low = l.to_lowercase();
            if words.iter().all(|w| low.contains(w.as_str())) {
                found.push(l.to_string());
                if found.len() >= MAX_FOUND * 2 {
                    break;
                }
            }
        }
        if found.len() >= MAX_FOUND * 2 {
            break;
        }
    }
    // Then what Claude Code remembers by itself (cc_memory.rs), read only.
    let cc = crate::cc_memory::search(&words, MAX_FOUND / 2);
    if found.is_empty() && cc.is_empty() {
        return Ok(t("Niente in memoria su questo.").into());
    }
    if !cc.is_empty() {
        if !found.is_empty() {
            found.push(String::new());
        }
        found.push(t("Dalla memoria di Claude Code (si legge soltanto):").into());
        found.extend(cc);
    }
    Ok(found.join("\n"))
}

/// Impostazioni → Chat: how many notes and diary lines there are.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub notes: usize,
    pub days: usize,
    pub pages: usize,
    pub inbox: usize,
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
    Info { notes, days: days.len(), pages: crate::brain::pages().len(), inbox: crate::brain::inbox_files().len(), folder: dir().to_string_lossy().into_owned() }
}

/// memory_forget for a note: the one line of MEMORIA.md with this text moves
/// to archivio.md (never deleted).
pub fn forget(text: &str) -> Result<String, String> {
    let key = short(text, 300).to_lowercase();
    if key.is_empty() {
        return Err(t("note: il testo della nota, o page: il titolo della pagina.").into());
    }
    let current = read_main();
    let notes = notes_of(&current);
    let matching: Vec<&String> = notes.iter().filter(|n| n.to_lowercase().contains(&key)).collect();
    let line = match matching.as_slice() {
        [one] => (*one).clone(),
        // 8 Nov 2026: the check tried four times to archive notes that are only in the other PC's copy.
        [] => return Err(t("Nessuna nota con questo testo nella memoria di questo PC. Se l'hai trovata tra i risultati dell'altro PC (memoria collegata), sta là: si toglie da quel PC, non da qui.").into()),
        _ => return Err(tf("Più note con questo testo ({n}): scrivine di più.", &[("n", &matching.len().to_string())])),
    };
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir().join("archivio.md")).map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{line}");
    let kept: Vec<&String> = notes.iter().filter(|n| **n != line).collect();
    let out = format!("{}{}
", header(), kept.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("
"));
    write_whole(&main_file(), &out)?;
    Ok(t("Nota spostata in archivio.md.").into())
}

/// The tests that move %APPDATA% run one at a time.
#[cfg(test)]
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    fn a_note_said_again_in_other_words_is_not_saved_twice() {
        let old = "- 2026-11-07: (da casa) (Agent Chat) Sul PC casa il repository di EasyIsland è in C:\\Users\\Edoardo\\WORK\\EasyIsland_0.2.0, sul ramo claude/sviluppo.";
        assert!(says_nothing_new("(da casa) (Agent Chat) Il codice di EasyIsland sul PC casa sta in `C:\\Users\\Edoardo\\WORK\\EasyIsland_0.2.0`.", old));
        // A new number, path or name is news.
        assert!(!says_nothing_new("(da casa) (Agent Chat) Sul PC casa il repository di EasyIsland è in D:\\Lavoro\\EasyIsland, sul ramo claude/sviluppo.", old));
        let jira = "- 2026-11-01: Lorenzo usa Jira per i ticket dei clienti di Easytech";
        assert!(!says_nothing_new("Lorenzo usa Zammad per i ticket dei clienti di Easytech", jira));
        assert!(!says_nothing_new("La tariffa oraria di Easytech è di 65 € più IVA", "- 2026-10-24: La tariffa oraria di Easytech è di 55 € più IVA"));
    }

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
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
        assert!(forget("nota numero").is_err());
        assert_eq!(forget("nota numero 7").unwrap(), t("Nota spostata in archivio.md."));
        assert_eq!(notes_of(&read_main()).len(), MAX_LINES - 1);
        note("nota numero 99").unwrap();
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
