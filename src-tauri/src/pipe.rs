// Named-pipe server for easyisland-hook.
//
// `\\.\pipe\easyisland-<sid>` — one instance per connection. Every hook event is
// forwarded to the island as a `hook` event. `PermissionRequest` is the only one
// that keeps its connection open: it waits for the island's decision and writes
// it back on the same pipe, which is how approving from the island works.
//
// Claude Code is never blocked by us. Three things guarantee it:
//   * easyisland-hook gives the connection 300 ms and exits cleanly if we are closed;
//   * we only wait for a human once the island has *confirmed* the card is on
//     screen, so a paused island or a webview that is not listening costs a few
//     hundred milliseconds, not two minutes;
//   * whatever happens we drop the connection after the decision timeout, and
//     the terminal takes over.
//
// What we write back is the bare word `allow` or `deny`. Turning that into the
// documented hookSpecificOutput JSON is easyisland-hook's job, so the wire format
// Claude Code expects lives in exactly one place.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

use crate::island::WINDOW_LABEL;
use crate::log;

/// Slightly under easyisland-hook's own 110 s wait, so we always answer first.
const DECISION_TIMEOUT: Duration = Duration::from_secs(108);
/// How long the island gets to say "the card is up". This is the whole of B4:
/// without it, an island that is paused, hidden behind a crashed webview or
/// simply not listening would leave Claude Code staring at a prompt nobody can
/// see for nearly two minutes.
const ACK_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_PAYLOAD: usize = 1 << 20;

/// What the island can say about a permission request.
pub enum Reply {
    /// The card is on screen and a human can act on it.
    Ack,
    /// A human clicked: `allow` or `deny`.
    Decision(String),
    /// Nobody can act on it — paused, or another request already holds the card.
    Decline,
}

/// Permission requests the island has been told about.
#[derive(Default)]
pub struct Pending(pub Mutex<HashMap<String, mpsc::Sender<Reply>>>);

static COUNTER: AtomicU64 = AtomicU64::new(1);

/// `\\.\pipe\easyisland-<sid>` — must match easyisland-hook's `pipe_path()` exactly.
pub fn pipe_name() -> String {
    let key = crate::win_user::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    format!(r"\\.\pipe\easyisland-{key}")
}

/// DACL for the pipe: this account and SYSTEM, nobody else. The default one
/// Windows applies would also give Everyone and Anonymous read access.
fn owner_only_sddl(sid: &str) -> String {
    format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})")
}

/// One pipe instance that only `sid` (and SYSTEM) can open. Without a SID we
/// fall back to Windows' default descriptor rather than not listening at all.
fn create_instance(name: &str, first: bool, sid: Option<&str>) -> std::io::Result<NamedPipeServer> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

    let mut options = ServerOptions::new();
    options.first_pipe_instance(first);
    let Some(sid) = sid else { return options.create(name) };

    let sddl: Vec<u16> = owner_only_sddl(sid).encode_utf16().chain(Some(0)).collect();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
        .map_err(std::io::Error::other)?;
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: false.into(),
        };
        let created = options
            .create_with_security_attributes_raw(name, (&mut attributes as *mut SECURITY_ATTRIBUTES).cast());
        let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        created
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let name = pipe_name();
        let sid = crate::win_user::current_user_sid();
        if sid.is_none() {
            log::line("relay pipe: user SID unavailable, using the default descriptor");
        }
        // first_pipe_instance also means we refuse to join a pipe somebody else
        // already owns under our name, rather than serving on top of it.
        let mut server = match create_instance(&name, true, sid.as_deref()) {
            Ok(s) => s,
            Err(err) => {
                log::line(format!("cannot open the relay pipe: {err}"));
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            // Hand the connected instance to a task and listen on a fresh one.
            let next = match create_instance(&name, false, sid.as_deref()) {
                Ok(s) => s,
                Err(err) => {
                    log::line(format!("cannot reopen the relay pipe: {err}"));
                    return;
                }
            };
            let connected = std::mem::replace(&mut server, next);
            let app = app.clone();
            tauri::async_runtime::spawn(async move { handle(app, connected).await });
        }
    });
}

