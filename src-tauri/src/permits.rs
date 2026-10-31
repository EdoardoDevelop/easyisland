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
    if tool.ends_with("remote_run") {
        return true;
    }
    const WORDS: &[&str] = &["delete", "remove", "trash", "archive", "destroy", "drop", "purge", "erase", "clear", "wipe",
        "unlink", "rmdir", "rm", "del", "send", "mail", "email", "reply", "forward", "publish", "post", "message", "invite",
        "share", "cancel"];
    let t = tool.to_ascii_lowercase();
    t.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| WORDS.contains(&w))
}

/// The tool «Sempre» would allow for good: a reversible tool asked by the
/// chat (island, Telegram, a task). Else none, and the card has no «Sempre».
pub fn offers_always(payload: &Value) -> Option<String> {
    if payload.get("easyisland_chat").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    tool_of(payload).filter(|t| reversible(t)).map(str::to_string)
}

/// A request of the chat (island, Telegram, a task) for a reversible tool the
/// user allowed for good, or the running task may use: allowed with no click.
pub fn allowed_now(app: &AppHandle, payload: &Value) -> bool {
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
    fn names_and_levels() {
        assert_eq!(tool_of(&json!({ "tool_name": "mcp__easyisland__todo_add" })), Some("todo_add"));
        assert_eq!(tool_of(&json!({ "tool_name": "easyisland_notion_add_row" })), Some("notion_add_row"));
        assert_eq!(tool_of(&json!({ "tool_name": "Bash" })), None);
        assert!(reversible("todo_add") && reversible("move_to_work_folder"));
        for never in ["notion_delete_row", "remote_run", "open_url", "run_quick_action", "set_setting", "read_clipboard", "custom_call"] {
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
    fn reversible_tools_exist_and_are_not_read_only() {
        let all = crate::claude::tool_list::tools();
        for r in crate::claude::tool_list::REVERSIBLE {
            let t = all.iter().find(|t| t.0 == *r).unwrap_or_else(|| panic!("{r} is not a tool"));
            assert!(!t.3, "{r} is read-only, so it is never asked anyway");
        }
    }

    #[test]
    fn delicate_for_both_automatiche() {
        for t in ["mcp__easyisland__notion_delete_row", "easyisland_remote_run", "mcp__easyisland__remote_run", "mcp__gmail__send_email", "drive_share_file", "mcp__notion__notion-delete-pages"] {
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
