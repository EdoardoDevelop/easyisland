// The map of Agent Chat (asked by Edoardo on 4 Nov 2026): the engines read
// only the last messages of a room, so they did not know what was decided
// days ago, what is still open, who is on what. Here the whole chat (up to
// KEEP messages, from the server and then as they arrive) becomes a list of
// topics, built without any engine and so without tokens:
// - a request of the owner opens a topic; a short follow-up of theirs («ok»,
//   «procedi», «sì grazie») stays in the topic before it;
// - the agents' messages after it belong to it; a consult and its thread are
//   a topic of their own;
// - «FATTO:» / «BLOCCATO:» at the start of an agent's message give its state
//   (the rules ask the engines for them), no answer yet = «da fare»;
// - who: the agents that wrote in it and who took it on (claim).
// The turn's prompt gets the map, compact, beside the last messages; the
// engine reads a whole topic or searches the old messages with
// agentchat_topic. The island's card lists the topics («Argomenti»).

use crate::agentchat::Msg;
use crate::i18n::{t, tf};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

/// Messages kept for the map (the oldest go first).
const KEEP: usize = 3000;
/// Topics in a turn's prompt, most recent first.
const IN_PROMPT: usize = 25;
/// Messages of a topic given by agentchat_topic, the last ones.
const TOPIC_MAX: usize = 80;

static ALL: Mutex<BTreeMap<i64, Msg>> = Mutex::new(BTreeMap::new());

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Topic {
    /// Its first message's id.
    pub id: i64,
    pub room: String,
    pub title: String,
    /// "da fare", "aperto", "fatto", "bloccato".
    pub state: &'static str,
    /// The agents in it (their names), the one who took it on first.
    pub who: Vec<String>,
    /// First and last message (seconds).
    pub first: f64,
    pub last: f64,
    pub ids: Vec<i64>,
    pub consult: bool,
    /// The last message, short.
    pub last_line: String,
}

/// New messages (from the server or as they arrive).
pub fn add(list: &[Msg]) {
    let mut all = ALL.lock().unwrap();
    for m in list {
        all.insert(m.id, m.clone());
    }
    while all.len() > KEEP {
        let Some(first) = all.keys().next().copied() else { break };
        all.remove(&first);
    }
}

/// Another server or another account: the map starts again.
pub fn reset(list: &[Msg]) {
    ALL.lock().unwrap().clear();
    add(list);
}

/// A short reply of the owner that carries on the topic before it.
fn follow_up(text: &str) -> bool {
    let s = text.trim().to_lowercase();
    if s.is_empty() || s.contains('?') {
        return s.is_empty();
    }
    let words = s.split_whitespace().count();
    words <= 3 && s.chars().count() <= 30
}

fn is_owner(m: &Msg, owner: &str) -> bool {
    (m.human && m.verified) || (!owner.is_empty() && m.sender.eq_ignore_ascii_case(owner))
}

fn short(text: &str, n: usize) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default();
    if line.chars().count() > n {
        format!("{}…", line.chars().take(n - 1).collect::<String>())
    } else {
        line.to_string()
    }
}

