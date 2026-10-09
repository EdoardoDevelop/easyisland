// The Zammad integration: the agent's ticket overviews (assigned to me,
// unassigned and open, escalated) with their counts, and an alert when a new
// unassigned ticket comes in. It runs as a check through widgets.rs.
//
// The address (`zammad-url`, https://helpdesk.cliente.it) and the access token
// (`zammad-token`: Profile → Token di accesso, permission `ticket.agent`) live
// in the Credential Manager, like n8n's, never in settings.json.
//
// The counts come from /api/v1/ticket_overviews, the same list the agent sees
// on the left in Zammad, so it works with or without Elasticsearch. Overviews
// are matched by their `link`, which stays the same whatever the language.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;

use crate::widgets::{client, FieldValue, Widget, WidgetResult};
use crate::i18n::{t, tf};

const MY_ASSIGNED: &str = "my_assigned";
const UNASSIGNED: &str = "all_unassigned";
const ESCALATED: &str = "all_escalated";

/// Last unassigned count per widget: a rise means a new ticket came in. The
/// first check of a session only sets the baseline.
static LAST_UNASSIGNED: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);

/// The base address, without a trailing slash or a pasted `/#…` page.
fn base_url(url: &str) -> String {
    let u = url.trim();
    let u = u.split('#').next().unwrap_or(u);
    u.trim_end_matches('/').to_string()
}

