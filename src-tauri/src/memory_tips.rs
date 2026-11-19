// «Puoi chiedere:» from the memory (15 Nov 2026, Edoardo: «i suggerimenti
// potrebbero essere un po' più intelligenti, specifici e di più grazie a
// potion?»). The chat's tips (src/views/chat-tips.ts) ask here with what is in
// front of the user — the Anteprima's page, the files in the Vassoio, the last
// question of the conversation — never in an empty chat with nothing on screen
// (the choice of 9 Nov: no generic questions).
//   1. the memory's pages that text names (title or alias); only when it names
//      none, the closest in meaning (memory_meaning::near_pages, quiet, with
//      Potion or the service chosen);
//   2. for each, questions made of its own lines: «Cosa sai di X?» (its
//      summary) and «Che <campo> ha X?» for its «campo: valore» lines;
//   3. only the ones the memory answers by itself (memory_answer::pick on the
//      words, no model): a click and the answer comes at once, no tokens;
//      never one already asked in the conversation.

use serde::Serialize;
use tauri::AppHandle;

use crate::i18n::tf;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Tip {
    pub label: String,
    pub prompt: String,
}

const MAX_PAGES: usize = 2;
const MAX_TIPS: usize = 6;
const PER_PAGE_FIELDS: usize = 2;

fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' => 'a',
            'è' | 'é' => 'e',
            'ì' | 'í' => 'i',
            'ò' | 'ó' => 'o',
            'ù' | 'ú' => 'u',
            c => c,
        })
        .collect()
}

/// The words of a name that count: not common, three letters or more.
fn name_words(name: &str) -> Vec<String> {
    crate::memory_answer::words(&fold(name))
        .into_iter()
        .filter(|w| w.chars().count() >= 3 && !crate::memory_answer::is_common(w))
        .collect()
}

/// The pages whose title or alias is in the text: every word of the name
/// there, one of four letters or more. The longer names first.
fn named_pages(pages: &[crate::brain::Page], text: &str) -> Vec<String> {
    let said: Vec<String> = crate::memory_answer::words(&fold(text));
    let mut hits: Vec<(usize, &str)> = Vec::new();
    for p in pages {
        let best = std::iter::once(&p.title)
            .chain(p.aliases.iter())
            .map(|n| name_words(n))
            .filter(|w| !w.is_empty() && w.iter().any(|x| x.chars().count() >= 4) && w.iter().all(|x| said.contains(x)))
            .map(|w| w.len())
            .max();
        if let Some(n) = best {
            hits.push((n, &p.title));
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0));
    hits.into_iter().map(|(_, t)| t.to_string()).collect()
}

/// «VM: FALCHI-DC, …» → «VM»: a short name before a colon, not a date nor a
/// line that only holds the page together.
fn field(line: &str) -> Option<String> {
    let line = line.trim().trim_start_matches("- ").trim();
    if crate::memory_answer::structural(line) {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    let key = key.trim().trim_matches('*').trim();
    if rest.trim().is_empty() || key.is_empty() || key.chars().count() > 24 || key.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let w = crate::memory_answer::words(key);
    if w.is_empty() || w.len() > 3 || crate::memory_answer::is_common(&w[0]) || !key.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '/' || c == '-') {
        return None;
    }
    Some(key.to_string())
}

/// The questions about one page, in order: its summary, then its fields.
fn page_questions(page: &crate::brain::Page) -> Vec<Tip> {
    let mut out = Vec::new();
    if page.summary.trim().chars().count() > 20 {
        out.push(Tip {
            label: tf("Cosa so di {p}", &[("p", &page.title)]),
            prompt: tf("Cosa sai di {p}?", &[("p", &page.title)]),
        });
    }
    let mut keys: Vec<String> = Vec::new();
    for l in page.body.lines() {
        if let Some(k) = field(l) {
            if !keys.iter().any(|x| x.eq_ignore_ascii_case(&k)) {
                keys.push(k);
            }
        }
        if keys.len() >= PER_PAGE_FIELDS * 2 {
            break;
        }
    }
    for k in keys {
        out.push(Tip {
            label: tf("{k} di {p}", &[("k", &k), ("p", &page.title)]),
            prompt: tf("Che {k} ha {p}?", &[("k", &k), ("p", &page.title)]),
        });
    }
    out
}