async fn handle(app: AppHandle, mut pipe: NamedPipeServer) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') || buf.len() > MAX_PAYLOAD {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let line = match buf.iter().position(|b| *b == b'\n') {
        Some(i) => &buf[..i],
        None => &buf[..],
    };
    let Ok(payload) = serde_json::from_slice::<Value>(line) else { return };
    if !payload.is_object() {
        return;
    }

    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // A tool call from the chat's `easyisland` MCP server (easyisland-hook mcp):
    // run it and answer on the same connection.
    if event == "EasyIslandTool" {
        let tool = payload.get("tool").and_then(Value::as_str).unwrap_or_default().to_string();
        let args = payload.get("arguments").cloned().unwrap_or_else(|| json!({}));
        let reply = crate::agent::call(&app, &tool, &args).await;
        let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
        let _ = pipe.flush().await;
        let _ = pipe.disconnect();
        return;
    }

    // The plan limits from Claude Code's status line (easyisland-hook statusline):
    // not a session event, and it comes at every message, so it is not logged.
    if event == "StatusLine" {
        let _ = pipe.disconnect();
        if let Some(limits) = payload.get("rate_limits") {
            if crate::usage::set_plan(limits) {
                crate::widgets::refresh(&app, "integration_claude_usage").await;
            }
        }
        return;
    }

    if event != "PermissionRequest" {
        log::line(format!("hook {event}"));
        crate::recap::observe(&app, &payload);
        let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
        let _ = pipe.disconnect();
        return;
    }

    let decision = request_decision(&app, payload).await;

    // No decision: say nothing at all. easyisland-hook then writes nothing to stdout
    // and Claude Code asks in the terminal, exactly as if EasyIsland were closed.
    if let Some(d) = decision {
        let _ = pipe.write_all(format!("{d}\n").as_bytes()).await;
        let _ = pipe.flush().await;
    }
    let _ = pipe.disconnect();
}

/// Shows a PermissionRequest card (a Claude-Code-shaped hook payload) and
/// waits for the click: `allow`, `deny`, `always` or `answer {…}`; None when
/// nobody could answer (paused island, another card up, timeout). Also used by
/// opencode.rs, whose permissions come from opencode's server, not the relay.
pub async fn request_decision(app: &AppHandle, payload: Value) -> Option<String> {
    request_decision_as(app, &new_request_id(), payload).await
}

/// A fresh request id, for a caller that may need to release the wait itself
/// (`decline`), as opencode_agent.rs does when the answer comes from opencode.
pub fn new_request_id() -> String {
    format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// `request_decision` under a chosen id.
pub async fn request_decision_as(app: &AppHandle, id: &str, mut payload: Value) -> Option<String> {
    let id = id.to_string();
    let (tx, mut rx) = mpsc::channel::<Reply>(4);
    {
        let pending = app.state::<Pending>();
        pending.0.lock().unwrap().insert(id.clone(), tx);
    }
    payload["request_id"] = json!(id);
    log::line(format!("hook PermissionRequest id={id}"));
    crate::recap::note_request(&id, &payload);
    let _ = app.emit_to(WINDOW_LABEL, "hook", payload);

    let decision = wait_for_decision(&id, &mut rx).await;
    app.state::<Pending>().0.lock().unwrap().remove(&id);
    decision
}

/// Two waits: a short one for "the card is up", then the long one for a human.
async fn wait_for_decision(id: &str, rx: &mut mpsc::Receiver<Reply>) -> Option<String> {
    match tokio::time::timeout(ACK_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Ack)) => {}
        // A click that beats the ack is still a click.
        Ok(Some(Reply::Decision(d))) => {
            log::line(format!("hook id={id} answered {}", d.split(' ').next().unwrap_or("")));
            return Some(d);
        }
        Ok(Some(Reply::Decline)) => {
            log::line(format!("hook id={id} not shown — terminal takes over"));
            return None;
        }
        Ok(None) => return None,
        Err(_) => {
            log::line(format!("hook id={id} island never acknowledged — terminal takes over"));
            return None;
        }
    }

    match tokio::time::timeout(DECISION_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Decision(d))) => {
            log::line(format!("hook id={id} answered {}", d.split(' ').next().unwrap_or("")));
            Some(d)
        }
        Ok(Some(Reply::Decline)) => {
            log::line(format!("hook id={id} released without a decision"));
            None
        }
        _ => {
            log::line(format!("hook id={id} timed out — terminal takes over"));
            None
        }
    }
}

