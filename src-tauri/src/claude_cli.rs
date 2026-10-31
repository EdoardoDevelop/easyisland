// Chat through the user's own Claude Code install (`claude -p`), so a Claude
// subscription covers it instead of a pay-as-you-go API key.
//
// The process runs hidden, in a neutral working folder, with:
//   * hooks kept out of the island: without connectors every hook is disabled
//     (`disableAllHooks`); EASYISLAND_INTERNAL makes easyisland-hook.exe ignore the
//     user's own EasyIsland hooks either way, so the chat never shows up as a
//     Claude Code work session;
//   * only WebSearch, WebFetch and Read among the built-in tools;
//   * no connectors by default (`--strict-mcp-config`, `dontAsk`). When the user
//     picked some MCP servers, Claude Code loads its own user-scope config (no
//     copy of it, so no copy of any secret in it), the other servers are
//     disallowed, and every call to a server marked "confirm" goes through a
//     PermissionRequest hook — `easyisland-hook.exe PermissionRequest --chat` — to
//     the Consenti/Nega card in the island.
// The prompt goes in on stdin, and every other argument is a plain word or a
// path, so nothing needs quoting when the target is `claude.cmd`.
//
// "Modalità terminale" (settings.chat_terminal, chat.md) is the other way: the
// chat works as Claude Code does in a terminal — every built-in tool, the
// user's own MCP servers, plugins, CLAUDE.md and skills, in the folder the user
// chose — and every call Claude Code would ask about in a terminal goes to the
// island's Consenti / Nega card instead (same hook, every tool). The steps
// stream to the island while it works (`--output-format stream-json`).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::claude::{Chat, ChatContext, ChatReply};
use crate::settings::McpChoice;
use crate::i18n::{t, tf};

/// Opus with a few web searches can take a while; the island shows "thinking".
const TIMEOUT: Duration = Duration::from_secs(180);
/// With connectors a turn may also wait for the user's Consenti/Nega.
const TIMEOUT_WITH_CONNECTORS: Duration = Duration::from_secs(420);
const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
/// "Modalità terminale": a turn may run commands and wait for several clicks.
const TIMEOUT_TERMINAL: Duration = Duration::from_secs(30 * 60);
/// The island gets the growing reply at most this often.
const STREAM_EVERY: Duration = Duration::from_millis(120);
/// CREATE_NO_WINDOW: no console window flashing up on every message.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const TOOLS: &str = "WebSearch,WebFetch,Read";

/// The `easyisland` MCP server (`easyisland-hook mcp`, see agent.rs): its
/// tools that change nothing (or nothing outside EasyIsland), pre-allowed:
/// the read-only flag of hook/src/tool_list.rs, the one list. `show_card`
/// waits for a click by itself. Every other tool asks Consenti / Nega in the
/// island, unless the user allowed it for good (permits.rs).
pub(crate) fn agent_read_only() -> Vec<&'static str> {
    crate::claude::tool_list::tools().into_iter().filter(|t| t.3 && t.0 != "show_card").map(|t| t.0).collect()
}

pub(crate) const AGENT_PROMPT: &str = " You also have the easyisland tools, which act on the user's own PC: \
open programs, folders and links, run the user's quick actions (list_quick_actions, then run_quick_action), \
read the status of the PC, network, weather, mail and tickets (list_status), read or fill the clipboard, control the music, show a notice in the island, \
browse the user's work folder (list_work_folder; read its files with Read) and move files of the tray into it (move_to_work_folder), \
read and change EasyIsland's own settings (get_settings, then set_setting: default chat engine and model, integrations on or off, character, language, notifications…), work in the user's Notion through EasyIsland's own connection (notion_map for the structure, notion_search, notion_read, notion_query for the rows of a database, notion_add_row and notion_update_row, which check the values against the database, notion_delete_row to move a row to Notion's trash only after the user said yes in the chat), manage the user's Microsoft To Do through classic Outlook (todo_list, todo_add, todo_update), work on a remote PC the user connected in «Accesso remoto» and linked to the chat (remote_status, remote_run: one command at a time, PowerShell on Windows, sh on Linux), show files and web pages in EasyIsland's preview window next to the chat — the user's local dev server, a page you built, a file you changed — and check them: open a tab (preview_open: a URL, localhost:port or a file path; back, forward, reload), see the page as a tree of headings, texts and controls with refs (preview_snapshot: the best way to understand and use a page), read its text (preview_read), wait for something to appear (preview_wait), read failed requests (preview_network), take a screenshot (preview_screenshot, then read the PNG), read the console errors (preview_console), try it at phone or tablet size or in dark mode (preview_resize), and click or type in it by ref (preview_click, preview_type, which the user confirms); after changing a web page, open or reload it in the preview and check it before saying it works, keep the chat's memory (memory_search to look into notes, linked pages and past conversations, memory_note to remember something for next time, memory_page and memory_page_write for the pages about people, customers, projects and concepts, linked with [[Title]]), build the user's own integrations — forms with fields, tables and formulas, dashboards of data read from their services, calls to their APIs with keys they keep in Windows, documents and actions — when they ask for one (custom_create, custom_update, custom_get, custom_records, custom_add_record), hand a long job, or one for later or every day, to EasyIsland as a task it carries on by itself with a plan (task_create, task_list), and set up automations that then run by themselves (list_automations, create_automation, set_automation_enabled): when the user asks for something recurring \
(\"every morning…\", \"when I plug in a USB stick…\", \"if the client's site goes down…\") propose an automation; check the ids with list_quick_actions, list_profiles and list_status first. \
Use them when the user asks you to do something on the PC, or when they make the answer better (for example check list_status before answering about the PC or the day). \
You cannot run arbitrary commands: only the user's quick actions. \
While you work, before each group of tool calls write one short plain sentence in the user's language that says what you are doing and why \
(\"Cerco nella memoria le fatture di Rossi, poi preparo il piano.\"): the user follows your work by these sentences, in the island and on Telegram, \
between lines that only name the tools. Before a tool that opens, runs or changes something, always say it: \
the user confirms or refuses it with a click, and a refusal is final for that request.";
/// The sentence of AGENT_PROMPT that "Modalità terminale" leaves out.
pub(crate) const NO_COMMANDS: &str = "You cannot run arbitrary commands: only the user's quick actions. ";
pub(crate) const INHERITED_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_PID",
    "CLAUDE_CODE_REMOTE_SESSION_ID",
];

const SYSTEM_PROMPT: &str = "You are the personal assistant living in a small chat bubble at the top of the user's screen (the EasyIsland desktop app). \
You are not working on a codebase here: never try to edit files or run commands. \
Use WebSearch and WebFetch when the question needs current or external information, and Read to look at a file the user attached. \
Respond in Italian unless the user writes in another language. Be thorough but keep it readable in a small window. \
Markdown is rendered: use short paragraphs, lists, tables and code blocks when they help.";

/// "Modalità terminale": Claude Code's own system prompt stays (it is the one of
/// the terminal); this goes after it. `{folder}` is the working folder.
const TERMINAL_PROMPT: &str = "You are working on the user's Windows PC from the chat bubble of the EasyIsland desktop app, \
as Claude Code does in a terminal: run commands (PowerShell or Bash), read and edit files, use the user's MCP servers and skills. \
The working folder is {folder}; work elsewhere on the PC when the user asks. \
Every command or change that Claude Code would ask about in a terminal waits for the user's click on Consenti / Nega in the island: \
a refusal is final for that request. Nobody can type into a running command: never start interactive programs \
(text interfaces, editors, logins or prompts that wait for input); tell the user to run those in their own terminal. \
Respond in Italian unless the user writes in another language. The reply is shown in a small window with markdown rendered: \
keep it readable, short paragraphs and lists, code blocks for commands and output.";

