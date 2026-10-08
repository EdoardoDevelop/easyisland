// Hook installation for Claude Code, and the same for Codex and Gemini CLI
// (HANDOFF 6.6, point 5): one `Target` per tool, each with its own file, events
// and timeout unit; the relay learns which tool calls it from `--agent`.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read %USERPROFILE%\.claude\settings.json, take a dated backup, merge without
// touching anybody else's hooks, show the diff, and write only after an explicit
// click. Uninstall removes EasyIsland's entries and nothing else.
//
// The command is only the quoted exe path in forward slashes plus the event name:
// on Windows Claude Code runs hook commands through Git Bash, and anything with
// PowerShell or cmd in it breaks.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::settings;

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
    ("PreCompact", 10),
];

/// Marker that identifies an EasyIsland entry inside settings.json.
const MARKER: &str = "easyisland-hook";

/// The relay's name before the app was renamed (Coucou). Entries with it are
/// ours too: installing replaces them, uninstalling removes them.
const LEGACY_MARKER: &str = "coucou-hook";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    /// settings.json still runs the old Coucou relay: installing again fixes it.
    pub legacy: bool,
    /// Installed, but an event EasyIsland now listens to is missing (a newer
    /// version added it): installing again adds it.
    pub outdated: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    /// Identifies the bytes this diff was computed from; handed back to `write`
    /// so we only ever apply what the user actually looked at.
    pub fingerprint: String,
}

/// Which tool's hooks: Claude Code (`~/.claude/settings.json`), Codex
/// (`~/.codex/hooks.json`), Gemini CLI (`~/.gemini/settings.json`), Cursor
/// (`~/.cursor/hooks.json`) or Copilot CLI (a file of its own,
/// `~/.copilot/hooks/easyisland.json`).
///
/// opencode has no command hooks: it gets a plugin of EasyIsland's own,
/// `~/.config/opencode/plugins/easyisland.js` (see `opencode_*` below).
///
/// Cursor and Copilot get observation hooks only: on their permission hooks a
/// reply they cannot parse (Cursor) or an error (Copilot) blocks the tool, and
/// the island must never be able to block an agent.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Target {
    Claude,
    Codex,
    Gemini,
    Cursor,
    Copilot,
    OpenCode,
}

impl Target {
    pub fn parse(s: Option<&str>) -> Target {
        match s {
            Some("codex") => Target::Codex,
            Some("gemini") => Target::Gemini,
            Some("cursor") => Target::Cursor,
            Some("copilot") => Target::Copilot,
            Some("opencode") => Target::OpenCode,
            _ => Target::Claude,
        }
    }

    pub fn file(self) -> PathBuf {
        match self {
            Target::Claude => home().join(".claude").join("settings.json"),
            Target::Codex => home().join(".codex").join("hooks.json"),
            Target::Gemini => home().join(".gemini").join("settings.json"),
            Target::Cursor => home().join(".cursor").join("hooks.json"),
            Target::Copilot => home().join(".copilot").join("hooks").join("easyisland.json"),
            // opencode reads ~/.config on Windows too.
            Target::OpenCode => home().join(".config").join("opencode").join("plugins").join("easyisland.js"),
        }
    }

