// Microsoft account (Microsoft Graph), read-only: the base for Outlook and
// Teams through the APIs (docs/idee.md → Account Microsoft, docs/integrazioni.md).
//
// Sign-in: "Accedi con Microsoft" in the settings opens the browser on
// Microsoft's page (authorization code with PKCE); Microsoft sends the browser
// back to http://localhost:<port> on this PC, where a one-shot listener takes
// the code. No secret anywhere: the app registration's id is public, the
// refresh token lives in the Credential Manager ("msgraph-refresh"), the access
// token only in memory. The user registers the app once in Microsoft Entra
// (the settings say how); a company may require its admin's approval, and
// that is never worked around.
//
// Scopes (delegated, read-only): User.Read, Mail.Read, Calendars.Read,
// Presence.Read, plus offline_access. Network only to login.microsoftonline.com
// and graph.microsoft.com, only once signed in, never while EasyIsland is paused.
// Used by outlook.rs (mail and appointments, also for the new Outlook) and by
// the Teams card (status and today's online meetings, `teams_snapshot`).

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::i18n::{t, tf};

const SECRET: &str = "msgraph-refresh";
pub const SCOPES: &str = "offline_access User.Read Mail.Read Calendars.Read Presence.Read";
const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const LOGIN_WAIT: Duration = Duration::from_secs(300);

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The access token and when it stops working.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);
/// "Mario Rossi (mario@ditta.it)", once known.
static ACCOUNT: Mutex<Option<String>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// An app registration id is set.
    pub configured: bool,
    pub signed_in: bool,
    pub account: Option<String>,
    pub error: Option<String>,
    /// What to register as redirect URI.
    pub redirect: String,
    pub scopes: String,
}

/// (client id, tenant) from the settings; tenant "" = "organizations".
fn config() -> Option<(String, String)> {
    let app = APP.get()?;
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    let id = s.integration_config.ms_client_id.trim().to_string();
    let tenant = s.integration_config.ms_tenant.trim().to_string();
    (!id.is_empty()).then(|| (id, if tenant.is_empty() { "organizations".into() } else { tenant }))
}

/// A tenant as Microsoft accepts it: common, organizations, consumers, a GUID or a domain.
fn tenant_ok(t: &str) -> bool {
    !t.is_empty() && t.len() <= 100 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

pub fn signed_in() -> bool {
    config().is_some() && crate::secrets::present(SECRET)
}

pub fn status() -> Status {
    Status {
        configured: config().is_some(),
        signed_in: signed_in(),
        account: ACCOUNT.lock().unwrap().clone(),
        error: LAST_ERROR.lock().unwrap().clone(),
        redirect: "http://localhost".into(),
        scopes: SCOPES.into(),
    }
}

fn set_error(e: Option<String>) {
    *LAST_ERROR.lock().unwrap() = e;
}

// ── Small helpers (no new dependency) ────────────────────────────────────────

fn random(n: usize) -> Vec<u8> {
    use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    let mut buf = vec![0u8; n];
    unsafe {
        let _ = BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    }
    buf
}

fn sha256(data: &[u8]) -> Vec<u8> {
    use windows::Win32::Security::Cryptography::{BCryptHash, BCRYPT_SHA256_ALG_HANDLE};
    let mut out = vec![0u8; 32];
    unsafe {
        let _ = BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut out);
    }
    out
}

fn b64url(bytes: &[u8]) -> String {
    crate::claude::base64_for(bytes).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}

fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' => {
                let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(v) => {
                        out.push(v);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// "a=1&b=2" → value of `key`, decoded.
fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| dec(v))
    })
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default()
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>EasyIsland</title><body style=\"font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh\"><div>✓ Accesso riuscito: puoi chiudere questa scheda e tornare a EasyIsland.</div>";
const PAGE_BAD: &str = "<!doctype html><meta charset=utf-8><title>EasyIsland</title><body style=\"font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh\"><div>Accesso non riuscito: torna a EasyIsland per il motivo.</div>";