/// Where `claude` lives: %PATH% first (npm installs `claude.cmd`), then the
/// native installer's and npm's default folders, which a GUI app launched at
/// login may not have on its PATH. Last, the copies bundled with the Claude
/// desktop app and the VS Code extension, for users who have no standalone CLI.
pub fn find_claude() -> Option<PathBuf> {
    if let Some(p) = crate::find_on_path("claude") {
        return Some(p);
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let mut candidates = Vec::new();
    if let Some(home) = &home {
        candidates.push(home.join(".local").join("bin").join("claude.exe"));
    }
    if let Some(appdata) = &appdata {
        candidates.push(appdata.join("npm").join("claude.cmd"));
    }
    if let Some(p) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    // %APPDATA%\Claude\claude-code\<version>\claude.exe
    if let Some(p) = appdata.as_ref().and_then(|a| {
        newest_bundled(&a.join("Claude").join("claude-code"), "", &["claude.exe"])
    }) {
        return Some(p);
    }
    // %USERPROFILE%\.vscode\extensions\anthropic.claude-code-<version>-<platform>\resources\native-binary\claude.exe
    home.as_ref().and_then(|h| {
        newest_bundled(
            &h.join(".vscode").join("extensions"),
            "anthropic.claude-code-",
            &["resources", "native-binary", "claude.exe"],
        )
    })
}

/// The `claude.exe` under the subfolder of `dir` (named `prefix` + version)
/// with the highest version.
fn newest_bundled(dir: &Path, prefix: &str, tail: &[&str]) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let version = version_key(name.strip_prefix(prefix)?)?;
            let exe = tail.iter().fold(e.path(), |p, part| p.join(part));
            exe.is_file().then_some((version, exe))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, exe)| exe)
}

/// "2.1.286-win32-x64" → [2, 1, 286]; None when it does not start with a number.
fn version_key(s: &str) -> Option<Vec<u64>> {
    let key: Vec<u64> = s
        .split(|c: char| c == '.' || c == '-')
        .map_while(|part| part.parse().ok())
        .collect();
    (!key.is_empty()).then_some(key)
}

/// MCP server names as they appear in tool names: anything outside
/// `A-Z a-z 0-9 _ -` becomes `_` (Claude Code's own rule).
pub fn tool_prefix(server: &str) -> String {
    let norm: String = server
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    format!("mcp__{norm}")
}

/// Where Claude Code keeps user-scope MCP servers: `~/.claude.json`, or the
/// same file under CLAUDE_CONFIG_DIR when that is set.
fn claude_json_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join(".claude.json"));
    }
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude.json"))
}

/// Names of the MCP servers configured for the user in Claude Code: the
/// user-scope ones (`claude mcp add --scope user`) and those of the plugins
/// turned on for the user ("plugin:Notion:notion", see `plugin_servers`). Only
/// the names: the configuration (and any key in it) is never read into EasyIsland.
pub fn configured_mcp_servers() -> Vec<String> {
    let mut names: Vec<String> = claude_json_path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|json| json.get("mcpServers").and_then(Value::as_object).map(|m| m.keys().cloned().collect()))
        .unwrap_or_default();
    if let Some(dir) = claude_dir() {
        names.extend(plugin_servers(&dir));
    }
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// `~/.claude`, or CLAUDE_CONFIG_DIR when that is set.
fn claude_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude"))
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// The MCP servers of the plugins turned on in the user's settings
/// (`enabledPlugins` in settings.json, installed as `plugins/installed_plugins.json`
/// says), named as Claude Code names them: "plugin:<plugin>:<server>", whose
/// tools are `mcp__plugin_<plugin>_<server>__…` (the same as `tool_prefix`).
/// Claude Code loads them in `claude -p` too.
fn plugin_servers(claude_dir: &Path) -> Vec<String> {
    let enabled: Vec<String> = read_json(&claude_dir.join("settings.json"))
        .and_then(|s| s.get("enabledPlugins").and_then(Value::as_object).cloned())
        .map(|m| m.into_iter().filter(|(_, on)| on.as_bool() == Some(true)).map(|(k, _)| k).collect())
        .unwrap_or_default();
    let installed = read_json(&claude_dir.join("plugins").join("installed_plugins.json"));
    let mut out = Vec::new();
    for key in enabled {
        let Some(path) = installed
            .as_ref()
            .and_then(|i| i.get("plugins")?.get(&key)?.as_array()?.iter().find_map(|e| e.get("installPath")?.as_str()))
            .map(PathBuf::from)
        else {
            continue;
        };
        let manifest = read_json(&path.join(".claude-plugin").join("plugin.json"));
        let plugin = manifest
            .as_ref()
            .and_then(|m| m.get("name")?.as_str().map(String::from))
            .unwrap_or_else(|| key.split('@').next().unwrap_or(&key).to_string());
        let mut servers: Vec<String> = read_json(&path.join(".mcp.json"))
            .and_then(|m| m.get("mcpServers").and_then(Value::as_object).map(|o| o.keys().cloned().collect()))
            .unwrap_or_default();
        if let Some(inline) = manifest.as_ref().and_then(|m| m.get("mcpServers")).and_then(Value::as_object) {
            servers.extend(inline.keys().cloned());
        }
        for s in servers {
            out.push(format!("plugin:{plugin}:{s}"));
        }
    }
    out
}

/// The connectors this turn may use, already filtered to configured ones.
pub struct Connectors {
    pub enabled: Vec<McpChoice>,
    /// Configured but not picked: removed from the model's tools.
    pub disabled: Vec<String>,
    /// EasyIsland's own tools (the `easyisland` MCP server, agent.rs).
    pub agent: bool,
}

impl Connectors {
    pub fn from_choices(choices: &[McpChoice], agent: bool) -> Self {
        let configured = configured_mcp_servers();
        let enabled: Vec<McpChoice> = choices
            .iter()
            .filter(|c| configured.iter().any(|n| n == &c.name))
            .cloned()
            .collect();
        let disabled = configured
            .into_iter()
            .filter(|n| !enabled.iter().any(|c| &c.name == n))
            .collect();
        Self { enabled, disabled, agent }
    }

    fn any(&self) -> bool {
        !self.enabled.is_empty()
    }

    /// Some MCP server is on this turn: calls then go through the island.
    fn uses_mcp(&self) -> bool {
        self.any() || self.agent
    }
}

/// %LOCALAPPDATA%\EasyIsland\chat — an empty folder, so Claude Code has no project
/// to read; it also holds the two small files we pass by path.
fn work_dir(connectors: &Connectors, terminal: Option<&Path>) -> Result<PathBuf, String> {
    let dir = crate::settings::local_dir().join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| tf("cartella della chat non creata: {e}", &[("e", &e)]))?;

    let mut prompt = match terminal {
        Some(folder) => crate::i18n::prompt(&TERMINAL_PROMPT.replace("{folder}", &folder.to_string_lossy())),
        None => crate::i18n::prompt(SYSTEM_PROMPT),
    };
    if connectors.agent {
        // With the terminal's own tools the chat can run commands after all.
        prompt.push_str(&if terminal.is_some() { AGENT_PROMPT.replace(NO_COMMANDS, "") } else { AGENT_PROMPT.to_string() });
        // `easyisland-hook mcp`: the tools of agent.rs, through the pipe.
        let hook = crate::settings::hook_exe_path().to_string_lossy().into_owned();
        let mcp = serde_json::json!({
            "mcpServers": { "easyisland": { "type": "stdio", "command": hook, "args": ["mcp"] } }
        });
        std::fs::write(dir.join("chat-mcp.json"), mcp.to_string()).map_err(|e| e.to_string())?;
    }
    let settings = if terminal.is_some() {
        // Every tool Claude Code would ask about goes to the island. The
        // user's own hooks run as in a terminal (easyisland-hook ignores them
        // here: EASYISLAND_INTERNAL).
        permission_hook(".*")
    } else if connectors.uses_mcp() {
        if connectors.any() {
            let names: Vec<&str> = connectors.enabled.iter().map(|c| c.name.as_str()).collect();
            prompt.push_str(&format!(
                " You can use these connectors (MCP servers): {}. \
Before any call that creates, changes, sends or deletes something, say in one short sentence what you are about to do: \
the user confirms or refuses it with a click, and a refusal is final for that request.",
                names.join(", ")
            ));
        }
        permission_hook("mcp__.*")
    } else {
        r#"{ "disableAllHooks": true }"#.to_string()
    };
    std::fs::write(dir.join("chat-prompt.txt"), prompt).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("chat-settings.json"), settings).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The chat's settings: the PermissionRequest hook that puts Claude Code's
