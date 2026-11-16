// «Risposte dalla memoria» (15 Nov 2026): a question that only looks
// something up («quale vm ha la farmacia Falchi?») is answered with the
// memory's own lines, no engine. On the laptop the question had gone to Claude,
// which read the page and searched again (two steps) for a line the meaning had
// already found at 0.62.
//
// The model on this PC does not understand nor write: it ranks lines. So the
// answer is the lines as they are (with their date), never a sentence made up,
// and only when it is safe:
//   - the question looks something up: short, with a question word, no action
//     to do (fai, manda, apri…), nothing live («adesso», «stato») nor a why/how;
//   - a line names every subject of the question (a name, a device: a word of
//     the question that is not a common one); the meaning only orders the
//     lines (`memory_meaning::answer_min`);
// else the engine, as before. «⚡ Chiedi al motore», or the same question
// again, sends it to the engine (router.rs, as the other direct answers).

/// The words that make a question a lookup.
const ASKING: &[&str] = &[
    "quale", "quali", "qual", "che", "chi", "dove", "quando", "quanto", "quanti", "quante", "cosa", "cos",
    "which", "what", "who", "where", "when", "how many", "how much",
];

/// Things to do, live state, reasons and ways: the engine's.
const NOT_LOOKUP: &[&str] = &[
    // actions
    "fai", "fammi", "fare", "crea", "creare", "manda", "mandare", "invia", "inviare", "scrivi", "scrivere", "apri",
    "aprire", "controlla", "controllare", "verifica", "prepara", "preparare", "aggiorna", "aggiornare", "cambia",
    "cambiare", "elimina", "cancella", "installa", "configura", "imposta", "calcola", "riassumi", "traduci", "cerca",
    "trova", "leggi", "ricordami", "aggiungi", "sistema", "risolvi", "riavvia", "spegni", "accendi", "esegui", "lancia",
    "make", "create", "send", "write", "open", "check", "update", "delete", "install", "fix", "find", "search",
    // live state
    "adesso", "ora", "oggi", "ieri", "domani", "stato", "attualmente", "online", "offline", "funziona", "errore",
    "errori", "problema", "problemi", "spazio", "libero", "now", "today", "status",
    // reasons and ways
    "perché", "perche", "come", "why", "how",
];

/// Words that say nothing of what is asked about.
const COMMON: &[&str] = &[
    "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "di", "del", "dello", "della", "dei", "degli", "delle",
    "da", "dal", "dalla", "dai", "in", "nel", "nella", "nei", "con", "su", "sul", "sulla", "per", "tra", "fra", "e",
    "ed", "o", "a", "al", "allo", "alla", "ai", "agli", "alle", "è", "e'", "sono", "ha", "hanno", "ho", "hai", "c",
    "ci", "si", "mi", "ti", "ne", "non", "più", "mio", "mia", "miei", "mie", "tuo", "tua", "suo", "sua", "suoi", "loro",
    "nostro", "nostra", "questo", "questa", "quello", "quella", "l", "d", "un'", "chiama", "chiamano", "usa", "usano",
    "c'è", "sai", "sa", "so", "you", "know", "about", "the", "a", "an", "of", "is", "are", "does", "do", "has", "have", "in", "on", "for", "to", "and", "or",
];

const MAX_WORDS: usize = 14;
/// At most this many lines, as good as the best one (same page, same words).
const MAX_LINES: usize = 2;
/// A second line only this close in meaning to the first one.
const SECOND_BELOW: f32 = 0.05;

