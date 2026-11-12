// Permessi per livelli (decided with Edoardo on 31 Oct 2026, docs/chat.md →
// Permessi per livelli). EasyIsland's own tools come in three levels:
// - read-only (claude_cli.rs `agent_read_only`): never asked;
// - reversible (hook/src/tool_list.rs `REVERSIBLE`): Consenti / Nega until the
//   user says «Consenti sempre» on the card (kept in `toolsAllowed` until they
//   take it away in Impostazioni → Chat), or a task allows it (`Task::may`);
// - everything else (sending, deleting, opening, running, settings): asked
//   every time, as before.
// Every tool that changes something goes in «Cosa ho fatto»
// (cosa-ho-fatto.json, the last `KEEP`), with Annulla for the reversible ones.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::t;

/// Entries kept in «Cosa ho fatto».
const KEEP: usize = 300;
/// A tool allowed without a click is the one that runs right after.
const ALONE_FOR: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub id: String,
    /// Milliseconds since 1970.
    pub at: i64,
    pub tool: String,
    /// The tool's answer, shortened: what it did, in its words.
    pub what: String,
    /// "" = the chat; else the task's title.
    #[serde(default)]
    pub task: String,
    /// It ran without a click («Consenti sempre» or the task's permission).
    #[serde(default)]
    pub alone: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<Undo>,
    #[serde(default)]
    pub undone: bool,
}

/// How to take a change back.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Undo {
    NotionTrash { page: String },
    NotionRestore { page: String, before: Value },
    TodoRemove { entry: String },
    TodoRestore { entry: String, before: Value },
    TrayRemove { name: String },
    WorkFolderBack { rel: String, copy: bool },
}

static LOG: Mutex<Option<Vec<Done>>> = Mutex::new(None);
/// Tools just allowed without a click, waiting for their call.
static ALONE: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

fn file() -> std::path::PathBuf {
    crate::settings::config_dir().join("cosa-ho-fatto.json")
}

fn with_log<R>(f: impl FnOnce(&mut Vec<Done>) -> R) -> R {
    let mut guard = LOG.lock().unwrap();
    let log = guard.get_or_insert_with(|| {
        std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    });
    f(log)
}

fn save(log: &[Done]) {
    if let Ok(bytes) = serde_json::to_vec(log) {
        if let Err(e) = crate::settings::write_atomic(&file(), &bytes) {
            crate::log::line(format!("permessi: registro non salvato: {e}"));
        }
    }
}

/// EasyIsland's tool in a permission request: "mcp__easyisland__x" (Claude
/// Code, the API engine) or "easyisland_x" (opencode).
pub fn tool_of(payload: &Value) -> Option<&str> {
    let name = payload.get("tool_name").and_then(Value::as_str)?;
    name.strip_prefix("mcp__easyisland__").or_else(|| name.strip_prefix("easyisland_"))
}

pub fn reversible(tool: &str) -> bool {
    crate::claude::tool_list::REVERSIBLE.contains(&tool)
}

/// A list of tools, kept to the reversible ones, once each.
pub fn only_reversible(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in list.iter().map(|t| t.trim()) {
        if reversible(t) && !out.iter().any(|o| o == t) {
            out.push(t.to_string());
        }
    }
    out
}

/// A tool (a connector's, or EasyIsland's own) that deletes, sends something
/// in the user's name or runs a command on the remote PC: «Automatica» (the
/// chat's ⚡ with opencode, Telegram's) still asks for it. One list for both
/// since 31 Oct 2026: before, Telegram's let "send" and "archive" through.
pub fn delicate_tool(tool: &str) -> bool {
    // A remote PC (a command there, a connection opened to it), the password vault written,
    // or a quick action changed: a script in it is code that runs here.
    // A password from the vault typed into a web page asks every time too.
    if tool.ends_with("remote_run") || tool.ends_with("rdm_open") || tool.contains("dvc_new_") || tool.contains("quick_action_") || tool.ends_with("preview_login") {
        return true;
    }
    const WORDS: &[&str] = &["delete", "remove", "trash", "archive", "destroy", "drop", "purge", "erase", "clear", "wipe",
        "unlink", "rmdir", "rm", "del", "send", "mail", "email", "reply", "forward", "publish", "post", "message", "invite",
        "share", "cancel"];
    let t = tool.to_ascii_lowercase();
    t.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| WORDS.contains(&w))
}