/// questions on the island's card, for the tools `matcher` covers.
fn permission_hook(matcher: &str) -> String {
    let exe = crate::settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    serde_json::json!({
        "hooks": {
            "PermissionRequest": [{
                "matcher": matcher,
                "hooks": [{
                    "type": "command",
                    "command": format!("\"{exe}\" PermissionRequest --chat"),
                    "timeout": 130
                }]
            }]
        }
    })
    .to_string()
}

pub(crate) fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    // If EasyIsland itself was started from inside a Claude Code session (e.g.
    // `npm run tauri dev` run by Claude), these would make the chat attach to
    // that session instead of its own.
    for var in INHERITED_SESSION_VARS {
        cmd.env_remove(var);
    }
    cmd.env("EASYISLAND_INTERNAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// The arguments for one turn. Kept apart from the spawn so it can be tested.
fn args(
    dir: &Path,
    model: &str,
    session: Option<&str>,
    extra_dir: Option<&Path>,
    connectors: &Connectors,
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--settings".into(),
        dir.join("chat-settings.json")
            .to_string_lossy()
            .into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("chat-prompt.txt").to_string_lossy().into_owned(),
        "--tools".into(),
        TOOLS.into(),
    ];
    if connectors.uses_mcp() {
        // `default`: a call that is not pre-allowed goes to the PermissionRequest
        // hook (the island); with no answer from there it is denied.
        a.extend(["--permission-mode".into(), "default".into()]);
        let mut allowed = TOOLS.to_string();
        for c in connectors.enabled.iter().filter(|c| !c.confirm) {
            allowed.push(',');
            allowed.push_str(&tool_prefix(&c.name));
        }
        if connectors.agent {
            for t in agent_read_only() {
                allowed.push_str(&format!(",mcp__easyisland__{t}"));
            }
            a.extend(["--mcp-config".into(), dir.join("chat-mcp.json").to_string_lossy().into_owned()]);
            // Without connectors of the user's own, only ours is loaded.
            if !connectors.any() {
                a.push("--strict-mcp-config".into());
            }
        }
        a.extend(["--allowedTools".into(), allowed]);
        let mut denied: Vec<String> = Vec::new();
        if connectors.any() {
            denied.extend(connectors.disabled.iter().filter(|n| n.as_str() != "easyisland").map(|n| tool_prefix(n)));
        }
        if !denied.is_empty() {
            a.extend(["--disallowedTools".into(), denied.join(",")]);
        }
    } else {
        a.extend([
            "--permission-mode".into(),
            "dontAsk".into(),
            "--strict-mcp-config".into(),
            "--allowedTools".into(),
            TOOLS.into(),
        ]);
    }
    if !model.is_empty() {
        a.push("--model".into());
        a.push(model.into());
    }
    if let Some(id) = session {
        a.push("--resume".into());
        a.push(id.into());
    }
    if let Some(d) = extra_dir {
        a.push("--add-dir".into());
        a.push(d.to_string_lossy().into_owned());
    }
    a
}

/// "Modalità terminale": the arguments of a turn. No `--tools` (all of
/// Claude Code's), no `--strict-mcp-config` (the user's own servers and
/// plugins), `default` permissions: what is not allowed by the user's own
/// rules goes to the island. Connectors marked "no confirmation" and the
/// easyisland tools that change nothing are pre-allowed, as outside it.
/// `auto` ("Automatica" in the chat): Claude Code's auto mode, where its own
/// check approves routine actions and refuses risky ones; what it still
/// asks about comes to the island as before.
fn terminal_args(
    dir: &Path,
    model: &str,
    session: Option<&str>,
    extra_dir: Option<&Path>,
    connectors: &Connectors,
    auto: bool,
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--settings".into(),
        dir.join("chat-settings.json").to_string_lossy().into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("chat-prompt.txt").to_string_lossy().into_owned(),
        "--permission-mode".into(),
        if auto { "auto".into() } else { "default".into() },
    ];
    let mut allowed: Vec<String> = connectors.enabled.iter().filter(|c| !c.confirm).map(|c| tool_prefix(&c.name)).collect();
    if connectors.agent {
        allowed.extend(agent_read_only().iter().map(|t| format!("mcp__easyisland__{t}")));
        a.extend(["--mcp-config".into(), dir.join("chat-mcp.json").to_string_lossy().into_owned()]);
    }
    if !allowed.is_empty() {
        a.extend(["--allowedTools".into(), allowed.join(",")]);
    }
    if !model.is_empty() {
        a.extend(["--model".into(), model.into()]);
    }
    if let Some(id) = session {
        a.extend(["--resume".into(), id.into()]);
    }
    if let Some(d) = extra_dir {
        a.extend(["--add-dir".into(), d.to_string_lossy().into_owned()]);
    }
    a
}

/// "Modalità terminale": what the island shows while Claude Code works, from
/// its `stream-json` lines — the steps as short lines ("> ⚙ Esegue · `git
/// status`", as opencode.rs does) and the text in between.
#[derive(Default)]
struct Progress {
    shown: String,
    /// The reasoning being written, shown under the rest only while it lasts.
    thinking: String,
}

impl Progress {
    /// One line of the stream; true when what is shown changed.
    fn feed(&mut self, line: &str) -> bool {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { return false };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            return false;
        }
        // A sub-agent's own steps stay inside its one step.
        if v.get("parent_tool_use_id").is_some_and(|p| !p.is_null()) {
            return false;
        }
        let mut changed = false;
        for block in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
            if block.get("type").and_then(Value::as_str) == Some("thinking") {
                let t = block.get("thinking").and_then(Value::as_str).unwrap_or_default().trim();
                if !t.is_empty() {
                    self.thinking = t.to_string();
                    changed = true;
                }
                continue;
            }
            let piece = match block.get("type").and_then(Value::as_str) {
                Some("text") => block.get("text").and_then(Value::as_str).map(|t| t.trim().to_string()),
                Some("tool_use") => {
                    let (name, input) = (block.get("name").and_then(Value::as_str).unwrap_or_default(), block.get("input").unwrap_or(&Value::Null));
                    // A file about to change: «Modifiche» and the preview (preview.rs).
                    crate::preview::touched_by(name, input);
                    Some(step_line(name, input))
                }
                _ => None,
            };
            if let Some(p) = piece.filter(|p| !p.is_empty()) {
                if !self.shown.is_empty() {
                    self.shown.push_str("\n\n");
                }
                self.shown.push_str(&p);
                self.thinking.clear();
                changed = true;
            }
        }
        changed
    }
}

impl Progress {
    /// What is shown while the turn goes on.
    fn view(&self) -> String {
        crate::opencode::with_thinking(self.shown.clone(), &self.thinking)
    }
}