/// "Accedi con Microsoft": browser, then the code on localhost, then the tokens.
pub async fn login(app: AppHandle) -> Result<String, String> {
    let _ = APP.set(app.clone());
    let (client_id, tenant) = config().ok_or_else(|| t("Scrivi prima l'ID applicazione (client) della registrazione in Microsoft Entra").to_string())?;
    if !tenant_ok(&tenant) {
        return Err(t("Tenant non valido: usa organizations, common, il dominio o l'ID della directory").into());
    }
    let verifier = b64url(&random(48));
    let challenge = b64url(&sha256(verifier.as_bytes()));
    let state = b64url(&random(16));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://localhost:{port}");
    let url = format!(
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{}",
        form(&[
            ("client_id", &client_id),
            ("response_type", "code"),
            ("redirect_uri", &redirect),
            ("response_mode", "query"),
            ("scope", SCOPES),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ])
    );
    crate::open_url_now(&url);
    let code = tokio::time::timeout(LOGIN_WAIT, wait_code(&listener, &state))
        .await
        .map_err(|_| t("Tempo scaduto: l'accesso non è stato completato nel browser").to_string())??;
    drop(listener);

    let body = form(&[
        ("client_id", &client_id),
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect),
        ("code_verifier", &verifier),
        ("scope", SCOPES),
    ]);
    let tokens = token_request(&tenant, body).await?;
    store(&tokens)?;
    let me = get("/me?$select=displayName,mail,userPrincipalName").await?;
    let account = account_line(&me);
    *ACCOUNT.lock().unwrap() = Some(account.clone());
    set_error(None);
    crate::log::line("msgraph: accesso fatto");
    let _ = app.emit("msgraph-status", status());
    Ok(account)
}

/// Waits for the browser's request with `?code=…&state=…`; anything else gets a 404.
async fn wait_code(listener: &tokio::net::TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = match tokio::time::timeout(Duration::from_secs(10), sock.read(&mut buf)).await {
            Ok(Ok(n)) => n,
            _ => continue,
        };
        let head = String::from_utf8_lossy(buf.get(..n).unwrap_or(&[])).into_owned();
        let target = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("").to_string();
        let query = target.split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default();
        let reply = |ok: bool| {
            let page = if ok { PAGE_OK } else { PAGE_BAD };
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len())
        };
        // The favicon and the like: not ours.
        if query_value(&query, "state").as_deref() != Some(state) {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        if let Some(err) = query_value(&query, "error") {
            let _ = sock.write_all(reply(false).as_bytes()).await;
            let why = query_value(&query, "error_description").unwrap_or(err);
            // AADSTS65001 / 90094: the company wants its admin to approve the app.
            let admin = why.contains("AADSTS90094") || why.contains("AADSTS65001") || why.contains("admin");
            return Err(if admin {
                t("L'azienda chiede l'approvazione dell'amministratore per questa app: va chiesta all'IT").to_string()
            } else {
                tf("Microsoft ha rifiutato l'accesso: {why}", &[("why", &why.lines().next().unwrap_or("").to_string())])
            });
        }
        let Some(code) = query_value(&query, "code") else { continue };
        let _ = sock.write_all(reply(true).as_bytes()).await;
        return Ok(code);
    }
}

async fn token_request(tenant: &str, body: String) -> Result<Value, String> {
    let url = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
    let resp = client()
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| tf("Microsoft non risponde: {e}", &[("e", &e)]))?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !ok {
        let why = v.get("error_description").and_then(Value::as_str).unwrap_or("").lines().next().unwrap_or("").to_string();
        return Err(tf("Accesso a Microsoft non riuscito: {why}", &[("why", &why)]));
    }
    Ok(v)
}

fn store(tokens: &Value) -> Result<(), String> {
    let access = tokens.get("access_token").and_then(Value::as_str).ok_or_else(|| t("Risposta di Microsoft senza token").to_string())?;
    let secs = tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
    *ACCESS.lock().unwrap() = Some((access.to_string(), Instant::now() + Duration::from_secs(secs.saturating_sub(120))));
    if let Some(refresh) = tokens.get("refresh_token").and_then(Value::as_str) {
        crate::secrets::set(SECRET, refresh)?;
    }
    Ok(())
}

/// "Esci": tokens forgotten here (the browser session at Microsoft stays).
pub fn logout() -> Result<(), String> {
    *ACCESS.lock().unwrap() = None;
    *ACCOUNT.lock().unwrap() = None;
    set_error(None);
    crate::secrets::clear(SECRET)
}

/// A valid access token, refreshed with the stored refresh token when needed.
async fn access_token() -> Result<String, String> {
    if let Some((tok, until)) = ACCESS.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(tok);
        }
    }
    let (client_id, tenant) = config().ok_or_else(|| t("Account Microsoft non configurato").to_string())?;
    let refresh = crate::secrets::get(SECRET).ok_or_else(|| t("Non hai fatto l'accesso a Microsoft").to_string())?;
    let body = form(&[("client_id", &client_id), ("grant_type", "refresh_token"), ("refresh_token", &refresh), ("scope", SCOPES)]);
    match token_request(&tenant, body).await {
        Ok(tokens) => {
            store(&tokens)?;
            Ok(ACCESS.lock().unwrap().as_ref().map(|(t, _)| t.clone()).unwrap_or_default())
        }
        Err(e) => {
            set_error(Some(e.clone()));
            Err(e)
        }
    }
}