/// Claude Code's own tools that only read files (Read, Grep, Glob), asked by
/// the chat for a place outside its folders: no card, as opencode.rs does,
/// unless the path is one where keys and passwords live (`secret_place`).
/// On the laptop they were a fifth of the cards (8 Nov 2026).
pub fn chat_read(payload: &Value) -> bool {
    if payload.get("easyisland_chat").and_then(Value::as_bool) != Some(true) {
        return false;
    }
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    let input = payload.get("tool_input");
    // Commands keep Consenti / Nega, even the ones that only look (CLAUDE.md).
    if !matches!(tool, "Read" | "Grep" | "Glob") {
        return false;
    }
    let places: Vec<&str> = ["file_path", "path", "pattern", "glob"].iter().filter_map(|k| input.and_then(|i| i.get(*k)).and_then(Value::as_str)).collect();
    !places.is_empty() && places.iter().all(|p| !crate::opencode::secret_place(p))
}

/// preview_steps whose steps all only read (open, find, wait, scroll, read…):
/// no card, as each of them alone would have none.
pub fn steps_only_read(payload: &Value) -> bool {
    if tool_of(payload) != Some("preview_steps") {
        return false;
    }
    let read_only = crate::claude_cli::agent_read_only();
    payload.pointer("/tool_input/steps").and_then(Value::as_array).is_some_and(|steps| {
        !steps.is_empty() && steps.iter().all(|s| s.get("tool").and_then(Value::as_str).is_some_and(|t| t != "preview_steps" && read_only.contains(&t)))
    })
}

/// The tool «Sempre» would allow for good: a reversible tool asked by the
/// chat (island, Telegram, a task). Else none, and the card has no «Sempre».
pub fn offers_always(payload: &Value) -> Option<String> {
    if payload.get("easyisland_chat").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    tool_of(payload).filter(|t| reversible(t)).map(str::to_string)
}

/// «Sempre» clicked on a card of the chat's Claude Code, for the session:
/// (session, what it allows). Claude Code keeps its session rules only while
/// its process lives; the chat starts another one after 20 idle minutes, a
/// change of settings or a conversation reopened, and the rule was gone (8 Nov
/// 2026: Claude Desktop keeps it for the whole conversation). In memory only.
static SESSION_RULES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// What «Sempre» allows for the session, in the words of easyisland-hook's
/// `session_rule`: the one-line command, every file edit, the web domain, or
/// the tool by name. None for questions and plans (they always ask).
fn session_key(payload: &Value) -> Option<(String, String)> {
    if payload.get("easyisland_chat").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let session = payload.get("session_id").and_then(Value::as_str).filter(|s| !s.is_empty())?;
    // Clicks and keys in the preview: the site, never the tool (Edoardo, 12 Nov 2026).
    if tool_of(payload).is_some_and(|t| SITE_TOOLS.contains(&t)) {
        return site_key(payload, crate::preview::site_of, crate::preview::as_url).map(|h| (session.to_string(), format!("site:{h}")));
    }
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    let text = |k: &str| payload.pointer(&format!("/tool_input/{k}")).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    let what = match tool {
        "" | "AskUserQuestion" | "ExitPlanMode" => return None,
        "Bash" | "PowerShell" => format!("{tool}:{}", text("command").filter(|c| !c.contains('\n'))?),
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => "edits".to_string(),
        "WebFetch" => {
            let url = text("url")?;
            let rest = url.split_once("://").map_or(url, |(_, r)| r);
            let host = rest.split(['/', '?', '#']).next()?.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
            if host.is_empty() {
                return None;
            }
            format!("WebFetch:{host}")
        }
        other => other.to_string(),
    };
    Some((session.to_string(), what))
}

/// The preview's tools that click, press or type: «Sempre» on them allows that
/// site for the conversation (as Claude Desktop does), never the tool everywhere.
/// Buying, ordering and paying are refused by the preview itself (preview.rs FIND).
pub const SITE_TOOLS: &[&str] = &["preview_click", "preview_type", "preview_act", "preview_steps"];

