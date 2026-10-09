// Weekly recap: what the coding agents did, shown on Monday (taken from
// Coucou's recap.rs / RecapStore.swift).
//
// Every agent event (relay, opencode) passes through `observe`. A "turn" runs
// from a prompt (or the first tool call) to Stop, and only its counts and two
// names are kept: the agent's id and the project folder's last path
// component. Never a command, a file path, file contents or a prompt.
//
// The history lives in recap.json in %LOCALAPPDATA%\EasyIsland, keeps 12 weeks
// and a hard cap on its length, and is written whole to a temporary file then
// renamed over the old one. Nothing in it leaves the PC. Off with
// Impostazioni → Riepilogo settimanale (`weekly_recap`).
//
// Weeks, the busiest day and the rest are counted in the island
// (src/island/recap.ts): they need the local time zone.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 12 weeks, like Coucou.
const WINDOW_SECS: i64 = 12 * 7 * 86_400;
/// A turn with no event for two hours ends at its last event (agent crashed,
/// or never sent Stop).
const STALE_SECS: i64 = 2 * 3600;
const MAX_TURNS: usize = 10_000;
const MAX_DECISIONS: usize = 10_000;
const MAX_DRAFTS: usize = 256;
const MAX_REQUESTS: usize = 64;
const MAX_NAME_CHARS: usize = 64;

/// Tool names that run a shell command, across the agents the relay serves
/// (after its normaliser).
const COMMAND_TOOLS: &[&str] = &["Bash", "PowerShell", "Execute", "run_shell_command", "shell", "local_shell", "exec_command", "run_command", "bash"];

/// One finished turn. Times are Unix seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub agent: String,
    pub project: String,
    pub start: i64,
    pub end: i64,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub commands_run: u32,
    pub questions: u32,
}

/// A click on Consenti, Sempre or Nega in the island.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub agent: String,
    pub date: i64,
    /// "allow" or "deny".
    pub decision: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct History {
    turns: Vec<Turn>,
    decisions: Vec<Decision>,
    /// Monday (YYYY-MM-DD) of the week the recap last opened on its own.
    last_shown_week: String,
}

/// What the island reads.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryView {
    pub turns: Vec<Turn>,
    pub decisions: Vec<Decision>,
    pub last_shown_week: String,
}

/// A turn in progress, in memory only. The paths are only there to count
/// distinct files and are never written anywhere.
#[derive(Debug)]
struct Draft {
    agent: String,
    project: String,
    start: i64,
    last_event: i64,
    paths: HashSet<String>,
    lines_added: u32,
    lines_removed: u32,
    commands_run: u32,
    questions: u32,
}

impl Draft {
    fn into_turn(self, end: i64) -> Turn {
        Turn {
            agent: self.agent,
            project: self.project,
            start: self.start,
            end: end.max(self.start),
            files_changed: self.paths.len().min(u32::MAX as usize) as u32,
            lines_added: self.lines_added,
            lines_removed: self.lines_removed,
            commands_run: self.commands_run,
            questions: self.questions,
        }
    }
}

struct Recap {
    path: PathBuf,
    history: History,
    drafts: HashMap<String, Draft>,
    /// Permission request id → agent, until the island answers it.
    requests: HashMap<String, String>,
}