/// A step of Claude Code in the words of opencode.rs's (`step_line`).
fn step_line(tool: &str, input: &Value) -> String {
    if let Some(rest) = tool.strip_prefix("mcp__") {
        // mcp__<server>__<tool>
        let (server, name) = rest.split_once("__").unwrap_or(("", rest));
        let server = server.trim_start_matches("plugin_").replace('_', " ");
        return crate::steps::mcp(&server, name, input);
    }
    if tool == "ToolSearch" {
        return crate::steps::loading_tools();
    }
    let as_opencode = match tool {
        "Bash" | "PowerShell" => "bash",
        "Read" => "read",
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => "edit",
        "Glob" | "Grep" => "glob",
        "WebFetch" => "webfetch",
        "WebSearch" => "websearch",
        "TodoWrite" => "todowrite",
        "Skill" => "skill",
        "Task" | "Agent" => return match input.get("description").and_then(Value::as_str) {
            Some(d) => format!("> ⚙ {} · `{}`", t("Sotto-agente"), d.replace('`', "'")),
            None => format!("> ⚙ {}", t("Sotto-agente")),
        },
        other => other,
    };
    crate::opencode::step_line(as_opencode, input)
}

type OutLines = tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>;

/// Reads the turn as it streams, the steps (and the text and the reasoning) to
/// `on_text`. Back: the last JSON line, what was shown, and whether the
/// turn's `result` came. `until_result`: a kept process (`Live`) goes on after it.
async fn read_lines(
    lines: &mut OutLines,
    on_text: &(dyn Fn(&str) + Sync),
    limit: Duration,
    late: &str,
    until_result: bool,
) -> Result<(String, String, bool), String> {
    let mut progress = Progress::default();
    let mut last = String::new();
    let mut emitted = std::time::Instant::now();
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Err(_) => return Err(late.to_string()),
            Ok(Err(e)) => return Err(tf("Claude Code si è interrotto: {e}", &[("e", &e)])),
            Ok(Ok(None)) => return Ok((last, progress.shown, false)),
            Ok(Ok(Some(line))) => {
                if !line.trim_start().starts_with('{') {
                    continue;
                }
                if progress.feed(&line) && emitted.elapsed() >= STREAM_EVERY {
                    emitted = std::time::Instant::now();
                    on_text(&progress.view());
                }
                let result = line.contains("\"type\":\"result\"") && serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("type").and_then(Value::as_str).map(|t| t == "result")) == Some(true);
                last = line;
                if result && until_result {
                    return Ok((last, progress.shown, true));
                }
            }
        }
    }
}

/// One process, one turn: the output to its end. Back: the last JSON line
/// (the result), what was shown, stderr, and the exit.
async fn read_stream(
    child: &mut tokio::process::Child,
    on_text: &(dyn Fn(&str) + Sync),
    limit: Duration,
    late: &str,
) -> Result<(String, String, String, bool), String> {
    let stdout = child.stdout.take().ok_or(t("Claude Code si è interrotto."))?;
    let stderr = child.stderr.take();
    // Read alongside, or a full stderr pipe would stall Claude Code.
    let err = tauri::async_runtime::spawn(async move {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s).await;
        }
        s
    });
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let (last, shown, _) = match read_lines(&mut lines, on_text, limit, late, false).await {
        Ok(r) => r,
        Err(e) => {
            let _ = child.start_kill();
            return Err(e);
        }
    };
    let ok = matches!(child.wait().await, Ok(s) if s.success());
    let stderr = err.await.unwrap_or_default();
    Ok((last, shown, stderr, ok))
}

// ── Kept processes ────────────────────────────────────────────────────────────
// A new `claude -p` for every message took ~6 s before the model even
// started (Node, settings, MCP servers); one left running between the
// messages of a conversation answers in ~3 s (measured on 20 October 2026).
// The chat's conversations (island and Telegram) keep theirs: messages go in
// as stream-json lines on stdin, each turn ends at its `result`. Anything that
// changes how it was started (model, connectors, folders, the prompt and
// settings files, Telegram) or a new conversation starts another; a kept
// process that died is replaced with `--resume`, so nothing is lost. Ferma
// drops the turn, and with it the process (kill_on_drop).

struct Live {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    lines: OutLines,
    stderr: std::sync::Arc<std::sync::Mutex<String>>,
    /// The conversation (the `Chat`'s address) and how the process was started.
    chat: usize,
    print: String,
    session: String,
    used: std::time::Instant,
}

static LIVE: std::sync::Mutex<Vec<Live>> = std::sync::Mutex::new(Vec::new());
/// A conversation left alone this long lets its process go.
const LIVE_IDLE: Duration = Duration::from_secs(20 * 60);

/// How the process is started, without the session it resumes.
fn fingerprint(cmd: &Command, dir: &Path) -> String {
    let std = cmd.as_std();
    let mut parts: Vec<String> = Vec::new();
    let mut skip = false;
    for a in std.get_args() {
        let a = a.to_string_lossy().into_owned();
        if skip {
            skip = false;
            continue;
        }
        if a == "--resume" {
            skip = true;
            continue;
        }
        parts.push(a);
    }
    parts.push(format!("cwd={:?}", std.get_current_dir()));
    for (k, v) in std.get_envs() {
        parts.push(format!("{}={:?}", k.to_string_lossy(), v));
    }
    // The files it read when it started.
    for f in ["chat-prompt.txt", "chat-settings.json", "chat-mcp.json"] {
        parts.push(std::fs::read_to_string(dir.join(f)).unwrap_or_default());
    }
    parts.join("\u{1}")
}

/// The kept process of this conversation, if it fits; the others of the same
/// conversation and those left alone too long go.
fn take_live(chat: usize, print: &str, session: Option<&str>) -> Option<Live> {
    let mut all = LIVE.lock().unwrap();
    let pos = all.iter().position(|l| l.chat == chat && l.print == print && Some(l.session.as_str()) == session);
    let found = pos.map(|i| all.remove(i));
    all.retain(|l| l.chat != chat && l.used.elapsed() < LIVE_IDLE);
    found
}

fn put_live(live: Live) {
    LIVE.lock().unwrap().push(live);
}

/// At the app's exit (lib.rs): the kept processes go with it.
pub fn shutdown() {
    let mut all = LIVE.lock().unwrap();
    for l in all.iter_mut() {
        let _ = l.child.start_kill();
    }
    all.clear();
}

fn spawn_live(mut cmd: Command, chat: usize, print: String) -> Result<Live, String> {
    cmd.args(["--input-format", "stream-json"]);
    let mut child = cmd.spawn().map_err(|e| tf("Claude Code non si avvia: {e}", &[("e", &e)]))?;
    let stdin = child.stdin.take().ok_or(t("Claude Code si è interrotto."))?;
    let stdout = child.stdout.take().ok_or(t("Claude Code si è interrotto."))?;
    let stderr = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(e) = child.stderr.take() {
        let keep = stderr.clone();
        // Read alongside, or a full stderr pipe would stall Claude Code.
        tauri::async_runtime::spawn(async move {
            let mut lines = tokio::io::BufReader::new(e).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut k = keep.lock().unwrap();
                k.push_str(&line);
                k.push('\n');
                let n = k.chars().count();
                if n > 4000 {
                    *k = k.chars().skip(n - 4000).collect();
                }
            }
        });
    }
    Ok(Live { child, stdin, lines: tokio::io::BufReader::new(stdout).lines(), stderr, chat, print, session: String::new(), used: std::time::Instant::now() })
}