    /// Events and their timeout, in the tool's own unit: seconds for Claude Code
    /// and Codex (whose SessionEnd may take 3 s at most), milliseconds for Gemini.
    fn events(self) -> &'static [(&'static str, u64)] {
        match self {
            Target::Claude => HOOK_EVENTS,
            Target::Codex => &[
                ("SessionStart", 10),
                ("SessionEnd", 3),
                ("UserPromptSubmit", 10),
                ("PreToolUse", 10),
                ("PostToolUse", 10),
                ("PermissionRequest", 120),
                ("Stop", 10),
                ("SubagentStart", 10),
                ("SubagentStop", 10),
            ],
            Target::Gemini => &[
                ("SessionStart", 10_000),
                ("SessionEnd", 10_000),
                ("BeforeAgent", 10_000),
                ("AfterAgent", 10_000),
                ("BeforeTool", 10_000),
                ("AfterTool", 10_000),
                ("Notification", 10_000),
            ],
            // Seconds. No preToolUse / beforeShellExecution / beforeReadFile /
            // subagentStart: those are permission hooks (see the enum).
            Target::Cursor => &[
                ("sessionStart", 10),
                ("sessionEnd", 10),
                ("beforeSubmitPrompt", 10),
                ("afterShellExecution", 10),
                ("afterFileEdit", 10),
                ("afterMCPExecution", 10),
                ("subagentStop", 10),
                ("preCompact", 10),
                ("stop", 10),
            ],
            // Seconds (`timeoutSec`). No preToolUse: an error there denies the tool.
            Target::Copilot => &[
                ("sessionStart", 10),
                ("sessionEnd", 10),
                ("userPromptSubmitted", 10),
                ("postToolUse", 10),
                ("postToolUseFailure", 10),
                ("agentStop", 10),
                ("subagentStop", 10),
                ("preCompact", 10),
                ("errorOccurred", 10),
            ],
            // A plugin, not a list of hooks: the plugin picks its events.
            Target::OpenCode => &[],
        }
    }

    /// Cursor and Copilot want `"version": 1` at the top of the file.
    fn versioned(self) -> bool {
        matches!(self, Target::Cursor | Target::Copilot)
    }

    /// The relay's command line. Claude Code runs hooks through Git Bash (quoted
    /// path in forward slashes); Codex and Gemini may use cmd or PowerShell, where
    /// a quoted path is only a string, so it is quoted only when it has a space.
    fn command(self, event: &str) -> String {
        let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
        let exe = if self == Target::Claude || exe.contains(' ') { format!("\"{exe}\"") } else { exe };
        match self {
            Target::Claude => format!("{exe} {event}"),
            Target::Codex => format!("{exe} {event} --agent codex"),
            Target::Gemini => format!("{exe} {event} --agent gemini"),
            Target::Cursor => format!("{exe} {event} --agent cursor"),
            Target::Copilot => format!("{exe} {event} --agent copilot"),
            Target::OpenCode => format!("{exe} {event} --agent opencode"),
        }
    }

    fn entry(self, event: &str, timeout: u64) -> Value {
        match self {
            Target::Cursor => return json!({ "command": self.command(event), "timeout": timeout }),
            // Copilot runs `powershell` on Windows and `bash` elsewhere: in
            // PowerShell a quoted path is only a string, `&` runs it.
            Target::Copilot => {
                let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
                return json!({
                    "type": "command",
                    "bash": format!("\"{exe}\" {event} --agent copilot"),
                    "powershell": format!("& \"{exe}\" {event} --agent copilot"),
                    "timeoutSec": timeout,
                });
            }
            _ => {}
        }
        let handler = json!({ "type": "command", "command": self.command(event), "timeout": timeout });
        // Gemini matches tool events by a regex: "*" is every tool.
        if self == Target::Gemini && (event == "BeforeTool" || event == "AfterTool") {
            json!({ "matcher": "*", "hooks": [handler] })
        } else {
            json!({ "hooks": [handler] })
        }
    }
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
pub fn settings_path() -> PathBuf {
    Target::Claude.file()
}

/// Reads the target's file (`~/.claude/settings.json` for Claude Code).
///
/// The only error that means "start from nothing" is the file not being there.
/// Everything else — a lock held by another process, a permission problem, JSON
/// we cannot parse — is reported, because the alternative is treating somebody's
/// unreadable settings as an empty object and then writing that back over them.
fn read_settings_at(target: Target) -> Result<Value, String> {
    let path = target.file();
    match std::fs::read(&path) {
        Ok(bytes) => parse_settings(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        // A lock, a permission problem, a bad drive: all of them mean we do not
        // know what is in there, and not knowing is not the same as empty.
        Err(err) => Err(format!("Impossibile leggere {}: {err}", path.display())),
    }
}

/// The parsing half of `read_settings_at`, split out so it can be tested without
/// a home directory.
fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{path} non è un oggetto JSON: EasyIsland non lo tocca.")),
        Err(err) => Err(format!(
            "{path} non è JSON valido ({err}). Correggilo o spostalo e riprova: EasyIsland non lo sovrascrive."
        )),
    }
}