impl Recap {
    fn load(path: PathBuf, now: i64) -> Self {
        let history = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<History>(&b).ok())
            .unwrap_or_default();
        let mut recap = Self { path, history, drafts: HashMap::new(), requests: HashMap::new() };
        recap.prune(now);
        recap
    }

    fn observe(&mut self, payload: &Value, now: i64) {
        self.close_stale(now);
        let event = text(payload, "hook_event_name");
        let agent = agent_id(payload);
        let key = session_key(payload, &agent);
        match event {
            "UserPromptSubmit" => {
                self.draft(&key, &agent, payload, now);
            }
            "PreToolUse" => {
                let tool = text(payload, "tool_name");
                let draft = self.draft(&key, &agent, payload, now);
                if COMMAND_TOOLS.contains(&tool) {
                    draft.commands_run = draft.commands_run.saturating_add(1);
                }
                if tool == "AskUserQuestion" {
                    draft.questions = draft.questions.saturating_add(1);
                }
            }
            "PostToolUse" => {
                let changes = file_changes(payload);
                let draft = self.draft(&key, &agent, payload, now);
                for (path, added, removed) in changes {
                    draft.paths.insert(path);
                    draft.lines_added = draft.lines_added.saturating_add(added);
                    draft.lines_removed = draft.lines_removed.saturating_add(removed);
                }
            }
            // A session quit mid-turn still worked: SessionEnd closes it too.
            "Stop" | "StopFailure" | "SessionEnd" => {
                if let Some(draft) = self.drafts.remove(&key) {
                    self.history.turns.push(draft.into_turn(now));
                    self.prune(now);
                    self.save();
                }
            }
            _ => {}
        }
    }

    fn draft(&mut self, key: &str, agent: &str, payload: &Value, now: i64) -> &mut Draft {
        if !self.drafts.contains_key(key) && self.drafts.len() >= MAX_DRAFTS {
            if let Some(oldest) = self.drafts.iter().min_by_key(|(_, d)| d.last_event).map(|(k, _)| k.clone()) {
                if let Some(d) = self.drafts.remove(&oldest) {
                    let end = d.last_event;
                    self.history.turns.push(d.into_turn(end));
                }
            }
        }
        let draft = self.drafts.entry(key.to_string()).or_insert_with(|| Draft {
            agent: agent.to_string(),
            project: project_name(text(payload, "cwd")),
            start: now,
            last_event: now,
            paths: HashSet::new(),
            lines_added: 0,
            lines_removed: 0,
            commands_run: 0,
            questions: 0,
        });
        draft.last_event = now;
        draft
    }

    /// Turns silent for two hours count up to their last event instead of being lost.
    fn close_stale(&mut self, now: i64) {
        let stale: Vec<String> =
            self.drafts.iter().filter(|(_, d)| d.last_event < now - STALE_SECS).map(|(k, _)| k.clone()).collect();
        if stale.is_empty() {
            return;
        }
        for key in stale {
            if let Some(d) = self.drafts.remove(&key) {
                let end = d.last_event;
                self.history.turns.push(d.into_turn(end));
            }
        }
        self.prune(now);
        self.save();
    }

    fn note_request(&mut self, request_id: &str, payload: &Value) {
        if self.requests.len() >= MAX_REQUESTS {
            self.requests.clear();
        }
        self.requests.insert(request_id.to_string(), agent_id(payload));
    }

    fn record_decision(&mut self, request_id: &str, decision: &str, now: i64) {
        let Some(agent) = self.requests.remove(request_id) else { return };
        let word = match decision {
            "allow" | "always" => "allow",
            "deny" => "deny",
            _ => return,
        };
        self.history.decisions.push(Decision { agent, date: now, decision: word.to_string() });
        self.prune(now);
        self.save();
    }

    fn view(&self, since: i64) -> HistoryView {
        HistoryView {
            turns: self.history.turns.iter().filter(|t| t.start >= since).cloned().collect(),
            decisions: self.history.decisions.iter().filter(|d| d.date >= since).cloned().collect(),
            last_shown_week: self.history.last_shown_week.clone(),
        }
    }

    fn prune(&mut self, now: i64) {
        let cutoff = now - WINDOW_SECS;
        self.history.turns.retain(|t| t.start >= cutoff);
        self.history.decisions.retain(|d| d.date >= cutoff);
        if self.history.turns.len() > MAX_TURNS {
            self.history.turns.sort_by_key(|t| t.start);
            let excess = self.history.turns.len() - MAX_TURNS;
            self.history.turns.drain(..excess);
        }
        if self.history.decisions.len() > MAX_DECISIONS {
            self.history.decisions.sort_by_key(|d| d.date);
            let excess = self.history.decisions.len() - MAX_DECISIONS;
            self.history.decisions.drain(..excess);
        }
    }

    /// Whole file to a temporary sibling, then renamed over the old one.
    fn save(&self) {
        let Ok(json) = serde_json::to_vec(&self.history) else { return };
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let temp = self.path.with_extension(format!("json.tmp-{}", std::process::id()));
        let done = std::fs::write(&temp, &json).and_then(|()| std::fs::rename(&temp, &self.path));
        if let Err(err) = done {
            let _ = std::fs::remove_file(&temp);
            #[cfg(not(test))]
            crate::log::line(format!("recap: could not save the history: {err}"));
            #[cfg(test)]
            eprintln!("{err}");
        }
    }
}

