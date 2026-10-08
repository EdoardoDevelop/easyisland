// opencode (sst/opencode 2.x) as a chat engine: models that are free or local,
// *with* tools (commands, files, the web), which the OpenAI-compatible engines
// of openai.rs cannot do (HANDOFF, opencode).
//
// opencode runs here as a private server of EasyIsland's own: `opencode serve`
// on 127.0.0.1 at a free port, with a random password (basic auth, user
// "opencode") and EASYISLAND_INTERNAL=1 so our relay ignores it. It starts with
// the first message and stops after IDLE_STOP without one, or when the app quits.
//
// One opencode session per chat. A turn: open the event stream, send the
// prompt, stream the text to the island (`chat-stream`, as openai.rs does) with
// the tool steps as short lines, until the session's execution ends.
//
// Permissions never default to allow: every session carries RULES (`*` = ask,
// reading and searching allowed, .env never read, no questions), and each
// request becomes the island's Consenti / Nega card (pipe::request_decision).
// "Sempre" only for read-only commands; no click in time = reject.
//
// Provider keys stay with opencode (`opencode auth login`), never here.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::claude::{Chat, ChatContext, ChatReply};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The private server stops after this long without a message.
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
/// How long a fresh server gets to answer.
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// The island gets the growing reply at most this often.
const STREAM_EVERY_MS: u128 = 80;
/// No event of the turn for this long (a model that stopped answering): give up.
/// Longer than a permission card stays up (pipe.rs, 108 s).
const STALL: Duration = Duration::from_secs(180);

#[derive(Clone, Serialize)]
struct Stream<'a> {
    text: &'a str,
}

// ── Finding opencode ──────────────────────────────────────────────────────────

/// The real `opencode.exe`: npm's shims (`opencode.cmd`) start it through cmd,
/// and a server behind cmd could not be stopped, so the binary they point at
/// comes first; then %PATH%, then the installer's own folder.
pub fn find_exe() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(a) = &appdata {
        let modules = a.join("npm").join("node_modules");
        candidates.push(modules.join("@opencode").join("cli").join("bin").join("opencode.exe"));
        candidates.push(modules.join("opencode-ai").join("node_modules").join("opencode-windows-x64").join("bin").join("opencode.exe"));
        candidates.push(modules.join("opencode-windows-x64").join("bin").join("opencode.exe"));
    }
    if let Some(h) = &home {
        candidates.push(h.join(".opencode").join("bin").join("opencode.exe"));
    }
    if let Some(p) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    crate::find_on_path("opencode").filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
}