/// The topics of `msgs` (any order), oldest first. `name` turns a handle into its name.
pub fn build(msgs: &[Msg], owner: &str, name: &dyn Fn(&str) -> String) -> Vec<Topic> {
    let mut list: Vec<&Msg> = msgs.iter().collect();
    list.sort_by_key(|m| m.id);
    let mut topics: Vec<Topic> = Vec::new();
    let mut current: HashMap<String, usize> = HashMap::new();
    let mut consults: HashMap<i64, usize> = HashMap::new();
    for m in list {
        let mine = is_owner(m, owner);
        // A consult's answers go to it; the consult is a topic of its own.
        let at = if let Some(i) = m.thread.and_then(|th| consults.get(&th).copied()) {
            Some(i)
        } else if m.kind == "consult" {
            None
        } else if mine && !(follow_up(&m.text) && current.contains_key(&m.room)) {
            None
        } else {
            current.get(&m.room).copied()
        };
        let i = match at {
            Some(i) => i,
            None => {
                topics.push(Topic {
                    id: m.id,
                    room: m.room.clone(),
                    title: short(&m.text, 90),
                    state: "da fare",
                    who: Vec::new(),
                    first: m.ts,
                    last: m.ts,
                    ids: Vec::new(),
                    consult: m.kind == "consult",
                    last_line: String::new(),
                });
                let i = topics.len() - 1;
                if m.kind == "consult" {
                    consults.insert(m.id, i);
                } else {
                    current.insert(m.room.clone(), i);
                }
                i
            }
        };
        let tp = &mut topics[i];
        tp.ids.push(m.id);
        tp.last = tp.last.max(m.ts);
        tp.last_line = short(&m.text, 120);
        if let Some(c) = m.claimed_by.as_deref() {
            let n = name(c);
            if !tp.who.contains(&n) {
                tp.who.insert(0, n);
            }
        }
        if mine {
            continue;
        }
        let n = name(&m.sender);
        if !tp.who.contains(&n) {
            tp.who.push(n);
        }
        let head = m.text.trim_start().to_uppercase();
        tp.state = if head.starts_with("FATTO") {
            "fatto"
        } else if head.starts_with("BLOCCATO") {
            "bloccato"
        } else if tp.state == "da fare" {
            "aperto"
        } else {
            tp.state
        };
    }
    topics
}

/// The map now, most recent first.
pub fn topics(owner: &str, name: &dyn Fn(&str) -> String) -> Vec<Topic> {
    let all: Vec<Msg> = ALL.lock().unwrap().values().cloned().collect();
    let mut list = build(&all, owner, name);
    list.sort_by(|a, b| b.last.partial_cmp(&a.last).unwrap_or(std::cmp::Ordering::Equal));
    list
}

fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// "5 min fa", "2 h fa", "3 g fa".
fn ago(ts: f64) -> String {
    let s = (now() - ts).max(0.0) as u64;
    if s < 3600 {
        tf("{n} min fa", &[("n", &(s / 60).max(1))])
    } else if s < 86_400 {
        tf("{n} h fa", &[("n", &(s / 3600))])
    } else {
        tf("{n} g fa", &[("n", &(s / 86_400))])
    }
}

fn state_name(s: &str) -> String {
    match s {
        "fatto" => t("fatto"),
        "bloccato" => t("bloccato"),
        "aperto" => t("aperto"),
        _ => t("da fare"),
    }
    .to_string()
}

/// The map for a turn's prompt: the topics, compact, most recent first.
pub fn prompt(owner: &str, name: &dyn Fn(&str) -> String) -> String {
    let list = topics(owner, name);
    if list.len() < 2 {
        return String::new();
    }
    let mut out = tf(
        "\n\nMappa della chat ({n} argomenti, dal più recente; l'id è quello del primo messaggio). Usala per sapere cosa si è già deciso o fatto e chi ci lavora; per leggere un argomento intero o cercare nei messaggi vecchi usa agentchat_topic (id, oppure query).",
        &[("n", &list.len())],
    );
    for tp in list.iter().take(IN_PROMPT) {
        let who = if tp.who.is_empty() { String::new() } else { format!(" · {}", tp.who.join(", ")) };
        let kind = if tp.consult { format!(" ({})", t("consulta")) } else { String::new() };
        out.push_str(&format!(
            "\n- #{} [{}]{kind} «{}» — {}{who} · {} · {}",
            tp.id,
            tp.room,
            tp.title,
            state_name(tp.state),
            tf("{n} messaggi", &[("n", &tp.ids.len())]),
            ago(tp.last)
        ));
    }
    if list.len() > IN_PROMPT {
        out.push_str(&tf("\n(e altri {n} più vecchi: cercali con agentchat_topic)", &[("n", &(list.len() - IN_PROMPT))]));
    }
    out
}

