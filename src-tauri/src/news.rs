// «Notizie» (asked by Edoardo on 30 October 2026, docs/idee.md → «Notizie dal
// web sugli argomenti della memoria»), step 1: the subjects the user cares
// about, read from the memory (brain.rs pages, MEMORIA.md notes, this month's
// diary). Nothing here goes on the network: it only proposes. A subject is
// searched only after the user added it in Impostazioni → Notizie, and the
// excluded ones never come back as proposals (`news.excluded` in settings).
//
// Pages about people and customers are never proposed: a search for them
// would send a name to an outside service. A page counts as one when its
// header says so («tipo: persona», «tipo: cliente»), when it holds an email
// address or a phone number, or when it is linked with a relation that names
// a person («cliente», «collega», «referente»…).

use std::collections::HashMap;

use serde::Serialize;

use crate::brain::{self, Page};

/// Proposals shown, at most.
const MAX_PROPOSALS: usize = 24;
/// A page updated within these days counts as recent.
const RECENT_DAYS: i64 = 30;

/// Relations ("- cliente: [[X]]") that make X a person or a customer.
const PERSON_RELATIONS: &[&str] = &[
    "cliente", "clienti", "collega", "colleghi", "referente", "contatto", "persona", "lavora con", "lavora per", "capo", "responsabile",
    "fornitore", "moglie", "marito", "figlio", "figlia", "padre", "madre", "amico", "amica", "socio", "dipendente", "titolare",
    "customer", "colleague", "contact", "person", "works with", "boss", "supplier",
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    /// The page's title: what the user sees and adds.
    pub name: String,
    /// The words a search would use: the title and its aliases.
    pub words: Vec<String>,
    /// Its summary line, to recognise it.
    pub summary: String,
    /// Why it is proposed («citata da 4 pagine», «aggiornata di recente»…).
    pub why: Vec<String>,
    pub score: u32,
}

fn has_email(text: &str) -> bool {
    text.split_whitespace().any(|w| {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.');
        match w.split_once('@') {
            Some((a, b)) => !a.is_empty() && b.contains('.') && !b.starts_with('.'),
            None => false,
        }
    })
}

/// Nine digits or more in a row (single spaces, dashes or slashes allowed in between): a
/// phone number. Dots break the run, so IP addresses and versions are not phones.
fn has_phone(text: &str) -> bool {
    let mut run = 0;
    let mut gap = false;
    for c in text.chars() {
        if c.is_ascii_digit() {
            run += 1;
            gap = false;
            if run >= 9 {
                return true;
            }
        } else if matches!(c, ' ' | '-' | '/') && run > 0 && !gap {
            gap = true;
        } else if c == '+' && run == 0 {
        } else {
            run = 0;
            gap = false;
        }
    }
    false
}

/// The header's «tipo:» line, lowercase ("" if none).
fn kind_of(page: &Page) -> String {
    // parse() keeps unknown header lines in the body: the first lines say it.
    page.body
        .lines()
        .take(6)
        .find_map(|l| l.trim().strip_prefix("tipo:").map(|v| v.trim().to_lowercase()))
        .unwrap_or_default()
}

/// A page about a person or a customer: never proposed (see the top of the file).
fn is_person(page: &Page, all: &[Page]) -> bool {
    let kind = kind_of(page);
    if ["persona", "cliente", "contatto", "person", "customer", "contact"].iter().any(|k| kind.contains(k)) {
        return true;
    }
    if has_email(&page.body) || has_phone(&page.body) {
        return true;
    }
    let names: Vec<String> = std::iter::once(page.title.to_lowercase()).chain(page.aliases.iter().map(|a| a.to_lowercase())).collect();
    all.iter().any(|p| {
        p.links.iter().any(|l| {
            let rel = l.rel.to_lowercase();
            names.contains(&l.target.to_lowercase()) && PERSON_RELATIONS.iter().any(|r| rel == *r || rel.starts_with(&format!("{r} ")))
        })
    })
}

/// How many times a subject's names appear in a text (whole words, any case).
fn mentions(text_lower: &str, names: &[String]) -> u32 {
    let mut n = 0u32;
    for name in names {
        let name = name.to_lowercase();
        if name.chars().count() < 3 {
            continue;
        }
        let mut rest = text_lower;
        while let Some(i) = rest.find(&name) {
            let before = rest.get(..i).and_then(|b| b.chars().last()).is_none_or(|c| !c.is_alphanumeric());
            let after_text = rest.get(i + name.len()..).unwrap_or_default();
            let after = after_text.chars().next().is_none_or(|c| !c.is_alphanumeric());
            if before && after {
                n += 1;
            }
            rest = after_text;
        }
    }
    n
}