/// One message to a kept process. Err(None): the process was gone (start another).
async fn live_turn(
    live: &mut Live,
    prompt: &str,
    on_text: &(dyn Fn(&str) + Sync),
    limit: Duration,
    late: &str,
) -> Result<(String, String), Option<String>> {
    let line = serde_json::json!({ "type": "user", "message": { "role": "user", "content": prompt } }).to_string();
    if live.stdin.write_all(format!("{line}\n").as_bytes()).await.is_err() || live.stdin.flush().await.is_err() {
        return Err(None);
    }
    match read_lines(&mut live.lines, on_text, limit, late, true).await {
        Ok((last, shown, true)) => Ok((last, shown)),
        Ok((_, _, false)) => Err(None),
        Err(e) => Err(Some(e)),
    }
}

/// What `claude -p --output-format json` printed. Claude Code reports a failed
/// run (not logged in, usage limit…) as a result with `is_error`, on stdout.
struct Outcome {
    text: String,
    is_error: bool,
    session_id: Option<String>,
}

fn parse_output(stdout: &str) -> Option<Outcome> {
    // The JSON object is the last non-empty line; anything before it is noise.
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with('{'))?;
    let v: Value = serde_json::from_str(line).ok()?;
    Some(Outcome {
        text: v
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
        session_id: v
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// The `result` line's numbers in the log: where the time and the tokens went.
fn log_usage(stdout: &str) {
    let Some(v) = stdout.lines().rev().map(str::trim).find(|l| l.starts_with('{')).and_then(|l| serde_json::from_str::<Value>(l).ok()) else { return };
    if let Some(line) = usage_line(&v) {
        crate::log::line(line);
    }
}

fn usage_line(v: &Value) -> Option<String> {
    let u = v.get("usage")?;
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    Some(format!(
        "claude: {} passi, {:.1} s (modello {:.1} s), token: {} nuovi, {} in cache, {} scritti in cache, {} in uscita, {:.3} $",
        v.get("num_turns").and_then(Value::as_u64).unwrap_or(0),
        v.get("duration_ms").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0,
        v.get("duration_api_ms").and_then(Value::as_f64).unwrap_or(0.0) / 1000.0,
        n("input_tokens"),
        n("cache_read_input_tokens"),
        n("cache_creation_input_tokens"),
        n("output_tokens"),
        v.get("total_cost_usd").and_then(Value::as_f64).unwrap_or(0.0),
    ))
}

/// One chat turn through Claude Code. Multi-turn works by resuming the session
/// Claude Code reported last time.
pub async fn send(
    chat: &Chat,
    model: &str,
    mcp: &[McpChoice],
    agent: bool,
    query: String,
    context: Option<ChatContext>,
    terminal: Option<&Path>,
    auto: bool,
    on_text: &(dyn Fn(&str) + Sync),
    telegram: bool,
    work: Option<&Path>,
) -> Result<ChatReply, String> {
    send_mode(chat, model, mcp, agent, query, context, terminal, auto, on_text, telegram, work, false).await
}

/// `send` for the chat's own conversations (lib.rs chat_turn): the process
/// stays on between the messages (`Live`).
pub async fn send_kept(
    chat: &Chat,
    model: &str,
    mcp: &[McpChoice],
    agent: bool,
    query: String,
    context: Option<ChatContext>,
    terminal: Option<&Path>,
    auto: bool,
    on_text: &(dyn Fn(&str) + Sync),
    telegram: bool,
    work: Option<&Path>,
) -> Result<ChatReply, String> {
    send_mode(chat, model, mcp, agent, query, context, terminal, auto, on_text, telegram, work, true).await
}

#[allow(clippy::too_many_arguments)]
async fn send_mode(
    chat: &Chat,
    model: &str,
    mcp: &[McpChoice],
    agent: bool,
    query: String,
    context: Option<ChatContext>,
    terminal: Option<&Path>,
    auto: bool,
    on_text: &(dyn Fn(&str) + Sync),
    telegram: bool,
    work: Option<&Path>,
    keep: bool,
) -> Result<ChatReply, String> {
    let exe = find_claude().ok_or_else(|| {
        t("Per la chat con l'abbonamento serve Claude Code da riga di comando (la CLI), installato su questo PC e con il login fatto: quello dentro l'app desktop di Claude non si può usare da altri programmi. Impostazioni → Chat spiega come installarlo; oppure lì scegli un altro motore.")
            .to_string()
    })?;
    let connectors = Connectors::from_choices(mcp, agent);
    let dir = work_dir(&connectors, terminal)?;
    let session = chat.cli_session();

    // The front end sends a context with the first message, or with a file
    // added later (pasted in the chat, sent on Telegram).
    let mut prompt = String::new();
    let mut extra_dir: Option<PathBuf> = None;
    {
        for (part, folder) in crate::claude::parts(context.as_ref()) {
            match &part {
                ChatContext::File { name, path } => {
                    prompt.push_str(&tf("File allegato: {name}\nPercorso: {path}\nLeggilo con Read prima di rispondere.\n\n", &[("name", &name), ("path", &path)]));
                    extra_dir = Path::new(path).parent().map(Path::to_path_buf);
                }
                ChatContext::Text { label, text } => {
                    prompt.push_str(&format!("{label}:\n{text}\n\n"));
                    // An attached folder: Claude Code may read in it.
                    if let Some(folder) = folder {
                        prompt.push_str(&tf("Puoi leggere i file della cartella {path} con Read, Glob e Grep.\n\n", &[("path", &folder)]));
                        extra_dir = Some(PathBuf::from(folder));
                    }
                }
                ChatContext::Window { app_name, title, url, image } => {
                    prompt.push_str(&crate::claude::window_line(app_name, title, url.as_deref()));
                    prompt.push('\n');
                    if let Some(path) = image {
                        prompt.push_str(&tf("Immagine della finestra: {path}\nGuardala con Read prima di rispondere.\n", &[("path", &path)]));
                        extra_dir = Path::new(path).parent().map(Path::to_path_buf);
                    }
                    prompt.push('\n');
                }
                ChatContext::Files { .. } => {}
            }
        }
    }
    prompt.push_str(&query);

    let make = |resume: Option<&str>| {
        let mut cmd = command(&exe);
        match terminal {
            Some(folder) => cmd.current_dir(folder).args(terminal_args(&dir, model, resume, extra_dir.as_deref(), &connectors, auto)),
            None => cmd.current_dir(&dir).args(args(&dir, model, resume, extra_dir.as_deref(), &connectors)),
        };
        // The work folder (workdir.rs): readable with Read outside terminal mode too.
        if let (None, Some(w)) = (terminal, work) {
            cmd.arg("--add-dir").arg(w);
        }
        // A turn from Telegram: easyisland-hook passes this on, and pipe.rs asks
        // Consenti / Nega in Telegram instead of on the island (telegram.rs).
        if telegram {
            cmd.env("EASYISLAND_CHANNEL", "telegram");
        }
        cmd
    };
    let (limit, late) = if terminal.is_some() {
        (TIMEOUT_TERMINAL, t("Claude Code non ha finito entro 30 minuti: interrotto."))
    } else if connectors.uses_mcp() {
        (TIMEOUT_WITH_CONNECTORS, t("Claude Code non ha risposto in tempo."))
    } else {
        (TIMEOUT, t("Claude Code non ha risposto in tempo."))
    };

    let (stdout, shown, stderr, success) = if keep {
        let print = fingerprint(&make(None), &dir);
        let id = chat as *const Chat as usize;
        let mut kept = take_live(id, &print, session.as_deref());
        let mut answer = None;
        // A kept process that is gone is replaced once, resuming the conversation.
        for _ in 0..2 {
            let mut live = match kept.take() {
                Some(l) => l,
                None => spawn_live(make(session.as_deref()), id, print.clone())?,
            };
            match live_turn(&mut live, &prompt, on_text, limit, late).await {
                Ok((last, shown)) => {
                    answer = Some((last, shown, live));
                    break;
                }
                Err(Some(e)) => return Err(e),
                Err(None) => {
                    let detail = live.stderr.lock().unwrap().clone();
                    crate::log::line(format!("claude: processo tenuto chiuso, ne parte un altro{}", if detail.trim().is_empty() { String::new() } else { format!(" ({})", detail.trim().chars().take(200).collect::<String>()) }));
                    if needs_login(&detail) {
                        return Err(LOGIN_HELP.into());
                    }
                }
            }
        }
        let Some((last, shown, mut live)) = answer else {
            return Err(t("Claude Code si è interrotto.").into());
        };
        let stderr = live.stderr.lock().unwrap().clone();
        let outcome_ok = parse_output(&last).is_some_and(|o| !o.is_error);
        if let (true, Some(sid)) = (outcome_ok, parse_output(&last).and_then(|o| o.session_id)) {
            live.session = sid;
            live.used = std::time::Instant::now();
            put_live(live);
        }
        // Outside the terminal the answer is the text alone, as before.
        (last, if terminal.is_some() { shown } else { String::new() }, stderr, true)
    } else {
        let mut child = make(session.as_deref())
            .spawn()
            .map_err(|e| tf("Claude Code non si avvia: {e}", &[("e", &e)]))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            // Dropping stdin closes it: that is what tells `claude -p` the prompt is complete.
        }
        let (last, shown, stderr, ok) = read_stream(&mut child, on_text, limit, late).await?;
        (last, if terminal.is_some() { shown } else { String::new() }, stderr, ok)
    };

    log_usage(&stdout);
    let Some(outcome) = parse_output(&stdout) else {
        let detail: String = stderr.trim().chars().take(300).collect();
        // A broken session id would fail every later turn the same way.
        chat.set_cli_session(None);
        if needs_login(&detail) {
            return Err(LOGIN_HELP.into());
        }
        return Err(if detail.is_empty() {
            t("Claude Code ha restituito un errore.").to_string()

        } else {
            format!("Claude Code: {detail}")
        });
    };

    if outcome.is_error || !success {
        chat.set_cli_session(None);
        if needs_login(&outcome.text) {
            return Err(LOGIN_HELP.into());
        }
        return Err(if outcome.text.is_empty() {
            t("Claude Code ha restituito un errore.").into()
        } else {
            format!("Claude Code: {}", outcome.text)
        });
    }

    if let Some(id) = outcome.session_id {
        chat.set_cli_session(Some(id));
    }
    // The terminal's steps stay above the answer, as they were shown.
    let text = if shown.trim().is_empty() { outcome.text } else { shown };
    if text.is_empty() {
        return Err(t("Nessun testo nella risposta.").into());
    }
    Ok(ChatReply { text })
}

/// What the chat says when Claude Code has no login of its own.
const LOGIN_HELP: &str = "Il login di Claude Code manca o è scaduto. Apri un terminale, scrivi «claude», poi «/login» e accedi con il tuo account Claude (Pro o Max); quindi riprova. Se «claude» non viene trovato, installalo come spiega Impostazioni → Chat.";

/// Claude Code's own ways of saying "nobody is signed in".
fn needs_login(text: &str) -> bool {
    let t = text.to_lowercase();
    // "Failed to authenticate: OAuth session expired and could not be refreshed"
    ["/login", "not logged in", "please log in", "log in to", "invalid api key", "oauth token", "failed to authenticate", "session expired"]
        .iter()
        .any(|k| t.contains(k))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub found: bool,
    pub path: String,
    pub logged_in: bool,
    /// Where it was found: "cli" (installed on its own), "vscode" (the VS Code
    /// extension's copy), "desktop" (the Claude app's copy) — for the settings.
    pub source: String,
}

fn source_of(path: &Path) -> &'static str {
    let p = path.to_string_lossy().to_lowercase();
    if p.contains(".vscode") {
        "vscode"
    } else if p.contains("claude-code") && p.contains("claude") && !p.contains(".local") && !p.contains("npm") {
        "desktop"
    } else {
        "cli"
    }
}