// ── Reading a hook payload ────────────────────────────────────────────────────

fn text<'a>(payload: &'a Value, key: &str) -> &'a str {
    payload.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// "claude" for Claude Code, else the relay's `easyisland_agent.id` (codex,
/// gemini, opencode…), as the island's pills.
fn agent_id(payload: &Value) -> String {
    let raw = payload.pointer("/easyisland_agent/id").and_then(Value::as_str).unwrap_or_default();
    let valid = !raw.is_empty()
        && raw.len() <= 24
        && raw.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if valid { raw.to_string() } else { "claude".to_string() }
}

/// Concurrent sessions are tracked apart; one without an id by agent and folder.
fn session_key(payload: &Value, agent: &str) -> String {
    let id = text(payload, "session_id");
    if id.is_empty() || id == "unknown" { format!("{agent}+{}", text(payload, "cwd")) } else { format!("{agent}:{id}") }
}

/// The working folder's last component: the only part of a path ever kept.
fn project_name(cwd: &str) -> String {
    let last = cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or_default();
    last.chars().filter(|c| !c.is_control()).take(MAX_NAME_CHARS).collect()
}

/// The files a PostToolUse changed, with lines added and removed: the relay's
/// own diff (`easyisland_diff`, or `easyisland_diffs` for Codex's patches).
fn file_changes(payload: &Value) -> Vec<(String, u32, u32)> {
    let one = |d: &Value| -> Option<(String, u32, u32)> {
        let file = d.get("file").and_then(Value::as_str)?.to_string();
        let n = |k: &str| d.get(k).and_then(Value::as_u64).unwrap_or(0).min(u32::MAX as u64) as u32;
        let (added, removed) = (n("added"), n("removed"));
        (added > 0 || removed > 0).then_some((file, added, removed))
    };
    let mut out: Vec<(String, u32, u32)> = payload.get("easyisland_diff").and_then(one).into_iter().collect();
    if let Some(list) = payload.get("easyisland_diffs").and_then(Value::as_array) {
        out.extend(list.iter().filter_map(one));
    }
    out
}

// ── The app's side ────────────────────────────────────────────────────────────

static STORE: Mutex<Option<Recap>> = Mutex::new(None);

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn with<T>(f: impl FnOnce(&mut Recap) -> T) -> T {
    let mut guard = STORE.lock().unwrap_or_else(|e| e.into_inner());
    let recap = guard.get_or_insert_with(|| Recap::load(crate::settings::local_dir().join("recap.json"), now()));
    f(recap)
}

fn enabled(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<crate::Shared>().is_none_or(|s| s.settings.lock().unwrap().weekly_recap)
}

/// One agent event, as the relay or opencode delivered it. The island's own
/// chat is not a coding session.
pub fn observe(app: &tauri::AppHandle, payload: &Value) {
    if payload.get("easyisland_chat").is_some() || !enabled(app) {
        return;
    }
    with(|r| r.observe(payload, now()));
}

/// A permission request reached the island: remember whose it is.
pub fn note_request(request_id: &str, payload: &Value) {
    with(|r| r.note_request(request_id, payload));
}

/// A click on Consenti / Sempre / Nega.
pub fn record_decision(app: &tauri::AppHandle, request_id: &str, decision: &str) {
    if !enabled(app) {
        return;
    }
    with(|r| r.record_decision(request_id, decision, now()));
}

#[tauri::command]
pub fn recap_history(since: i64) -> HistoryView {
    with(|r| r.view(since))
}

/// `week` is the Monday the recap was shown for, as YYYY-MM-DD.
#[tauri::command]
pub fn recap_mark_shown(week: String) {
    let ok = week.len() == 10 && week.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if ok {
        with(|r| {
            r.history.last_shown_week = week;
            r.save();
        });
    }
}