/// Where the chat's sessions work: a folder of their own, not the user's files.
fn workspace() -> PathBuf {
    let dir = crate::settings::local_dir().join("opencode");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

// ── The private server ────────────────────────────────────────────────────────

struct Server {
    url: String,
    password: String,
    child: tokio::process::Child,
    last_used: Instant,
    /// Which start this is: the idle timer of an older server leaves this one alone.
    generation: u64,
}

static SERVER: tokio::sync::Mutex<Option<Server>> = tokio::sync::Mutex::const_new(None);
/// The server's process id, readable at exit without the lock (0 = none).
static SERVER_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Turns in progress: the idle timer never stops a server mid-answer.
static BUSY: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// 128 random bits as hex, from the OS-seeded keys of std's hasher.
fn random_password() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..4u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:08x}", h.finish() as u32));
    }
    out
}

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// For the event stream: no overall limit (STALL watches it).
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// For everything else: a call that hangs must not hold the chat.
fn http_short() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// The running server's address and password, started if needed.
async fn server() -> Result<(String, String), String> {
    let mut guard = SERVER.lock().await;
    if let Some(s) = guard.as_mut() {
        if matches!(s.child.try_wait(), Ok(None)) {
            s.last_used = Instant::now();
            return Ok((s.url.clone(), s.password.clone()));
        }
        *guard = None;
    }
    let exe = find_exe().ok_or("opencode non è installato su questo PC (npm i -g @opencode/cli, oppure opencode.ai).")?;
    let port = free_port()?;
    let password = random_password();
    let url = format!("http://127.0.0.1:{port}");
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()])
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("EASYISLAND_INTERNAL", "1")
        .current_dir(workspace())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let child = cmd.spawn().map_err(|e| format!("Impossibile avviare opencode: {e}"))?;
    crate::log::line(format!("opencode: server on port {port}"));

    // Up when /api/info answers; a 1.x opencode has no /api and never does.
    let client = http_short()?;
    let started = Instant::now();
    loop {
        let ok = client.get(format!("{url}/api/info")).basic_auth("opencode", Some(&password)).send().await
            .map(|r| r.status().is_success()).unwrap_or(false);
        if ok {
            break;
        }
        if started.elapsed() > START_TIMEOUT {
            return Err("opencode non risponde. Serve la versione 2 (opencode upgrade).".into());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    SERVER_PID.store(child.id().unwrap_or(0), std::sync::atomic::Ordering::SeqCst);
    *guard = Some(Server { url: url.clone(), password: password.clone(), child, last_used: Instant::now(), generation });
    drop(guard);
    spawn_idle_stop(generation);
    Ok((url, password))
}

// ── The chat's sessions in opencode's history ─────────────────────────────────
// opencode keeps every session in its own database, shared with opencode
// Desktop and the TUI: the chat's conversations would pile up there as "Chat
// di EasyIsland". They are deleted when the chat starts over, when the engine
// changes, and when the server stops.

/// Sessions this run of EasyIsland created and has not deleted yet.
static OURS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// A conversation is over: delete its session (only ours, only an opencode one).
pub fn forget(session: Option<String>) {
    let Some(id) = session.filter(|s| s.starts_with("ses")) else { return };
    let ours = {
        let mut list = OURS.lock().unwrap();
        let had = list.contains(&id);
        list.retain(|x| x != &id);
        had
    };
    if !ours {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let Some((url, password)) = SERVER.lock().await.as_ref().map(|s| (s.url.clone(), s.password.clone())) else { return };
        delete_sessions(&url, &password, &[id]).await;
    });
}

async fn delete_sessions(url: &str, password: &str, ids: &[String]) {
    let Ok(client) = http_short() else { return };
    for id in ids {
        let _ = client.delete(format!("{url}/api/session/{id}")).basic_auth("opencode", Some(password)).send().await;
    }
}

/// Every session still ours, deleted (before the server stops).
async fn delete_ours(url: &str, password: &str) {
    let ids: Vec<String> = std::mem::take(&mut *OURS.lock().unwrap());
    delete_sessions(url, password, &ids).await;
}

/// The server and every shell it started (taskkill /T): stopping opencode.exe
/// alone would leave a long command running.
fn stop(s: &mut Server) {
    if let Some(pid) = s.child.id() {
        crate::actions::kill_tree(pid);
    }
    let _ = s.child.start_kill();
    SERVER_PID.store(0, std::sync::atomic::Ordering::SeqCst);
}

/// Once per server: stops it after IDLE_STOP without a turn.
fn spawn_idle_stop(generation: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let mut guard = SERVER.lock().await;
            let Some(s) = guard.as_mut().filter(|s| s.generation == generation) else { return };
            if BUSY.load(std::sync::atomic::Ordering::SeqCst) == 0 && s.last_used.elapsed() > IDLE_STOP {
                delete_ours(&s.url, &s.password).await;
                stop(s);
                *guard = None;
                crate::log::line("opencode: server stopped (idle)");
                return;
            }
        }
    });
}

/// The app is quitting: the chat's sessions out of opencode's history (two
/// seconds at most), and no server left behind, even if a turn holds the lock.
pub fn shutdown() {
    if let Ok(guard) = SERVER.try_lock() {
        if let Some((url, password)) = guard.as_ref().map(|s| (s.url.clone(), s.password.clone())) {
            drop(guard);
            tauri::async_runtime::block_on(async {
                let _ = tokio::time::timeout(Duration::from_secs(2), delete_ours(&url, &password)).await;
            });
        }
    }
    let pid = SERVER_PID.swap(0, std::sync::atomic::Ordering::SeqCst);
    if pid != 0 {
        crate::actions::kill_tree(pid);
    }
}