async fn get_with(path: &str, prefer: Option<&str>) -> Result<Value, String> {
    if crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(t("EasyIsland è in pausa").into());
    }
    let token = access_token().await?;
    let mut req = client().get(format!("{GRAPH}{path}")).bearer_auth(token);
    if let Some(p) = prefer {
        req = req.header("Prefer", p);
    }
    let resp = req.send().await.map_err(|e| tf("Microsoft Graph non risponde: {e}", &[("e", &e)]))?;
    let code = resp.status().as_u16();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if code == 401 {
        // Revoked or expired: the next call refreshes.
        *ACCESS.lock().unwrap() = None;
    }
    if !(200..300).contains(&code) {
        let why = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(tf("Microsoft Graph: errore {code} {why}", &[("code", &code), ("why", &why)]));
    }
    Ok(v)
}

async fn get(path: &str) -> Result<Value, String> {
    get_with(path, None).await
}

fn account_line(me: &Value) -> String {
    let name = me.get("displayName").and_then(Value::as_str).unwrap_or("");
    let mail = me.get("mail").and_then(Value::as_str).or_else(|| me.get("userPrincipalName").and_then(Value::as_str)).unwrap_or("");
    match (name.is_empty(), mail.is_empty()) {
        (false, false) => format!("{name} ({mail})"),
        (false, true) => name.to_string(),
        _ => mail.to_string(),
    }
}

/// The account's name for the settings (asked to Graph once per run).
pub async fn account() -> Option<String> {
    if let Some(a) = ACCOUNT.lock().unwrap().clone() {
        return Some(a);
    }
    let me = get("/me?$select=displayName,mail,userPrincipalName").await.ok()?;
    let a = account_line(&me);
    *ACCOUNT.lock().unwrap() = Some(a.clone());
    Some(a)
}

// ── Data ─────────────────────────────────────────────────────────────────────

/// Windows' name of the local time zone ("W. Europe Standard Time"): Graph
/// then gives times as local wall-clock, like Outlook's COM model.
fn windows_time_zone() -> String {
    use windows::Win32::System::Time::{GetDynamicTimeZoneInformation, DYNAMIC_TIME_ZONE_INFORMATION};
    let mut tz = DYNAMIC_TIME_ZONE_INFORMATION::default();
    unsafe {
        GetDynamicTimeZoneInformation(&mut tz);
    }
    let len = tz.TimeZoneKeyName.iter().position(|c| *c == 0).unwrap_or(tz.TimeZoneKeyName.len());
    let name = String::from_utf16_lossy(tz.TimeZoneKeyName.get(..len).unwrap_or(&[]));
    if name.is_empty() { "UTC".into() } else { name }
}

/// UTC "YYYY-MM-DDTHH:MM:SSZ", `offset` seconds from now.
fn utc_iso(offset: i64) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + offset;
    let (y, m, d) = crate::calendar::civil_from_days(now.div_euclid(86_400));
    let s = now.rem_euclid(86_400);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", s / 3600, s / 60 % 60, s % 60)
}

/// One appointment, times local ("2026-10-16T09:00:00…").
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub subject: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    /// The Teams link of an online meeting, "" otherwise.
    pub join_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mail {
    pub from: String,
    pub subject: String,
    pub received: String,
    pub web_link: String,
}