fn send(app: &AppHandle, request_id: &str, reply: Reply, keep: bool) {
    let sender = {
        let pending = app.state::<Pending>();
        let mut map = pending.0.lock().unwrap();
        if keep { map.get(request_id).cloned() } else { map.remove(request_id) }
    };
    match sender {
        Some(tx) => {
            let _ = tx.try_send(reply);
        }
        None => log::line(format!("reply for id={request_id} — no pending request")),
    }
}

/// The island has the card on screen; the long wait may begin.
pub fn acknowledge(app: &AppHandle, request_id: &str) {
    send(app, request_id, Reply::Ack, true);
}

/// Nobody can act on this one — paused, or another card already holds the view.
pub fn decline(app: &AppHandle, request_id: &str) {
    log::line(format!("decline id={request_id}"));
    send(app, request_id, Reply::Decline, false);
}

/// Called by the island's Allow / Deny buttons. Only ever a bare word: turning
/// it into Claude Code's JSON is easyisland-hook's job.
pub fn answer(app: &AppHandle, request_id: &str, decision: &str) {
    // "always": allow, and the relay saves Claude Code's own proposed rule.
    let word = match decision {
        "allow" => "allow",
        "always" => "always",
        _ => "deny",
    };
    log::line(format!("decision id={request_id} {word}"));
    crate::recap::record_decision(app, request_id, word);
    send(app, request_id, Reply::Decision(word.to_string()), false);
}

/// The island answered an AskUserQuestion: question → chosen label(s).
/// easyisland-hook folds them into the tool's input (`answer {json}`).
pub fn answer_questions(app: &AppHandle, request_id: &str, answers: &serde_json::Map<String, serde_json::Value>) {
    if answers.is_empty() || !answers.values().all(|v| v.is_string()) {
        return decline(app, request_id);
    }
    // The answers themselves stay out of the log.
    log::line(format!("decision id={request_id} answer ({} risposte)", answers.len()));
    let line = format!("answer {}", serde_json::Value::Object(answers.clone()));
    send(app, request_id, Reply::Decision(line), false);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sddl_names_only_the_user_and_system() {
        let sddl = owner_only_sddl("S-1-5-21-1-2-3-1001");
        assert_eq!(sddl, "D:P(A;;GA;;;SY)(A;;GA;;;S-1-5-21-1-2-3-1001)");
        // Protected, and no Everyone / Anonymous / Authenticated Users entries.
        assert!(!sddl.contains(";WD)") && !sddl.contains(";AN)") && !sddl.contains(";AU)"));
    }

    #[test]
    fn owner_can_still_open_the_pipe() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_io().build().unwrap();
        rt.block_on(async {
            let sid = crate::win_user::current_user_sid().expect("sid");
            let name = format!(r"\\.\pipe\easyisland-test-{}", std::process::id());
            let server = create_instance(&name, true, Some(&sid)).expect("create");
            std::fs::OpenOptions::new().read(true).write(true).open(&name).expect("open as owner");

            // Read the DACL back from the live pipe: exactly SYSTEM and us.
            use std::os::windows::io::AsRawHandle;
            use windows::core::PWSTR;
            use windows::Win32::Foundation::{HANDLE, HLOCAL, LocalFree};
            use windows::Win32::Security::Authorization::{
                ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
                SE_KERNEL_OBJECT,
            };
            use windows::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
            unsafe {
                let mut descriptor = PSECURITY_DESCRIPTOR::default();
                let status = GetSecurityInfo(
                    HANDLE(server.as_raw_handle()),
                    SE_KERNEL_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    None,
                    None,
                    None,
                    None,
                    Some(&mut descriptor),
                );
                assert!(status.is_ok(), "GetSecurityInfo: {status:?}");
                let mut text = PWSTR::null();
                ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    descriptor,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION,
                    &mut text,
                    None,
                )
                .expect("to sddl");
                let sddl = text.to_string().unwrap();
                let _ = LocalFree(Some(HLOCAL(text.0.cast())));
                let _ = LocalFree(Some(HLOCAL(descriptor.0)));
                assert!(sddl.starts_with("D:P"), "{sddl}");
                assert!(sddl.contains(&sid), "{sddl}");
                assert!(!sddl.contains(";WD)") && !sddl.contains(";AN)"), "{sddl}");
            }
        });
    }
}
