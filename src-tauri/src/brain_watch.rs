// The second brain at work (asked by Edoardo on 31 October 2026, towards a
// personal assistant): what happens during the day keeps the memory's pages
// of people and customers up to date, and the commitments made become
// reminders. Nothing is written without a click.
//
//   * A Zammad ticket of mine that closes (zammad.rs): its first and last
//     messages, i.e. the problem and how it was solved.
//   * An important mail (Microsoft 365 through msgraph.rs; classic Outlook has
//     no text to read here): marked high importance, or from someone or a
//     company that has a page in the memory.
//   * A 3CX call is not here: EasyIsland knows who and how long, not what was
//     said, so the island offers «Annota» instead (moments.rs, `call`), which
//     goes through «Ricorda questo» like any capture.
//
// They wait in a queue; ten minutes after the last one (a burst of mails is one
// job), a task (tasks.rs `brain_job`) reads them, looks for the pages, and
// proposes with task_ask one or two lines per page and the commitments, with
// «Fai tutto» / «Niente». Only what the user approves is written. At most
// MAX_JOBS_PER_DAY jobs a day; each kind is a switch in Impostazioni → Flussi.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::i18n::{t, tf};
use crate::msgraph::Mail;

/// Quiet time after the last event before the job starts.
const QUIET: Duration = Duration::from_secs(10 * 60);
const MAX_QUEUE: usize = 20;
const MAX_JOBS_PER_DAY: u32 = 8;
/// Webmail domains: their name says nothing about a customer.
const WEBMAIL: &[&str] = &[
    "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "icloud", "me", "libero", "virgilio",
    "alice", "tin", "tiscali", "fastwebnet", "aruba", "pec", "legalmail", "email", "mail", "proton", "protonmail",
];

/// Something that happened, for the job.
#[derive(Clone, Debug, PartialEq)]
pub struct Happened {
    /// "ticket" | "mail".
    pub kind: &'static str,
    pub title: String,
    pub text: String,
    /// Where to open it ("" if none).
    pub link: String,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static QUEUE: Mutex<Vec<Happened>> = Mutex::new(Vec::new());
static LAST: Mutex<Option<Instant>> = Mutex::new(None);
static WAITING: AtomicBool = AtomicBool::new(false);
/// Jobs started today: (day, count).
static TODAY: Mutex<(String, u32)> = Mutex::new((String::new(), 0));
/// Mails already looked at (by Graph id); None until the first look, which only sets the baseline.
static SEEN_MAIL: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Is this kind ("ticket", "mail") switched on.
pub fn wants(kind: &str) -> bool {
    let Some(app) = APP.get() else { return false };
    let Some(shared) = app.try_state::<crate::Shared>() else { return false };
    let s = shared.settings.lock().unwrap();
    match kind {
        "ticket" => s.brain_tickets,
        "mail" => s.brain_mail,
        _ => false,
    }
}

pub fn wants_promises() -> bool {
    APP.get()
        .and_then(|app| app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().brain_promises))
        .unwrap_or(false)
}

/// Into the queue; the job starts QUIET after the last one.
pub fn note(h: Happened) {
    if !wants(h.kind) {
        return;
    }
    {
        let mut q = QUEUE.lock().unwrap();
        if q.len() >= MAX_QUEUE || q.iter().any(|x| x.kind == h.kind && x.title == h.title) {
            return;
        }
        crate::log::line(format!("secondo cervello: in coda ({})", h.kind));
        q.push(h);
    }
    *LAST.lock().unwrap() = Some(Instant::now());
    if WAITING.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(app) = APP.get().cloned() else { return };
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let quiet = LAST.lock().unwrap().is_none_or(|at| at.elapsed() >= QUIET);
            if quiet && !crate::tasks::brain_job_running() {
                break;
            }
        }
        WAITING.store(false, Ordering::SeqCst);
        let list: Vec<Happened> = std::mem::take(&mut *QUEUE.lock().unwrap());
        if list.is_empty() || !may_start_today() {
            return;
        }
        if let Err(e) = crate::tasks::brain_job(&app, &goal(&list, wants_promises())) {
            crate::log::line(format!("secondo cervello: {e}"));
        }
    });
}

fn may_start_today() -> bool {
    let day: String = crate::memory::stamp().chars().take(10).collect();
    let mut today = TODAY.lock().unwrap();
    if today.0 != day {
        *today = (day, 0);
    }
    if today.1 >= MAX_JOBS_PER_DAY {
        crate::log::line("secondo cervello: limite del giorno raggiunto");
        return false;
    }
    today.1 += 1;
    true
}