fn entry_has(entry: &Value, marker: &str) -> bool {
    // Cursor's and Copilot's entries are flat: the command is on the entry itself.
    let flat = ["command", "bash", "powershell"]
        .iter()
        .any(|k| entry.get(*k).and_then(Value::as_str).is_some_and(|c| c.contains(marker)));
    flat || entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .map(|c| c.contains(marker))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn entry_is_ours(entry: &Value) -> bool {
    entry_has(entry, MARKER) || entry_has(entry, LEGACY_MARKER)
}

/// Every hook entry in the file, whatever the event.
fn all_entries(settings: &Value) -> Vec<&Value> {
    settings
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| hooks.values().filter_map(Value::as_array).flatten().collect())
        .unwrap_or_default()
}

/// Claude Code's settings with EasyIsland's hooks added (see `merged_for`).
#[cfg(test)]
fn merged(existing: &Value) -> Value {
    merged_for(existing, Target::Claude)
}

/// The file with EasyIsland's hooks for `target` added; everything else is
/// left untouched.
fn merged_for(existing: &Value, target: Target) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);

    for (event, timeout) in target.events() {
        let mut list = hooks
            .get(*event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry));
        list.push(target.entry(event, *timeout));
        hooks.insert((*event).to_string(), Value::Array(list));
    }

    root.insert("hooks".into(), Value::Object(hooks));
    if target.versioned() && !root.contains_key("version") {
        root.insert("version".into(), json!(1));
    }
    Value::Object(root)
}

/// The file with every EasyIsland entry removed, and nothing else changed.
fn without_ours(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> =
                    list.iter().filter(|e| !entry_is_ours(e)).cloned().collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup.
fn stamp() -> String {
    let t = unsafe { GetLocalTime() };
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

/// `settings.json.bak-20261004-213000` beside the file (or `hooks.json.bak-…`).
fn backup_path(target: Target) -> PathBuf {
    let p = target.file();
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.with_file_name(format!("{name}.bak-{}", stamp()))
}

/// Identifies the exact bytes a preview was computed from. FNV-1a is plenty:
/// the question is only "is this still the file I showed the user?".
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint(target: Target) -> String {
    match std::fs::read(target.file()) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Claude Code's hooks.
pub fn status() -> HookStatus {
    status_for(Target::Claude)
}

pub fn status_for(target: Target) -> HookStatus {
    if target == Target::OpenCode {
        return opencode_status();
    }
    // Read-only and never loud: an unreadable file just reads as "not installed".
    let current = read_settings_at(target).unwrap_or_else(|_| json!({}));
    let entries = all_entries(&current);
    let hook_path = settings::hook_exe_path();
    let installed = entries.iter().any(|e| entry_has(e, MARKER));
    let missing = target.events().iter().any(|(event, _)| {
        !current
            .get("hooks")
            .and_then(|h| h.get(*event))
            .and_then(Value::as_array)
            .is_some_and(|list| list.iter().any(|e| entry_has(e, MARKER)))
    });
    HookStatus {
        installed,
        outdated: installed && missing,
        legacy: entries.iter().any(|e| entry_has(e, LEGACY_MARKER)),
        settings_path: target.file().to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

#[cfg(test)]
pub fn preview(install: bool) -> Result<HookPreview, String> {
    preview_for(install, Target::Claude)
}

pub fn preview_for(install: bool, target: Target) -> Result<HookPreview, String> {
    if target == Target::OpenCode {
        return opencode_preview(install);
    }
    let current = read_settings_at(target)?;
    let next = if install { merged_for(&current, target) } else { without_ours(&current) };
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path(target).to_string_lossy().to_string(),
        settings_path: target.file().to_string_lossy().to_string(),
        fingerprint: current_fingerprint(target),
    })
}

#[cfg(test)]
pub fn write(install: bool, fingerprint: &str) -> Result<String, String> {
    write_for(install, fingerprint, Target::Claude)
}

/// Writes the merged (or cleaned) file after taking a dated backup.
///
/// `fingerprint` is the one the preview was computed from. If the file changed
/// in between — another tool, another window, the user's own editor — we stop
/// and make them look at a fresh diff, because the only thing worse than not
/// installing the hooks is silently reverting somebody else's edit.
pub fn write_for(install: bool, fingerprint: &str, target: Target) -> Result<String, String> {
    if target == Target::OpenCode {
        return opencode_write(install, fingerprint);
    }
    let path = target.file();
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Read before the backup: an unreadable file must abort before we touch
    // anything at all.
    let current = read_settings_at(target)?;
    if current_fingerprint(target) != fingerprint {
        return Err(format!(
            "{} è cambiato dopo l'anteprima. Non è stato scritto nulla: controlla il nuovo diff.",
            path.display()
        ));
    }

    let backup = backup_path(target);
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup non riuscito: {e}"))?;
    }

    let next = if install { merged_for(&current, target) } else { without_ours(&current) };
    let mut text = pretty(&next);
    text.push('\n');

    // Write beside the target and rename over it: a crash or a full disk leaves
    // the original file intact rather than half a file.
    let temp = path.with_extension(format!("json.easyisland-{}", std::process::id()));
    std::fs::write(&temp, text.as_bytes()).map_err(|e| format!("scrittura non riuscita: {e}"))?;
    if let Err(err) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("scrittura non riuscita: {err}"));
    }
    Ok(backup.to_string_lossy().to_string())
}

