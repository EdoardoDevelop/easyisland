// 3CX V20 through the official APIs: an API client made in the Admin Console
// (Integrazioni → API: Client ID + key, "3CX Call Control API Access", the
// extension among the monitored ones; 8SC+ licence). Documented and stable.
//
//   POST /connect/token  grant_type=client_credentials  → access_token
//   GET  /callcontrol/{dn}                → devices and participants
//   POST /callcontrol/{dn}/makecall       (or …/devices/{id}/makecall)
//   POST /callcontrol/{dn}/participants/{id}/answer | drop
//   wss  /callcontrol/ws  (Bearer)        → events: {event_type, entity}
//   GET  /xapi/v1/Users, /xapi/v1/Contacts  → phonebook (needs Configuration API access)

use serde_json::{json, Value};

use super::{Call, Contact, Device};
use crate::i18n::{t, tf};

pub struct Token {
    pub access: String,
    /// When to get a new one (ms since 1970).
    pub renew_at: u64,
}

pub async fn token(http: &reqwest::Client, base: &str, client_id: &str, secret: &str, now: u64) -> Result<Token, String> {
    let resp = http
        .post(format!("{base}/connect/token"))
        .form(&[("client_id", client_id), ("client_secret", secret), ("grant_type", "client_credentials")])
        .send()
        .await
        .map_err(|e| tf("Centralino non raggiungibile: {e}", &[("e", &e)]))?;
    match resp.status().as_u16() {
        200 => {}
        400 | 401 | 403 => return Err(t("Client ID o chiave API non validi").into()),
        code => return Err(tf("Token non ottenuto ({code})", &[("code", &code)])),
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let access = v["access_token"].as_str().ok_or(t("Il centralino non ha dato un token"))?.to_string();
    // 3CX gives minutes here; a value too big for minutes is seconds.
    let exp = v["expires_in"].as_u64().unwrap_or(60);
    let secs = if exp <= 600 { exp * 60 } else { exp };
    Ok(Token { access, renew_at: now + secs * 1000 / 2 })
}

fn check(resp: &reqwest::Response) -> Result<(), String> {
    match resp.status().as_u16() {
        200..=299 => Ok(()),
        401 => Err(t("Token scaduto").into()),
        403 => Err(t("Il client API non può controllare questo interno: aggiungilo agli interni monitorati").into()),
        404 => Err(t("Non trovato sul centralino").into()),
        422 | 424 => Err(t("Il centralino non ha potuto eseguire l'operazione").into()),
        code => Err(tf("Richiesta rifiutata ({code})", &[("code", &code)])),

    }
}

async fn get(http: &reqwest::Client, base: &str, token: &str, path: &str) -> Result<Value, String> {
    let resp = http.get(format!("{base}{path}")).bearer_auth(token).send().await.map_err(|e| e.to_string())?;
    check(&resp)?;
    resp.json().await.map_err(|e| e.to_string())
}

async fn post(http: &reqwest::Client, base: &str, token: &str, path: &str, body: Value) -> Result<Value, String> {
    let resp = http.post(format!("{base}{path}")).bearer_auth(token).json(&body).send().await.map_err(|e| e.to_string())?;
    check(&resp)?;
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    // 200/202 with a final status that says it failed.
    if let Some(reason) = v["finalstatus"].as_str().filter(|s| s.eq_ignore_ascii_case("Failure")) {
        let text = v["reasontext"].as_str().or(v["reason"].as_str()).unwrap_or(reason);
        return Err(tf("Operazione non riuscita: {text}", &[("text", &text)]));
    }
    Ok(v)
}

/// Path segments are numbers and SIP contacts: escape what is not plain.
fn seg(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub async fn state(http: &reqwest::Client, base: &str, token: &str, dn: &str) -> Result<Value, String> {
    get(http, base, token, &format!("/callcontrol/{}", seg(dn))).await
}

pub async fn participant(http: &reqwest::Client, base: &str, token: &str, entity: &str) -> Result<Value, String> {
    // The entity comes from the server ("/callcontrol/101/participants/5"): only that shape is followed.
    if !entity.starts_with("/callcontrol/") || entity.contains("..") {
        return Err("percorso inatteso".into());
    }
    get(http, base, token, entity).await
}

pub async fn make_call(http: &reqwest::Client, base: &str, token: &str, dn: &str, device: Option<&str>, to: &str) -> Result<(), String> {
    let path = match device {
        Some(d) if !d.is_empty() => format!("/callcontrol/{}/devices/{}/makecall", seg(dn), seg(d)),
        _ => format!("/callcontrol/{}/makecall", seg(dn)),
    };
    post(http, base, token, &path, json!({ "destination": to, "timeout": 30 })).await.map(|_| ())
}

pub async fn action(http: &reqwest::Client, base: &str, token: &str, dn: &str, participant: &str, what: &str) -> Result<(), String> {
    let path = format!("/callcontrol/{}/participants/{}/{what}", seg(dn), seg(participant));
    post(http, base, token, &path, json!({})).await.map(|_| ())
}

pub fn devices(state: &Value) -> Vec<Device> {
    state["devices"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|d| {
                    let id = d["device_id"].as_str()?.to_string();
                    Some(Device { id, name: super::myphone::device_name(d["user_agent"].as_str().unwrap_or("")) })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A participant on our extension → a call as the island shows it.
pub fn call(p: &Value, first_seen: &mut std::collections::HashMap<i64, (u64, bool)>, now: u64) -> Option<Call> {
    let id = p["id"].as_i64()?;
    let status = p["status"].as_str().unwrap_or("").to_lowercase();
    let state = match status.as_str() {
        "ringing" => "ringing",
        "dialing" => "dialing",
        "connected" => "connected",
        _ => "other",
    };
    let entry = first_seen.entry(id).or_insert((now, state == "connected"));
    if state == "connected" && !entry.1 {
        *entry = (now, true);
    }
    let number = p["party_caller_id"].as_str().filter(|s| !s.is_empty()).or(p["party_dn"].as_str()).unwrap_or("").to_string();
    let name = p["party_caller_name"].as_str().filter(|s| !s.is_empty() && *s != number).unwrap_or("").to_string();
    Some(Call {
        id: id.to_string(),
        state: state.into(),
        // Ringing on our extension means someone is calling us; dialing means we called.
        incoming: state == "ringing",
        name,
        number,
        since: entry.0,
        can_answer: state == "ringing" && p["direct_control"].as_bool().unwrap_or(false),
    })
}

/// An event of the /callcontrol/ws channel: (event type, entity path).
pub fn event(text: &str) -> Option<(i64, String)> {
    let v: Value = serde_json::from_str(text).ok()?;
    let e = if v.get("event").is_some() { &v["event"] } else { &v };
    let pick = |a: &str, b: &str| e.get(a).or_else(|| e.get(b)).cloned();
    let kind = pick("event_type", "EventType")?.as_i64()?;
    let entity = pick("entity", "Entity")?.as_str()?.to_string();
    Some((kind, entity))
}

fn quote(q: &str) -> String {
    q.to_lowercase().replace('\'', "''")
}

/// Colleagues and the company phonebook, through XAPI.
pub async fn contacts(http: &reqwest::Client, base: &str, token: &str, query: &str) -> Result<Vec<Contact>, String> {
    let q = quote(query);
    let mut out = Vec::new();
    let users = format!(
        "/xapi/v1/Users?$top=10&$select=Number,FirstName,LastName&$filter=contains(tolower(FirstName),'{q}') or contains(tolower(LastName),'{q}') or startswith(Number,'{q}')"
    );
    let contacts = format!(
        "/xapi/v1/Contacts?$top=20&$filter=contains(tolower(FirstName),'{q}') or contains(tolower(LastName),'{q}') or contains(tolower(CompanyName),'{q}')"
    );
    let users = get(http, base, token, &url_query(&users)).await;
    let contacts = get(http, base, token, &url_query(&contacts)).await;
    if let (Err(e), Err(_)) = (&users, &contacts) {
        return Err(tf("Rubrica non disponibile: serve l'accesso alla Configuration API nel client API ({e})", &[("e", &e)]));
    }
    for u in users.ok().and_then(|v| v["value"].as_array().cloned()).unwrap_or_default() {
        let name = format!("{} {}", u["FirstName"].as_str().unwrap_or(""), u["LastName"].as_str().unwrap_or("")).trim().to_string();
        if let Some(n) = u["Number"].as_str() {
            out.push(Contact { name, company: String::new(), numbers: vec![n.to_string()], colleague: true });
        }
    }
    for c in contacts.ok().and_then(|v| v["value"].as_array().cloned()).unwrap_or_default() {
        let name = format!("{} {}", c["FirstName"].as_str().unwrap_or(""), c["LastName"].as_str().unwrap_or("")).trim().to_string();
        let company = c["CompanyName"].as_str().unwrap_or("").to_string();
        let numbers: Vec<String> = ["PhoneNumber", "Mobile2", "Business", "Business2", "Home", "Other"]
            .iter()
            .filter_map(|k| c[*k].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();
        if !numbers.is_empty() {
            out.push(Contact { name: if name.is_empty() { company.clone() } else { name }, company, numbers, colleague: false });
        }
    }
    Ok(out)
}

/// Spaces and quotes in an OData query string.
fn url_query(path: &str) -> String {
    match path.split_once('?') {
        Some((p, q)) => format!(
            "{p}?{}",
            q.bytes()
                .map(|b| match b {
                    b' ' => "%20".to_string(),
                    b'\'' => "%27".to_string(),
                    b'+' => "%2B".to_string(),
                    _ => (b as char).to_string(),
                })
                .collect::<String>()
        ),
        None => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_and_participants() {
        let ev = r#"{"sequence":3,"event":{"event_type":0,"entity":"/callcontrol/101/participants/5","attached_data":null}}"#;
        assert_eq!(event(ev), Some((0, "/callcontrol/101/participants/5".into())));
        assert_eq!(event(r#"{"EventType":1,"Entity":"/callcontrol/101/participants/5"}"#), Some((1, "/callcontrol/101/participants/5".into())));
        assert!(event("non json").is_none());

        let p = json!({"id":5,"status":"Ringing","party_caller_name":"Cliente","party_caller_id":"0511234","direct_control":true});
        let mut seen = std::collections::HashMap::new();
        let c = call(&p, &mut seen, 10).unwrap();
        assert!(c.incoming && c.can_answer);
        assert_eq!((c.name.as_str(), c.number.as_str()), ("Cliente", "0511234"));
    }

    #[test]
    fn escaping() {
        assert_eq!(seg("sip:101@10.0.0.5:5060"), "sip%3A101%4010.0.0.5%3A5060");
        assert_eq!(quote("D'Angelo"), "d''angelo");
        assert_eq!(url_query("/x?$filter=a eq 'b'"), "/x?$filter=a%20eq%20%27b%27");
    }
}
