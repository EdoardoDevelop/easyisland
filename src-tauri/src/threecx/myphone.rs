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
//
// Team and chat (October 2026, from the same code): the colleagues and their
// presence come pushed as Groups (208); a chat with colleagues is a
// conversation created from the sorted extension numbers joined by ":"
// ("101:105"), then written with SendChatMessageToConversation (190); new
// messages, unread counts and "is typing" are pushed (209, 229, 180).

use serde_json::{json, Value};

use super::pb::{Msg, Writer};
use super::{Call, ChatMessage, ChatSummary, Colleague, Contact, Device, HistoryItem, Profile, Voicemail};
use crate::i18n::{t, tf};

pub const T_MY_INFO_REQUEST: i64 = 102;
pub const T_CHANGE_STATUS: i64 = 103;
pub const T_LOOKUP_CONTACT: i64 = 104;
pub const T_CALL_HISTORY: i64 = 106;
pub const T_SET_CHAT_RECEIVED: i64 = 112;
pub const T_SET_VOICEMAIL_HEARD: i64 = 114;
pub const T_DROP_CALL: i64 = 115;
pub const T_DIVERT_CALL: i64 = 116;
pub const T_PICKUP_CALL: i64 = 117;
pub const T_TRANSFER_CALL: i64 = 118;
pub const T_MAKE_CALL: i64 = 119;
pub const T_RESET_MISSED: i64 = 125;
pub const T_PLAY_VOICEMAIL: i64 = 127;
pub const T_MY_CHAT_PARTIES: i64 = 138;
pub const T_AUTO_ANSWER: i64 = 152;
pub const T_LAST_MESSAGES: i64 = 162;
pub const T_UNREAD_COUNT: i64 = 165;
pub const T_TYPING: i64 = 180;
pub const T_CREATE_CONVERSATION: i64 = 189;
pub const T_SEND_TO_CONVERSATION: i64 = 190;
pub const T_GET_VOICEMAILS: i64 = 565;
pub const T_MY_INFO: i64 = 201;
pub const T_LOOKUP_RESULT: i64 = 202;
pub const T_CALL_HISTORY_RESULT: i64 = 204;
pub const T_ACK: i64 = 207;
/// The colleagues with their presence, by group: sent whole on connect, then as deltas.
pub const T_GROUPS: i64 = 208;
/// New chat messages (pushed), or the answer to `T_LAST_MESSAGES`.
pub const T_MESSAGES: i64 = 209;
/// The call queues the extension sees (pushed on connect).
pub const T_QUEUES: i64 = 211;
pub const T_CHAT_PARTIES: i64 = 220;
/// Unread chat messages per conversation (pushed, or the answer to `T_UNREAD_COUNT`).
pub const T_UNREAD: i64 = 229;
pub const T_CONVERSATION_INFO: i64 = 236;
pub const T_VOICEMAILS: i64 = 268;

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
        .map_err(|e| tf("Centralino non raggiungibile: {e}", &[("e", &e)]))?;
    let status = resp.status();
    let jar = cookies(&resp);
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let login = field(&body, "Status").and_then(Value::as_str).unwrap_or("");
    if login.eq_ignore_ascii_case("Required2FA") {
        return Err(t("Il centralino chiede il codice di verifica in due passaggi: per ora non è supportato, usa la modalità API").into());
    }
    if !status.is_success() || (!login.is_empty() && !login.eq_ignore_ascii_case("AuthSuccess")) {
        return Err(match status.as_u16() {
            401 | 403 => t("Interno o password non validi").into(),
            _ if !login.is_empty() => tf("Accesso rifiutato ({login})", &[("login", &login)]),
            code => tf("Accesso non riuscito ({code})", &[("code", &code)]),
        });
    }

    // The access token comes from the refresh-token cookie the login just set.
    let resp = http
        .post(format!("{base}/connect/token"))
        .header(reqwest::header::COOKIE, jar)
        .form(&[("client_id", CLIENT), ("grant_type", "refresh_token")])
        .send()
        .await
        .map_err(|e| tf("Token non ottenuto: {e}", &[("e", &e)]))?;
    if !resp.status().is_success() {
        return Err(tf("Token non ottenuto ({code})", &[("code", &resp.status().as_u16())]));
    }
    let token: Value = resp.json().await.map_err(|e| e.to_string())?;
    let access = field(&token, "access_token").and_then(Value::as_str).ok_or(t("Il centralino non ha dato un token"))?.to_string();

    let resp = http
        .post(format!("{base}/webclient/api/MyPhone/session"))
        .bearer_auth(&access)
        .json(&json!({ "name": CLIENT, "version": CLIENT_VERSION, "isHuman": true }))
        .send()
        .await
        .map_err(|e| tf("Sessione non aperta: {e}", &[("e", &e)]))?;
    if !resp.status().is_success() {
        return Err(tf("Sessione non aperta ({code})", &[("code", &resp.status().as_u16())]));
    }
    let s: Value = resp.json().await.map_err(|e| e.to_string())?;
    let key = field(&s, "sessionKey").and_then(Value::as_str).ok_or(t("Sessione senza chiave"))?.to_string();
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
            .map_err(|e| tf("Centralino non raggiungibile: {e}", &[("e", &e)]))?;
        if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
            return Err(t("Sessione scaduta").into());
        }
        if !resp.status().is_success() {
            return Err(tf("Richiesta rifiutata ({code})", &[("code", &resp.status().as_u16())]));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let (id, msg) = unwrap(&bytes).ok_or(t("Risposta del centralino non leggibile"))?;
        if id == T_ACK && msg.bool(1) != Some(true) {
            let text = msg.str(3).or_else(|| msg.str(5)).filter(|s| !s.is_empty());
            return Err(text.unwrap_or_else(|| tf("Operazione non riuscita (errore {code})", &[("code", &msg.int(2).unwrap_or(0))])));
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

/// Just the queue login (agent in / out of the queues), the rest of the status untouched.
pub fn queue_status(logged_in: bool) -> Writer {
    Writer::new().bool(3, logged_in)
}

/// A call of ours, connected, handed to `destination` (blind transfer).
pub fn transfer(connection: i64, destination: &str) -> Writer {
    Writer::new().int(1, connection).bool(2, false).str(3, destination)
}

/// A call ringing for us sent elsewhere: to `destination`, or to our voicemail.
pub fn divert(connection: i64, destination: &str, voicemail: bool) -> Writer {
    let w = Writer::new().int(1, connection).bool(2, voicemail).str(3, destination);
    if voicemail { w.bool(4, true) } else { w }
}

/// A colleague's ringing call answered here, on `device`.
pub fn pickup(connection: i64, device: Option<&str>) -> Writer {
    let w = Writer::new().int(1, connection);
    let w = match device {
        Some(d) if !d.is_empty() => w.str(3, d),
        _ => w,
    };
    w.bool(4, true)
}

/// The latest conversations (with participants and their last message).
pub fn chat_parties(count: i64) -> Writer {
    Writer::new().int(1, 0).int(2, count).bool(3, true)
}

/// The latest `count` messages of a conversation, or those before `before`.
pub fn last_messages(conversation: i64, count: i64, before: Option<i64>) -> Writer {
    let w = Writer::new().int(2, count);
    let w = match before {
        Some(id) => w.int(3, id),
        None => w,
    };
    w.int(4, conversation)
}

/// The conversation of these extensions (ours included), created if new.
pub fn create_conversation(party: &str) -> Writer {
    Writer::new().str(1, party).str(4, "")
}

/// "101:105": the extensions sorted as text and joined, as the web client does.
pub fn party(mine: &str, others: &[&str]) -> String {
    let mut all: Vec<String> = others.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if !all.iter().any(|s| s == mine) {
        all.push(mine.to_string());
    }
    all.sort();
    all.dedup();
    all.join(":").replace('#', "@")
}

pub fn send_message(conversation: i64, text: &str) -> Writer {
    Writer::new().int(1, conversation).str(2, text)
}

/// Messages read: their ids (a repeated field, not packed).
pub fn chat_received(ids: &[i64]) -> Writer {
    ids.iter().fold(Writer::new(), |w, id| w.int(1, *id))
}

pub fn typing(conversation: i64) -> Writer {
    Writer::new().int(3, conversation)
}

pub fn voicemails(count: i64) -> Writer {
    Writer::new().int(3, 0).int(4, count)
}

pub fn voicemail_heard(id: i64) -> Writer {
    Writer::new().int(1, id).bool(2, true)
}

pub fn play_voicemail(id: i64) -> Writer {
    Writer::new().int(1, id)
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
    /// Logged in to the call queues (as an agent).
    pub queue: bool,
    pub new_voicemails: i64,
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
        if let Some(v) = m.bool(6) {
            self.queue = v;
        }
        if let Some(v) = m.int(53) {
            self.new_voicemails = v;
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
    if short.is_empty() { t("Telefono").into() } else { short }
}

/// V20's built-in statuses, in Italian.
pub fn profile_name(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "available" => t("Disponibile"),
        "away" => t("Assente"),
        "out of office" | "do not disturb" | "dnd" => t("Non disturbare"),
        "custom 1" | "lunch" => t("Pausa pranzo"),
        "custom 2" | "business trip" => t("Trasferta"),
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

// ── Team: the colleagues by group, with their presence ──────────────────────

struct Member {
    msg: Msg,
    /// The member's calls: a list of its own inside the member, merged item by item.
    calls: Items,
}

struct Group {
    /// "" for this PBX, the bridge for a linked one.
    source: String,
    id: i64,
    members: Vec<(i64, Member)>,
}

#[derive(Default)]
pub struct Team {
    groups: Vec<Group>,
}

fn apply_members(members: &mut Vec<(i64, Member)>, list: &Msg) {
    if list.int(1) == Some(ACTION_FULL) {
        members.clear();
    }
    for item in list.msgs(2) {
        let Some(id) = item.int(2) else { continue };
        let pos = members.iter().position(|(m, _)| *m == id);
        match (item.int(1), pos) {
            (Some(ACTION_DELETED), Some(i)) => {
                members.remove(i);
            }
            (Some(ACTION_DELETED), None) => {}
            (_, Some(i)) => {
                let m = &mut members[i].1;
                if let Some(c) = item.msg(15) {
                    m.calls.apply(&c);
                }
                merge(&mut m.msg, &item);
            }
            (_, None) => {
                let mut calls = Items::default();
                if let Some(c) = item.msg(15) {
                    calls.apply(&c);
                }
                members.push((id, Member { msg: item, calls }));
            }
        }
    }
}

impl Team {
    pub fn apply(&mut self, m: &Msg) {
        let source = m.str(4).unwrap_or_default();
        if m.int(1) == Some(ACTION_FULL) {
            self.groups.retain(|g| g.source != source);
        }
        for g in m.msgs(2) {
            let Some(id) = g.int(2) else { continue };
            let pos = self.groups.iter().position(|x| x.source == source && x.id == id);
            if g.int(1) == Some(ACTION_DELETED) {
                if let Some(i) = pos {
                    self.groups.remove(i);
                }
                continue;
            }
            let i = pos.unwrap_or_else(|| {
                self.groups.push(Group { source: source.clone(), id, members: Vec::new() });
                self.groups.len() - 1
            });
            if let Some(list) = g.msg(5) {
                apply_members(&mut self.groups[i].members, &list);
            }
        }
    }

    /// Every colleague once (an extension can be in several groups), not `me`, by name.
    pub fn colleagues(&self, me: &str) -> Vec<Colleague> {
        let mut out: Vec<Colleague> = Vec::new();
        let mut groups: Vec<&Group> = self.groups.iter().collect();
        groups.sort_by_key(|g| !g.source.is_empty());
        for g in groups {
            for (_, m) in &g.members {
                let Some(c) = colleague(m) else { continue };
                if c.number == me || out.iter().any(|x| x.number == c.number) {
                    continue;
                }
                out.push(c);
            }
        }
        out.sort_by_key(|c| c.name.to_lowercase());
        out
    }
}

fn colleague(m: &Member) -> Option<Colleague> {
    let g = &m.msg;
    let number = g.str(3).filter(|s| !s.is_empty())?;
    let name = [g.str(4), g.str(5)].into_iter().flatten().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join(" ");
    let overridden = g.bool(19) == Some(true);
    let pick = |normal: u32, temp: u32| {
        let t = if overridden { g.str(temp).filter(|s| !s.is_empty()) } else { None };
        t.or_else(|| g.str(normal)).unwrap_or_default()
    };
    let internal = pick(14, 23);
    let custom = pick(9, 21);
    let ringing_call = m.calls.0.iter().find(|c| c.int(5) == Some(1) && c.bool(12) == Some(true)).and_then(|c| c.int(2));
    let presence = if ringing_call.is_some() || g.bool(27) == Some(true) {
        "ringing"
    } else if g.bool(11) == Some(true) || m.calls.0.iter().any(|c| c.int(5) == Some(3)) {
        "busy"
    } else if g.bool(6) != Some(true) {
        "offline"
    } else if g.bool(7) == Some(true) {
        "dnd"
    } else {
        match internal.to_lowercase().as_str() {
            "available" | "" => "available",
            "out of office" | "do not disturb" | "dnd" => "dnd",
            _ => "away",
        }
    };
    let profile = if internal.is_empty() { pick(8, 20) } else { internal };
    let status = if custom.trim().is_empty() { profile_name(&profile) } else { custom.trim().to_string() };
    Some(Colleague {
        name: if name.is_empty() { number.clone() } else { name },
        number,
        presence: presence.into(),
        status,
        ringing_call: ringing_call.map(|id| id.to_string()),
        mobile: g.str(13).unwrap_or_default(),
    })
}

// ── Chat ─────────────────────────────────────────────────────────────────────

/// A ChatMessage → what the island shows. `me`: our extension, to tell our own apart.
pub fn chat_message(m: &Msg, me: &str) -> Option<ChatMessage> {
    let id = m.int(1)?;
    let sender = m.str(2).unwrap_or_default();
    let bridge = m.str(4).unwrap_or_default();
    let kind = m.int(15).unwrap_or(0);
    let file = m.msg(11).and_then(|f| f.str(1)).filter(|s| !s.is_empty());
    let text = m.str(6).unwrap_or_default();
    Some(ChatMessage {
        id,
        conversation: m.int(13).unwrap_or(0),
        mine: !sender.is_empty() && sender == me && bridge.is_empty(),
        from: m.str(3).filter(|s| !s.trim().is_empty()).unwrap_or(sender),
        text,
        file,
        at: m.msg(7).and_then(|d| date_ms(&d)).unwrap_or(0),
        is_new: m.bool(8) == Some(true),
        // Closed, transferred, "is in DND"…: told by the PBX, not written by someone.
        system: kind != 0,
    })
}

/// The people in a conversation other than us, by name (or number).
fn others(info: &Msg, me: &str) -> Vec<(String, String)> {
    info.msgs(2)
        .iter()
        .filter_map(|r| r.msg(1))
        .filter(|r| !(r.str(1).as_deref() == Some(me) && r.str(3).unwrap_or_default().is_empty() && r.int(7).unwrap_or(0) == 0))
        .map(|r| {
            let number = r.str(1).filter(|s| !s.is_empty()).or_else(|| r.str(8)).unwrap_or_default();
            let name = r.str(2).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| number.clone());
            (name, number)
        })
        .collect()
}

/// A ChatPartyInfo → a conversation of the list (its last message and unread count come apart).
pub fn conversation(info: &Msg, me: &str) -> Option<ChatSummary> {
    let id = info.int(4)?;
    let people = others(info, me);
    let named = [info.str(6), info.str(9)].into_iter().flatten().find(|s| !s.trim().is_empty());
    let name = named.unwrap_or_else(|| people.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", "));
    let colleagues: Vec<String> = info
        .msgs(2)
        .iter()
        .filter_map(|r| r.msg(1))
        .filter(|r| r.int(7).unwrap_or(0) == 0 && r.str(3).unwrap_or_default().is_empty())
        .filter_map(|r| r.str(1))
        .filter(|n| n != me)
        .collect();
    Some(ChatSummary {
        id,
        name: if name.is_empty() { info.str(8).unwrap_or_default() } else { name },
        external: info.bool(3) == Some(true),
        group: people.len() > 1,
        // A one-to-one chat with a colleague: the one to call from the chat.
        number: if colleagues.len() == 1 && people.len() == 1 { colleagues[0].clone() } else { String::new() },
        last: String::new(),
        last_at: 0,
        last_mine: false,
        unread: 0,
    })
}

/// ResponseMyChatParties → the conversations, newest first, with their last message.
pub fn conversations(m: &Msg, me: &str) -> Vec<ChatSummary> {
    let last: Vec<ChatMessage> = m.msgs(2).iter().filter_map(|x| chat_message(x, me)).collect();
    let mut out: Vec<ChatSummary> = m.msgs(3).iter().filter_map(|x| conversation(x, me)).collect();
    for c in &mut out {
        if let Some(l) = last.iter().find(|l| l.conversation == c.id) {
            c.last = l.file.clone().unwrap_or_else(|| l.text.clone());
            c.last_at = l.at;
            c.last_mine = l.mine;
        }
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.last_at));
    out
}

/// ResponseUnreadMessagesCount → conversation id → unread messages.
pub fn unread(m: &Msg) -> Vec<(i64, i64)> {
    m.msgs(1).iter().filter_map(|p| Some((p.int(3)?, p.int(2).unwrap_or(0)))).filter(|(_, n)| *n > 0).collect()
}

// ── Voicemail ────────────────────────────────────────────────────────────────

pub fn voicemail_list(m: &Msg) -> Vec<Voicemail> {
    let mut out: Vec<Voicemail> = m
        .msgs(2)
        .iter()
        .filter_map(|v| {
            let number = v.str(5).unwrap_or_default();
            Some(Voicemail {
                id: v.int(2)?,
                name: v.str(6).filter(|s| !s.trim().is_empty() && *s != number).unwrap_or_default(),
                number,
                at: v.msg(7).and_then(|d| date_ms(&d)).unwrap_or(0),
                seconds: v.int(8).unwrap_or(0),
                is_new: v.bool(9) == Some(true),
                transcription: v.str(10).unwrap_or_default().trim().to_string(),
            })
        })
        .collect();
    out.sort_by_key(|v| std::cmp::Reverse(v.at));
    out
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

    fn member(action: i64, id: i64, ext: &str, first: &str) -> Writer {
        Writer::new().int(1, action).int(2, id).str(3, ext).str(4, first).str(5, "Rossi").bool(6, true).str(14, "Available")
    }

    fn groups(action: i64, members: Writer) -> Vec<u8> {
        Writer::new().int(1, action).msg(2, Writer::new().int(1, action).int(2, 7).str(3, "Tutti").msg(5, members)).finish()
    }

    #[test]
    fn team_presence_and_deltas() {
        let mut team = Team::default();
        let full = Writer::new()
            .int(1, 1)
            .msg(2, member(1, 1, "101", "Io"))
            .msg(2, member(1, 2, "102", "Anna"))
            .msg(2, member(1, 3, "103", "Bruno").bool(6, false));
        team.apply(&Msg::decode(&groups(1, full)).unwrap());
        let list = team.colleagues("101");
        assert_eq!(list.iter().map(|c| c.number.as_str()).collect::<Vec<_>>(), vec!["102", "103"], "not me, by name");
        assert_eq!(list[0].presence, "available");
        assert_eq!(list[0].status, "Disponibile");
        assert_eq!(list[1].presence, "offline");

        // Anna goes away with a message of her own, then a call rings for her.
        let away = Writer::new().int(1, 3).msg(2, Writer::new().int(1, 3).int(2, 2).str(14, "Away").str(9, "Torno alle 15"));
        team.apply(&Msg::decode(&groups(3, away)).unwrap());
        let anna = &team.colleagues("101")[0];
        assert_eq!((anna.presence.as_str(), anna.status.as_str()), ("away", "Torno alle 15"));
        assert_eq!(anna.name, "Anna Rossi");
        let ring = Writer::new().int(1, 3).msg(2, Writer::new().int(1, 3).int(2, 2).msg(15,
            Writer::new().int(1, 3).msg(2, Writer::new().int(1, 2).int(2, 90).int(5, 1).bool(12, true))));
        team.apply(&Msg::decode(&groups(3, ring)).unwrap());
        let anna = &team.colleagues("101")[0];
        assert_eq!(anna.presence, "ringing");
        assert_eq!(anna.ringing_call.as_deref(), Some("90"));

        // Bruno leaves the group.
        let gone = Writer::new().int(1, 3).msg(2, Writer::new().int(1, 4).int(2, 3));
        team.apply(&Msg::decode(&groups(3, gone)).unwrap());
        assert_eq!(team.colleagues("101").len(), 1);
    }

    #[test]
    fn chats_and_messages() {
        assert_eq!(party("101", &["105"]), "101:105");
        assert_eq!(party("2000", &["105", "101", "105"]), "101:105:2000", "sorted as text, once each");

        let who = |ext: &str, name: &str| Writer::new().msg(1, Writer::new().str(1, ext).str(2, name));
        let when = Writer::new().int(1, 2026).int(2, 10).int(3, 11).int(4, 9);
        let parties = Writer::new()
            .str(1, "101:105")
            .msg(2, Writer::new().int(1, 40).str(2, "105").str(3, "Anna").str(6, "Ciao").msg(7, when).int(13, 7))
            .msg(3, Writer::new().int(4, 7).msg(2, who("101", "Io")).msg(2, who("105", "Anna")))
            .msg(3, Writer::new().int(4, 8).str(9, "Ufficio").msg(2, who("101", "Io")).msg(2, who("102", "B")).msg(2, who("105", "Anna")))
            .finish();
        let list = conversations(&Msg::decode(&parties).unwrap(), "101");
        assert_eq!(list[0].id, 7, "the one with the newest message first");
        assert_eq!(list[0].name, "Anna");
        assert_eq!(list[0].number, "105");
        assert_eq!(list[0].last, "Ciao");
        assert!(!list[0].last_mine && !list[0].group);
        assert_eq!(list[1].name, "Ufficio");
        assert!(list[1].group && list[1].number.is_empty());

        let mine = Writer::new().int(1, 41).str(2, "101").str(6, "Arrivo").int(13, 7).finish();
        let m = chat_message(&Msg::decode(&mine).unwrap(), "101").unwrap();
        assert!(m.mine && !m.system);
        let closed = Writer::new().int(1, 42).str(2, "105").int(13, 7).int(15, 1).bool(8, true).finish();
        assert!(chat_message(&Msg::decode(&closed).unwrap(), "101").unwrap().system);

        let counts = Writer::new().msg(1, Writer::new().str(1, "101:105").int(2, 3).int(3, 7)).msg(1, Writer::new().int(2, 0).int(3, 8)).finish();
        assert_eq!(unread(&Msg::decode(&counts).unwrap()), vec![(7, 3)]);
        assert_eq!(chat_received(&[4, 5]).finish(), vec![0x08, 4, 0x08, 5], "one field per id, not packed");
    }

    #[test]
    fn voicemail_items() {
        let vm = |id: i64, day: i64, new: bool| {
            Writer::new().int(2, id).str(5, "0511234").str(6, "Cliente").msg(7, Writer::new().int(1, 2026).int(2, 10).int(3, day))
                .int(8, 42).bool(9, new).str(10, " Richiamami ")
        };
        let list = voicemail_list(&Msg::decode(&Writer::new().int(1, 1).msg(2, vm(1, 9, false)).msg(2, vm(2, 10, true)).finish()).unwrap());
        assert_eq!(list[0].id, 2, "newest first");
        assert!(list[0].is_new && !list[1].is_new);
        assert_eq!(list[0].transcription, "Richiamami");
        assert_eq!(list[0].seconds, 42);
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