// ── opencode: a plugin file of EasyIsland's own ──────────────────────────────

/// The plugin as EasyIsland writes it, with this PC's relay path.
fn opencode_plugin() -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    let literal = serde_json::to_string(&exe).unwrap_or_else(|_| "\"\"".into());
    include_str!("opencode-plugin.js").replace("__HOOK__", &literal)
}

/// The plugin file's text: `None` when there is none. A file of somebody
/// else's under the same name is an error: EasyIsland never writes over it.
fn opencode_current() -> Result<Option<String>, String> {
    let path = Target::OpenCode.file();
    match std::fs::read(&path) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes).to_string();
            if text.contains(MARKER) || text.trim().is_empty() {
                Ok(Some(text))
            } else {
                Err(format!("{} non è di EasyIsland: non lo tocca. Rinominalo e riprova.", path.display()))
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Impossibile leggere {}: {err}", path.display())),
    }
}

fn opencode_status() -> HookStatus {
    let current = opencode_current().ok().flatten();
    let installed = current.as_deref().is_some_and(|t| t.contains(MARKER));
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed,
        // A newer plugin, or the relay moved: installing again rewrites it.
        outdated: installed && current.as_deref() != Some(opencode_plugin().as_str()),
        legacy: false,
        settings_path: Target::OpenCode.file().to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

fn opencode_preview(install: bool) -> Result<HookPreview, String> {
    let current = opencode_current()?.unwrap_or_default();
    let next = if install { opencode_plugin() } else { String::new() };
    Ok(HookPreview {
        diff: unified_diff(&current, &next),
        backup: backup_path(Target::OpenCode).to_string_lossy().to_string(),
        settings_path: Target::OpenCode.file().to_string_lossy().to_string(),
        fingerprint: current_fingerprint(Target::OpenCode),
    })
}

/// Writes the plugin (or removes it) after a dated backup of the old one; the
/// same fingerprint check as `write_for`.
fn opencode_write(install: bool, fingerprint: &str) -> Result<String, String> {
    let path = Target::OpenCode.file();
    let current = opencode_current()?;
    if current_fingerprint(Target::OpenCode) != fingerprint {
        return Err(format!(
            "{} è cambiato dopo l'anteprima. Non è stato scritto nulla: controlla il nuovo diff.",
            path.display()
        ));
    }
    let backup = backup_path(Target::OpenCode);
    if current.is_some() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup non riuscito: {e}"))?;
    }
    if install {
        let dir = path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let temp = path.with_extension(format!("js.easyisland-{}", std::process::id()));
        std::fs::write(&temp, opencode_plugin().as_bytes()).map_err(|e| format!("scrittura non riuscita: {e}"))?;
        if let Err(err) = std::fs::rename(&temp, &path) {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("scrittura non riuscita: {err}"));
        }
    } else if current.is_some() {
        std::fs::remove_file(&path).map_err(|e| format!("rimozione non riuscita: {e}"))?;
    }
    Ok(backup.to_string_lossy().to_string())
}

