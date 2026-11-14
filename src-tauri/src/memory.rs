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
const MAX_INJECT: usize = 1_500;
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

pub(crate) fn read_main() -> String {
    std::fs::read_to_string(main_file()).unwrap_or_default()
}

/// A note that holds whatever the question (a rule, a preference: «sempre»,
/// «mai», «non deve»…), not a fact about one customer or one site.
pub(crate) fn general(note: &str) -> bool {
    let l = note.to_lowercase();
    // Agent Chat's notes, the to-dos and «not always» are not rules.
    if ["(agent chat)", "da migliorare", "da fare", "non è sempre", "non sempre"].iter().any(|w| l.contains(w)) {
        return false;
    }
    const RULE: &[&str] = &[
        "sempre", " mai ", "non deve", "non devono", "non va ", "non vanno", "nessuna va", "nessun riferimento",
        "preferisce", "vuole che", "non vuole", "tiene le sue", "always", "never", "prefers",
    ];
    l.contains(": regola: ") || l.starts_with("regola: ") || RULE.iter().any(|w| l.contains(w))
}

/// The text in front of a new conversation (13 Nov 2026, Edoardo: «cose non
/// utili ad ogni conversazione»): only the general notes, newest first, up to
/// MAX_INJECT; the others come with each question from `related`, when they
/// fit it. `tools`: the engine has memory_search and memory_note.
pub fn preface(tools: bool, learns: bool) -> Option<String> {
    if !cfg!(test) {
        expire();
    }
    let notes: Vec<String> = notes_of(&read_main()).into_iter().filter(|n| general(n)).collect();
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
    let how = if tools && learns {
        // memory_learn.rs keeps the memory after the answer: no steps for it here.
        t("Se serve qualcosa di una conversazione passata o di un argomento (persone, clienti, progetti), cercalo con memory_search (note, pagine collegate e diario delle domande); memory_page con brief dà la scheda di una pagina (riassunto e collegamenti), senza brief il testo intero: aprilo solo se la scheda non basta o per riscriverla; memory_path dice come sono collegate due pagine. Non serve salvare in memoria: dopo ogni risposta EasyIsland annota da sola ciò che vale per le prossime volte. Usa memory_note o memory_page_write solo se l'utente ti chiede di ricordare o di scrivere qualcosa.")
    } else if tools {
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

/// Moves notes to archivio.md (memory_learn: a note the newer one corrects or
/// repeats; memory_ai: a fact now in its page; `expire`: an event gone by).
pub(crate) fn archive(lines: &[String]) -> Result<usize, String> {
    if lines.is_empty() {
        return Ok(0);
    }
    let notes = notes_of(&read_main());
    let gone: Vec<&String> = notes.iter().filter(|n| lines.contains(n)).collect();
    if gone.is_empty() {
        return Ok(0);
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dir().join("archivio.md")).map_err(|e| e.to_string())?;
    for g in &gone {
        let _ = writeln!(f, "{g}");
    }
    let kept: Vec<&str> = notes.iter().filter(|n| !lines.contains(n)).map(String::as_str).collect();
    write_whole(&main_file(), &format!("{}{}\n", header(), kept.join("\n")))?;
    Ok(gone.len())
}

/// The days (as day numbers) a note talks about: «18/11/2026», «18/11» (the
/// note's year), «2026-11-18» in its text, not the date it was written.
fn dates_in(note: &str) -> Vec<i64> {
    let body = note.trim_start_matches("- ");
    let (written, text) = match body.get(..10).filter(|d| d.as_bytes().get(4) == Some(&b'-')) {
        Some(d) => (d, body.get(11..).unwrap_or_default()),
        None => ("", body),
    };
    let year: i64 = written.get(..4).and_then(|y| y.parse().ok()).unwrap_or(0);
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let num = |i: usize, n: usize| -> Option<i64> {
        let s: String = chars.get(i..i + n)?.iter().collect();
        s.chars().all(|c| c.is_ascii_digit()).then(|| s.parse().ok())?
    };
    let mut i = 0;
    while i < chars.len() {
        let before_ok = i == 0 || !chars[i - 1].is_ascii_digit();
        if before_ok {
            // 2026-11-18
            if let (Some(y), Some('-'), Some(m), Some('-'), Some(d)) = (num(i, 4), chars.get(i + 4).copied(), num(i + 5, 2), chars.get(i + 7).copied(), num(i + 8, 2)) {
                if let Some(n) = crate::brain::day_number(&format!("{y:04}-{m:02}-{d:02}")) {
                    out.push(n);
                }
                i += 10;
                continue;
            }
            // 18/11/2026 or 18/11
            let d_len = if num(i, 2).is_some() { 2 } else if num(i, 1).is_some() { 1 } else { 0 };
            if d_len > 0 && chars.get(i + d_len) == Some(&'/') {
                let m_at = i + d_len + 1;
                let m_len = if num(m_at, 2).is_some() { 2 } else if num(m_at, 1).is_some() { 1 } else { 0 };
                if m_len > 0 {
                    let (d, m) = (num(i, d_len).unwrap_or(0), num(m_at, m_len).unwrap_or(0));
                    let y_at = m_at + m_len + 1;
                    let (y, end) = match (chars.get(m_at + m_len), num(y_at, 4)) {
                        (Some('/'), Some(y)) => (y, y_at + 4),
                        _ => (year, m_at + m_len),
                    };
                    if (1..=31).contains(&d) && (1..=12).contains(&m) && y > 2000 {
                        if let Some(n) = crate::brain::day_number(&format!("{y:04}-{m:02}-{d:02}")) {
                            out.push(n);
                        }
                    }
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

/// An event planned for a day («intervento previsto mercoledì 18/11»): once
/// that day is past, the note goes to the archive, still found by memory_search.
fn expired(note: &str, today: i64) -> bool {
    const EVENT: &[&str] = &["previst", "intervento", "appuntamento", "scadenz", "entro ", "riunione", "consegna", "da fare", "promemoria", "incontro", "in attesa"];
    let low = note.to_lowercase();
    if !EVENT.iter().any(|w| low.contains(w)) || general(note) {
        return false;
    }
    let written = note.trim_start_matches("- ").get(..10).and_then(crate::brain::day_number).unwrap_or(0);
    let ahead: Vec<i64> = dates_in(note).into_iter().filter(|d| *d > written).collect();
    !ahead.is_empty() && ahead.iter().all(|d| *d < today)
}

/// The notes about an event already gone by, to the archive (at most once a day, before a new conversation).
pub fn expire() {
    static LAST: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
    let Some(today) = crate::brain::day_number(&stamp().chars().take(10).collect::<String>()) else { return };
    if LAST.swap(today, std::sync::atomic::Ordering::Relaxed) == today {
        return;
    }
    let gone: Vec<String> = notes_of(&read_main()).into_iter().filter(|n| expired(n, today)).collect();
    if let Ok(n) = archive(&gone) {
        if n > 0 {
            crate::log::line(format!("memoria: {n} note su eventi passati in archivio"));
        }
    }
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
        found.push(t("Dalla memoria di Claude Code (si legge soltanto; con la data: se contraddice quanto sopra, vale quanto sopra):").into());
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
        assert!(preface(false, false).is_none());
        assert_eq!(note("Il cliente Rossi paga a 60 giorni").unwrap(), t("Salvato in memoria."));
        assert_eq!(note("il cliente rossi paga a 60 giorni").unwrap(), t("Era già in memoria."));
        assert!(note("   ").is_err());
        diary("subscription", "Come si rinnova il certificato di Bianchi?", "Con certbot renew", false);
        // A fact about one customer stays out of the front; a rule goes in.
        let p = preface(true, false).unwrap();
        assert!(!p.contains("Rossi paga a 60 giorni"));
        assert!(p.contains("memory_search"));
        note("I preventivi vanno sempre con la grafica standard").unwrap();
        assert!(preface(true, false).unwrap().contains("grafica standard"));
        note("Il cliente Bianchi ha il NAS Synology in sala server, backup alle 3").unwrap();
        assert!(!preface(true, false).unwrap().contains("Synology"));
        assert!(related("Che NAS ha il cliente Bianchi?", true, &[]).unwrap().contains("Synology"));
        assert!(related("Dove salvo le copie?", true, &["- 2026-11-14: backup sul NAS di casa ogni notte alle 3".to_string()]).unwrap().contains("NAS di casa"));
        // A fact goes to its page (memory_learn), once; a corrected note to the archive.
        assert!(crate::brain::add_line("Studio Verdi", "- 2026-11-14: il server è un HP ProLiant ML30").unwrap());
        assert!(!crate::brain::add_line("Studio Verdi", "- 2026-11-15: il server è un HP ProLiant ML30").unwrap());
        assert!(crate::brain::add_line("studio verdi", "- 2026-11-15: stampante Kyocera al primo piano").unwrap());
        let page = crate::brain::pages().into_iter().find(|p| p.title == "Studio Verdi").unwrap();
        assert!(page.body.contains("ProLiant") && page.body.contains("Kyocera"));
        let synology = notes_of(&read_main()).into_iter().find(|n| n.contains("Synology")).unwrap();
        assert_eq!(archive(&[synology]).unwrap(), 1);
        assert!(!read_main().contains("Synology"));
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

/// Words that say nothing about the subject of a question.
const STOP: &[&str] = &[
    "nell", "dell", "dall", "sull", "quell", "dovrebbe", "dovrei", "anche", "ancora", "allora", "adesso", "altro", "altra", "altri", "avere", "come", "cosa", "così", "credo", "della", "delle", "dello", "degli", "dalla",
    "dalle", "dentro", "devi", "deve", "dimmi", "dove", "dopo", "essere", "fammi", "fare", "fatto", "funziona", "grazie", "invece", "lavoro", "mentre",
    "nella", "nelle", "nello", "negli", "ogni", "oggi", "perché", "perche", "però", "poter", "posso", "possiamo", "potresti", "prima", "proprio", "puoi",
    "quale", "quali", "quando", "quanto", "quella", "quelle", "quello", "questa", "queste", "questo", "quindi", "sarebbe", "sempre", "senza", "solo",
    "sono", "stato", "sulla", "sulle", "tutte", "tutti", "tutto", "vedere", "voglio", "vorrei", "with", "what", "that", "this", "have", "from", "would",
];

/// The words of a question worth looking for: 4+ letters, not in `STOP`.
pub(crate) fn subject_words(question: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in question.split(|c: char| !c.is_alphanumeric()).map(str::to_lowercase) {
        if w.chars().count() >= 4 && !STOP.contains(&w.as_str()) && !out.contains(&w) {
            out.push(w);
        }
    }
    out.truncate(12);
    out
}

/// What the memory knows about a question, looked up here before it goes to
/// the engine, with no model and no tokens of a step (12 Nov 2026: in 10 days
/// on the laptop 109 memory_search, most of them the first step of a turn).
/// Pages named in the question (title or alias) with their gist, then notes,
/// archived notes and page lines with two or more of its words. `fresh`: the
/// general notes are already in front of the conversation (`preface`).
pub fn related(question: &str, fresh: bool, meaning: &[String]) -> Option<String> {
    const MAX_LINES: usize = 8;
    const MAX_CHARS: usize = 1_500;
    let low = question.to_lowercase();
    let words = subject_words(question);
    let mut found: Vec<(usize, String)> = Vec::new();
    let pages = crate::brain::pages();
    // The question as plain words, so a name is found as words, not inside one.
    let plain = format!(" {} ", low.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    for p in &pages {
        let named = std::iter::once(&p.title).chain(p.aliases.iter()).any(|n| {
            let n = n.trim().to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
            n.chars().count() >= 3 && plain.contains(&format!(" {n} "))
        });
        if named {
            found.push((100, format!("[[{}]] {}", p.title, p.gist())));
        }
    }
    if !words.is_empty() {
        let score = |line: &str| {
            let l = line.to_lowercase();
            words.iter().filter(|w| l.contains(w.as_str())).count()
        };
        let mut lines: Vec<String> = Vec::new();
        lines.extend(notes_of(&read_main()).into_iter().filter(|n| !(fresh && general(n))));
        lines.extend(notes_of(&std::fs::read_to_string(dir().join("archivio.md")).unwrap_or_default()));
        for p in &pages {
            for l in p.body.lines().map(str::trim).filter(|l| l.len() > 3) {
                lines.push(format!("[[{}]] {}", p.title, l.trim_start_matches("- ")));
            }
        }
        // What a line says besides its links and marks: a line of names only says nothing.
        let said = |l: &str| l.replace("[[", "").replace("]]", "").replace("**", "").trim_start_matches("- ").chars().filter(|c| c.is_alphanumeric()).count();
        // Two words, and a quarter of the question's for a long one: «switch» and
        // «ubiquiti» alone brought a customer's whole network to a quote (13 Nov 2026).
        let needed = 2.max(words.len().div_ceil(4));
        for l in lines {
            let s = score(&l);
            if s < needed || said(&l) < 40 {
                continue;
            }
            // The same note copied into a page ("[[X]] nota: - 2026-…"): once.
            let core: String = l.rsplit("- ").next().unwrap_or(&l).chars().take(80).collect();
            if !found.iter().any(|(_, f)| f.contains(&core)) {
                found.push((s, l));
            }
        }
    }
    // Close in meaning (memory_meaning.rs): in, after what has the words.
    for l in meaning {
        let core: String = l.rsplit("- ").next().unwrap_or(l).chars().take(80).collect();
        if !found.iter().any(|(_, f)| f.contains(&core)) {
            found.push((1, l.clone()));
        }
    }
    if found.is_empty() {
        return None;
    }
    // Equal matches: the newest note first (12 Nov 2026, «i campi file non hanno
    // un filtro» from the morning came before the note saying they now have one).
    let day = |l: &str| l.trim_start_matches("- ").get(..10).filter(|d| d.as_bytes().get(4) == Some(&b'-')).unwrap_or("").to_string();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| day(&b.1).cmp(&day(&a.1))));
    let mut body = String::new();
    for (_, l) in found.into_iter().take(MAX_LINES) {
        let l = short(&l, 260);
        if body.len() + l.len() + 3 > MAX_CHARS {
            break;
        }
        body.push_str("- ");
        body.push_str(l.trim_start_matches("- "));
        body.push('\n');
    }
    Some(tf(
        "[Dalla memoria, trovato da EasyIsland per questa domanda (se serve altro, memory_search; se due note si contraddicono vale la più recente):\n{body}]\n\n",
        &[("body", &body)],
    ))
}

#[cfg(test)]
mod related_tests {
    use super::subject_words;

    #[test]
    fn the_subject_of_a_question() {
        assert_eq!(
            subject_words("nell'integrazioni ttspeak la selezione audio creato mi deve far vedere solo i file audio"),
            ["integrazioni", "ttspeak", "selezione", "audio", "creato", "file"]
        );
        assert!(subject_words("come si fa?").is_empty());
    }

    #[test]
    fn events_gone_by() {
        use super::{dates_in, expired};
        let day = |d: &str| crate::brain::day_number(d).unwrap();
        let n = "- 2026-11-12: Jacaroni: mercoledì 18/11/2026 intervento previsto: spostare il PC dello studio 5";
        assert_eq!(dates_in(n), vec![day("2026-11-18")]);
        assert!(!expired(n, day("2026-11-18")));
        assert!(expired(n, day("2026-11-19")));
        assert_eq!(dates_in("- 2026-11-12: consegna il 3/12 e poi 2026-12-20"), vec![day("2026-12-03"), day("2026-12-20")]);
        // A fact with a past date only, or no event word: stays.
        assert!(!expired("- 2026-11-11: Il 09/11/2026 è stato salvato il DDT ED-2026-003", day("2026-12-01")));
        assert!(!expired("- 2026-11-12: Il PC ha IP 192.168.0.240 dal 20/11", day("2026-12-01")));
    }

    #[test]
    fn general_notes_are_rules() {
        use super::general;
        assert!(general("- 2026-11-13: Preventivi/offerte Easytech: usare sempre la grafica standard"));
        assert!(general("- 2026-11-11: Nella stampa del Registro non deve esserci nessun riferimento alla segreteria"));
        assert!(general("- 2026-11-10: Edoardo tiene le sue password personali di lavoro in KeePassXC"));
        assert!(!general("- 2026-11-13: Wisp.store è un portale PrestaShop: i prodotti si cercano in JSON"));
        assert!(!general("- 2026-11-12: (Agent Chat) L'installer è sempre nel Vassoio"));
        assert!(general("- 2026-11-14: regola: i preventivi in PDF"));
    }
}

#[cfg(test)]
mod related_live {
    /// `EI_Q="…" cargo test related_live -- --ignored --nocapture`: what this PC's memory adds to a question.
    #[test]
    #[ignore]
    fn related_live() {
        let q = std::env::var("EI_Q").unwrap_or_else(|_| "come configuro il backup del NAS di un cliente?".into());
        println!("{}", super::related(&q, false, &[]).unwrap_or_else(|| "(niente)".into()));
    }
}