/// The task's goal: what happened, and what to propose.
pub fn goal(list: &[Happened], promises: bool) -> String {
    let events = list
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let link = if h.link.is_empty() { String::new() } else { format!(" ({})", h.link) };
            format!("{}. {}{link}\n{}", i + 1, h.title, h.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let promises = if promises {
        t("Cerca anche gli impegni presi, dall'utente o verso di lui («ti mando domani il preventivo», «richiamo giovedì»): con chi, cosa e la scadenza. Proponili come promemoria.")
    } else {
        ""
    };
    tf(
        "[Secondo cervello: tieni aggiornata la memoria con quello che è successo.\n\n{events}\n\nPer ognuno cerca con memory_search e memory_page la pagina della persona, del cliente o del progetto. Prepara al massimo due righe da aggiungere per pagina, solo fatti utili nei prossimi mesi (cosa ha chiesto, cosa si è deciso, come si è risolto un problema, una preferenza), non già scritti, senza password o dati sensibili; una pagina nuova solo per un cliente o una persona che torneranno. {promises} Mostra tutto con task_ask, una proposta per riga numerata («Rossi Srl: + …», «Promemoria: … entro …»), con le opzioni «Fai tutto» e «Niente» (l'utente può scrivere i numeri che vuole). Poi fai solo quelle approvate: memory_page_write partendo dal testo e dalla versione letti, con la riga in fondo preceduta dalla data; i promemoria con todo_add (con la scadenza) se c'è, altrimenti in fondo alla pagina «Impegni» della memoria. Se non c'è niente che valga la pena chiudi con task_done e quiet true, senza chiedere; altrimenti con task_done e cosa hai scritto.]",
        &[("events", &events), ("promises", &promises)],
    )
}

// ── Mail ──────────────────────────────────────────────────────────────────────

/// The unread mails Graph gave (msgraph.rs): the new important ones go in the queue.
pub fn mails(list: &[Mail]) {
    if !wants("mail") {
        return;
    }
    let fresh: Vec<&Mail> = {
        let mut guard = SEEN_MAIL.lock().unwrap();
        let first = guard.is_none();
        let seen = guard.get_or_insert_with(HashSet::new);
        let fresh = list.iter().filter(|m| !m.id.is_empty() && seen.insert(m.id.clone())).collect::<Vec<_>>();
        if first { Vec::new() } else { fresh }
    };
    for m in fresh {
        let page = known_sender(&m.from, &m.address, &crate::brain::page_named);
        if m.importance != "high" && page.is_none() {
            continue;
        }
        let why = match page {
            Some(p) => tf("mittente con una pagina in memoria: {p}", &[("p", &p)]),
            None => t("segnata come importante").to_string(),
        };
        note(Happened {
            kind: "mail",
            title: tf("Mail da {from}: {subject} ({why})", &[("from", &m.from), ("subject", &m.subject), ("why", &why)]),
            text: m.preview.clone(),
            link: m.web_link.clone(),
        });
    }
}

/// The page of a sender, by name or by the company in the address
/// ("mario@rossi-impianti.it" → "rossi"), never by a webmail's name.
fn known_sender(name: &str, address: &str, page_named: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if name.split_whitespace().count() >= 2 || name.chars().count() >= 5 {
        if let Some(p) = page_named(name) {
            return Some(p);
        }
    }
    let domain = address.rsplit_once('@').map(|(_, d)| d.to_lowercase())?;
    let stem = domain.split('.').next().unwrap_or_default();
    let word = stem.split(['-', '_']).find(|w| w.chars().count() >= 4)?;
    if WEBMAIL.contains(&stem) {
        return None;
    }
    page_named(word)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn senders_are_found_by_name_or_company() {
        let pages = |q: &str| -> Option<String> {
            let q = q.to_lowercase();
            ["Rossi Impianti", "Anna Bianchi"].iter().find(|p| q.split_whitespace().all(|w| p.to_lowercase().contains(w))).map(|p| p.to_string())
        };
        assert_eq!(known_sender("Anna Bianchi", "anna@gmail.com", &pages), Some("Anna Bianchi".into()));
        assert_eq!(known_sender("Ufficio", "info@rossi-impianti.it", &pages), Some("Rossi Impianti".into()));
        assert_eq!(known_sender("Mario", "rossi.mario@gmail.com", &pages), None);
        assert_eq!(known_sender("", "nobody", &pages), None);
    }

    #[test]
    fn the_goal_lists_what_happened() {
        let list = vec![
            Happened { kind: "ticket", title: "Ticket chiuso: #10342 Stampante — Rossi Srl".into(), text: "U1: non stampa\n---\nU2: driver aggiornato".into(), link: "https://z/#ticket/zoom/1".into() },
            Happened { kind: "mail", title: "Mail da Anna".into(), text: "Ti mando venerdì il contratto".into(), link: String::new() },
        ];
        let g = goal(&list, true);
        assert!(g.contains("1. Ticket chiuso: #10342 Stampante — Rossi Srl (https://z/#ticket/zoom/1)\nU1: non stampa"));
        assert!(g.contains("2. Mail da Anna\nTi mando venerdì il contratto"));
        assert!(g.contains("impegni presi"));
        assert!(!goal(&list, false).contains("impegni presi"));
    }
}