fn events_from(v: &Value) -> Vec<Event> {
    v.get("value")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|e| !e.get("isCancelled").and_then(Value::as_bool).unwrap_or(false))
                .map(|e| Event {
                    subject: e.get("subject").and_then(Value::as_str).unwrap_or("").to_string(),
                    start: e.pointer("/start/dateTime").and_then(Value::as_str).unwrap_or("").to_string(),
                    end: e.pointer("/end/dateTime").and_then(Value::as_str).unwrap_or("").to_string(),
                    all_day: e.get("isAllDay").and_then(Value::as_bool).unwrap_or(false),
                    join_url: e
                        .pointer("/onlineMeeting/joinUrl")
                        .and_then(Value::as_str)
                        .filter(|u| crate::teams::meeting_link(u).is_some())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mails_from(v: &Value) -> Vec<Mail> {
    v.get("value")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|m| Mail {
                    from: m
                        .pointer("/from/emailAddress/name")
                        .and_then(Value::as_str)
                        .or_else(|| m.pointer("/from/emailAddress/address").and_then(Value::as_str))
                        .unwrap_or("")
                        .to_string(),
                    subject: m.get("subject").and_then(Value::as_str).unwrap_or("").to_string(),
                    received: m.get("receivedDateTime").and_then(Value::as_str).unwrap_or("").to_string(),
                    web_link: m.get("webLink").and_then(Value::as_str).filter(|u| u.starts_with("https://")).unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Appointments from now to the end of tomorrow (48 h, describe() picks).
pub async fn events() -> Result<Vec<Event>, String> {
    let path = format!(
        "/me/calendarView?startDateTime={}&endDateTime={}&$select=subject,start,end,isAllDay,isCancelled,onlineMeeting&$orderby=start/dateTime&$top=30",
        utc_iso(-3600),
        utc_iso(48 * 3600)
    );
    let prefer = format!("outlook.timezone=\"{}\"", windows_time_zone());
    Ok(events_from(&get_with(&path, Some(&prefer)).await?))
}

/// Unread mail in the inbox: the count and the newest five.
pub async fn unread_mail() -> Result<(u64, Vec<Mail>), String> {
    let folder = get("/me/mailFolders/inbox?$select=unreadItemCount").await?;
    let count = folder.get("unreadItemCount").and_then(Value::as_u64).unwrap_or(0);
    let list = if count > 0 {
        mails_from(&get("/me/mailFolders/inbox/messages?$filter=isRead%20eq%20false&$top=5&$select=subject,from,receivedDateTime,webLink").await?)
    } else {
        Vec::new()
    };
    Ok((count, list))
}

/// Teams status: (availability, activity), e.g. ("Busy", "InAMeeting").
pub async fn presence() -> Result<(String, String), String> {
    let v = get("/me/presence").await?;
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Ok((s("availability"), s("activity")))
}

/// For the Teams card: status and today's online meetings.
pub async fn teams_snapshot() -> Value {
    if !signed_in() {
        return json!({ "signedIn": false });
    }
    // One after the other: tokio's join! needs a feature this crate does not turn on.
    let presence = presence().await;
    let events = events().await;
    let error = presence.as_ref().err().or(events.as_ref().err()).cloned();
    let (availability, activity) = presence.unwrap_or_default();
    let meetings: Vec<Event> = events.unwrap_or_default().into_iter().filter(|e| !e.join_url.is_empty()).collect();
    json!({ "signedIn": true, "availability": availability, "activity": activity, "meetings": meetings, "error": error })
}

/// Starts the Teams part's loop: every minute while signed in and Teams is on.
pub fn spawn(app: AppHandle) {
    let _ = APP.set(app.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            if signed_in() && crate::integrations::enabled(&app, crate::teams::ID) {
                let snap = teams_snapshot().await;
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "msgraph-teams", snap);
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(enc("a b/ç"), "a%20b%2F%C3%A7");
        assert_eq!(dec("a%20b%2F%C3%A7+x"), "a b/ç x");
        assert_eq!(dec("bad%zz%"), "bad%zz%");
        assert_eq!(query_value("code=ab%2Bc&state=x", "code").as_deref(), Some("ab+c"));
        assert!(query_value("code=1", "state").is_none());
        assert!(tenant_ok("organizations") && tenant_ok("ditta.onmicrosoft.com") && !tenant_ok("a/b") && !tenant_ok(""));
        // PKCE: RFC 7636's example verifier and challenge.
        assert_eq!(b64url(&sha256(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_eq!(random(16).len(), 16);
        assert_ne!(random(16), random(16));
    }

    #[test]
    fn reads_graph_shapes() {
        let ev = events_from(&json!({ "value": [
            { "subject": "Cliente", "start": { "dateTime": "2026-10-16T09:00:00.0000000" }, "end": { "dateTime": "2026-10-16T10:00:00.0000000" },
              "isAllDay": false, "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/x" } },
            { "subject": "Annullata", "isCancelled": true },
            { "subject": "Strana", "onlineMeeting": { "joinUrl": "https://evil.example/x" } }
        ] }));
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].join_url, "https://teams.microsoft.com/l/meetup-join/x");
        assert_eq!(ev[1].join_url, "");
        let m = mails_from(&json!({ "value": [{ "subject": "Fattura", "from": { "emailAddress": { "address": "a@b.it" } }, "webLink": "javascript:x" }] }));
        assert_eq!(m[0].from, "a@b.it");
        assert_eq!(m[0].web_link, "");
        assert!(events_from(&json!({})).is_empty());
        assert_eq!(account_line(&json!({ "displayName": "Mario", "mail": "m@d.it" })), "Mario (m@d.it)");
        assert_eq!(utc_iso(0).len(), 20);
    }
}
