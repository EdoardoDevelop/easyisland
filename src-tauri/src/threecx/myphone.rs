// 3CX V20 with the extension's own login — what the 3CX web client and apps do,
// no API client or licence needed. Reconstructed from the web client's public
// code (October 2026), not documented by 3CX: a PBX update may change it.
//
//   POST /webclient/api/Login/GetAccessToken   {Username, Password, SecurityCode}
//        → {Status} and a refresh-token cookie
//   POST /connect/token  grant_type=refresh_token, client_id=Webclient (+cookie)
//        → access_token
//   POST /webclient/api/MyPhone/session  (Bearer)  → {sessionKey, pass}
//   POST /MyPhone/MPWebService.asmx  header MyPhoneSession, body = GenericMessage
//   wss  /ws/webclient?sessionId=…&pass=…  → GenericMessage updates (MyInfo deltas)
//
// GenericMessage: field 1 = the type id, and the message itself in the field
// with that same number (RequestMakeCall = 119, MyInfo = 201…).

use serde_json::{json, Value};

use super::pb::{Msg, Writer};
use super::{Call, Contact, Device, HistoryItem, Profile};

pub const T_MY_INFO_REQUEST: i64 = 102;
pub const T_CHANGE_STATUS: i64 = 103;
pub const T_LOOKUP_CONTACT: i64 = 104;
pub const T_CALL_HISTORY: i64 = 106;
pub const T_DROP_CALL: i64 = 115;
pub const T_MAKE_CALL: i64 = 119;
pub const T_RESET_MISSED: i64 = 125;
pub const T_AUTO_ANSWER: i64 = 152;
pub const T_MY_INFO: i64 = 201;
pub const T_LOOKUP_RESULT: i64 = 202;
pub const T_CALL_HISTORY_RESULT: i64 = 204;
pub const T_ACK: i64 = 207;

/// What the web client says about itself when it opens a session.
const CLIENT: &str = "Webclient";
const CLIENT_VERSION: &str = "20.0.9.0";

/// "Set-Cookie: a=1; Path=/; HttpOnly" → "a=1", for every cookie of a response.
fn cookies(resp: &reqwest::Response) -> String {
    resp.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .map(str::trim)
        .filter(|v| v.contains('='))
        .collect::<Vec<_>>()
        .join("; ")
}

/// A JSON field whatever its case ("sessionKey", "SessionKey"…).
fn field<'a>(v: &'a Value, name: &str) -> Option<&'a Value> {
    v.as_object()?.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v)
}

pub struct Session {
    pub base: String,
    pub key: String,
    pass: String,
}

/// Login → token → MyPhone session.
pub async fn open(http: &reqwest::Client, base: &str, user: &str, password: &str) -> Result<Session, String> {
    let resp = http
        .post(format!("{base}/webclient/api/Login/GetAccessToken"))
        .json(&json!({ "Username": user, "Password": password, "SecurityCode": "", "ReCaptchaResponse": null }))
        .send()
        .await
        .map_err(|e| format!("Centralino non raggiungibile: {e}"))?;
    let status = resp.status();
    let jar = cookies(&resp);
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let login = field(&body, "Status").and_then(Value::as_str).unwrap_or("");
    if login.eq_ignore_ascii_case("Required2FA") {
        return Err("Il centralino chiede il codice di verifica in due passaggi: per ora non è supportato, usa la modalità API".into());
    }
    if !status.is_success() || (!login.is_empty() && !login.eq_ignore_ascii_case("AuthSuccess")) {
        return Err(match status.as_u16() {
            401 | 403 => "Interno o password non validi".into(),
            _ if !login.is_empty() => format!("Accesso rifiutato ({login})"),
            code => format!("Accesso non riuscito ({code})"),
        });
    }

    // The access token comes from the refresh-token cookie the login just set.
    let resp = http
        .post(format!("{base}/connect/token"))
        .header(reqwest::header::COOKIE, jar)
        .form(&[("client_id", CLIENT), ("grant_type", "refresh_token")])
        .send()
        .await
        .map_err(|e| format!("Token non ottenuto: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Token non ottenuto ({})", resp.status().as_u16()));
    }
    let token: Value = resp.json().await.map_err(|e| e.to_string())?;
    let access = field(&token, "access_token").and_then(Value::as_str).ok_or("Il centralino non ha dato un token")?.to_string();

    let resp = http
        .post(format!("{base}/webclient/api/MyPhone/session"))
        .bearer_auth(&access)
        .json(&json!({ "name": CLIENT, "version": CLIENT_VERSION, "isHuman": true }))
        .send()
        .await
        .map_err(|e| format!("Sessione non aperta: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Sessione non aperta ({})", resp.status().as_u16()));
    }
    let s: Value = resp.json().await.map_err(|e| e.to_string())?;
    let key = field(&s, "sessionKey").and_then(Value::as_str).ok_or("Sessione senza chiave")?.to_string();
    let pass = field(&s, "pass").and_then(Value::as_str).unwrap_or_default().to_string();
    Ok(Session { base: base.to_string(), key, pass })
}

