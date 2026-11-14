// Comandi senza motore (14 Nov 2026, Edoardo: «1, 2 e 4»): a short order in
// the chat — one of the user's quick actions, a profile, the music, a To Do
// reminder — is recognised with fixed rules and offered with a button
// (router.rs `offer`). Nothing runs until the user presses «Esegui»
// (lib.rs chat_command_run, only the tools in RUNS). Programs are opened only
// through the user's own quick actions: a name alone is the engine's to find.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::i18n::{t, tf};

/// The tools a command may run, after the click.
pub const RUNS: &[&str] = &["run_quick_action", "switch_profile", "media_control", "todo_add"];

/// Longer than this is a question, not an order.
const MAX_WORDS: usize = 9;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Command {
    pub tool: String,
    pub args: Value,
    /// What the button does, in words: «Azione rapida «Teams»».
    pub label: String,
}

fn command(tool: &str, args: Value, label: String) -> Option<Command> {
    Some(Command { tool: tool.into(), args, label })
}

fn plain(text: &str) -> String {
    text.trim()
        .trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | ' '))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// What follows one of the starts, if the text begins with one.
fn after<'a>(text: &'a str, starts: &[&str]) -> Option<&'a str> {
    starts.iter().find_map(|s| text.strip_prefix(s).map(str::trim)).filter(|r| !r.is_empty())
}

fn name_of(v: &Value) -> &str {
    v.get("name").and_then(Value::as_str).unwrap_or_default()
}

const MUSIC: &[(&[&str], &str)] = &[
    (&["pausa", "metti in pausa", "metti pausa", "ferma la musica", "stop musica", "riprendi la musica", "fai partire la musica", "play", "pause"], "toggle"),
    (&["prossima canzone", "canzone successiva", "brano successivo", "prossimo brano", "salta canzone", "salta questa canzone", "next"], "next"),
    (&["canzone precedente", "brano precedente", "torna alla canzone di prima", "previous"], "prev"),
];

/// The command a chat question is, if it is one. `actions` and `profiles`
/// are the user's (settings), as JSON values with "id" and "name".
pub fn parse(question: &str, actions: &[Value], profiles: &[(String, String)]) -> Option<Command> {
    let q = plain(question);
    if q.is_empty() || question.trim().contains('\n') || q.split(' ').count() > MAX_WORDS {
        return None;
    }
    for (phrases, cmd) in MUSIC {
        if phrases.contains(&q.as_str()) {
            let label = match *cmd {
                "next" => t("Musica: brano successivo"),
                "prev" => t("Musica: brano precedente"),
                _ => t("Musica: pausa o riprendi"),
            };
            return command("media_control", json!({ "command": cmd }), label.to_string());
        }
    }
    // One of the user's quick actions, by its name.
    let named = |rest: &str| actions.iter().find(|a| !name_of(a).is_empty() && plain(name_of(a)) == plain(rest));
    if let Some(rest) = after(&q, &["esegui l'azione", "esegui", "avvia", "apri", "lancia", "fai partire"]) {
        let rest = rest.trim_start_matches("l'azione ").trim_start_matches("azione ");
        if let Some(a) = named(rest) {
            let id = a.get("id").and_then(Value::as_str).unwrap_or_default();
            return command("run_quick_action", json!({ "id": id }), tf("Azione rapida «{name}»", &[("name", &name_of(a))]));
        }
    }
    if let Some(a) = named(&q) {
        let id = a.get("id").and_then(Value::as_str).unwrap_or_default();
        return command("run_quick_action", json!({ "id": id }), tf("Azione rapida «{name}»", &[("name", &name_of(a))]));
    }
    if let Some(rest) = after(&q, &["passa al profilo", "attiva il profilo", "attiva profilo", "usa il profilo", "profilo"]) {
        if let Some((id, name)) = profiles.iter().find(|(_, n)| plain(n) == plain(rest)) {
            return command("switch_profile", json!({ "id": id }), tf("Profilo «{name}»", &[("name", name)]));
        }
    }
    // A reminder: the words of the user, as written (not lowercased).
    let raw = question.trim().trim_end_matches(['.', '!']);
    let low = raw.to_lowercase();
    for start in ["ricordami di ", "ricordami che ", "promemoria: ", "promemoria ", "nuova attività: ", "nuova attività ", "aggiungi attività: ", "aggiungi attività "] {
        if low.starts_with(start) {
            let title = raw.get(start.len()..).unwrap_or_default().trim();
            if title.chars().count() >= 3 {
                return command("todo_add", json!({ "title": title }), tf("Nuova attività in To Do: «{title}»", &[("title", &title)]));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actions() -> Vec<Value> {
        vec![json!({ "id": "a1", "name": "Teams", "kind": "app" }), json!({ "id": "a2", "name": "Posta in arrivo", "kind": "url" })]
    }

    fn profiles() -> Vec<(String, String)> {
        vec![("p1".into(), "Ufficio".into()), ("p2".into(), "Casa".into())]
    }

    fn tool(q: &str) -> Option<(String, Value)> {
        parse(q, &actions(), &profiles()).map(|c| (c.tool, c.args))
    }

    #[test]
    fn orders_become_commands() {
        assert_eq!(tool("Apri Teams"), Some(("run_quick_action".into(), json!({ "id": "a1" }))));
        assert_eq!(tool("posta in arrivo!"), Some(("run_quick_action".into(), json!({ "id": "a2" }))));
        assert_eq!(tool("passa al profilo casa"), Some(("switch_profile".into(), json!({ "id": "p2" }))));
        assert_eq!(tool("Metti in pausa"), Some(("media_control".into(), json!({ "command": "toggle" }))));
        assert_eq!(tool("prossima canzone"), Some(("media_control".into(), json!({ "command": "next" }))));
        assert_eq!(tool("Ricordami di chiamare Rossi domani."), Some(("todo_add".into(), json!({ "title": "chiamare Rossi domani" }))));
    }

    #[test]
    fn questions_stay_questions() {
        assert_eq!(tool("apri Word"), None, "not one of the user's actions: the engine's");
        assert_eq!(tool("profilo Montagna"), None);
        assert_eq!(tool("perché Teams non si apre quando lo lancio dal menu Start?"), None);
        assert_eq!(tool("pausa pranzo alle 13: ricordamelo"), None);
        assert_eq!(tool("ricordami di"), None);
        assert_eq!(tool("Apri Teams\ne scrivi a Rossi"), None);
    }
}