pub(crate) fn words(question: &str) -> Vec<String> {
    question
        .to_lowercase()
        .replace(['’', '\''], " ")
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '.')
        .map(|w| w.trim_matches(|c: char| c == '-' || c == '.').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// The question only looks something up (see the head of the file).
pub fn is_lookup(question: &str) -> bool {
    let q = question.trim();
    let w = words(q);
    if w.len() < 2 || w.len() > MAX_WORDS || q.contains('\n') {
        return false;
    }
    // «come si chiama…» is a lookup; any other «come» a way to do something.
    let named = q.to_lowercase().contains("come si chiama");
    // «dove si trova…» is a lookup too, not «trova» something.
    let located = q.to_lowercase().contains("si trova");
    if w.iter().any(|x| NOT_LOOKUP.contains(&x.as_str()) && !(named && x == "come") && !(located && x == "trova")) {
        return false;
    }
    let low = q.to_lowercase();
    let asks = w.first().is_some_and(|x| ASKING.contains(&x.as_str()))
        || named
        || (q.ends_with('?') && ASKING.iter().any(|a| w.iter().any(|x| x == a) || (a.contains(' ') && low.contains(a))));
    asks
}

/// The words of the question that name something (not a question word nor a
/// common one): «vm», «ip» and numbers too («comunale 3» is not «comunale 2»).
fn subjects(question: &str) -> Vec<String> {
    words(question)
        .into_iter()
        .filter(|w| (w.chars().count() >= 2 || w.chars().all(|c| c.is_ascii_digit())) && !ASKING.contains(&w.as_str()) && !COMMON.contains(&w.as_str()) && !NOT_LOOKUP.contains(&w.as_str()))
        .collect()
}

/// The word is in the line: whole for a short one («ip» not in «tipo»,
/// «teams» not in «TeamSystem»); a long one also with another ending, at most
/// its last two letters («farmacie» / «farmacia», «stampante» / «stampanti»),
/// never by a shared start alone («contratto» is not «controller», «centralino»
/// is not «centrale»: review of 16 Nov 2026).
fn has_word(line_words: &[String], line: &str, w: &str) -> bool {
    let n = w.chars().count();
    if n <= 5 {
        return line_words.iter().any(|x| x == w);
    }
    if line.contains(w) {
        return true;
    }
    line_words.iter().any(|x| same_word(w, x))
}

/// Two long words that differ only in their last two letters at most.
fn same_word(a: &str, b: &str) -> bool {
    let (na, nb) = (a.chars().count(), b.chars().count());
    if na < 6 || nb < 6 {
        return false;
    }
    let shared = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    shared >= 5 && shared + 2 >= na.max(nb)
}


/// Lines that only hold the page together: a title, aliases, links, dates.
pub(crate) fn structural(line: &str) -> bool {
    let text = line.trim();
    let text = match text.strip_prefix("[[").and_then(|r| r.split_once("]]")) {
        Some((_, rest)) => rest.trim(),
        None => text,
    };
    let text = text.trim_start_matches("- ").trim();
    let low = text.to_lowercase();
    const MARKS: &[&str] = &[
        "#", "alias:", "parte di:", "usato per:", "usata per:", "vedi anche:", "collegato a:", "collegata da:", "collegate:",
        "versione:", "aggiornata:", "aggiornato:", "cliente di:", "usa:", "ha:", "di:", "fonte:", "---",
    ];
    if MARKS.iter().any(|m| low.starts_with(m)) {
        return true;
    }
    // Only links and little else: «VM di: [[Farmacia Falchi]]».
    let bare: String = text.split("[[").map(|p| p.split_once("]]").map(|(_, r)| r).unwrap_or(p)).collect();
    bare.chars().filter(|c| c.is_alphanumeric()).count() < 12
}

/// The lines that answer, best first, when the question is a lookup and they
/// are safe: every subject of the question in the line (its page's title
/// counts), close in meaning (`min`), not a structural line. The meaning only
/// orders: on the laptop's memory it put «parte di: [[Farmacie comunali]]»
/// first for «quale vm ha la farmacia falchi?» (15 Nov 2026).
pub fn pick(question: &str, found: &[(f32, String)], min: f32) -> Vec<String> {
    if !is_lookup(question) {
        return Vec::new();
    }
    let subjects = subjects(question);
    if subjects.is_empty() {
        return Vec::new();
    }
    let fits = |l: &str| {
        let low = l.to_lowercase();
        let lw = words(&low);
        !structural(l) && subjects.iter().all(|s| has_word(&lw, &low, s))
    };
    // The lines of the page the question names come first («farmacia-falchi»
    // for «… farmacia falchi?»), then the closest in meaning.
    let own_page = |l: &str| {
        let title = l.trim().strip_prefix("[[").and_then(|r| r.split_once("]]")).map(|(t, _)| t.to_lowercase()).unwrap_or_default();
        let tw = words(&title.replace('-', " "));
        subjects.iter().filter(|s| tw.iter().any(|t| t == *s)).count()
    };
    // Then the lines with what is asked besides the names («vm»: in the line,
    // not only in its page's title); a question that only names the page
    // («chi è Falchi?») gets its summary; then the meaning, then the shorter.
    let body = |l: &str| l.trim().strip_prefix("[[").and_then(|r| r.split_once("]]")).map(|(_, b)| b.trim()).unwrap_or(l).to_lowercase();
    let body_hits = |l: &str| {
        let b = body(l);
        let bw = words(&b);
        subjects.iter().filter(|s| has_word(&bw, &b, s)).count()
    };
    let summary = |l: &str| own_page(l) == subjects.len() && body(l).starts_with("riassunto:");
    let mut good: Vec<(usize, usize, bool, f32, usize, &String)> = found
        .iter()
        .filter(|(s, l)| *s >= min && (fits(l) || summary(l)))
        .map(|(s, l)| (own_page(l), body_hits(l), summary(l), *s, l.chars().count(), l))
        .collect();
    good.sort_by(|a, b| b.0.cmp(&a.0).then(b.2.cmp(&a.2)).then(b.1.cmp(&a.1)).then(b.3.total_cmp(&a.3)).then(a.4.cmp(&b.4)));
    #[cfg(test)]
    if std::env::var_os("EI_EXPLAIN").is_some() {
        for (p, h, r, s, _, l) in good.iter().take(6) {
            println!("    cand p={p} h={h} r={r} {s:.2} {}", l.chars().take(90).collect::<String>());
        }
    }
    let Some(&(page, hits, sum, best, ..)) = good.first() else { return Vec::new() };
    good.into_iter()
        .filter(|(p, h, r, s, ..)| *p == page && *h == hits && *r == sum && *s >= best - SECOND_BELOW)
        .take(if sum { 1 } else { MAX_LINES })
        .map(|(.., l)| l.clone())
        .collect()
}

/// A memory line as the answer shows it: «[[Pagina]] testo» as «**Pagina** — testo».
pub fn shown(line: &str) -> String {
    let line = line.trim().trim_start_matches("- ").trim();
    let text = match line.strip_prefix("[[").and_then(|r| r.split_once("]]")) {
        Some((title, rest)) => format!("**{}** — {}", title.trim(), rest.trim().trim_start_matches("- ").trim()),
        None => line.to_string(),
    };
    let text = text.replace("[[", "").replace("]]", "");
    if text.chars().count() > 700 {
        format!("{}…", text.chars().take(700).collect::<String>())
    } else {
        text
    }
}

/// A word that says nothing of what is asked about, nor asks.
pub(crate) fn is_common(w: &str) -> bool {
    COMMON.contains(&w) || ASKING.contains(&w) || NOT_LOOKUP.contains(&w)
}

/// The subjects of a question as a key, for the votes (votes.rs): «quale vm ha
/// Falchi?» and «che VM ha falchi» share it, «quale ip ha Falchi?» does not.
/// Not recipes::same_question, which drops two-letter words like «vm» and «ip».
pub fn key(question: &str) -> Vec<String> {
    let mut k: Vec<String> = subjects(question)
        .into_iter()
        .map(|w| {
            // A long word without its ending, as `same_word` reads it:
            // «farmacia»/«farmacie», «fabbrica»/«fabbriche», «server»/«servers»
            // share the key, «contratto» and «controller» do not.
            let w: String = w.chars().map(fold).collect();
            if w.chars().count() >= 6 { stem(&w) } else { w }
        })
        .collect();
    k.sort();
    k.dedup();
    k
}

/// A long word's key: without its last vowels, a plural «s», the «h» of
/// «-che»/«-ghi».
fn stem(w: &str) -> String {
    let mut s = w.trim_end_matches(['a', 'e', 'i', 'o', 'u']);
    s = s.strip_suffix('s').unwrap_or(s);
    if s.ends_with("ch") || s.ends_with("gh") {
        s = s.strip_suffix('h').unwrap_or(s);
    }
    s.to_string()
}

fn fold(c: char) -> char {
    match c {
        'à' | 'á' => 'a',
        'è' | 'é' => 'e',
        'ì' | 'í' => 'i',
        'ò' | 'ó' => 'o',
        'ù' | 'ú' => 'u',
        c => c,
    }
}

/// Two lookups about the same things (see `key`).
pub fn similar(a: &str, b: &str) -> bool {
    let (x, y) = (key(a), key(b));
    !x.is_empty() && x == y
}

/// With no safe answer («Solo EasyIsland»): the lines that name the most of
/// what is asked, then the closest in meaning; never structural ones.
pub fn near(question: &str, found: &[(f32, String)], n: usize) -> Vec<String> {
    let subjects = subjects(question);
    if subjects.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(usize, f32, &String)> = found
        .iter()
        .filter(|(_, l)| !structural(l))
        .map(|(s, l)| {
            let low = l.to_lowercase();
            let lw = words(&low);
            (subjects.iter().filter(|w| has_word(&lw, &low, w)).count(), *s, l)
        })
        .filter(|(hits, ..)| *hits > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_cmp(&a.1)));
    scored.into_iter().take(n).map(|(.., l)| l.clone()).collect()
}