/// For the settings window: is Claude Code installed, and signed in?
/// `claude auth status` exits 0 when logged in, 1 when not.
pub async fn status() -> CliStatus {
    let Some(exe) = find_claude() else {
        return CliStatus {
            found: false,
            path: String::new(),
            logged_in: false,
            source: String::new(),
        };
    };
    let mut cmd = command(&exe);
    cmd.arg("auth").arg("status").stdin(Stdio::null());
    let logged_in = match cmd.spawn() {
        Ok(child) => matches!(
            tokio::time::timeout(STATUS_TIMEOUT, child.wait_with_output()).await,
            Ok(Ok(o)) if o.status.success()
        ),
        Err(_) => false,
    };
    CliStatus {
        found: true,
        path: exe.to_string_lossy().into_owned(),
        logged_in,
        source: source_of(&exe).to_string(),
    }
}

/// "Chiedi a questa sessione": what the copy is told before the question.
const ASK_PROMPT: &str = "You are a read-only copy of the user's Claude Code session, asked a side question from the EasyIsland island. \
The real session goes on without you: never edit files, run commands or continue its work. \
Answer from what the session already knows, reading files only if needed. Be brief: the answer is shown in a small window. \
Respond in Italian unless the user writes in another language.";
const ASK_TOOLS: &str = "Read,Glob,Grep";

#[derive(Serialize)]
pub struct AskReply {
    text: String,
    /// The copy's session id: the next question goes on there.
    fork: Option<String>,
}

/// The arguments for one side question. Kept apart from the spawn so it can be tested.
fn ask_args(dir: &Path, session: &str, fork: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--settings".into(),
        dir.join("ask-settings.json").to_string_lossy().into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("ask-prompt.txt").to_string_lossy().into_owned(),
        "--tools".into(),
        ASK_TOOLS.into(),
        "--allowedTools".into(),
        ASK_TOOLS.into(),
        "--permission-mode".into(),
        "dontAsk".into(),
        "--strict-mcp-config".into(),
        "--resume".into(),
    ];
    match fork {
        // The copy made by the first question: its own history goes on.
        Some(f) => a.push(f.into()),
        // A copy of the session: the session itself is never written to.
        None => a.extend([session.into(), "--fork-session".into()]),
    }
    a
}

/// A side question to a Claude Code session, answered by a read-only copy of it
/// (`--fork-session`), run in the session's folder (where Claude Code keeps it),
/// with hooks off so the copy never shows up in the island as a session.
#[tauri::command]
pub async fn session_ask(session: String, fork: Option<String>, cwd: String, question: String) -> Result<AskReply, String> {
    let question = question.trim().to_string();
    let valid = |s: &str| !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if question.is_empty() || !valid(&session) || fork.as_deref().is_some_and(|f| !valid(f)) {
        return Err(t("Domanda o sessione non valida.").into());
    }
    let folder = PathBuf::from(&cwd);
    if !folder.is_dir() {
        return Err(t("La cartella della sessione non esiste più.").into());
    }
    let exe = find_claude().ok_or_else(|| {
        t("Per chiedere a una sessione serve Claude Code da riga di comando (la CLI) su questo PC.").to_string()
    })?;
    let dir = crate::settings::local_dir().join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| tf("cartella della chat non creata: {e}", &[("e", &e)]))?;
    std::fs::write(dir.join("ask-prompt.txt"), crate::i18n::prompt(ASK_PROMPT)).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("ask-settings.json"), r#"{ "disableAllHooks": true }"#).map_err(|e| e.to_string())?;

    let mut cmd = command(&exe);
    cmd.current_dir(&folder).args(ask_args(&dir, &session, fork.as_deref()));
    let mut child = cmd.spawn().map_err(|e| tf("Claude Code non si avvia: {e}", &[("e", &e)]))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(question.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let output = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(tf("Claude Code si è interrotto: {e}", &[("e", &e)])),
        Err(_) => return Err(t("Claude Code non ha risposto in tempo.").into()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(outcome) = parse_output(&stdout) else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.trim().chars().take(300).collect();
        if needs_login(&detail) {
            return Err(LOGIN_HELP.into());
        }
        return Err(if detail.is_empty() { t("Claude Code ha restituito un errore.").into() } else { format!("Claude Code: {detail}") });
    };
    if outcome.is_error || !output.status.success() {
        if needs_login(&outcome.text) {
            return Err(LOGIN_HELP.into());
        }
        return Err(if outcome.text.is_empty() { t("Claude Code ha restituito un errore.").into() } else { format!("Claude Code: {}", outcome.text) });
    }
    if outcome.text.is_empty() {
        return Err(t("Nessun testo nella risposta.").into());
    }
    Ok(AskReply { text: outcome.text, fork: outcome.session_id.or(fork) })
}