impl Session {
    pub fn events_url(&self) -> String {
        let host = self.base.trim_start_matches("https://");
        format!("wss://{host}/ws/webclient?sessionId={}&pass={}", self.key, self.pass)
    }

    /// One request; the answer's type id and message. A negative acknowledgement is an error.
    pub async fn request(&self, http: &reqwest::Client, type_id: i64, body: Writer) -> Result<(i64, Msg), String> {
        let payload = Writer::new().int(1, type_id).msg(type_id as u32, body).finish();
        let resp = http
            .post(format!("{}/MyPhone/MPWebService.asmx", self.base))
            .header("MyPhoneSession", &self.key)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .header(reqwest::header::ACCEPT, "application/octet-stream")
            .body(payload)
            .send()
            .await
            .map_err(|e| format!("Centralino non raggiungibile: {e}"))?;
        if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
            return Err("Sessione scaduta".into());
        }
        if !resp.status().is_success() {
            return Err(format!("Richiesta rifiutata ({})", resp.status().as_u16()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let (id, msg) = unwrap(&bytes).ok_or("Risposta del centralino non leggibile")?;
        if id == T_ACK && msg.bool(1) != Some(true) {
            let text = msg.str(3).or_else(|| msg.str(5)).filter(|s| !s.is_empty());
            return Err(text.unwrap_or_else(|| format!("Operazione non riuscita (errore {})", msg.int(2).unwrap_or(0))));
        }
        Ok((id, msg))
    }
}

/// GenericMessage → (type id, the message inside).
pub fn unwrap(bytes: &[u8]) -> Option<(i64, Msg)> {
    let outer = Msg::decode(bytes)?;
    let id = outer.int(1)?;
    Some((id, outer.msg(id as u32).unwrap_or_default()))
}

// ── Requests ─────────────────────────────────────────────────────────────────

pub fn my_info() -> Writer {
    Writer::new().bool(1, true) // DontSendVM
}

pub fn make_call(destination: &str, device: Option<&str>) -> Writer {
    let w = Writer::new().str(1, destination);
    let w = match device {
        Some(d) if !d.is_empty() => w.str(3, d),
        _ => w,
    };
    w.bool(4, true) // EnableCallControl
}

pub fn drop_call(connection: i64) -> Writer {
    Writer::new().int(1, connection).bool(2, true)
}

pub fn answer(connection: i64) -> Writer {
    Writer::new().int(1, connection)
}

pub fn change_status(profile: i64) -> Writer {
    Writer::new().int(1, profile)
}

pub fn lookup(query: &str, count: i64) -> Writer {
    Writer::new()
        .str(1, query) // Input
        .int(2, 0) // Offset
        .int(3, count) // Count
        .bool(4, true) // ExtIncluded: colleagues too
        .int(5, 1) // SortBy: first name
        .int(7, 63) // SearchBy: names, company, e-mail, numbers
        .bool(9, true) // SearchCompany
        .bool(10, true) // SearchPersonal
}

/// CallType: 0 every call, 1 missed.
pub fn call_history(missed_only: bool, count: i64) -> Writer {
    Writer::new().int(1, if missed_only { 1 } else { 0 }).int(3, count).int(4, 0)
}

// ── MyInfo: the extension's live state, sent whole and then as deltas ───────

const ACTION_FULL: i64 = 1;
const ACTION_DELETED: i64 = 4;

/// Present fields of `new` replace the same fields of `old`.
fn merge(old: &mut Msg, new: &Msg) {
    let numbers: Vec<u32> = new.fields.iter().map(|(n, _)| *n).collect();
    old.fields.retain(|(n, _)| !numbers.contains(n));
    old.fields.extend(new.fields.iter().cloned());
}

/// A list that arrives as {Action, Items[{Action, Id, …}]}: whole, or item by item.
#[derive(Default, Clone)]
pub struct Items(pub Vec<Msg>);

impl Items {
    fn apply(&mut self, list: &Msg) {
        if list.int(1) == Some(ACTION_FULL) {
            self.0.clear();
        }
        for item in list.msgs(2) {
            let Some(id) = item.int(2) else { continue };
            let pos = self.0.iter().position(|m| m.int(2) == Some(id));
            match (item.int(1), pos) {
                (Some(ACTION_DELETED), Some(i)) => {
                    self.0.remove(i);
                }
                (Some(ACTION_DELETED), None) => {}
                (_, Some(i)) => merge(&mut self.0[i], &item),
                (_, None) => self.0.push(item),
            }
        }
    }
}

#[derive(Default)]
pub struct MyInfo {
    pub number: String,
    pub first: String,
    pub last: String,
    pub profile: i64,
    pub dnd: bool,
    pub missed: i64,
    pub devices: Items,
    pub profiles: Items,
    pub connections: Items,
}

impl MyInfo {
    pub fn apply(&mut self, m: &Msg) {
        if let Some(v) = m.str(3) {
            self.number = v;
        }
        if let Some(v) = m.str(7) {
            self.first = v;
        }
        if let Some(v) = m.str(8) {
            self.last = v;
        }
        if let Some(v) = m.int(10) {
            self.profile = v;
        }
        if let Some(v) = m.bool(14) {
            self.dnd = v;
        }
        if let Some(v) = m.int(24) {
            self.missed = v;
        }
        if let Some(l) = m.msg(9) {
            self.devices.apply(&l);
        }
        if let Some(l) = m.msg(13) {
            self.profiles.apply(&l);
        }
        if let Some(l) = m.msg(18) {
            self.connections.apply(&l);
        }
    }

    pub fn devices(&self) -> Vec<Device> {
        self.devices
            .0
            .iter()
            .map(|d| Device {
                id: d.str(3).unwrap_or_default(),
                name: device_name(&d.str(5).unwrap_or_default()),
            })
            .filter(|d| !d.id.is_empty())
            .collect()
    }

    pub fn profiles(&self) -> Vec<Profile> {
        self.profiles
            .0
            .iter()
            .filter_map(|p| {
                let id = p.int(2)?;
                let custom = p.str(5).filter(|s| !s.trim().is_empty());
                Some(Profile { id: id.to_string(), name: custom.unwrap_or_else(|| profile_name(&p.str(3).unwrap_or_default())) })
            })
            .collect()
    }

    pub fn calls(&self, first_seen: &mut std::collections::HashMap<i64, (u64, bool)>, now: u64) -> Vec<Call> {
        let mut out = Vec::new();
        for c in &self.connections.0 {
            let Some(id) = c.int(2) else { continue };
            let state = match c.int(5).unwrap_or(0) {
                1 => "ringing",
                2 => "dialing",
                3 => "connected",
                _ => "other",
            };
            // Times: when we first saw it, and again when it was answered.
            let entry = first_seen.entry(id).or_insert((now, state == "connected"));
            if state == "connected" && !entry.1 {
                *entry = (now, true);
            }
            let incoming = c.bool(12).unwrap_or(false);
            let number = c.str(11).filter(|s| !s.is_empty()).or_else(|| c.str(22)).unwrap_or_default();
            let name = c.str(10).filter(|s| !s.is_empty() && *s != number).unwrap_or_default();
            out.push(Call {
                id: id.to_string(),
                state: state.into(),
                incoming,
                name,
                number,
                since: entry.0,
                can_answer: incoming && state == "ringing",
            });
        }
        first_seen.retain(|id, _| self.connections.0.iter().any(|c| c.int(2) == Some(*id)));
        out
    }
}

/// The user agent of a registration, shortened to something a person recognises.
pub fn device_name(agent: &str) -> String {
    let a = agent.to_lowercase();
    let known = [
        ("windows", "App 3CX per Windows"),
        ("android", "Smartphone Android"),
        ("iphone", "iPhone"),
        ("ios", "iPhone"),
        ("webrtc", "Web client"),
        ("web client", "Web client"),
    ];
    if a.contains("3cx") {
        for (k, v) in known {
            if a.contains(k) {
                return v.into();
            }
        }
    }
    let short: String = agent.split(['(', '/']).next().unwrap_or(agent).trim().chars().take(40).collect();
    if short.is_empty() { "Telefono".into() } else { short }
}

/// V20's built-in statuses, in Italian.
pub fn profile_name(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "available" => "Disponibile",
        "away" => "Assente",
        "out of office" | "do not disturb" | "dnd" => "Non disturbare",
        "custom 1" | "lunch" => "Pausa pranzo",
        "custom 2" | "business trip" => "Trasferta",
        _ => return name.to_string(),
    }
    .into()
}

pub fn contacts(m: &Msg) -> Vec<Contact> {
    m.msgs(1)
        .iter()
        .map(|c| {
            let name = [c.str(2), c.str(3)].into_iter().flatten().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join(" ");
            let mut numbers: Vec<String> = Vec::new();
            for n in [c.str(5), c.str(4)].into_iter().flatten().chain((8..=17).filter_map(|i| c.str(i))) {
                let n = n.trim().to_string();
                let phone = !n.is_empty() && !n.contains('@') && n.chars().all(|ch| ch.is_ascii_digit() || "+ -()./*#".contains(ch));
                if phone && !numbers.contains(&n) {
                    numbers.push(n);
                }
            }
            Contact {
                name: if name.is_empty() { c.str(7).unwrap_or_default() } else { name },
                company: c.str(7).unwrap_or_default(),
                numbers,
                colleague: c.int(6) == Some(0),
            }
        })
        .filter(|c| !c.numbers.is_empty())
        .collect()
}

/// DateTime {Year, Month, Day, Hour, Minute, Second} (UTC) → ms since 1970.
fn date_ms(d: &Msg) -> Option<u64> {
    let (y, mo, da) = (d.int(1)?, d.int(2)?, d.int(3)?);
    let (h, mi, s) = (d.int(4).unwrap_or(0), d.int(5).unwrap_or(0), d.int(6).unwrap_or(0));
    // Days from civil (Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + mi * 60 + s;
    (secs > 0).then_some(secs as u64 * 1000)
}

pub fn history(m: &Msg) -> Vec<HistoryItem> {
    m.msgs(1)
        .iter()
        .filter_map(|r| {
            let parties = r.msg(3)?.msgs(1);
            let p = parties.first()?;
            let number = p.str(8).filter(|s| !s.is_empty()).or_else(|| p.str(5)).unwrap_or_default();
            let name = p.str(7).filter(|s| !s.is_empty() && *s != number).unwrap_or_default();
            let kind = match p.int(14).unwrap_or(0) {
                1 => "missed",
                2 => "received",
                3 => "outgoing",
                _ => "other",
            };
            Some(HistoryItem {
                name,
                number,
                kind: kind.into(),
                at: p.msg(2).and_then(|d| date_ms(&d)).unwrap_or(0),
                answered: p.msg(3).is_some(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(action: i64, id: i64, state: i64, incoming: bool, name: &str, number: &str) -> Writer {
        Writer::new().int(1, action).int(2, id).int(5, state).str(10, name).str(11, number).bool(12, incoming)
    }

    #[test]
    fn my_info_full_then_deltas() {
        let full = Writer::new()
            .int(1, 1)
            .str(3, "101")
            .str(7, "Mario")
            .str(8, "Rossi")
            .int(10, 1)
            .int(24, 2)
            .msg(9, Writer::new().int(1, 1).msg(2, Writer::new().int(2, 7).str(3, "sip:101@10.0.0.5").str(5, "3CX Windows 20.0")))
            .msg(13, Writer::new().int(1, 1).msg(2, Writer::new().int(2, 1).str(3, "Available")).msg(2, Writer::new().int(2, 2).str(3, "Away")))
            .msg(18, Writer::new().int(1, 1).msg(2, conn(2, 50, 1, true, "Cliente Srl", "+39051123456")))
            .finish();
        let mut info = MyInfo::default();
        info.apply(&Msg::decode(&full).unwrap());
        assert_eq!(info.number, "101");
        assert_eq!(info.missed, 2);
        assert_eq!(info.devices()[0].name, "App 3CX per Windows");
        assert_eq!(info.profiles()[1].name, "Assente");

        let mut seen = std::collections::HashMap::new();
        let calls = info.calls(&mut seen, 1000);
        assert_eq!(calls.len(), 1);
        assert!(calls[0].incoming && calls[0].can_answer);
        assert_eq!(calls[0].state, "ringing");
        assert_eq!(calls[0].name, "Cliente Srl");

        // Answered: only the state changes, the rest stays.
        let delta = Writer::new().int(1, 3).msg(18, Writer::new().int(1, 3).msg(2, Writer::new().int(1, 3).int(2, 50).int(5, 3))).finish();
        info.apply(&Msg::decode(&delta).unwrap());
        let calls = info.calls(&mut seen, 5000);
        assert_eq!(calls[0].state, "connected");
        assert_eq!(calls[0].number, "+39051123456");
        assert_eq!(calls[0].since, 5000, "the timer restarts when answered");

        // Hung up.
        let gone = Writer::new().int(1, 3).msg(18, Writer::new().int(1, 3).msg(2, Writer::new().int(1, 4).int(2, 50))).finish();
        info.apply(&Msg::decode(&gone).unwrap());
        assert!(info.calls(&mut seen, 6000).is_empty());
        assert!(seen.is_empty());
    }

    #[test]
    fn generic_message_wrapping() {
        let bytes = Writer::new().int(1, T_MAKE_CALL).msg(T_MAKE_CALL as u32, make_call("0511234", Some("sip:x"))).finish();
        let (id, m) = unwrap(&bytes).unwrap();
        assert_eq!(id, 119);
        assert_eq!(m.str(1).as_deref(), Some("0511234"));
        assert_eq!(m.str(3).as_deref(), Some("sip:x"));
        assert_eq!(m.bool(4), Some(true));
    }

    #[test]
    fn contacts_and_history() {
        let lookup = Writer::new()
            .msg(1, Writer::new().str(2, "Anna").str(3, "Bianchi").str(5, "102").int(6, 0))
            .msg(1, Writer::new().str(7, "Cliente Srl").str(4, "+39 051 123").str(8, "info@cliente.it").int(6, 1))
            .msg(1, Writer::new().str(2, "Senza").str(3, "Numero"))
            .finish();
        let list = contacts(&Msg::decode(&lookup).unwrap());
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Anna Bianchi");
        assert!(list[0].colleague);
        assert_eq!(list[1].name, "Cliente Srl");
        assert_eq!(list[1].numbers, vec!["+39 051 123"]);

        let when = Writer::new().int(1, 2026).int(2, 10).int(3, 4).int(4, 9).int(5, 30);
        let party = Writer::new().msg(2, when).str(7, "Cliente").str(8, "0511234").int(14, 1);
        let rec = Writer::new().int(2, 1).msg(3, Writer::new().msg(1, party));
        let h = history(&Msg::decode(&Writer::new().msg(1, rec).finish()).unwrap());
        assert_eq!(h[0].kind, "missed");
        assert_eq!(h[0].number, "0511234");
        assert_eq!(h[0].at, 1_791_106_200_000);
    }
}