/// The one site a preview request acts on: its tab's; for preview_steps, None
/// when a step opens another site or acts on another tab (no «Sempre» then).
fn site_key(payload: &Value, site_of: impl Fn(&str) -> Option<String>, as_url: impl Fn(&str) -> Option<String>) -> Option<String> {
    let input = payload.get("tool_input")?;
    let tab = input.get("tab").and_then(Value::as_str).unwrap_or_default();
    let host = site_of(tab)?;
    if tool_of(payload) == Some("preview_steps") {
        for step in input.get("steps").and_then(Value::as_array)? {
            if step.get("tab").and_then(Value::as_str).is_some_and(|t| t != tab) {
                return None;
            }
            if step.get("tool").and_then(Value::as_str) == Some("preview_open") {
                let target = step.get("target").and_then(Value::as_str).unwrap_or_default().trim();
                let same = match target {
                    "" | "reload" => true,
                    "back" | "forward" | "show" | "close" => false,
                    t => as_url(t).and_then(|u| crate::preview::host_of(&u)).is_some_and(|h| h == host),
                };
                if !same {
                    return None;
                }
            }
        }
    }
    Some(host)
}

/// The site «Sempre» would allow, on the card's request (easyisland_site, hooks.ts).
pub fn annotate_site(payload: &mut Value) {
    if let Some((_, key)) = session_key(payload).filter(|(_, k)| k.starts_with("site:")) {
        if let Some(o) = payload.as_object_mut() {
            o.insert("easyisland_site".into(), Value::String(key.trim_start_matches("site:").to_string()));
        }
    }
}

/// Sessions whose plan (ExitPlanMode) was approved on its card, for the chat to leave «Piano».
static PLANS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The plan of `session` was approved since the last time it was asked (once).
pub fn plan_approved(session: &str) -> bool {
    let mut all = PLANS.lock().unwrap();
    let had = all.iter().any(|s| s == session);
    all.retain(|s| s != session);
    had
}

/// The answer to a card: «Sempre» on the chat's Claude Code is kept for its session.
pub fn note_decision(payload: &Value, decision: Option<&str>) {
    let word = decision.and_then(|d| d.split(' ').next()).unwrap_or_default();
    if matches!(word, "allow" | "always") && payload.get("tool_name").and_then(Value::as_str) == Some("ExitPlanMode") {
        if let Some(s) = payload.get("session_id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            PLANS.lock().unwrap().push(s.to_string());
        }
    }
    if decision.is_some_and(|d| d.split(' ').next() == Some("always")) {
        if let Some(key) = session_key(payload) {
            let mut all = SESSION_RULES.lock().unwrap();
            if !all.contains(&key) {
                all.push(key);
            }
        }
    }
}

/// A request of the chat (island, Telegram, a task) for a reversible tool the
/// user allowed for good, or the running task may use: allowed with no click.
pub fn allowed_now(app: &AppHandle, payload: &Value) -> bool {
    if steps_only_read(payload) {
        crate::log::line("permessi: preview_steps consentito senza chiedere (solo lettura)".to_string());
        return true;
    }
    if chat_read(payload) {
        let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default();
        crate::log::line(format!("permessi: {tool} consentito senza chiedere (solo lettura)"));
        return true;
    }
    // «Sempre» already clicked for this, in this session (Claude Code's own rule, kept here).
    if let Some(key) = session_key(payload) {
        if SESSION_RULES.lock().unwrap().contains(&key) {
            crate::log::line(format!("permessi: {} consentito per la sessione («Sempre»)", key.1.split(':').next().unwrap_or_default()));
            return true;
        }
    }
    let Some(tool) = offers_always(payload) else { return false };
    let always = app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().tools_allowed.iter().any(|a| *a == tool));
    if !always && !crate::tasks::may_now(&tool) {
        return false;
    }
    crate::log::line(format!("permessi: {tool} consentito senza chiedere"));
    let mut alone = ALONE.lock().unwrap();
    alone.retain(|(_, at)| at.elapsed() < ALONE_FOR);
    alone.push((tool, Instant::now()));
    true
}

/// «Consenti sempre» on the card (on) or ✕ in Impostazioni → Chat (off).
pub fn allow(app: &AppHandle, tool: &str, on: bool) -> Result<(), String> {
    if on && !reversible(tool) {
        return Err(t("Questo strumento chiede sempre conferma.").into());
    }
    crate::agent::update_settings(app, |s| {
        s.tools_allowed.retain(|a| a != tool && reversible(a));
        if on {
            s.tools_allowed.push(tool.to_string());
        }
    })
}