#[cfg(test)]
mod tests {
    #[test]
    fn plugin_servers_of_enabled_plugins() {
        let dir = std::env::temp_dir().join(format!("ei-plugins-{}", std::process::id()));
        let notion = dir.join("cache").join("notion");
        let off = dir.join("cache").join("off");
        std::fs::create_dir_all(notion.join(".claude-plugin")).unwrap();
        std::fs::create_dir_all(dir.join("plugins")).unwrap();
        std::fs::create_dir_all(&off).unwrap();
        std::fs::write(dir.join("settings.json"), r#"{"enabledPlugins":{"notion@dir":true,"off@dir":false,"missing@dir":true}}"#).unwrap();
        let installed = serde_json::json!({ "version": 2, "plugins": {
            "notion@dir": [{ "scope": "user", "installPath": notion.to_string_lossy() }],
            "off@dir": [{ "scope": "user", "installPath": off.to_string_lossy() }],
        }});
        std::fs::write(dir.join("plugins").join("installed_plugins.json"), installed.to_string()).unwrap();
        std::fs::write(notion.join(".claude-plugin").join("plugin.json"), r#"{"name":"Notion"}"#).unwrap();
        std::fs::write(notion.join(".mcp.json"), r#"{"mcpServers":{"notion":{"type":"http","url":"https://mcp.notion.com/mcp"}}}"#).unwrap();
        std::fs::write(off.join(".mcp.json"), r#"{"mcpServers":{"x":{}}}"#).unwrap();
        assert_eq!(super::plugin_servers(&dir), vec!["plugin:Notion:notion".to_string()]);
        assert_eq!(super::tool_prefix("plugin:Notion:notion"), "mcp__plugin_Notion_notion");
        assert!(super::plugin_servers(&dir.join("nessuna")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_side_question_forks_once_then_goes_on_in_the_copy() {
        let dir = std::path::Path::new("C:/x");
        let first = super::ask_args(dir, "abc", None);
        let at = first.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(&first[at + 1..], ["abc", "--fork-session"]);
        assert!(first.windows(2).any(|w| w[0] == "--permission-mode" && w[1] == "dontAsk"));
        assert!(first.windows(2).any(|w| w[0] == "--tools" && w[1] == "Read,Glob,Grep"));
        let next = super::ask_args(dir, "abc", Some("def"));
        assert_eq!(next.last().unwrap(), "def");
        assert!(!next.iter().any(|a| a == "--fork-session"));
    }

    /// `claude -p` on this PC, as the island's chat runs it:
    /// `cargo test --lib claude_cli::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_chat_turn() {
        tauri::async_runtime::block_on(async {
            println!("claude: {:?}", super::find_claude());
            let chat = crate::claude::Chat::default();
            for agent in [false, true] {
                let r = super::send(&chat, "", &[], agent, "Rispondi solo con la parola: ok".into(), None, None, false, &|_| {}, false, None).await;
                println!("agent={agent}: {:?}", r.as_ref().map(|x| &x.text));
                chat.reset();
            }
        });
    }

    /// A real question with EasyIsland's tools (the app must be running), timed:
    /// `cargo test --lib claude_cli::tests::live_speed -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_speed() {
        tauri::async_runtime::block_on(async {
            let chat = crate::claude::Chat::default();
            let q = std::env::var("SPEED_Q").unwrap_or_else(|_| "Quanto ho speso in totale a ottobre 2026 secondo Notion? Solo il numero.".into());
            let mut index = crate::notion_map::index(true).unwrap_or_default();
            // `SPEED_RECIPE=1`: as if a recipe had been learnt (recipes.rs).
            if std::env::var("SPEED_RECIPE").is_ok() {
                index.push_str(&crate::recipes::sample_hint());
            }
            for (i, q) in [format!("{index}{q}"), "E a settembre? Solo il numero.".to_string()].into_iter().enumerate() {
                let start = std::time::Instant::now();
                let first = std::sync::Mutex::new(None::<f32>);
                let r = super::send(&chat, "", &[], true, q, None, None, false, &|_| { first.lock().unwrap().get_or_insert(start.elapsed().as_secs_f32()); }, false, None).await;
                println!("turno {i}: {:.1} s (primo testo {:?}) → {:?}", start.elapsed().as_secs_f32(), first.lock().unwrap(), r.map(|x| x.text));
            }
        });
    }

    /// Kept processes on this PC: messages in a row, a process that died, a
    /// stopped turn, the app's exit.
    /// `cargo test --lib claude_cli::tests::live_kept -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_kept() {
        tauri::async_runtime::block_on(async {
            let chat = crate::claude::Chat::default();
            let agent = std::env::var("KEPT_AGENT").is_ok();
            let ask = |q: &str| super::send_kept(&chat, "", &[], agent, q.to_string(), None, None, false, &|_| {}, false, None);
            let alive = || super::LIVE.lock().unwrap().len();
            let mut times = Vec::new();
            for q in ["Ricorda la parola: ananas. Rispondi solo: ok", "Rispondi solo: ok", "Quale parola ti ho chiesto di ricordare? Solo quella."] {
                let t = std::time::Instant::now();
                let r = ask(q).await.expect("turn");
                times.push(t.elapsed().as_secs_f32());
                println!("{:.1} s → {}", t.elapsed().as_secs_f32(), r.text);
                assert_eq!(alive(), 1, "one process for the conversation");
                if q.starts_with("Quale") {
                    assert!(r.text.to_lowercase().contains("ananas"), "{}", r.text);
                }
            }
            let session = chat.cli_session().expect("session");
            // The process dies: the next message starts another on the same conversation.
            {
                let mut all = super::LIVE.lock().unwrap();
                let _ = all[0].child.start_kill();
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let r = ask("Quale parola ti ho chiesto di ricordare? Solo quella.").await.expect("after a death");
            println!("dopo la chiusura → {}", r.text);
            assert!(r.text.to_lowercase().contains("ananas"), "{}", r.text);
            assert_eq!(chat.cli_session().as_deref(), Some(session.as_str()), "same conversation");
            // Ferma: the turn is dropped, and its process with it.
            let stopped = tokio::time::timeout(std::time::Duration::from_millis(1500), ask("Scrivi una poesia di 40 righe sul mare.")).await;
            assert!(stopped.is_err());
            assert_eq!(alive(), 0, "a stopped turn takes its process");
            let r = ask("Quale parola ti ho chiesto di ricordare? Solo quella.").await.expect("after a stop");
            println!("dopo Ferma → {}", r.text);
            assert!(r.text.to_lowercase().contains("ananas"), "{}", r.text);
            // A new conversation: another process, the old one goes.
            chat.reset();
            ask("Rispondi solo: ok").await.expect("new conversation");
            assert_eq!(alive(), 1);
            assert_ne!(chat.cli_session().as_deref(), Some(session.as_str()));
            super::shutdown();
            assert_eq!(alive(), 0);
            println!("tempi: {times:?}");
            assert!(times[1] < times[0], "the second message is faster than the first");
        });
    }

    #[test]
    fn usage_in_the_log() {
        let v = serde_json::json!({ "type": "result", "num_turns": 3, "duration_ms": 28700, "duration_api_ms": 21000, "total_cost_usd": 0.0412,
            "usage": { "input_tokens": 6, "cache_read_input_tokens": 26285, "cache_creation_input_tokens": 590, "output_tokens": 113 } });
        assert_eq!(super::usage_line(&v).unwrap(), "claude: 3 passi, 28.7 s (modello 21.0 s), token: 6 nuovi, 26285 in cache, 590 scritti in cache, 113 in uscita, 0.041 $");
        assert!(super::usage_line(&serde_json::json!({ "type": "result" })).is_none());
    }

    #[test]
    fn login_errors_are_recognised() {
        assert!(super::needs_login("Invalid API key · Please run /login"));
        assert!(super::needs_login("Failed to authenticate: OAuth session expired and could not be refreshed"));
        assert!(super::needs_login("Not logged in"));
        assert!(!super::needs_login("Rate limit reached"));
    }

    #[test]
    fn where_claude_code_came_from() {
        use std::path::Path;
        assert_eq!(super::source_of(Path::new("C:/Users/x/.local/bin/claude.exe")), "cli");
        assert_eq!(super::source_of(Path::new("C:/Users/x/AppData/Roaming/npm/claude.cmd")), "cli");
        assert_eq!(super::source_of(Path::new("C:/Users/x/.vscode/extensions/anthropic.claude-code-2.1.288-win32-x64/resources/native-binary/claude.exe")), "vscode");
        assert_eq!(super::source_of(Path::new("C:/Users/x/AppData/Roaming/Claude/claude-code/2.1.286/claude.exe")), "desktop");
    }

    use super::{args, parse_output, step_line, terminal_args, tool_prefix, version_key, Connectors, Progress};
    use crate::settings::McpChoice;
    use std::path::Path;

    fn none() -> Connectors {
        Connectors { enabled: Vec::new(), disabled: Vec::new(), agent: false }
    }

    #[test]
    fn terminal_mode_has_every_tool_and_the_users_servers() {
        let c = Connectors {
            enabled: vec![McpChoice { name: "docs".into(), confirm: false }],
            disabled: vec!["altro".into()],
            agent: true,
        };
        let a = terminal_args(Path::new("C:/x"), "opus", Some("abc"), None, &c, false);
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert!(!a.contains(&"--tools".to_string()));
        assert!(!a.contains(&"--strict-mcp-config".to_string()));
        assert!(!a.contains(&"--disallowedTools".to_string()));
        assert_eq!(at("--permission-mode"), "default");
        assert_eq!(at("--output-format"), "stream-json");
        assert!(a.contains(&"--verbose".to_string()));
        let allowed = at("--allowedTools");
        assert!(allowed.starts_with("mcp__docs,mcp__easyisland__"));
        assert!(!allowed.contains("Bash"));
        assert_eq!(at("--resume"), "abc");
        let a = terminal_args(Path::new("C:/x"), "", None, None, &none(), true);
        assert_eq!(a[a.iter().position(|x| x == "--permission-mode").unwrap() + 1], "auto");
    }

    #[test]
    fn terminal_steps_and_text_as_shown() {
        let mut p = Progress::default();
        assert!(!p.feed(r#"{"type":"system","subtype":"init"}"#));
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Controllo."},{"type":"tool_use","name":"Bash","input":{"command":"git status"}}]}}"#));
        assert!(!p.feed(r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"text","text":"dentro"}]}}"#));
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__plugin_Notion_notion__notion-search","input":{}}]}}"#));
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Fatto."}]}}"#));
        assert_eq!(p.shown, "Controllo.\n\n> ⚙ Esegue · `git status`\n\n> ⚙ notion search (Notion notion)\n\nFatto.");
        // The reasoning shows under the rest until the next text or step.
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Sommo le  spese\ndi ottobre"}]}}"#));
        assert!(p.view().ends_with("> 💭 _Sommo le spese di ottobre_"));
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Totale."}]}}"#));
        assert!(!p.view().contains("💭"));
        assert_eq!(step_line("Edit", &serde_json::json!({ "file_path": "C:/a.txt" })), "> ⚙ Modifica · `C:/a.txt`");
    }

    #[test]
    fn args_resume_and_model_only_when_set() {
        let dir = Path::new("C:/x");
        let a = args(dir, "", None, None, &none());
        assert!(!a.contains(&"--model".to_string()));
        assert!(!a.contains(&"--resume".to_string()));
        assert!(a.contains(&"dontAsk".to_string()));
        assert!(a.contains(&"--strict-mcp-config".to_string()));

        let a = args(dir, "sonnet", Some("abc"), Some(Path::new("C:/inbox")), &none());
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(at("--model"), "sonnet");
        assert_eq!(at("--resume"), "abc");
        assert_eq!(at("--add-dir"), "C:/inbox");
    }

    #[test]
    fn bundled_versions_compare_numerically() {
        assert_eq!(version_key("2.1.286-win32-x64"), Some(vec![2, 1, 286]));
        assert_eq!(version_key("2.1.284"), Some(vec![2, 1, 284]));
        assert!(version_key("2.1.99") < version_key("2.1.100"));
        assert_eq!(version_key("latest"), None);
    }

    #[test]
    fn parses_the_json_result() {
        let out = "warning: something\n{\"type\":\"result\",\"is_error\":false,\"result\":\" Ciao! \",\"session_id\":\"s1\"}\n";
        let o = parse_output(out).unwrap();
        assert_eq!(o.text, "Ciao!");
        assert!(!o.is_error);
        assert_eq!(o.session_id.as_deref(), Some("s1"));

        let err = parse_output("{\"is_error\":true,\"result\":\"Not logged in\"}").unwrap();
        assert!(err.is_error);
        assert!(parse_output("nessun json").is_none());
    }

    #[test]
    fn connectors_change_permissions() {
        let c = Connectors {
            enabled: vec![
                McpChoice { name: "agenda".into(), confirm: true },
                McpChoice { name: "docs.read".into(), confirm: false },
            ],
            disabled: vec!["altro".into()],
            agent: false,
        };
        let a = args(Path::new("C:/x"), "", None, None, &c);
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert!(!a.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(at("--permission-mode"), "default");
        // Only the no-confirm server is pre-allowed; the other waits for the island.
        assert_eq!(at("--allowedTools"), "WebSearch,WebFetch,Read,mcp__docs_read");
        assert_eq!(at("--disallowedTools"), "mcp__altro");
        assert_eq!(tool_prefix("claude.ai Gmail"), "mcp__claude_ai_Gmail");
    }

    #[test]
    fn easyisland_tools_ride_along() {
        let c = Connectors { enabled: Vec::new(), disabled: vec!["altro".into()], agent: true };
        let a = args(Path::new("C:/x"), "", None, None, &c);
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(at("--permission-mode"), "default");
        assert!(at("--mcp-config").ends_with("chat-mcp.json"));
        // Only our server: the user's own stay out.
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        let allowed = at("--allowedTools");
        assert!(allowed.contains("mcp__easyisland__list_status"));
        // Anything that acts waits for the island.
        assert!(!allowed.contains("mcp__easyisland__open_app"));
        assert!(!allowed.contains("mcp__easyisland__run_quick_action"));
    }
}