/// Impostazioni → Riepilogo settimanale → «Cancella la cronologia».
#[tauri::command]
pub fn recap_clear() {
    with(|r| {
        r.history.turns.clear();
        r.history.decisions.clear();
        r.drafts.clear();
        r.save();
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("easyisland-recap-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("recap.json")
    }

    fn event(name: &str, session: &str, extra: Value) -> Value {
        let mut v = json!({ "hook_event_name": name, "session_id": session, "cwd": "C:\\Users\\x\\WORK\\progetto" });
        if let (Some(map), Some(more)) = (v.as_object_mut(), extra.as_object()) {
            map.extend(more.clone());
        }
        v
    }

    #[test]
    fn a_turn_is_counted_from_prompt_to_stop_and_keeps_no_text() {
        let path = scratch("turn");
        let mut r = Recap::load(path.clone(), 1000);
        r.observe(&event("UserPromptSubmit", "s1", json!({ "prompt": "segreto" })), 1000);
        r.observe(&event("PreToolUse", "s1", json!({ "tool_name": "Bash", "tool_input": { "command": "rm segreto" } })), 1010);
        r.observe(&event("PreToolUse", "s1", json!({ "tool_name": "AskUserQuestion" })), 1015);
        r.observe(&event("PostToolUse", "s1", json!({ "tool_name": "Edit", "easyisland_diff": { "file": "C:/a.rs", "added": 3, "removed": 1 } })), 1020);
        r.observe(&event("PostToolUse", "s1", json!({ "tool_name": "Edit", "easyisland_diff": { "file": "C:/a.rs", "added": 2, "removed": 0 } })), 1030);
        r.observe(&event("PostToolUse", "s1", json!({ "tool_name": "Patch", "easyisland_diffs": [{ "file": "C:/b.rs", "added": 1, "removed": 4 }] })), 1040);
        r.observe(&event("Stop", "s1", json!({})), 1100);
        let t = &r.history.turns[0];
        assert_eq!((t.agent.as_str(), t.project.as_str(), t.start, t.end), ("claude", "progetto", 1000, 1100));
        assert_eq!((t.files_changed, t.lines_added, t.lines_removed, t.commands_run, t.questions), (2, 6, 5, 1, 1));
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("segreto") && !on_disk.contains("a.rs") && !on_disk.contains("WORK"));
    }

    #[test]
    fn agents_sessions_decisions_and_stale_turns() {
        let mut r = Recap::load(scratch("agents"), 0);
        let codex = json!({ "easyisland_agent": { "id": "codex", "name": "Codex" } });
        r.observe(&event("UserPromptSubmit", "s1", codex.clone()), 100);
        r.observe(&event("UserPromptSubmit", "s1", json!({})), 100);
        r.observe(&event("Stop", "s1", codex), 200);
        assert_eq!(r.history.turns.len(), 1);
        assert_eq!(r.history.turns[0].agent, "codex");
        // The Claude Code turn with the same session id is still open; two hours
        // of silence end it at its last event.
        r.observe(&event("UserPromptSubmit", "s9", json!({})), 100 + STALE_SECS + 1);
        assert_eq!(r.history.turns.len(), 2);
        assert_eq!(r.history.turns[1].end, 100);
        // Decisions only for requests the island showed.
        r.note_request("r1", &json!({ "easyisland_agent": { "id": "opencode" } }));
        r.record_decision("r1", "always", 300);
        r.record_decision("r2", "deny", 300);
        assert_eq!(r.history.decisions.len(), 1);
        assert_eq!((r.history.decisions[0].agent.as_str(), r.history.decisions[0].decision.as_str()), ("opencode", "allow"));
    }

    #[test]
    fn twelve_weeks_are_kept() {
        let mut r = Recap::load(scratch("prune"), 0);
        r.observe(&event("UserPromptSubmit", "a", json!({})), 10);
        r.observe(&event("Stop", "a", json!({})), 20);
        r.observe(&event("UserPromptSubmit", "b", json!({})), WINDOW_SECS + 100);
        r.observe(&event("Stop", "b", json!({})), WINDOW_SECS + 200);
        assert_eq!(r.history.turns.len(), 1);
        assert_eq!(r.history.turns[0].start, WINDOW_SECS + 100);
        assert_eq!(project_name("C:\\Users\\x\\WORK\\progetto\\"), "progetto");
    }
}