/// The tips for this text, best first; `asked`: the conversation's questions.
pub async fn tips(app: &AppHandle, text: &str, asked: &[String]) -> Vec<Tip> {
    let remember = tauri::Manager::try_state::<crate::Shared>(app).is_some_and(|s| s.settings.lock().unwrap().chat_history);
    if !remember || text.trim().chars().count() < 3 {
        return Vec::new();
    }
    let pages = tauri::async_runtime::spawn_blocking(crate::brain::pages).await.unwrap_or_default();
    if pages.is_empty() {
        return Vec::new();
    }
    let mut titles = named_pages(&pages, text);
    // The meaning only when the text names no page: «che PC ha Vetro Latino?»
    // brought Imec too, a client with similar notes (15 Nov 2026).
    if titles.is_empty() {
        for t in crate::memory_meaning::near_pages(app, text, MAX_PAGES).await {
            if !titles.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                titles.push(t);
            }
        }
    }
    titles.truncate(MAX_PAGES);
    if titles.is_empty() {
        return Vec::new();
    }
    let lines: Vec<(f32, String)> = crate::memory_meaning::all_lines().await.into_iter().map(|l| (0.0, l)).collect();
    let mut per_page: Vec<Vec<Tip>> = titles
        .iter()
        .filter_map(|t| pages.iter().find(|p| p.title == *t))
        .map(|p| {
            page_questions(p)
                .into_iter()
                .filter(|tip| !asked.iter().any(|q| crate::memory_answer::similar(q, &tip.prompt)))
                .filter(|tip| !crate::memory_answer::pick(&tip.prompt, &lines, 0.0).is_empty())
                .collect()
        })
        .collect();
    // One from each page in turn, so two pages both show.
    let mut out: Vec<Tip> = Vec::new();
    while out.len() < MAX_TIPS && per_page.iter().any(|v| !v.is_empty()) {
        for v in per_page.iter_mut() {
            if !v.is_empty() && out.len() < MAX_TIPS {
                out.push(v.remove(0));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(title: &str, summary: &str, body: &str) -> crate::brain::Page {
        crate::brain::Page { slug: String::new(), title: title.into(), source: String::new(), updated: String::new(), summary: summary.into(), aliases: vec![], kind: String::new(), body: body.into(), links: vec![] }
    }

    #[test]
    fn pages_named_and_their_questions() {
        let falchi = page("Farmacia Falchi", "Farmacia comunale cliente, con Proxmox falchi-pve01", "- VM: FALCHI-DC, FALCHI-WINFARM\n- parte di: [[Farmacie comunali]]\n- Da fare: job di backup\n- 2026-11-14: nota\n- Host: falchi-pve01");
        let rossi = page("Rossi", "", "- NAS: DS920+");
        let pages = vec![falchi.clone(), rossi];
        assert_eq!(named_pages(&pages, "quale vm ha la farmacia falchi?"), vec!["Farmacia Falchi".to_string()]);
        assert!(named_pages(&pages, "che tempo fa oggi?").is_empty());
        let q: Vec<String> = page_questions(&falchi).into_iter().map(|t| t.prompt).collect();
        assert_eq!(q, vec!["Cosa sai di Farmacia Falchi?", "Che VM ha Farmacia Falchi?", "Che Host ha Farmacia Falchi?"]);
        // A question the memory answers, a tip only if it is not asked already.
        assert!(crate::memory_answer::is_lookup("Cosa sai di Farmacia Falchi?"));
        assert!(crate::memory_answer::similar("quale vm ha la farmacia falchi?", "Che VM ha Farmacia Falchi?"));
    }
}