/// agentchat_topic: a whole topic (`id`, any of its messages) or the old
/// messages with every word of `query`; `line` writes one message.
pub fn read(id: Option<i64>, query: &str, owner: &str, name: &dyn Fn(&str) -> String, line: &dyn Fn(&Msg) -> String) -> Result<String, String> {
    let all = ALL.lock().unwrap().clone();
    if let Some(id) = id {
        let msgs: Vec<Msg> = all.values().cloned().collect();
        let tp = build(&msgs, owner, name)
            .into_iter()
            .find(|tp| tp.ids.contains(&id))
            .ok_or_else(|| tf("Nessun argomento con il messaggio #{id} (forse è troppo vecchio).", &[("id", &id)]))?;
        let skip = tp.ids.len().saturating_sub(TOPIC_MAX);
        let mut out = tf(
            "Argomento #{id} «{title}» — {state}, {n} messaggi:",
            &[("id", &tp.id), ("title", &tp.title), ("state", &state_name(tp.state)), ("n", &tp.ids.len())],
        );
        if skip > 0 {
            out.push_str(&tf("\n(i primi {n} non sono mostrati)", &[("n", &skip)]));
        }
        for mid in tp.ids.iter().skip(skip) {
            if let Some(m) = all.get(mid) {
                out.push('\n');
                out.push_str(&line(m));
            }
        }
        return Ok(out);
    }
    let words: Vec<String> = query.to_lowercase().split_whitespace().take(6).map(String::from).collect();
    if words.is_empty() {
        return Err(t("id: l'argomento (un suo messaggio), oppure query: le parole da cercare.").into());
    }
    let found: Vec<&Msg> = all
        .values()
        .rev()
        .filter(|m| {
            let text = format!("{} {}", m.text, m.sender).to_lowercase();
            words.iter().all(|w| text.contains(w.as_str()))
        })
        .take(30)
        .collect();
    if found.is_empty() {
        return Ok(t("Nessun messaggio con queste parole.").into());
    }
    let mut out = tf("{n} messaggi trovati (dal più recente):", &[("n", &found.len())]);
    for m in found {
        out.push('\n');
        out.push_str(&line(m));
    }
    Ok(out)
}

/// The messages of the topic with message `id` (the card's «Argomenti»), oldest first.
pub fn messages_of(id: i64, owner: &str, name: &dyn Fn(&str) -> String) -> Vec<Msg> {
    let all = ALL.lock().unwrap().clone();
    let msgs: Vec<Msg> = all.values().cloned().collect();
    build(&msgs, owner, name)
        .into_iter()
        .find(|tp| tp.ids.contains(&id))
        .map(|tp| tp.ids.iter().filter_map(|i| all.get(i).cloned()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: i64, sender: &str, text: &str, human: bool) -> Msg {
        serde_json::from_value(serde_json::json!({ "id": id, "room": "general", "sender": sender, "text": text, "verified": true, "human": human, "ts": id as f64 })).unwrap()
    }

    #[test]
    fn requests_open_topics_and_markers_close_them() {
        let msgs = vec![
            msg(1, "edoardo", "Controlla il backup del NAS di Rossi", true),
            msg(2, "casa/claude", "Sto guardando i log del NAS.", false),
            msg(3, "casa/claude", "FATTO: backup ok, ultimo stanotte alle 2.", false),
            msg(4, "edoardo", "ok grazie", true),
            msg(5, "edoardo", "Prepara il preventivo per Verdi?", true),
            msg(6, "lavoro/codex", "BLOCCATO: manca il listino 2026.", false),
            msg(7, "edoardo", "Riavvia la stampante dell'ufficio", true),
        ];
        let tps = build(&msgs, "edoardo", &|h| h.to_string());
        assert_eq!(tps.len(), 3);
        assert_eq!(tps[0].ids, vec![1, 2, 3, 4]);
        assert_eq!(tps[0].state, "fatto");
        assert_eq!(tps[0].who, vec!["casa/claude".to_string()]);
        assert_eq!(tps[1].state, "bloccato");
        assert_eq!(tps[2].state, "da fare");
    }

    #[test]
    fn a_consult_keeps_its_thread() {
        let mut c = msg(10, "edoardo", "Meglio Proxmox o Hyper-V?", true);
        c.kind = "consult".into();
        let mut a = msg(12, "casa/claude", "Proxmox.", false);
        a.thread = Some(10);
        let other = msg(11, "edoardo", "Intanto riavvia il router", true);
        let tps = build(&[c, other, a], "edoardo", &|h| h.to_string());
        assert_eq!(tps.len(), 2);
        assert!(tps[0].consult);
        assert_eq!(tps[0].ids, vec![10, 12]);
        assert_eq!(tps[1].ids, vec![11]);
    }
}