/// (link → count) from the overview list; overviews without a count are skipped.
fn counts(list: &Value) -> HashMap<String, i64> {
    list.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|o| Some((o.get("link")?.as_str()?.to_string(), o.get("count")?.as_i64()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// Titles of the newest tickets in an overview's data (`?view=<link>`), newest first.
fn newest_titles(data: &Value, max: usize) -> Vec<String> {
    let Some(ids) = data.pointer("/index/tickets").and_then(Value::as_array) else { return Vec::new() };
    let tickets = data.pointer("/assets/Ticket");
    let mut list: Vec<(i64, String)> = ids
        .iter()
        .filter_map(|t| {
            let id = t.get("id")?.as_i64()?;
            let ticket = tickets?.get(id.to_string())?;
            let number = ticket.get("number").and_then(Value::as_str).unwrap_or("");
            let title = ticket.get("title").and_then(Value::as_str).unwrap_or(crate::i18n::t("(senza titolo)"));
            Some((id, if number.is_empty() { title.to_string() } else { format!("#{number} {title}") }))
        })
        .collect();
    list.sort_by(|a, b| b.0.cmp(&a.0));
    list.into_iter().take(max).map(|(_, t)| t).collect()
}

fn plural(n: i64, one: &str, many: &str) -> String {
    if n == 1 { format!("1 {one}") } else { format!("{n} {many}") }
}

/// Level, summary and fields for the three counts.
fn describe(mine: i64, unassigned: i64, escalated: i64) -> (&'static str, String, Vec<FieldValue>) {
    let fields = vec![
        FieldValue { label: t("Assegnati a me").into(), value: mine.to_string() },
        FieldValue { label: t("Non assegnati").into(), value: unassigned.to_string() },
        FieldValue { label: t("In escalation").into(), value: escalated.to_string() },
    ];
    let mut parts = Vec::new();
    if escalated > 0 {
        parts.push(plural(escalated, t("ticket in escalation"), t("ticket in escalation")));
    }
    if unassigned > 0 {
        parts.push(plural(unassigned, t("non assegnato"), t("non assegnati")));
    }
    parts.push(plural(mine, t("assegnato a te"), t("assegnati a te")));
    let level = if escalated > 0 { "warn" } else { "ok" };
    (level, parts.join(" · "), fields)
}

/// A new unassigned ticket since the last check of this widget.
fn new_ticket_event(id: &str, unassigned: i64) -> Option<i64> {
    let mut guard = LAST_UNASSIGNED.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    let before = map.insert(id.to_string(), unassigned)?;
    (unassigned > before).then_some(unassigned - before)
}

async fn get_json(c: &reqwest::Client, url: &str, token: &str) -> Result<Value, String> {
    let resp = c
        .get(url)
        .header("Authorization", format!("Token token={token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { t("Zammad non risponde (tempo scaduto)").to_string() } else { tf("Zammad non raggiungibile: {e}", &[("e", &e)]) })?;
    match resp.status().as_u16() {
        200..=299 => resp.json().await.map_err(|_| t("Risposta di Zammad non leggibile").to_string()),
        401 => Err(t("Token non valido o scaduto (401)").into()),
        403 => Err(t("Il token non ha il permesso ticket.agent (403)").into()),
        404 => Err(t("Indirizzo di Zammad non trovato (404)").into()),
        code => Err(format!("Zammad: HTTP {code}")),
    }
}

pub async fn probe(w: &Widget) -> WidgetResult {
    let base = base_url(&crate::secrets::get("zammad-url").unwrap_or_default());
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return WidgetResult::new(&w.id, "error", t("Scrivi l'indirizzo di Zammad (https://…) in Impostazioni → Integrazioni"));
    }
    let Some(token) = crate::secrets::get("zammad-token") else {
        return WidgetResult::new(&w.id, "error", t("Incolla il token di accesso in Impostazioni → Integrazioni → Zammad"));
    };
    let Some(c) = client() else { return WidgetResult::new(&w.id, "error", t("HTTP non disponibile")) };

    let list = match get_json(&c, &format!("{base}/api/v1/ticket_overviews"), token.trim()).await {
        Ok(v) => v,
        Err(e) => return WidgetResult::new(&w.id, "error", e),
    };
    let n = counts(&list);
    if n.is_empty() {
        return WidgetResult::new(&w.id, "error", t("Nessuna vista dei ticket: l'utente del token è un agente?"));
    }
    let get = |k: &str| n.get(k).copied().unwrap_or(0);
    let (mine, unassigned, escalated) = (get(MY_ASSIGNED), get(UNASSIGNED), get(ESCALATED));
    let (level, summary, mut fields) = describe(mine, unassigned, escalated);

    // The newest unassigned tickets by title: one more call, only when there are any.
    let mut titles = Vec::new();
    if unassigned > 0 {
        if let Ok(data) = get_json(&c, &format!("{base}/api/v1/ticket_overviews?view={UNASSIGNED}"), token.trim()).await {
            titles = newest_titles(&data, 3);
        }
    }
    for t in &titles {
        fields.push(FieldValue { label: crate::i18n::t("Da assegnare").into(), value: t.clone() });
    }

    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields = fields;
    if let Some(more) = new_ticket_event(&w.id, unassigned) {
        r.event = Some(match (more, titles.first()) {
            (1, Some(title)) => tf("Nuovo ticket: {title}", &[("title", &title)]),

            (1, None) => t("Nuovo ticket da assegnare").to_string(),
            (k, _) => tf("{k} nuovi ticket da assegnare", &[("k", &k)]),
        });
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn base_url_is_cleaned() {
        assert_eq!(base_url(" https://help.cliente.it/#ticket/view/my_assigned "), "https://help.cliente.it");
        assert_eq!(base_url("https://help.cliente.it/"), "https://help.cliente.it");
    }

    #[test]
    fn counts_by_link() {
        let list = json!([
            {"name": "I miei ticket assegnati", "link": "my_assigned", "count": 4},
            {"name": "Non assegnati e aperti", "link": "all_unassigned", "count": 2},
            {"name": "Senza conteggio", "link": "x"}
        ]);
        let n = counts(&list);
        assert_eq!(n.get("my_assigned"), Some(&4));
        assert_eq!(n.get("all_unassigned"), Some(&2));
        assert!(!n.contains_key("x"));
    }

    #[test]
    fn titles_newest_first() {
        let data = json!({
            "index": {"tickets": [{"id": 7}, {"id": 12}, {"id": 9}], "count": 3},
            "assets": {"Ticket": {
                "7": {"number": "31007", "title": "Stampante"},
                "12": {"number": "31012", "title": "VPN giù"},
                "9": {"title": "Senza numero"}
            }}
        });
        assert_eq!(newest_titles(&data, 2), vec!["#31012 VPN giù", "Senza numero"]);
    }

    #[test]
    fn summary_and_level() {
        let (level, summary, _) = describe(3, 0, 0);
        assert_eq!((level, summary.as_str()), ("ok", "3 assegnati a te"));
        let (level, summary, _) = describe(1, 2, 1);
        assert_eq!(level, "warn");
        assert_eq!(summary, "1 ticket in escalation · 2 non assegnati · 1 assegnato a te");
    }

    #[test]
    fn only_a_rise_is_new() {
        assert_eq!(new_ticket_event("t1", 2), None); // baseline
        assert_eq!(new_ticket_event("t1", 2), None);
        assert_eq!(new_ticket_event("t1", 3), Some(1));
        assert_eq!(new_ticket_event("t1", 1), None);
    }
}