// ── Rules, labels, permissions (pure, tested) ─────────────────────────────────

/// The session's permissions; the last matching rule wins. Everything asks,
/// except reading and searching inside the chat's folder and opencode's own.
pub fn rules() -> Value {
    let mut r = vec![
        json!({ "action": "*", "resource": "*", "effect": "ask" }),
    ];
    for action in ["read", "glob", "grep", "todowrite", "skill"] {
        r.push(json!({ "action": action, "resource": "*", "effect": "allow" }));
    }
    for env in ["*.env", "*.env.*"] {
        r.push(json!({ "action": "read", "resource": env, "effect": "deny" }));
    }
    // A question form has no place in the island yet: the model must just ask in its reply.
    r.push(json!({ "action": "question", "resource": "*", "effect": "deny" }));
    // opencode's own scratch folders (long tool output, shells).
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let temp = std::env::var("TEMP").unwrap_or_default();
    for dir in [format!("{home}\\.local\\share\\opencode\\*"), format!("{temp}\\opencode\\*")] {
        r.push(json!({ "action": "external_directory", "resource": dir, "effect": "allow" }));
    }
    Value::Array(r)
}

/// "provider/model" (as saved in engineModels.opencode) → `{providerID, id}`.
pub fn model_ref(model: &str) -> Option<Value> {
    let (provider, id) = model.trim().split_once('/')?;
    (!provider.is_empty() && !id.is_empty()).then(|| json!({ "providerID": provider, "id": id }))
}

/// Commands that only look: the ones "Sempre" may approve for the session.
pub fn read_only(command: &str) -> bool {
    const SAFE: &[&str] = &[
        "echo", "pwd", "whoami", "hostname", "date", "ls", "dir", "cat", "type", "head", "tail", "wc", "find",
        "where", "which", "tree", "ipconfig", "ping", "nslookup", "tracert", "systeminfo", "tasklist", "ver",
        "get-childitem", "get-content", "get-item", "get-process", "get-service", "get-date", "get-location",
        "test-path", "test-connection", "resolve-dnsname", "get-netipaddress", "get-computerinfo",
        "git status", "git log", "git diff", "git show", "git branch", "node --version", "npm --version",
    ];
    let c = command.trim().to_ascii_lowercase();
    if c.is_empty() || c.contains(['>', '|', ';', '&', '`']) || c.contains("$(") {
        return false;
    }
    SAFE.iter().any(|s| c == *s || c.starts_with(&format!("{s} ")))
}

/// opencode's tool names under the island's ("Bash", "Edit"…).
fn tool_name(action: &str) -> String {
    match action {
        "shell" | "bash" => "Bash",
        "edit" | "write" | "apply_patch" | "patch" => "Edit",
        "read" => "Read",
        "webfetch" => "WebFetch",
        "websearch" => "WebSearch",
        "glob" => "Glob",
        "grep" => "Grep",
        "external_directory" => "Cartella esterna",
        other => other,
    }
    .to_string()
}

/// A step line under the reply: "Esegue · echo ciao".
pub fn step_line(tool: &str, input: &Value) -> String {
    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_string);
    let what = s("command").or_else(|| s("filePath")).or_else(|| s("path")).or_else(|| s("pattern"))
        .or_else(|| s("url")).or_else(|| s("query")).unwrap_or_default();
    let label = match tool {
        "shell" | "bash" => "Esegue",
        "read" => "Legge",
        "edit" | "write" | "apply_patch" => "Modifica",
        "glob" | "grep" => "Cerca",
        "webfetch" => "Apre",
        "websearch" => "Cerca sul web",
        "todowrite" => "Aggiorna il piano",
        // opencode's "code mode": a small script that calls its other tools.
        "execute" => "Esegue uno script",
        "skill" => "Usa una skill",
        other => other,
    };
    let what: String = what.lines().next().unwrap_or_default().chars().take(80).collect();
    if what.is_empty() { format!("> ⚙ {label}") } else { format!("> ⚙ {label} · `{}`", what.replace('`', "'")) }
}