/// The reversible tools, run here so that «Cosa ho fatto» knows how to undo
/// them; None for the others (agent.rs runs them).
pub async fn run_reversible(app: &AppHandle, tool: &str, args: &Value) -> Option<Result<String, String>> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let out = match tool {
        "notion_add_row" => crate::notion_tools::add_row_undoable(&s("database"), args.get("properties").unwrap_or(&Value::Null)).await
            .map(|(text, page)| (text, (!page.is_empty()).then_some(Undo::NotionTrash { page }))),
        "notion_update_row" => crate::notion_tools::update_row_undoable(&s("page"), args.get("properties").unwrap_or(&Value::Null)).await
            .map(|(text, page, before)| {
                let any = before.as_object().is_some_and(|o| !o.is_empty());
                (text, any.then_some(Undo::NotionRestore { page, before }))
            }),
        "todo_add" => crate::todo::add_undoable(args).await
            .map(|(text, entry)| (text, (!entry.is_empty()).then_some(Undo::TodoRemove { entry }))),
        "todo_update" => crate::todo::update_undoable(args).await
            .map(|(text, entry, before)| (text, Some(Undo::TodoRestore { entry, before }))),
        "add_to_tray" => crate::agent::add_to_tray(app, args).await
            .map(|(text, name)| (text, Some(Undo::TrayRemove { name }))),
        "move_to_work_folder" => crate::agent::move_to_work_folder(app, args).await
            .map(|(text, rel, copy)| (text, Some(Undo::WorkFolderBack { rel, copy }))),
        _ => return None,
    };
    Some(out.map(|(text, undo)| {
        record(app, tool, &text, undo);
        text
    }))
}

/// A tool that changed something, in «Cosa ho fatto». The read-only ones
/// (and the chat's memory, which has its own window) never come here.
pub fn record(app: &AppHandle, tool: &str, text: &str, undo: Option<Undo>) {
    let alone = {
        let mut list = ALONE.lock().unwrap();
        list.retain(|(_, at)| at.elapsed() < ALONE_FOR);
        list.iter().position(|(t, _)| t == tool).map(|i| list.remove(i)).is_some()
    };
    let task = if crate::tasks::in_turn() { crate::tasks::running().and_then(|id| crate::tasks::get(&id)).map(|t| t.title).unwrap_or_default() } else { String::new() };
    let mut what: String = text.lines().take(4).collect::<Vec<_>>().join("\n");
    if what.chars().count() > 400 {
        what = what.chars().take(400).collect::<String>() + "…";
    }
    let at = chrono_ms();
    let entry = Done { id: format!("{at:x}-{}", crate::msgraph::random(3).iter().map(|b| format!("{b:02x}")).collect::<String>()), at, tool: tool.to_string(), what, task, alone, undo, undone: false };
    // Done without a click: the island says so, with Annulla (src/main.ts).
    if entry.alone {
        let _ = app.emit("did-alone", &entry);
    }
    with_log(|log| {
        log.push(entry);
        let extra = log.len().saturating_sub(KEEP);
        log.drain(..extra);
        save(log);
    });
    let _ = app.emit("did-changed", ());
}

fn chrono_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

/// «Cosa ho fatto», the newest first.
pub fn list() -> Vec<Done> {
    with_log(|log| log.iter().rev().cloned().collect())
}