/// The subjects the memory talks about, best first, without people and customers
/// and without `excluded` (names, any case).
pub fn proposals(excluded: &[String]) -> Vec<Topic> {
    let all = brain::pages();
    let notes = crate::memory::notes().join("\n").to_lowercase();
    let diary = crate::memory::diary_month().to_lowercase();
    let today = crate::memory::stamp().get(..10).and_then(brain::day_number).unwrap_or(0);
    let excluded: Vec<String> = excluded.iter().map(|x| x.trim().to_lowercase()).collect();
    // Links pointing at each page, by lowercase title or alias.
    let mut cited: HashMap<String, u32> = HashMap::new();
    for p in &all {
        for l in &p.links {
            *cited.entry(l.target.to_lowercase()).or_default() += 1;
        }
    }
    let mut out = Vec::new();
    for p in &all {
        let names: Vec<String> = std::iter::once(p.title.clone()).chain(p.aliases.iter().cloned()).collect();
        if names.iter().any(|n| excluded.contains(&n.to_lowercase())) || is_person(p, &all) {
            continue;
        }
        let mut why = Vec::new();
        let links: u32 = names.iter().map(|n| cited.get(&n.to_lowercase()).copied().unwrap_or(0)).sum();
        let in_notes = mentions(&notes, &names);
        let in_diary = mentions(&diary, &names);
        let recent = brain::day_number(&p.updated).is_some_and(|d| today - d <= RECENT_DAYS);
        if links > 0 {
            why.push(format!("links:{links}"));
        }
        if in_notes > 0 {
            why.push(format!("notes:{in_notes}"));
        }
        if in_diary > 0 {
            why.push(format!("diary:{in_diary}"));
        }
        if recent {
            why.push("recent".to_string());
        }
        let score = links * 3 + in_notes * 2 + in_diary.min(10) + if recent { 3 } else { 0 } + p.links.len().min(5) as u32;
        if score == 0 {
            continue;
        }
        out.push(Topic { name: p.title.clone(), words: names, summary: p.summary.clone(), why, score });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    out.truncate(MAX_PROPOSALS);
    out
}

/// Impostazioni → Notizie: what the memory proposes now.
#[tauri::command]
pub async fn news_proposals(excluded: Vec<String>) -> Result<Vec<Topic>, String> {
    tauri::async_runtime::spawn_blocking(move || proposals(&excluded)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(title: &str, body: &str) -> Page {
        brain::parse(&brain::slug(title), &format!("# {title}\n\n{body}"))
    }

    #[test]
    fn people_and_customers_are_never_proposed() {
        let all = vec![
            page("UniFi", "Rete dell'ufficio.\n- usato da: [[Rossi Srl]]"),
            page("Rossi Srl", "tipo: cliente\nSede a Milano."),
            page("Mario Bianchi", "mario@esempio.it"),
            page("Luca", "Tel. 333 123 4567"),
            page("Anna", "Grafica."),
            page("Progetto X", "- referente: [[Anna]]"),
        ];
        assert!(!is_person(&all[0], &all));
        assert!(is_person(&all[1], &all), "tipo: cliente");
        assert!(is_person(&all[2], &all), "email");
        assert!(is_person(&all[3], &all), "phone");
        assert!(is_person(&all[4], &all), "linked as referente");
    }

    #[test]
    fn mentions_count_whole_words_only() {
        let names = vec!["Tauri".to_string()];
        assert_eq!(mentions("tauri e tauri 2, non tauriano", &names), 2);
        assert_eq!(mentions("", &names), 0);
    }

    /// `cargo test live_proposals -- --ignored --nocapture`: the proposals from this PC's memory.
    #[test]
    #[ignore]
    fn live_proposals() {
        for t in proposals(&[]) {
            println!("{:>3} {} {:?} {:?}", t.score, t.name, t.words, t.why);
        }
    }

    #[test]
    fn phone_numbers_and_not_dates() {
        assert!(has_phone("+39 02 1234 5678"));
        assert!(!has_phone("aggiornata: 2026-10-30"));
        assert!(!has_phone("versione 1.0.13"));
        assert!(!has_phone("server 192.168.100.123"));
    }
}