/// A `permission.asked` event's data → the island's PermissionRequest payload,
/// and whether "Sempre" is on offer (a read-only command with patterns to save).
pub fn permission_payload(data: &Value) -> (Value, bool) {
    let action = data.get("action").and_then(Value::as_str).unwrap_or_default();
    let list = |k: &str| -> Vec<String> {
        data.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
    };
    let resources = list("resources");
    let save = list("save");
    let tool = tool_name(action);
    let input = if action == "shell" || action == "bash" {
        json!({ "command": resources.join("\n") })
    } else {
        json!({ "path": resources.join(", ") })
    };
    let always = (action == "shell" || action == "bash") && !save.is_empty() && !resources.is_empty()
        && resources.iter().all(|c| read_only(c));
    let mut payload = json!({
        "hook_event_name": "PermissionRequest",
        "easyisland_chat": true,
        "easyisland_engine": "opencode",
        "session_id": data.get("sessionID").cloned().unwrap_or(Value::Null),
        "tool_name": tool,
        "tool_input": input,
    });
    if always {
        let rules: Vec<Value> = save.iter().map(|p| json!({ "toolName": "Bash", "ruleContent": p })).collect();
        payload["permission_suggestions"] = json!([{ "type": "addRules", "rules": rules, "behavior": "allow", "destination": "session" }]);
    }
    (payload, always)
}

/// The island's click → opencode's reply. No click (timeout, card refused) is a no.
pub fn reply_word(decision: Option<&str>, always_offered: bool) -> &'static str {
    match decision {
        Some("allow") => "once",
        Some("always") if always_offered => "always",
        Some("always") => "once",
        _ => "reject",
    }
}

/// One `data:` line of the event stream → the event.
pub fn parse_event(line: &str) -> Option<Value> {
    let data = line.trim().strip_prefix("data:")?.trim();
    serde_json::from_str(data).ok()
}

// ── A chat turn ───────────────────────────────────────────────────────────────

/// The first turn's attachment: text and window context go in front of the
/// question, a file as an attachment opencode reads itself.
fn prompt_body(first: bool, query: &str, context: Option<&ChatContext>) -> Value {
    let mut text = String::new();
    let mut files = Vec::new();
    if first {
        match context {
            Some(ChatContext::Text { label, text: t }) => text.push_str(&format!("{label}:\n{t}\n\n")),
            Some(ChatContext::Window { app_name, title, url }) => {
                text.push_str(&format!("Contesto — App: {app_name}, Finestra: {title}"));
                if let Some(u) = url {
                    text.push_str(&format!(", URL: {u}"));
                }
                text.push_str("\n\n");
            }
            Some(ChatContext::File { name, path }) => {
                let uri = format!("file:///{}", path.replace('\\', "/").trim_start_matches('/'));
                files.push(json!({ "uri": uri, "name": name }));
            }
            None => {}
        }
    }
    text.push_str(query);
    let mut body = json!({ "text": text });
    if !files.is_empty() {
        body["files"] = Value::Array(files);
    }
    body
}

/// What the event says about the turn: still going, done, or failed with a reason.
enum Turn {
    Going,
    Done,
    Failed(String),
}

fn turn_state(kind: &str, data: &Value) -> Turn {
    match kind {
        "session.execution.succeeded" => Turn::Done,
        "session.execution.failed" => {
            let msg = data.pointer("/error/message").or_else(|| data.get("message")).or_else(|| data.get("error"))
                .and_then(Value::as_str).unwrap_or("opencode si è fermato per un errore.");
            Turn::Failed(msg.to_string())
        }
        "session.execution.interrupted" => {
            let why = data.get("reason").and_then(Value::as_str).unwrap_or("");
            Turn::Failed(if why.is_empty() { "Risposta interrotta.".into() } else { format!("Risposta interrotta ({why}).") })
        }
        _ => Turn::Going,
    }
}

type Decision = std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>>;