/// Annulla: the change taken back, and the entry marked.
pub async fn undo(app: &AppHandle, id: &str) -> Result<(), String> {
    let entry = with_log(|log| log.iter().find(|d| d.id == id).cloned()).ok_or(t("Voce non trovata."))?;
    if entry.undone {
        return Err(t("Già annullato.").into());
    }
    let undo = entry.undo.ok_or(t("Questa azione non si può annullare da qui."))?;
    match undo {
        Undo::NotionTrash { page } => crate::notion_tools::trash_row(&page).await?,
        Undo::NotionRestore { page, before } => crate::notion_tools::restore_row(&page, &before).await?,
        Undo::TodoRemove { entry } => crate::todo::remove(&entry).await?,
        Undo::TodoRestore { entry, before } => crate::todo::restore(&entry, &before).await?,
        Undo::TrayRemove { name } => crate::files::delete_from_inbox(&name)?,
        Undo::WorkFolderBack { rel, copy } => {
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                // Moved: back in the Vassoio; copied: the copy to the Recycle Bin.
                if !copy {
                    crate::workdir::to_inbox(&app2, &rel)?;
                }
                crate::workdir::trash(&app2, &rel)
            })
            .await
            .map_err(|e| e.to_string())??;
        }
    }
    crate::log::line(format!("permessi: annullato {}", entry.tool));
    with_log(|log| {
        if let Some(d) = log.iter_mut().find(|d| d.id == id) {
            d.undone = true;
        }
        save(log);
    });
    let _ = app.emit("did-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sempre_on_a_click_is_for_the_site() {
        let site = |_: &str| Some("shop.esempio.it".to_string());
        let url = |t: &str| crate::preview::as_url(t);
        let p = |tool: &str, input: Value| json!({ "tool_name": format!("mcp__easyisland__{tool}"), "tool_input": input, "session_id": "s1", "easyisland_chat": true });
        assert_eq!(site_key(&p("preview_act", json!({ "action": "click" })), site, url).as_deref(), Some("shop.esempio.it"));
        let same = p("preview_steps", json!({ "steps": [{ "tool": "preview_open", "target": "https://shop.esempio.it/cerca?q=a" }, { "tool": "preview_act", "action": "key", "keys": "Enter" }] }));
        assert!(site_key(&same, site, url).is_some());
        let other = p("preview_steps", json!({ "steps": [{ "tool": "preview_open", "target": "https://altro.it/" }, { "tool": "preview_click", "ref": "e1" }] }));
        assert!(site_key(&other, site, url).is_none());
        let back = p("preview_steps", json!({ "steps": [{ "tool": "preview_open", "target": "back" }] }));
        assert!(site_key(&back, site, url).is_none());
        assert!(site_key(&p("preview_click", json!({})), |_: &str| None, url).is_none());
        assert!(SITE_TOOLS.iter().all(|t| !reversible(t)));
    }

    #[test]
    fn steps_that_only_read_need_no_card() {
        let p = |steps: Value| json!({ "tool_name": "mcp__easyisland__preview_steps", "tool_input": { "steps": steps } });
        assert!(steps_only_read(&p(json!([{ "tool": "preview_open", "target": "x" }, { "tool": "preview_find", "query": "a" }]))));
        assert!(!steps_only_read(&p(json!([{ "tool": "preview_open" }, { "tool": "preview_act", "action": "click" }]))));
        assert!(!steps_only_read(&p(json!([]))));
        assert!(!steps_only_read(&p(json!([{ "tool": "preview_steps" }]))));
        assert!(!steps_only_read(&json!({ "tool_name": "mcp__easyisland__preview_find", "tool_input": {} })));
    }

    #[test]
    fn chat_reads_pass_but_not_where_keys_live() {
        let ask = |tool: &str, input: Value, chat: bool| chat_read(&json!({ "tool_name": tool, "tool_input": input, "easyisland_chat": chat }));
        assert!(ask("Read", json!({ "file_path": "C:\\Users\\E\\AppData\\Local\\Temp\\out.txt" }), true));
        assert!(ask("Glob", json!({ "pattern": "**/*.pdf", "path": "D:\\Offerte" }), true));
        assert!(!ask("Read", json!({ "file_path": "C:\\Users\\E\\.ssh\\id_ed25519" }), true));
        assert!(!ask("Grep", json!({ "pattern": "x", "path": "C:\\Users\\E\\.aws" }), true));
        // Not the chat (a terminal of the user's), not a read, or nothing to check: the card as before.
        assert!(!ask("Read", json!({ "file_path": "C:\\a.txt" }), false));
        assert!(!ask("Write", json!({ "file_path": "C:\\a.txt" }), true));
        assert!(!ask("Read", json!({}), true));
        assert!(!ask("PowerShell", json!({ "command": "Get-ChildItem C:\\" }), true));
    }

    #[test]
    fn names_and_levels() {
        assert_eq!(tool_of(&json!({ "tool_name": "mcp__easyisland__todo_add" })), Some("todo_add"));
        assert_eq!(tool_of(&json!({ "tool_name": "easyisland_notion_add_row" })), Some("notion_add_row"));
        assert_eq!(tool_of(&json!({ "tool_name": "Bash" })), None);
        assert!(reversible("todo_add") && reversible("move_to_work_folder"));
        for never in ["notion_delete_row", "remote_run", "open_url", "rdm_open", "dvc_new_credential", "dvc_new_password_list", "run_quick_action", "quick_action_create", "quick_action_update", "quick_action_delete", "set_setting", "read_clipboard", "custom_call"] {
            assert!(!reversible(never), "{never} must always ask");
        }
        let kept = only_reversible(&["todo_add".into(), " todo_add ".into(), "notion_delete_row".into(), "x".into()]);
        assert_eq!(kept, vec!["todo_add".to_string()]);
        // «Sempre» (card and Telegram): only the chat's requests for a reversible tool.
        assert_eq!(offers_always(&json!({ "tool_name": "mcp__easyisland__todo_add", "easyisland_chat": true })).as_deref(), Some("todo_add"));
        assert_eq!(offers_always(&json!({ "tool_name": "mcp__easyisland__todo_add" })), None);
        assert_eq!(offers_always(&json!({ "tool_name": "easyisland_notion_delete_row", "easyisland_chat": true })), None);
        assert_eq!(offers_always(&json!({ "tool_name": "Bash", "easyisland_chat": true })), None);
    }

    #[test]
    fn sempre_holds_for_the_whole_session_and_only_for_what_was_allowed() {
        let ask = |tool: &str, input: Value| json!({ "tool_name": tool, "tool_input": input, "session_id": "s-ok", "easyisland_chat": true });
        let cmd = ask("Bash", json!({ "command": "npm test" }));
        assert!(session_key(&cmd).is_some());
        note_decision(&cmd, Some("always"));
        assert!(SESSION_RULES.lock().unwrap().contains(&session_key(&cmd).unwrap()));
        // Another command, another session, a plain «Consenti»: not covered.
        assert!(!SESSION_RULES.lock().unwrap().contains(&session_key(&ask("Bash", json!({ "command": "npm publish" }))).unwrap()));
        let other = json!({ "tool_name": "Bash", "tool_input": { "command": "npm test" }, "session_id": "s-altra", "easyisland_chat": true });
        assert!(!SESSION_RULES.lock().unwrap().contains(&session_key(&other).unwrap()));
        let once = ask("Write", json!({ "file_path": "C:/x/a.txt" }));
        note_decision(&once, Some("allow"));
        assert!(!SESSION_RULES.lock().unwrap().contains(&session_key(&once).unwrap()));
        // Questions, plans, terminal sessions (not the chat's) never.
        assert!(session_key(&ask("AskUserQuestion", json!({}))).is_none());
        assert!(session_key(&json!({ "tool_name": "Bash", "tool_input": { "command": "ls" }, "session_id": "t" })).is_none());
        // An approved plan is said once.
        note_decision(&ask("ExitPlanMode", json!({ "plan": "x" })), Some("allow"));
        assert!(plan_approved("s-ok"));
        assert!(!plan_approved("s-ok"));
    }

    #[test]
    fn reversible_tools_exist_and_are_not_read_only() {
        let all = crate::claude::tool_list::tools();
        for r in crate::claude::tool_list::REVERSIBLE {
            let t = all.iter().find(|t| t.0 == *r).unwrap_or_else(|| panic!("{r} is not a tool"));
            assert!(!t.3, "{r} is read-only, so it is never asked anyway");
        }
    }

    #[test]
    fn delicate_for_both_automatiche() {
        for t in ["mcp__easyisland__notion_delete_row", "easyisland_remote_run", "mcp__easyisland__remote_run", "mcp__gmail__send_email", "drive_share_file", "mcp__notion__notion-delete-pages", "mcp__easyisland__preview_login"] {
            assert!(delicate_tool(t), "{t}");
        }
        for t in ["mcp__easyisland__todo_add", "mcp__notion__notion-create-pages", "easyisland_list_status", "mcp__easyisland__notion_update_row"] {
            assert!(!delicate_tool(t), "{t}");
        }
    }

    #[test]
    fn island_names_every_reversible_tool() {
        let ts = include_str!("../../src/core/permits.ts");
        for r in crate::claude::tool_list::REVERSIBLE {
            assert!(ts.contains(&format!("  {r}: t(")), "{r} has no words in src/core/permits.ts");
        }
    }

    #[test]
    fn undo_round_trips() {
        let d = Done { id: "1".into(), at: 1, tool: "todo_update".into(), what: "x".into(), task: String::new(), alone: true,
            undo: Some(Undo::TodoRestore { entry: "E".into(), before: json!({ "title": "a" }) }), undone: false };
        let back: Done = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
        assert!(matches!(back.undo, Some(Undo::TodoRestore { ref entry, .. }) if entry == "E"));
    }
}