/// Copies easyisland-hook.exe into %LOCALAPPDATA%\EasyIsland\bin on launch.
/// In a bundled install it comes from the app resources; in `tauri dev` it sits
/// next to easyisland.exe in the workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
    let Some(dir) = dest.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve("easyisland-hook.exe", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed build, then `tauri dev` (target/debug) next to the
            // release hook the pre-build step produces.
            candidates.push(parent.join("easyisland-hook.exe"));
            candidates.push(parent.join("../release/easyisland-hook.exe"));
            // Belt and braces: where the old glob form used to land it.
            candidates.push(parent.join("_up_/target/release/easyisland-hook.exe"));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else {
        crate::log::line(format!(
            "easyisland-hook.exe not found — Claude Code hooks cannot work. Looked in: {}",
            tried.join(", ")
        ));
        return;
    };

    let same = match (std::fs::metadata(&src), std::fs::metadata(&dest)) {
        (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() == b.modified().ok(),
        _ => false,
    };
    if same {
        return;
    }
    // A hook may be running right now and hold the file open; keeping the old
    // copy is fine, it is the same relay.
    if let Err(err) = std::fs::copy(&src, &dest) {
        if !dest.exists() {
            crate::log::line(format!("could not install easyisland-hook.exe: {err}"));
        }
    }
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// settings.json is short, so a plain O(n·m) LCS is the simplest honest diff.
fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

    // Keep three lines of context around each change so the panel stays readable.
    let changed: Vec<usize> = out
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with('+') || l.starts_with('-'))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return "Nessuna modifica.".into();
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        for k in lo..hi {
            keep[k] = true;
        }
    }
    let mut result = String::new();
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHERE: &str = "settings.json";

    #[test]
    fn a_utf8_bom_is_stripped_not_treated_as_corruption() {
        // PowerShell 5's `Set-Content -Encoding utf8` produces exactly this.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"model":"opus","hooks":{}}"#);
        let parsed = parse_settings(&bytes, WHERE).expect("a BOM must not defeat the parser");
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn unreadable_content_is_an_error_never_an_empty_object() {
        // This is the whole bug: returning {} here meant `merged()` produced a
        // file containing nothing but EasyIsland's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(
                parse_settings(bad, WHERE).is_err(),
                "content we cannot use must refuse, not come back empty"
            );
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(parse_settings(b"  
	 ", WHERE).unwrap(), json!({}));
    }

    #[test]
    fn merging_keeps_every_other_setting_and_every_foreign_hook() {
        let existing = serde_json::json!({
            "model": "claude-opus-5",
            "theme": "dark",
            "enabledPlugins": ["a", "b"],
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "someone-elses-tool.exe" }] }
                ],
                "SomeEventWeDoNotTouch": [
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });

        let after = merged(&existing);
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["enabledPlugins"], serde_json::json!(["a", "b"]));

        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("someone-elses-tool.exe")),
            "another tool's hook was dropped"
        );
        assert!(pre.iter().any(entry_is_ours), "our own hook was not added");
        assert!(after["hooks"]["SomeEventWeDoNotTouch"].is_array());

        // And removing ours puts it back exactly as it was.
        let cleaned = without_ours(&after);
        assert_eq!(cleaned, existing);
    }

    #[test]
    fn installing_replaces_the_old_coucou_relay() {
        let old = "\"C:/Users/x/AppData/Local/Coucou/bin/coucou-hook.exe\" PreToolUse";
        let existing = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": old }] },
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });
        let after = merged(&existing);
        let text = serde_json::to_string(&after).unwrap();
        assert!(!text.contains("coucou-hook"), "the old relay must go");
        assert!(text.contains("keep-me.exe"));
        assert_eq!(after["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        assert!(!serde_json::to_string(&without_ours(&existing)).unwrap().contains("coucou-hook"));
    }

    #[test]
    fn codex_and_gemini_get_their_own_events_and_flag() {
        let existing = json!({ "theme": "x", "hooks": { "BeforeTool": [
            { "matcher": "write_file", "hooks": [{ "type": "command", "command": "mine.sh" }] }
        ] } });

        let codex = merged_for(&json!({}), Target::Codex);
        let events: Vec<&String> = codex["hooks"].as_object().unwrap().keys().collect();
        assert!(events.iter().any(|e| *e == "PermissionRequest"));
        assert!(!events.iter().any(|e| *e == "Notification"), "Codex has no Notification event");
        let cmd = codex["hooks"]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("easyisland-hook") && cmd.ends_with("PreToolUse --agent codex"), "{cmd}");
        assert_eq!(codex["hooks"]["SessionEnd"][0]["hooks"][0]["timeout"], 3, "Codex caps SessionEnd at 3 s");

        let gemini = merged_for(&existing, Target::Gemini);
        assert_eq!(gemini["theme"], "x");
        let before = gemini["hooks"]["BeforeTool"].as_array().unwrap();
        assert_eq!(before.len(), 2, "the user's own Gemini hook stays");
        assert_eq!(before[1]["matcher"], "*");
        assert_eq!(before[1]["hooks"][0]["timeout"], 10_000, "Gemini counts in milliseconds");
        assert!(gemini["hooks"]["AfterAgent"][0].get("matcher").is_none());
        assert_eq!(without_ours(&gemini), existing);

        assert_eq!(Target::parse(Some("gemini")), Target::Gemini);
        assert_eq!(Target::parse(Some("qualcosa")), Target::Claude);
        assert!(Target::Codex.file().ends_with(Path::new(".codex").join("hooks.json")));
    }

    #[test]
    fn cursor_and_copilot_get_flat_observation_hooks_only() {
        let existing = json!({ "version": 1, "hooks": { "afterFileEdit": [{ "command": "./format.sh" }] } });
        let cursor = merged_for(&existing, Target::Cursor);
        let edits = cursor["hooks"]["afterFileEdit"].as_array().unwrap();
        assert_eq!(edits.len(), 2, "the user's own Cursor hook stays");
        let cmd = edits[1]["command"].as_str().unwrap();
        assert!(cmd.contains("easyisland-hook") && cmd.ends_with("afterFileEdit --agent cursor"), "{cmd}");
        assert!(edits[1].get("hooks").is_none(), "Cursor's entries are flat");
        // Never a permission hook: a reply Cursor cannot parse there blocks the tool.
        for blocked in ["preToolUse", "beforeShellExecution", "beforeReadFile", "beforeMCPExecution", "subagentStart"] {
            assert!(cursor["hooks"].get(blocked).is_none(), "{blocked}");
        }
        assert_eq!(without_ours(&cursor), existing);

        let copilot = merged_for(&json!({}), Target::Copilot);
        assert_eq!(copilot["version"], 1);
        assert!(copilot["hooks"].get("preToolUse").is_none(), "an error there denies the tool");
        let e = &copilot["hooks"]["postToolUse"][0];
        assert!(e["powershell"].as_str().unwrap().starts_with("& \""));
        assert!(e["bash"].as_str().unwrap().ends_with("postToolUse --agent copilot"));
        assert_eq!(e["timeoutSec"], 10);
        assert!(all_entries(&copilot).iter().all(|x| entry_is_ours(x)));
        assert!(without_ours(&copilot).get("hooks").is_none());
        assert!(Target::Copilot.file().ends_with(Path::new(".copilot").join("hooks").join("easyisland.json")));
        assert_eq!(Target::parse(Some("cursor")), Target::Cursor);
    }

    #[test]
    fn opencode_gets_a_plugin_with_the_relay_path() {
        let plugin = opencode_plugin();
        assert!(!plugin.contains("__HOOK__"));
        assert!(plugin.contains(MARKER), "the marker is how status() recognises it");
        assert!(plugin.contains("--agent\", \"opencode"));
        assert!(Target::OpenCode.file().ends_with(Path::new(".config").join("opencode").join("plugins").join("easyisland.js")));
        assert!(Target::OpenCode.events().is_empty());
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points
    /// USERPROFILE at a temp directory, and that is process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("easyisland-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var("USERPROFILE", &tmp);

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("easyisland-hook"), "the diff must show what changes");
        let backup = write(true, &plan.fingerprint).expect("install should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = write(false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("è cambiato dopo l'anteprima"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true).is_err());
        assert!(write(true, "whatever").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