/// Who answers opencode's permission requests: the island's card, or (tests) a
/// fixed word. A trait rather than an enum, so the tests never link the webview.
trait Ask: Clone + Send + Sync + 'static {
    fn decide(&self, payload: Value) -> Decision;
}

#[derive(Clone)]
struct Island(AppHandle);

impl Ask for Island {
    fn decide(&self, payload: Value) -> Decision {
        let app = self.0.clone();
        Box::pin(async move { crate::pipe::request_decision(&app, payload).await })
    }
}

/// One chat turn on opencode. `model` is "provider/model".
pub async fn send(app: &AppHandle, chat: &Chat, model: &str, query: String, context: Option<ChatContext>) -> Result<ChatReply, String> {
    let on_text = |text: &str| {
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "chat-stream", Stream { text });
    };
    run_turn(chat, model, query, context, &on_text, Island(app.clone())).await
}

async fn run_turn(chat: &Chat, model: &str, query: String, context: Option<ChatContext>, on_text: &(dyn Fn(&str) + Sync), ask: impl Ask) -> Result<ChatReply, String> {
    let model_ref = model_ref(model).ok_or("Scegli un modello di opencode nelle impostazioni (Chat).")?;
    BUSY.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let result = turn(chat, model_ref, query, context, on_text, ask).await;
    BUSY.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(s) = SERVER.lock().await.as_mut() {
        s.last_used = Instant::now();
    }
    result
}

async fn turn(chat: &Chat, model: Value, query: String, context: Option<ChatContext>, on_text: &(dyn Fn(&str) + Sync), ask: impl Ask) -> Result<ChatReply, String> {
    match turn_once(chat, model.clone(), &query, context.as_ref(), on_text, ask.clone()).await {
        // The session is gone (opencode restarted without it): a fresh one, once.
        Err(e) if e == SESSION_GONE => {
            forget(chat.cli_session());
            chat.set_cli_session(None);
            turn_once(chat, model, &query, context.as_ref(), on_text, ask).await
        }
        other => other,
    }
}

const SESSION_GONE: &str = "opencode: sessione non trovata";