/// A 👍 on an engine's answer to a lookup (votes.rs): the memory lines the
/// answer was made of (most of their words are in it, and they name something
/// of the question), so the next similar question gets them directly. This is
/// how «che macchine virtuali ha Falchi?» learns the line with «VM».
pub fn used_lines(question: &str, answer: &str, lines: &[String]) -> Vec<String> {
    if !is_lookup(question) {
        return Vec::new();
    }
    let subjects = subjects(question);
    let said: std::collections::HashSet<String> = words(answer).into_iter().map(|w| w.chars().map(fold).collect()).collect();
    let significant = |l: &str| -> Vec<String> {
        let body = l.trim().strip_prefix("[[").and_then(|r| r.split_once("]]")).map(|(_, b)| b).unwrap_or(l);
        words(body)
            .into_iter()
            .map(|w| w.chars().map(fold).collect::<String>())
            .filter(|w| (w.chars().count() >= 3 || w.chars().any(|c| c.is_ascii_digit())) && !COMMON.contains(&w.as_str()))
            .collect()
    };
    let mut scored: Vec<(usize, &String)> = lines
        .iter()
        .filter(|l| !structural(l))
        .filter_map(|l| {
            let low = l.to_lowercase();
            let lw = words(&low);
            if !subjects.iter().any(|s| has_word(&lw, &low, s)) {
                return None;
            }
            let sig = significant(l);
            let hit = sig.iter().filter(|w| said.contains(*w)).count();
            (hit >= 3 && hit * 10 >= sig.len() * 6).then_some((hit, l))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(MAX_LINES).map(|(_, l)| l.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_lines_for_votes() {
        assert!(similar("quale vm ha la farmacia Falchi?", "che VM ha la farmacia falchi"));
        assert!(!similar("quale vm ha falchi?", "quale ip ha falchi?"));
        let lines = vec![
            "[[farmacia-falchi]] VM: FALCHI-DC, FALCHI-WINFARM, FALCHI-POLLER, FALCHI-PBS.".to_string(),
            "[[farmacia-falchi]] Host falchi-pve01, IP 192.168.0.254".to_string(),
            "[[rossi]] NAS DS920+ in sala server".to_string(),
        ];
        let answer = "La farmacia Falchi ha quattro macchine virtuali: FALCHI-DC, FALCHI-WINFARM, FALCHI-POLLER e FALCHI-PBS.";
        let got = used_lines("che macchine virtuali ha la farmacia Falchi?", answer, &lines);
        assert_eq!(got, vec![lines[0].clone()]);
        assert!(used_lines("perché il backup di Falchi non parte?", answer, &lines).is_empty());
        let near = near("che switch ha falchi?", &[(0.3, lines[1].clone()), (0.2, lines[2].clone())], 3);
        assert_eq!(near, vec![lines[1].clone()]);
        // Same start, another word (review of 16 Nov 2026): not the same subject.
        assert!(!similar("che contratto ha Rossi?", "che controller ha Rossi?"));
        assert!(similar("quale farmacia ha Rossi?", "quali farmacie ha Rossi?"));
        assert!(similar("quali fabbriche ha Rossi?", "che fabbrica ha Rossi?"));
        assert!(similar("che elenchi ha Rossi?", "che elenco ha Rossi?"));
        let ctl = "[[rossi]] controller UniFi in sala server".to_string();
        assert!(pick("che contratto ha Rossi?", &[(0.5, ctl.clone())], 0.0).is_empty());
        assert_eq!(pick("che controller ha Rossi?", &[(0.5, ctl.clone())], 0.0), vec![ctl.clone()]);
        let central = "[[bianchi]] centrale telefonica 3CX".to_string();
        assert!(pick("che centralino ha Bianchi?", &[(0.5, central)], 0.0).is_empty());
        let printer = "[[bianchi]] stampante HP in reception".to_string();
        assert_eq!(pick("quali stampanti ha Bianchi?", &[(0.5, printer.clone())], 0.0), vec![printer]);
        // «teams» is not inside «TeamSystem» (on the laptop, 15 Nov 2026).
        let ts = vec![(0.3, "[[listino]] Marche ricorrenti: UniFi, Synology, TeamSystem".to_string())];
        assert!(super::near("apri teams", &ts, 3).is_empty());
    }

    #[test]
    fn lookups_and_not() {
        for q in [
            "quale vm ha la farmacia falchi?",
            "che server ha Rossi?",
            "chi è il referente di Bianchi?",
            "dove si trova il NAS di Verdi?",
            "come si chiama il controller di Neri?",
            "quanti PC ha la farmacia comunale 2?",
        ] {
            assert!(is_lookup(q), "{q}");
        }
        for q in [
            "perché il backup di Falchi non parte?",
            "come configuro la VLAN su Falchi?",
            "che spazio libero ha adesso il NAS di Rossi?",
            "prepara il preventivo per Bianchi",
            "fai il punto della giornata",
            "manda una mail a Rossi",
            "ciao",
            "qual è lo stato del backup di Falchi?",
        ] {
            assert!(!is_lookup(q), "{q}");
        }
    }

    #[test]
    fn only_lines_with_every_subject() {
        let found = vec![
            (0.69, "[[farmacia-falchi]] parte di: [[Farmacie comunali]]".to_string()),
            (0.65, "[[farmacia-falchi]] Prima farmacia del rinnovo dei server. Host falchi-pve01, IP 192.168.0.254".to_string()),
            (0.57, "[[farmacie-comunali]] Standard: VM <FARMACIA>-DC, <FARMACIA>-WINFARM e <FARMACIA>-PBS.".to_string()),
            (0.52, "[[farmacia-falchi]] VM: FALCHI-DC, FALCHI-WINFARM, FALCHI-POLLER, FALCHI-PBS.".to_string()),
            (0.47, "[[winfarm]] VM di: [[Farmacia Falchi]]".to_string()),
        ];
        let got = pick("quale vm ha la farmacia falchi?", &found, 0.40);
        assert_eq!(got.len(), 1);
        assert!(got[0].contains("FALCHI-DC"));
        assert!(pick("quale vm ha la farmacia falchi?", &found, 0.60).is_empty());
        let ip = pick("che IP ha il server di Falchi?", &found, 0.40);
        assert!(ip.len() == 1 && ip[0].contains("192.168.0.254"));
        // «ip» is not inside «tipo»; a number must be there.
        let tipo = vec![(0.6, "[[rossi]] il tipo di server è un Dell R740".to_string())];
        assert!(pick("che ip ha il server di rossi?", &tipo, 0.40).is_empty());
        let com = vec![(0.7, "[[farmacia-comunale-2]] backup su PBS esterno ogni notte".to_string())];
        assert!(pick("che backup c'è sulla farmacia comunale 3?", &com, 0.40).is_empty());
        // Not a lookup: the engine.
        assert!(pick("perché la farmacia falchi non fa il backup?", &found, 0.40).is_empty());
    }

    /// On a real memory: what each question would get (the model on this PC).
    #[test]
    #[ignore = "EI_MEANING_DIR=<model> EI_LINES=<memory lines> EI_QUESTIONS=<one per line> cargo test answers_on_a_real_memory -- --ignored --nocapture"]
    fn answers_on_a_real_memory() {
        let lines: Vec<String> = std::fs::read_to_string(std::env::var("EI_LINES").unwrap()).unwrap().lines().map(String::from).collect();
        let questions: Vec<String> = std::fs::read_to_string(std::env::var("EI_QUESTIONS").unwrap()).unwrap().lines().filter(|l| !l.trim().is_empty()).map(String::from).collect();
        let vectors = crate::meaning_local::embed(&lines).unwrap();
        let min = crate::memory_meaning::answer_min(crate::memory_meaning::LOCAL);
        for q in &questions {
            let qv = crate::meaning_local::embed(std::slice::from_ref(q)).unwrap().remove(0);
            let mut scored: Vec<(f32, String)> = vectors.iter().zip(&lines).map(|(v, l)| (v.iter().zip(&qv).map(|(a, b)| a * b).sum::<f32>(), l.clone())).collect();
            scored.sort_by(|a, b| b.0.total_cmp(&a.0));
            scored.truncate(5_000);
            let picked = pick(q, &scored, min);
            println!("\n«{q}» consultazione={} → {}", is_lookup(q), if picked.is_empty() { "MOTORE".to_string() } else { format!("MEMORIA ({})", picked.len()) });
            for l in &picked {
                println!("  → {}", shown(l).chars().take(150).collect::<String>());
            }
        }
    }

    #[test]
    fn lines_shown_plainly() {
        assert_eq!(shown("[[Farmacia Falchi]] - VM: FALCHI-DC"), "**Farmacia Falchi** — VM: FALCHI-DC");
        assert_eq!(shown("- 2026-11-02 il NAS di [[Rossi]] è un DS920+"), "2026-11-02 il NAS di Rossi è un DS920+");
    }
}