async fn turn_once(chat: &Chat, model: Value, query: &str, context: Option<&ChatContext>, on_text: &(dyn Fn(&str) + Sync), ask: impl Ask) -> Result<ChatReply, String> {
    let (url, password) = server().await?;
    let client = http_short()?;
    let stream = http()?;
    let auth = |r: reqwest::RequestBuilder| r.basic_auth("opencode", Some(password.clone()));

    let first = chat.cli_session().is_none();
    let session = match chat.cli_session() {
        Some(id) => id,
        None => {
            let body = json!({
                "title": "Chat di EasyIsland",
                "model": model,
                "location": { "directory": workspace().to_string_lossy() },
                "permissions": rules(),
            });
            let r = auth(client.post(format!("{url}/api/session")).json(&body)).send().await.map_err(|e| e.to_string())?;
            let status = r.status();
            let v: Value = r.json().await.unwrap_or(Value::Null);
            let id = v.pointer("/data/id").and_then(Value::as_str).map(str::to_string)
                .ok_or_else(|| format!("opencode {status}: {}", error_text(&v)))?;
            chat.set_cli_session(Some(id.clone()));
            OURS.lock().unwrap().push(id.clone());
            id
        }
    };

    // The stream first, so no event of this turn is missed.
    let mut events = auth(stream.get(format!("{url}/api/event"))).send().await.map_err(|e| e.to_string())?;
    let r = auth(client.post(format!("{url}/api/session/{session}/prompt")).json(&prompt_body(first, query, context)))
        .send().await.map_err(|e| e.to_string())?;
    if r.status() == reqwest::StatusCode::NOT_FOUND && !first {
        return Err(SESSION_GONE.into());
    }
    if !r.status().is_success() {
        let status = r.status();
        let v: Value = r.json().await.unwrap_or(Value::Null);
        return Err(format!("opencode {status}: {}", error_text(&v)));
    }

    let mut out = String::new(); // steps and text, as shown
    let mut block = String::new(); // the text block being written
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut pending = Vec::<u8>::new();
    let mut last_emit = Instant::now();
    // A refused permission makes opencode stop the turn: that is an answer, not an error.
    let refused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shown = |out: &str, block: &str| -> String {
        if block.is_empty() { out.trim().to_string() } else if out.is_empty() { block.trim().to_string() } else { format!("{}\n\n{}", out.trim_end(), block.trim()) }
    };

    let mut last_event = Instant::now();
    loop {
        let next = tokio::time::timeout(Duration::from_secs(20), events.chunk()).await;
        if last_event.elapsed() > STALL {
            let _ = auth(client.post(format!("{url}/api/session/{session}/interrupt"))).send().await;
            return Err("Il modello non risponde da 3 minuti: risposta interrotta. Riprova o scegli un altro modello.".into());
        }
        let Ok(chunk) = next else { continue };
        let chunk = chunk.map_err(|e| format!("opencode ha chiuso la connessione: {e}"))?;
        let Some(chunk) = chunk else { return Err("opencode ha chiuso la connessione.".into()) };
        pending.extend_from_slice(&chunk);
        while let Some(nl) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=nl).collect();
            let Some(ev) = parse_event(&String::from_utf8_lossy(&line)) else { continue };
            let kind = ev.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
            let data = ev.get("data").cloned().unwrap_or(Value::Null);
            if data.get("sessionID").and_then(Value::as_str) != Some(session.as_str()) {
                continue;
            }
            last_event = Instant::now();
            match kind.as_str() {
                "session.text.delta" => {
                    block.push_str(data.get("delta").and_then(Value::as_str).unwrap_or_default());
                }
                "session.text.ended" => {
                    let text = data.get("text").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| block.clone());
                    out = shown(&out, &text);
                    block.clear();
                }
                "session.tool.input.started" => {
                    if let (Some(id), Some(name)) = (data.get("id").and_then(Value::as_str), data.get("name").and_then(Value::as_str)) {
                        names.insert(id.to_string(), name.to_string());
                    }
                }
                "session.tool.called" => {
                    let id = data.get("id").and_then(Value::as_str).unwrap_or_default();
                    let name = names.get(id).cloned().unwrap_or_else(|| "strumento".into());
                    let line = step_line(&name, data.get("input").unwrap_or(&Value::Null));
                    out = shown(&out, &line);
                }
                // A refused call says so once, at the end, in Italian.
                "session.tool.failed" | "session.tool.error" if refused.load(std::sync::atomic::Ordering::SeqCst) => {}
                "session.tool.failed" | "session.tool.error" => {
                    let msg = data.pointer("/error/message").or_else(|| data.get("message")).and_then(Value::as_str).unwrap_or("non riuscito");
                    out = shown(&out, &format!("> ✗ {}", msg.lines().next().unwrap_or_default()));
                }
                "permission.asked" => {
                    let ask = ask.clone();
                    let refused = refused.clone();
                    let (url, password, session, data) = (url.clone(), password.clone(), session.clone(), data.clone());
                    // Never inside the stream loop: the stream must keep flowing.
                    tauri::async_runtime::spawn(async move {
                        let (payload, always) = permission_payload(&data);
                        let decision = ask.decide(payload).await;
                        let word = reply_word(decision.as_deref(), always);
                        if word == "reject" {
                            refused.store(true, std::sync::atomic::Ordering::SeqCst);
                        }
                        let id = data.get("id").and_then(Value::as_str).unwrap_or_default();
                        if let Ok(c) = http_short() {
                            let _ = c.post(format!("{url}/api/session/{session}/permission/{id}/reply"))
                                .basic_auth("opencode", Some(password))
                                .json(&json!({ "decision": word }))
                                .send().await;
                        }
                    });
                }
                _ => match turn_state(&kind, &data) {
                    Turn::Going => {}
                    Turn::Done => {
                        let text = shown(&out, &block);
                        if text.is_empty() {
                            return Err("Nessun testo nella risposta.".into());
                        }
                        return Ok(ChatReply { text });
                    }
                    Turn::Failed(_) if refused.load(std::sync::atomic::Ordering::SeqCst) => {
                        return Ok(ChatReply { text: shown(&out, &format!("{}

_Permesso negato: opencode si è fermato._", block.trim())) });
                    }
                    Turn::Failed(why) => return Err(why),
                },
            }
            if last_emit.elapsed().as_millis() >= STREAM_EVERY_MS {
                last_emit = Instant::now();
                on_text(&shown(&out, &block));
            }
        }
    }
}

fn error_text(v: &Value) -> String {
    v.pointer("/error/message").or_else(|| v.get("message")).and_then(Value::as_str)
        .map(str::to_string).unwrap_or_else(|| v.to_string().chars().take(200).collect())
}

/// Impostazioni → Chat → "Carica modelli": "provider/model" for every enabled model.
pub async fn models() -> Result<Vec<String>, String> {
    let (url, password) = server().await?;
    let v: Value = http_short()?.get(format!("{url}/api/model")).basic_auth("opencode", Some(password))
        .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let mut out: Vec<String> = v.get("data").and_then(Value::as_array).into_iter().flatten()
        .filter(|m| m.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .filter_map(|m| Some(format!("{}/{}", m.get("providerID")?.as_str()?, m.get("id")?.as_str()?)))
        .collect();
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_asks_but_reading_and_searching() {
        let r = rules();
        let r = r.as_array().unwrap();
        assert_eq!(r[0], json!({ "action": "*", "resource": "*", "effect": "ask" }));
        assert!(!r.iter().any(|x| x["effect"] == "allow" && (x["action"] == "shell" || x["action"] == "edit" || x["action"] == "*")));
        assert!(r.iter().any(|x| x["action"] == "question" && x["effect"] == "deny"));
        assert!(r.iter().any(|x| x["action"] == "read" && x["resource"] == "*.env" && x["effect"] == "deny"));
    }

    #[test]
    fn models_are_provider_slash_id() {
        assert_eq!(model_ref("opencode/big-pickle"), Some(json!({ "providerID": "opencode", "id": "big-pickle" })));
        assert_eq!(model_ref("ollama/qwen3:8b"), Some(json!({ "providerID": "ollama", "id": "qwen3:8b" })));
        assert_eq!(model_ref("big-pickle"), None);
        assert_eq!(model_ref(""), None);
    }

    #[test]
    fn only_plain_looking_commands_are_read_only() {
        assert!(read_only("git status"));
        assert!(read_only("Get-ChildItem C:\\Clienti"));
        assert!(read_only("ipconfig /all"));
        assert!(!read_only("git push"));
        assert!(!read_only("echo x > file.txt"));
        assert!(!read_only("dir; del *"));
        assert!(!read_only("cat a | sh"));
        assert!(!read_only("echo $(rm -rf .)"));
        assert!(!read_only("Remove-Item x"));
    }

    #[test]
    fn a_permission_becomes_the_islands_card() {
        let (p, always) = permission_payload(&json!({ "id": "per_1", "sessionID": "ses_1", "action": "shell",
            "resources": ["git status"], "save": ["git status *"] }));
        assert!(always);
        assert_eq!((p["tool_name"].as_str(), p["tool_input"]["command"].as_str()), (Some("Bash"), Some("git status")));
        assert_eq!(p["easyisland_chat"], true);
        assert_eq!(p["permission_suggestions"][0]["rules"][0]["ruleContent"], "git status *");

        let (p, always) = permission_payload(&json!({ "action": "shell", "resources": ["Remove-Item C:\\x"], "save": ["Remove-Item *"] }));
        assert!(!always);
        assert!(p.get("permission_suggestions").is_none());

        let (p, _) = permission_payload(&json!({ "action": "edit", "resources": ["C:\\a.txt"], "save": [] }));
        assert_eq!((p["tool_name"].as_str(), p["tool_input"]["path"].as_str()), (Some("Edit"), Some("C:\\a.txt")));
    }

    #[test]
    fn no_click_is_a_no() {
        assert_eq!(reply_word(Some("allow"), false), "once");
        assert_eq!(reply_word(Some("always"), true), "always");
        assert_eq!(reply_word(Some("always"), false), "once");
        assert_eq!(reply_word(Some("deny"), true), "reject");
        assert_eq!(reply_word(None, true), "reject");
    }

    #[test]
    fn steps_read_like_the_islands_ticker() {
        assert_eq!(step_line("shell", &json!({ "command": "echo ciao" })), "> ⚙ Esegue · `echo ciao`");
        assert_eq!(step_line("read", &json!({ "filePath": "C:/a.txt" })), "> ⚙ Legge · `C:/a.txt`");
        assert_eq!(step_line("todowrite", &json!({})), "> ⚙ Aggiorna il piano");
    }

    #[test]
    fn the_turn_ends_on_the_execution_events() {
        assert!(matches!(turn_state("session.execution.succeeded", &json!({})), Turn::Done));
        assert!(matches!(turn_state("session.execution.interrupted", &json!({ "reason": "shutdown" })), Turn::Failed(_)));
        assert!(matches!(turn_state("session.text.delta", &json!({})), Turn::Going));
        let e = parse_event(r#"data: {"type":"session.text.delta","data":{"delta":"ciao"}}"#).unwrap();
        assert_eq!(e["data"]["delta"], "ciao");
        assert!(parse_event(": heartbeat").is_none());
    }

    #[derive(Clone)]
    struct Fixed(&'static str);

    impl Ask for Fixed {
        fn decide(&self, _payload: Value) -> Decision {
            let word = self.0.to_string();
            Box::pin(async move { Some(word) })
        }
    }

    /// Against the opencode installed on this PC (2.x, a free model):
    /// `cargo test --lib opencode::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_turn_with_a_command_and_a_follow_up() {
        tauri::async_runtime::block_on(async {
            let chat = Chat::default();
            let seen = std::sync::Mutex::new(0usize);
            let on_text = |t: &str| { *seen.lock().unwrap() += 1; let _ = t; };
            let model = std::env::var("OPENCODE_TEST_MODEL").unwrap_or_else(|_| "opencode/big-pickle".into());
            let r = run_turn(&chat, &model, "Esegui il comando: echo ciao-easyisland  e dimmi in una frase cosa ha stampato.".into(), None, &on_text, Fixed("allow")).await;
            println!("1: {:?}", r.as_ref().map(|x| &x.text));
            let text = r.expect("turn").text;
            // Free models do not always show the step (or call the tool at all).
            if !text.contains("> ⚙") {
                println!("(nessun passo: il modello ha risposto senza strumenti)");
            }
            assert!(text.contains("ciao-easyisland"), "{text}");
            assert!(*seen.lock().unwrap() > 0, "streamed");
            let r = run_turn(&chat, &model, "Rispondi solo con la parola: fatto".into(), None, &on_text, Fixed("allow")).await;
            println!("2: {:?}", r.as_ref().map(|x| &x.text));
            assert!(r.expect("follow-up").text.to_lowercase().contains("fatto"));
            let denied = Chat::default();
            let r = run_turn(&denied, &model, "Esegui il comando: echo vietato e dimmi cosa è successo.".into(), None, &on_text, Fixed("deny")).await;
            println!("3: {:?}", r.as_ref().map(|x| &x.text));
            // Both conversations leave opencode's history with the server.
            assert_eq!(OURS.lock().unwrap().len(), 2);
            // A free model sometimes answers without trying the command: no refusal then.
            assert!(r.is_ok(), "a refusal is an answer, not an error");
        });
        // Outside the runtime, as at the app's exit.
        shutdown();
        assert!(OURS.lock().unwrap().is_empty());
    }

    #[test]
    fn a_file_goes_as_an_attachment_on_the_first_turn_only() {
        let ctx = ChatContext::File { name: "a.pdf".into(), path: "C:\\x\\a.pdf".into() };
        let b = prompt_body(true, "riassumi", Some(&ctx));
        assert_eq!(b["files"][0]["uri"], "file:///C:/x/a.pdf");
        assert_eq!(b["text"], "riassumi");
        assert!(prompt_body(false, "e poi?", Some(&ctx)).get("files").is_none());
    }
}
