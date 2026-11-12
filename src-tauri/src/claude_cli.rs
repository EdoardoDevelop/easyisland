// Chat through the user's own Claude Code install (`claude -p`), so a Claude
// subscription covers it instead of a pay-as-you-go API key.
//
// The process runs hidden, in a neutral working folder, with:
//   * hooks kept out of the island: without connectors every hook is disabled
//     (`disableAllHooks`); EASYISLAND_INTERNAL makes easyisland-hook.exe ignore the
//     user's own EasyIsland hooks either way, so the chat never shows up as a
//     Claude Code work session;
//   * only WebSearch, WebFetch, Read and ToolSearch among the built-in tools;
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

use crate::claude::{BgTask, Chat, ChatContext, ChatReply, Later, OnTasks, OnWorking};
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

/// ToolSearch: Claude Code then loads the MCP tools (easyisland's ~100,
/// connectors) only when a question needs them. Without it every definition was
/// re-read at every step (measured 12 Nov 2026 on 2.1.318 and 2.1.322: «ok»
/// 34.8k → 9.9k tokens; a list_status question still works, one step more).
const TOOLS: &str = "WebSearch,WebFetch,Read,ToolSearch";

/// Modalità terminale: Claude Code's built-in tools a chat uses (files,
/// commands, web, skills, plan). Left out: Agent, Workflow, ScheduleWakeup,
/// ReportFindings, ListAgents, ShareOnboardingGuide, Cron…, worktrees: their
/// definitions alone were ~10k tokens re-read at every step (measured 12 Nov
/// 2026 on Claude Code 2.1.318: 31k → 23k for «ok»), and a sub-agent starts
/// its own context from zero. MCP tools (easyisland, connectors) are not affected.
const TERMINAL_TOOLS: &str =
    "Read,Write,Edit,Glob,Grep,Bash,PowerShell,Skill,ToolSearch,WebFetch,WebSearch,NotebookEdit,TodoWrite,ExitPlanMode,TaskStop,Monitor";

/// «Sotto-agenti» on in the chat (`Chat::agents`): Agent added to `--tools`.
fn with_agents(a: &mut [String]) {
    if let Some(i) = a.iter().position(|x| x == "--tools") {
        if let Some(v) = a.get_mut(i + 1) {
            if !v.split(',').any(|t| t == "Agent") {
                v.push_str(",Agent");
            }
        }
    }
}

/// The `easyisland` MCP server (`easyisland-hook mcp`, see agent.rs): its
/// tools that change nothing (or nothing outside EasyIsland), pre-allowed:
/// the read-only flag of hook/src/tool_list.rs, the one list. `show_card`
/// waits for a click by itself. Every other tool asks Consenti / Nega in the
/// island, unless the user allowed it for good (permits.rs).
pub(crate) fn agent_read_only() -> Vec<&'static str> {
    crate::claude::tool_list::tools().into_iter().filter(|t| t.3 && t.0 != "show_card").map(|t| t.0).collect()
}

pub(crate) const AGENT_PROMPT: &str = " You also have the easyisland tools, which act on the user's own PC: \
open programs, folders and links, run the user's quick actions (list_quick_actions, then run_quick_action) and make or change them when asked (quick_action_create, quick_action_update, quick_action_delete), \
read the status of the PC, network, weather, mail and tickets (list_status), read or fill the clipboard, control the music, show a notice in the island, \
browse the user's work folder (list_work_folder; read its files with Read) and move files of the tray into it (move_to_work_folder), read Word and PDF documents, one or a whole folder of them a page of files at a time (document_read: faster and cheaper than extracting the text with other programs), write new Word documents, also from the user's own templates, with the lines of a quote whose totals and VAT EasyIsland computes (document_templates, document_template_add, document_create), turn them into PDF with Word (document_pdf), merge, extract and split PDF pages into new files (pdf_merge, pdf_split), \
read and change EasyIsland's own settings (get_settings, then set_setting: default chat engine and model, integrations on or off, character, language, notifications…), work in the user's Notion through EasyIsland's own connection (notion_map for the structure, notion_search, notion_read, notion_query for the rows of a database, notion_add_row and notion_update_row, which check the values against the database, notion_delete_row to move a row to Notion's trash only after the user said yes in the chat), manage the user's Microsoft To Do through classic Outlook (todo_list, todo_add, todo_update), work on a remote PC the user connected in «Accesso remoto» and linked to the chat (remote_status, remote_run: one command at a time, PowerShell on Windows, sh on Linux), show files and web pages in EasyIsland's preview window next to the chat — the user's local dev server, a page you built, a file you changed — and check them: open a tab (preview_open: a URL, localhost:port or a file path; back, forward, reload), see the page as a tree of headings, texts and controls with refs (preview_snapshot), find the elements with some words and their refs (preview_find: much cheaper on a big page), read its text (preview_read), wait for something to appear (preview_wait), read the requests and the content of their answers, often the clean data of a search (preview_network with data_only, then body), take a screenshot (preview_screenshot, then read the PNG), read the console errors (preview_console), try it at phone or tablet size or in dark mode (preview_resize), and click or type in it by ref (preview_click, preview_type, which the user confirms), scroll it or hover (preview_scroll), and use a real mouse and keyboard: keys like Enter or Escape, typing that triggers suggestions, drop-downs, checkboxes, double and right clicks, drags (preview_act, confirmed); never buy, order or fill a cart; chain several of these in one call (preview_steps: far fewer steps and tokens); after changing a web page, open or reload it in the preview and check it before saying it works, keep the chat's memory (memory_search to look into notes, linked pages and past conversations, memory_note to remember something for next time, memory_page and memory_page_write for the pages about people, customers, projects and concepts, linked with [[Title]]), build the user's own integrations — forms with fields, tables and formulas, dashboards of data read from their services, calls to their APIs with keys they keep in Windows, documents and actions — when they ask for one (custom_create, custom_update, custom_get, custom_records, custom_add_record), hand a long job, or one for later or every day, to EasyIsland as a task it carries on by itself with a plan (task_create, task_list), and set up automations that then run by themselves (list_automations, create_automation, set_automation_enabled): when the user asks for something recurring \
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

const SYSTEM_PROMPT: &str = "You are the user's personal assistant in the chat of the EasyIsland desktop app. \
You are not working on a codebase here: never try to edit files or run commands. \
Use WebSearch and WebFetch when the question needs current or external information, and Read to look at a file the user attached. \
Every step re-reads the whole conversation: call independent tools together in the same step, and use queries, titles and notes \
of memory_search, memory_page and memory_note for several at once; load all the deferred tools you will need with one ToolSearch \
(select:name1,name2,...). \
Respond in Italian unless the user writes in another language. Be thorough and complete: use as much detail as the task requires. \
Markdown is rendered: use lists, tables and code blocks when they help.";

/// "Modalità terminale": Claude Code's own system prompt stays (it is the one of
/// the terminal); this goes after it. `{folder}` is the working folder.
const TERMINAL_PROMPT: &str = "You are working on the user's Windows PC from the chat of the EasyIsland desktop app, \
as Claude Code does in a terminal: run commands (PowerShell or Bash), read and edit files, use the user's MCP servers and skills. \
The working folder is {folder}; work elsewhere on the PC when the user asks. \
Every command or change that Claude Code would ask about in a terminal waits for the user's click on Consenti / Nega: \
a refusal is final for that request. Nobody can type into a running command: never start interactive programs \
(text interfaces, editors, logins or prompts that wait for input); tell the user to run those in their own terminal. \
Sub-agents and commands may run in parallel and in the background: the chat lists them to the user with a button to stop them, \
the user can keep writing to you meanwhile, and what you write when they end appears in the chat by itself with a notice. \
So when background work ends, write the finished result the user asked for (not only how much is done), \
and never promise to warn the user in some other way. \
Every step (each round of tool calls) re-reads the whole conversation, so make few steps and do more in each: \
call independent tools together in the same step; load all the deferred tools you will need with one ToolSearch \
(select:name1,name2,...); use queries, titles and notes of memory_search, memory_page and memory_note for several at once; \
save memory notes together at the end of the work, not one per step; read only the part of a long file you need. \
When an EasyIsland tool does the job, use it instead of a command or of Read: document_read for Word and PDF files and whole folders of them, \
list_status, memory_*, notion_*, todo_*, preview_* and the others: they give the result already clean, faster and with fewer tokens. \
To look at files and folders use Read, Glob and Grep, not commands: they need no click, a command does. \
Spend tokens where they matter: a sub-agent that only reads, searches, extracts or summarizes gets model \"sonnet\" in the Agent tool \
(your own model stays for planning, deciding and writing the answer); brief it fully, since it sees nothing of this chat, \
and ask for a compact report (facts, names, amounts, dates, differences; never copied text). \
Prefer a few sub-agents with a large share each to many small ones, and do not read again what a sub-agent already reported. \
While others are still running, answer a sub-agent's report with one short line at most. \
Respond in Italian unless the user writes in another language. Be thorough and complete: \
use as much detail as the task requires. Markdown is rendered.";

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

/// The folders Claude Code has worked in, from its own list. Only their names:
/// the rest of the file is not read into anything.
pub(crate) fn claude_projects() -> Vec<PathBuf> {
    let Some(text) = claude_json_path().and_then(|p| std::fs::read_to_string(p).ok()) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    v.get("projects").and_then(Value::as_object).map(|m| m.keys().map(PathBuf::from).collect()).unwrap_or_default()
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
pub(crate) fn claude_dir() -> Option<PathBuf> {
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
        // Claude Code's own skills for programmers (code-review, loop, dataviz, init…):
        // their list was ~2k tokens re-read at every step. The user's skills and
        // the claude.ai ones (docx, pdf, xlsx) stay. 12 Nov 2026.
        "disableBundledSkills": true,
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

/// How much of a tool's result Claude Code takes in one piece (`command`).
const MCP_OUTPUT_TOKENS: &str = "50000";

pub(crate) fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    // If EasyIsland itself was started from inside a Claude Code session (e.g.
    // `npm run tauri dev` run by Claude), these would make the chat attach to
    // that session instead of its own.
    for var in INHERITED_SESSION_VARS {
        cmd.env_remove(var);
    }
    // A tool's result over Claude Code's limit (25.000 token) goes to a file
    // the model then reads again in pieces: more calls, more tokens. A folder
    // of document_read (documents.rs FOLDER_BUDGET) fits in one piece.
    if std::env::var_os("MAX_MCP_OUTPUT_TOKENS").is_none() {
        cmd.env("MAX_MCP_OUTPUT_TOKENS", MCP_OUTPUT_TOKENS);
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
        "--include-partial-messages".into(),
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

/// A helper of «Multi motore» (team.rs): `dontAsk` refuses what is not listed,
/// with no card for the user; on the list only what reads.
fn read_only(a: &mut Vec<String>) {
    const READS: &str = "Read,Grep,Glob,WebSearch,WebFetch,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)";
    match a.iter().position(|x| x == "--permission-mode") {
        Some(i) if i + 1 < a.len() => "dontAsk".clone_into(&mut a[i + 1]),
        _ => a.extend(["--permission-mode".into(), "dontAsk".into()]),
    }
    match a.iter().position(|x| x == "--allowedTools") {
        Some(i) if i + 1 < a.len() => a[i + 1] = format!("{},{READS}", a[i + 1]),
        _ => a.extend(["--allowedTools".into(), READS.into()]),
    }
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
        "--include-partial-messages".into(),
        "--settings".into(),
        dir.join("chat-settings.json").to_string_lossy().into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("chat-prompt.txt").to_string_lossy().into_owned(),
        "--permission-mode".into(),
        if auto { "auto".into() } else { "default".into() },
        "--tools".into(),
        TERMINAL_TOOLS.into(),
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
    /// The text block being written, word by word.
    writing: String,
    /// Commands and sub-agents still running in the background
    /// (`background_tasks_changed`): when one ends Claude Code starts another
    /// turn by itself (`follow`).
    tasks: Vec<BgTask>,
    /// The list changed with the last line.
    tasks_changed: bool,
    /// A tool call being written (its input streams before it runs: a page of
    /// memory, a file): its step and the characters so far.
    drafting: Option<(String, usize)>,
    /// Reasoning whose text Claude Code does not send (only `thinking_tokens`).
    pondering: bool,
    /// Tokens in the context at the last call to the model: the result's own
    /// `usage` adds up every step of the turn, this is what the model last read.
    context: u64,
    /// `/compact` ran (its `compact_boundary`): tokens before and after.
    compacted: Option<(u64, u64)>,
    /// Claude Code's task list (TodoWrite) as it is now: under the steps, as
    /// Claude Desktop shows it beside the conversation.
    todos: String,
    /// The conversation (the `Chat`'s address; 0 = none): files about to change
    /// are kept for «⟲ File» (checkpoints.rs).
    chat: usize,
    /// The sub-agents started in this turn: their call's id and description,
    /// so their own steps show under them (as Claude Desktop shows them).
    agents: Vec<(String, String)>,
}

impl Progress {
    /// One line of the stream; true when what is shown changed.
    fn feed(&mut self, line: &str) -> bool {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { return false };
        if v.get("subtype").and_then(Value::as_str) == Some("background_tasks_changed") {
            let s = |t: &Value, k: &str| t.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            self.tasks = v.get("tasks").and_then(Value::as_array).into_iter().flatten().map(|t| BgTask { id: s(t, "task_id"), kind: s(t, "task_type"), description: s(t, "description") }).collect();
            self.tasks_changed = true;
            return false;
        }
        // Claude Code reports how much it reasons, not the text: the island
        // shows its waiting phrases meanwhile.
        if v.get("subtype").and_then(Value::as_str) == Some("thinking_tokens") {
            let was = self.pondering;
            self.pondering = self.thinking.is_empty() && self.drafting.is_none();
            return self.pondering != was;
        }
        // `/compact` (or Claude Code compacting by itself): the context is now the summary.
        if v.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
            let n = |k: &str| v.pointer(&format!("/compact_metadata/{k}")).and_then(Value::as_u64).unwrap_or(0);
            let (pre, post) = (n("pre_tokens"), n("post_tokens"));
            self.compacted = Some((pre, post));
            if post > 0 {
                self.context = post;
            }
            return false;
        }
        // A sub-agent's own steps: one line each, under its name.
        if let Some(parent) = v.get("parent_tool_use_id").and_then(Value::as_str) {
            return self.agent_step(parent, &v);
        }
        match v.get("type").and_then(Value::as_str) {
            Some("stream_event") => return self.delta(&v),
            // What a step gave back (a command's output, a file read): under it, folded.
            Some("user") => return self.step_result(&v),
            Some("assistant") => {
                if let Some(used) = context_used(&v) {
                    self.context = used;
                }
            }
            _ => return false,
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
                Some("tool_use") if block.get("name").and_then(Value::as_str) == Some("TodoWrite") => {
                    self.todos = todo_list(block.get("input").unwrap_or(&Value::Null));
                    self.drafting = None;
                    changed = true;
                    None
                }
                Some("tool_use") => {
                    let (name, input) = (block.get("name").and_then(Value::as_str).unwrap_or_default(), block.get("input").unwrap_or(&Value::Null));
                    if matches!(name, "Task" | "Agent") {
                        let id = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                        let what = input.get("description").and_then(Value::as_str).unwrap_or_default().to_string();
                        self.agents.push((id, what));
                    }
                    // A file about to change: «Modifiche» and the preview (preview.rs), and its checkpoint.
                    crate::preview::touched_by(name, input);
                    if self.chat != 0 && matches!(name, "Edit" | "Write" | "MultiEdit" | "NotebookEdit") {
                        if let Some(p) = ["file_path", "notebook_path"].iter().find_map(|k| input.get(*k).and_then(Value::as_str)).map(Path::new).filter(|p| p.is_absolute()) {
                            crate::checkpoints::touching(self.chat, p);
                        }
                    }
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
                self.writing.clear();
                self.drafting = None;
                self.pondering = false;
                changed = true;
            }
        }
        changed
    }
}

/// A step's output under it: this many lines at most, and characters.
const RESULT_LINES: usize = 30;
const RESULT_CHARS: usize = 2_500;

impl Progress {
    fn push_piece(&mut self, piece: &str) {
        if !self.shown.is_empty() {
            self.shown.push_str("\n\n");
        }
        self.shown.push_str(piece);
        self.thinking.clear();
        self.writing.clear();
        self.drafting = None;
        self.pondering = false;
    }

    /// A `user` line with `tool_result` blocks: each output as an «esito» block
    /// (views/typeline.ts folds it under its step).
    fn step_result(&mut self, v: &Value) -> bool {
        let mut changed = false;
        for block in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let text = match block.get("content") {
                Some(Value::String(t)) => t.clone(),
                Some(Value::Array(parts)) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
                _ => String::new(),
            };
            let text = text.trim();
            // The task list's own receipt says nothing (the list is shown already).
            if text.is_empty() || text.starts_with("Todos have been modified") {
                continue;
            }
            let failed = block.get("is_error").and_then(Value::as_bool) == Some(true);
            let piece = result_block(text, failed);
            self.push_piece(&piece);
            changed = true;
        }
        changed
    }

    /// A sub-agent's tool call: «↳ <agent> · <step>».
    fn agent_step(&mut self, parent: &str, v: &Value) -> bool {
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            return false;
        }
        let who = self.agents.iter().find(|(id, _)| id == parent).map(|(_, d)| d.clone()).unwrap_or_else(|| t("Sotto-agente").to_string());
        let mut changed = false;
        for block in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
            let step = step_line(name, block.get("input").unwrap_or(&Value::Null));
            let step = step.trim_start_matches("> ⚙ ").to_string();
            let piece = format!("> ⚙ ↳ {} · {step}", who.replace('`', "'"));
            self.push_piece(&piece);
            changed = true;
        }
        changed
    }
}

/// A step's output as a fenced «esito» block, cut to its first lines.
fn result_block(text: &str, failed: bool) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut body: String = lines.iter().take(RESULT_LINES).copied().collect::<Vec<_>>().join("\n");
    if body.chars().count() > RESULT_CHARS {
        body = body.chars().take(RESULT_CHARS).collect();
    }
    let cut = lines.len().saturating_sub(RESULT_LINES);
    if cut > 0 {
        body.push_str(&format!("\n… {}", tf("(altre {n} righe)", &[("n", &cut)])));
    } else if body.chars().count() < text.chars().count() {
        body.push('…');
    }
    // A fence inside would close the block.
    let body = body.replace("```", "'''");
    format!("```{}\n{body}\n```", if failed { "errore" } else { "esito" })
}

impl Progress {
    /// A piece of the block being written (`--include-partial-messages`); the
    /// whole block follows as an `assistant` line and takes its place.
    fn delta(&mut self, v: &Value) -> bool {
        // A block starts: a tool call's input streams before the call is shown.
        if v.pointer("/event/type").and_then(Value::as_str) == Some("content_block_start") {
            let block = v.pointer("/event/content_block");
            return match block.and_then(|b| b.get("type")).and_then(Value::as_str) {
                Some("tool_use") => {
                    let name = block.and_then(|b| b.get("name")).and_then(Value::as_str).unwrap_or_default();
                    self.drafting = Some((step_line(name, &Value::Null), 0));
                    self.pondering = false;
                    true
                }
                Some("thinking") | Some("redacted_thinking") => {
                    self.drafting = None;
                    self.pondering = self.thinking.is_empty();
                    true
                }
                _ => {
                    self.drafting = None;
                    false
                }
            };
        }
        if v.pointer("/event/type").and_then(Value::as_str) != Some("content_block_delta") {
            return false;
        }
        if v.pointer("/event/delta/type").and_then(Value::as_str) == Some("input_json_delta") {
            let n = v.pointer("/event/delta/partial_json").and_then(Value::as_str).map_or(0, |s| s.chars().count());
            if let Some(d) = self.drafting.as_mut() {
                d.1 += n;
                return n > 0;
            }
            return false;
        }
        let piece = |key: &str| v.pointer("/event/delta").and_then(|d| d.get(key)).and_then(Value::as_str).unwrap_or_default();
        match v.pointer("/event/delta/type").and_then(Value::as_str) {
            Some("text_delta") if !piece("text").is_empty() => {
                self.writing.push_str(piece("text"));
                self.thinking.clear();
                self.pondering = false;
                true
            }
            Some("thinking_delta") if !piece("thinking").is_empty() => {
                self.thinking.push_str(piece("thinking"));
                true
            }
            _ => false,
        }
    }

    /// What the turn showed, with its task list at the end (its last state).
    fn done(&self) -> String {
        match (self.shown.is_empty(), self.todos.is_empty()) {
            (_, true) => self.shown.clone(),
            (true, false) => self.todos.clone(),
            (false, false) => format!("{}\n\n{}", self.shown, self.todos),
        }
    }

    /// What is shown while the turn goes on.
    fn view(&self) -> String {
        let mut text = self.done();
        let writing = self.writing.trim();
        if !writing.is_empty() {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(writing);
        }
        // The step being written, with how far it got (the line under the reply).
        let extra = match &self.drafting {
            Some((step, n)) if *n > 0 => Some(format!("{step} · {}", tf("{n} caratteri", &[("n", &thousands(*n))]))),
            Some((step, _)) => Some(step.clone()),
            // Reasoning with no text to show: the waiting phrases (typeline.ts splitStatus).
            None if self.pondering && self.thinking.trim().is_empty() => Some("> 💭".to_string()),
            None => None,
        };
        if let Some(line) = extra {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(&line);
            return text;
        }
        crate::opencode::with_thinking(text, &self.thinking)
    }
}

/// TodoWrite's list: done, at work (its «activeForm»), to do.
fn todo_list(input: &Value) -> String {
    let items = input.get("todos").and_then(Value::as_array).cloned().unwrap_or_default();
    if items.is_empty() {
        return String::new();
    }
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().trim().replace('\n', " ");
    let done = items.iter().filter(|v| s(v, "status") == "completed").count();
    let mut out = format!("**{}** {done}/{}", t("Attività"), items.len());
    for v in &items {
        let line = match s(v, "status").as_str() {
            "completed" => format!("- ✅ {}", s(v, "content")),
            "in_progress" => format!("- ▶️ **{}**", Some(s(v, "activeForm")).filter(|a| !a.is_empty()).unwrap_or_else(|| s(v, "content"))),
            _ => format!("- ⬜ {}", s(v, "content")),
        };
        out.push('\n');
        out.push_str(&line);
    }
    out
}

/// 12345 → "12.345".
fn thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    out
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
/// `on_session`: the session as soon as Claude Code names it (its `init` line),
/// so a turn stopped halfway (Ferma, «Invia subito») is resumed, not lost.
async fn read_lines(
    lines: &mut OutLines,
    on_text: &(dyn Fn(&str) + Sync),
    on_session: &(dyn Fn(&str) + Sync),
    on_context: &(dyn Fn(u64, u64) + Sync),
    on_tasks: &(dyn Fn(&[BgTask]) + Sync),
    limit: Duration,
    late: &str,
    until_result: bool,
    running: &[BgTask],
    chat: usize,
) -> Result<(String, String, bool, Vec<BgTask>), String> {
    // What already runs in the background stays listed until Claude Code says otherwise.
    let mut progress = Progress { tasks: running.to_vec(), chat, ..Progress::default() };
    let mut last = String::new();
    let mut emitted = std::time::Instant::now();
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Err(_) => return Err(late.to_string()),
            Ok(Err(e)) => return Err(tf("Claude Code si è interrotto: {e}", &[("e", &e)])),
            Ok(Ok(None)) => return Ok((last, progress.done(), false, progress.tasks)),
            Ok(Ok(Some(line))) => {
                if !line.trim_start().starts_with('{') {
                    continue;
                }
                if let Some(id) = init_session(&line) {
                    on_session(&id);
                    remember_commands(&line);
                    if chat != 0 {
                        remember_fast(chat, &line);
                    }
                }
                if progress.feed(&line) && emitted.elapsed() >= STREAM_EVERY {
                    emitted = std::time::Instant::now();
                    on_text(&progress.view());
                }
                if std::mem::take(&mut progress.tasks_changed) {
                    on_tasks(&progress.tasks);
                }
                let result = line.contains("\"type\":\"result\"") && serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("type").and_then(Value::as_str).map(|t| t == "result")) == Some(true);
                // `/compact` answers with no text: the chat says what it did.
                let line = match progress.compacted.take().filter(|_| result) {
                    Some((pre, post)) => compacted_result(&line, pre, post),
                    None => line,
                };
                if result && progress.context > 0 {
                    on_context(progress.context, context_size(&line));
                }
                // The pieces of a block are not what the turn ended on.
                if !line.trim_start().starts_with("{\"type\":\"stream_event\"") {
                    last = line;
                }
                if result && until_result {
                    return Ok((last, progress.done(), true, progress.tasks));
                }
            }
        }
    }
}

/// The `result` line of a `/compact`, with what it did as its text (Claude Code leaves it empty).
fn compacted_result(line: &str, pre: u64, post: u64) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(line.trim()) else { return line.to_string() };
    if v.get("result").and_then(Value::as_str).is_some_and(|r| !r.trim().is_empty()) {
        return line.to_string();
    }
    let text = if pre > 0 && post > 0 {
        tf("📦 Conversazione compattata: il contesto passa da {pre} a {post} token. Claude Code continua da un riassunto di quanto detto.", &[("pre", &thousands(pre as usize)), ("post", &thousands(post as usize))])
    } else {
        t("📦 Conversazione compattata: Claude Code continua da un riassunto di quanto detto.").to_string()
    };
    v["result"] = Value::String(text);
    v.to_string()
}

/// What a model call read: the new tokens and those from the cache.
fn context_used(v: &Value) -> Option<u64> {
    let u = v.pointer("/message/usage")?;
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    Some(n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens")).filter(|t| *t > 0)
}

/// The size of the context, from the `result` line: the largest of the models
/// used (a sub-agent may have run on a smaller one); 0 when it does not say.
fn context_size(line: &str) -> u64 {
    let v: Value = serde_json::from_str(line.trim()).unwrap_or_default();
    v.get("modelUsage").and_then(Value::as_object).into_iter().flatten()
        .filter_map(|(_, m)| m.get("contextWindow").and_then(Value::as_u64))
        .max().unwrap_or(0)
}

/// `--settings <file>` becomes the same settings with `"fastMode": true`, as JSON.
fn with_fast(a: &mut Vec<String>) {
    match a.iter().position(|x| x == "--settings") {
        Some(i) => {
            let Some(file) = a.get(i + 1).cloned() else { return };
            let mut v: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| serde_json::json!({}));
            if let Some(o) = v.as_object_mut() {
                o.insert("fastMode".into(), Value::Bool(true));
            }
            if let Some(slot) = a.get_mut(i + 1) {
                *slot = v.to_string();
            }
        }
        None => a.extend(["--settings".into(), r#"{"fastMode":true}"#.into()]),
    }
}

/// Why fast mode is off, by conversation (the `Chat`'s address), from the last `init` line.
static FAST_OFF: std::sync::Mutex<Vec<(usize, String)>> = std::sync::Mutex::new(Vec::new());

fn remember_fast(chat: usize, line: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { return };
    let why = v.get("fast_mode_disabled_reason").and_then(Value::as_str).unwrap_or_default().to_string();
    let on = v.get("fast_mode_state").and_then(Value::as_str) == Some("on");
    let mut all = FAST_OFF.lock().unwrap();
    all.retain(|(c, _)| *c != chat);
    if !on && !why.is_empty() {
        all.push((chat, why));
    }
}

/// Fast mode asked for and refused by Claude Code: why, in words (once per turn).
pub fn fast_refused(chat: usize) -> Option<String> {
    let why = FAST_OFF.lock().unwrap().iter().find(|(c, _)| *c == chat).map(|(_, w)| w.clone())?;
    Some(match why.as_str() {
        "extra_usage_disabled" => t("Il fast mode di Claude Code non è attivo: sul tuo account Claude serve l'uso extra (claude.ai → Impostazioni → Utilizzo).").to_string(),
        "sdk_opt_in_required" => t("Il fast mode di Claude Code non è disponibile in questa modalità.").to_string(),
        other => tf("Il fast mode di Claude Code non è attivo ({why}).", &[("why", &other)]),
    })
}

/// Claude Code's slash commands (its own, the user's in `.claude/commands`,
/// skills, plugins), as its `init` line lists them: the chat's «/» menu shows
/// them, as Claude Desktop does. Kept in `claude-comandi.json` for the next start.
static COMMANDS: std::sync::Mutex<Option<Vec<String>>> = std::sync::Mutex::new(None);

fn commands_file() -> PathBuf {
    crate::settings::local_dir().join("claude-comandi.json")
}

/// Those of the `init` line, when it has them.
fn remember_commands(line: &str) {
    let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { return };
    let Some(list) = v.get("slash_commands").and_then(Value::as_array) else { return };
    // Internal ones ("__…") and those that only make sense in a terminal stay out.
    let names: Vec<String> = list.iter().filter_map(Value::as_str).filter(|n| !n.starts_with('_') && !matches!(*n, "heapdump" | "color" | "clear")).map(str::to_string).collect();
    let mut known = COMMANDS.lock().unwrap();
    if known.as_ref() != Some(&names) {
        let _ = std::fs::write(commands_file(), serde_json::to_vec(&names).unwrap_or_default());
        *known = Some(names);
    }
}

/// The chat's «/» menu with Claude Code (lib.rs `chat_claude_commands`).
pub fn commands() -> Vec<String> {
    let mut known = COMMANDS.lock().unwrap();
    known.get_or_insert_with(|| std::fs::read(commands_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()).clone()
}

/// The session named by Claude Code's `{"type":"system","subtype":"init",…}` line.
fn init_session(line: &str) -> Option<String> {
    if !line.contains("\"init\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("system") || v.get("subtype").and_then(Value::as_str) != Some("init") {
        return None;
    }
    v.get("session_id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

/// One process, one turn: the output to its end. Back: the last JSON line
/// (the result), what was shown, stderr, and the exit.
async fn read_stream(
    child: &mut tokio::process::Child,
    on_text: &(dyn Fn(&str) + Sync),
    on_session: &(dyn Fn(&str) + Sync),
    on_context: &(dyn Fn(u64, u64) + Sync),
    limit: Duration,
    late: &str,
    chat: usize,
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
    let (last, shown, _, _) = match read_lines(&mut lines, on_text, on_session, on_context, &|_| {}, limit, late, false, &[], chat).await {
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
    stdin: std::sync::Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
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

/// The conversation's kept process goes (desktop.rs: its session moves to Claude Desktop).
pub(crate) fn drop_live(chat: &Chat) {
    let id = chat as *const Chat as usize;
    stop_background(id);
    let mut all = LIVE.lock().unwrap();
    for l in all.iter_mut().filter(|l| l.chat == id) {
        let _ = l.child.start_kill();
    }
    all.retain(|l| l.chat != id);
}

/// At the app's exit (lib.rs): the kept processes go with it.
pub fn shutdown() {
    stop_background(0);
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
    let stdin = std::sync::Arc::new(tokio::sync::Mutex::new(stdin));
    Ok(Live { child, stdin, lines: tokio::io::BufReader::new(stdout).lines(), stderr, chat, print, session: String::new(), used: std::time::Instant::now() })
}

/// One message to a kept process. Err(None): the process was gone (start another).
async fn live_turn(
    live: &mut Live,
    prompt: &str,
    on_text: &(dyn Fn(&str) + Sync),
    on_session: &(dyn Fn(&str) + Sync),
    on_context: &(dyn Fn(u64, u64) + Sync),
    on_tasks: &(dyn Fn(&[BgTask]) + Sync),
    later: Option<&Later>,
    limit: Duration,
    late: &str,
) -> Result<(String, String, Vec<BgTask>), Option<String>> {
    let line = serde_json::json!({ "type": "user", "message": { "role": "user", "content": prompt } }).to_string();
    {
        let mut w = live.stdin.lock().await;
        if w.write_all(format!("{line}\n").as_bytes()).await.is_err() || w.flush().await.is_err() {
            return Err(None);
        }
    }
    // While it answers, a message written in the chat goes to it at once (`steer`).
    let _steering = Steering::on(live.chat, live.stdin.clone());
    let deadline = std::time::Instant::now() + limit;
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match read_lines(&mut live.lines, on_text, on_session, on_context, on_tasks, left, late, true, &[], live.chat).await {
            // A turn Claude Code started by itself for work that ended (a resumed
            // session reports one even for work stopped with its old process):
            // not the answer to this message; its text, if any, comes as an update.
            Ok((last, _, true, _)) if from_background(&last) => {
                let text = parse_output(&last).filter(|o| !o.is_error).map(|o| o.text).unwrap_or_default();
                if let (Some(later), false) = (later, text.trim().is_empty()) {
                    later(text);
                }
            }
            Ok((last, shown, true, tasks)) => return Ok((last, shown, tasks)),
            Ok((_, _, false, _)) => return Err(None),
            Err(e) => return Err(Some(e)),
        }
    }
}

/// The processes answering a message now, by conversation: a message written
/// meanwhile goes to Claude Code at once and it takes it into the turn it is
/// in, between two steps (as in Claude Desktop; tried on 8 Nov 2026: one
/// answer, «FATTO BANANA», to both).
type Stdin = std::sync::Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>;
static STEERING: std::sync::Mutex<Vec<(usize, Stdin)>> = std::sync::Mutex::new(Vec::new());

struct Steering(usize);

impl Steering {
    fn on(chat: usize, stdin: Stdin) -> Self {
        STEERING.lock().unwrap().push((chat, stdin));
        Steering(chat)
    }
}

impl Drop for Steering {
    fn drop(&mut self) {
        let mut all = STEERING.lock().unwrap();
        if let Some(i) = all.iter().rposition(|(c, _)| *c == self.0) {
            all.remove(i);
        }
    }
}

/// A message for the turn in progress of `chat`; false when no turn of
/// Claude Code is answering (the chat queues it as before).
pub async fn steer(chat: usize, text: &str) -> bool {
    let Some(stdin) = STEERING.lock().unwrap().iter().rev().find(|(c, _)| *c == chat).map(|(_, s)| s.clone()) else { return false };
    let line = serde_json::json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string();
    let mut w = stdin.lock().await;
    let ok = w.write_all(format!("{line}\n").as_bytes()).await.is_ok() && w.flush().await.is_ok();
    if ok {
        crate::log::line("claude: messaggio aggiunto al turno in corso".to_string());
    }
    ok
}

/// Turns Claude Code still has lined up after this result (`queued_turn_count`):
/// background work that ended while it was writing.
fn queued_turns(line: &str) -> u64 {
    serde_json::from_str::<Value>(line.trim()).ok().and_then(|v| v.get("queued_turn_count").and_then(Value::as_u64)).unwrap_or(0)
}

/// A result line of a turn Claude Code started by itself when background work
/// ended, not of a message sent to it: it has an `origin` ("task-notification"
/// for a command, "peer" for a sub-agent's report, 8 Nov 2026); a message's has none.
fn from_background(line: &str) -> bool {
    line.contains("\"origin\"")
        && serde_json::from_str::<Value>(line.trim()).ok().and_then(|v| v.pointer("/origin/kind").and_then(Value::as_str).map(|k| k != "user")) == Some(true)
}

/// How long a turn's background work is waited for, in all.
const FOLLOW_MAX: Duration = Duration::from_secs(3 * 3600);

/// What the follower tells the message that went in while it waits.
enum Ev {
    Text(String),
    /// The turn's result, what was shown and the work still in the background;
    /// Err(None): the process is gone.
    Done(Result<(String, String, Vec<BgTask>), Option<String>>),
}

/// A conversation whose process has work in the background: the follower
/// reads its output; a new message goes in through `stdin` (`through`) and
/// gets the next answer, so one conversation never has two processes.
struct Following {
    chat: usize,
    print: String,
    session: String,
    stdin: std::sync::Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    waiting: Option<tokio::sync::mpsc::UnboundedSender<Ev>>,
    kill: std::sync::Arc<tokio::sync::Notify>,
    /// The context at the last result read by the follower (the chat's meter).
    context: std::sync::Arc<std::sync::Mutex<Option<(u64, u64)>>>,
}

static FOLLOWING: std::sync::Mutex<Vec<Following>> = std::sync::Mutex::new(Vec::new());

/// Ferma with nothing being answered, a closed conversation, the app's exit:
/// the background work of `chat` (0 = all) ends with its process.
pub(crate) fn stop_background(chat: usize) -> bool {
    let all = FOLLOWING.lock().unwrap();
    let mut any = false;
    for f in all.iter().filter(|f| chat == 0 || f.chat == chat) {
        f.kill.notify_one();
        any = true;
    }
    any
}

/// Stops the process if the message's turn is dropped halfway (Ferma).
struct KillOnDrop {
    kill: std::sync::Arc<tokio::sync::Notify>,
    armed: bool,
}

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.kill.notify_one();
        }
    }
}

/// A message to a conversation whose process is being followed. None: no
/// follower fits (start or take a kept process as usual).
async fn through(
    chat: usize,
    print: &str,
    session: Option<&str>,
    prompt: &str,
    on_text: &(dyn Fn(&str) + Sync),
    on_context: &(dyn Fn(u64, u64) + Sync),
    limit: Duration,
    late: &str,
) -> Option<Result<(String, String, Vec<BgTask>), Option<String>>> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let (stdin, kill, context) = {
        let mut all = FOLLOWING.lock().unwrap();
        let f = all.iter_mut().find(|f| f.chat == chat && f.print == print && Some(f.session.as_str()) == session && f.waiting.is_none())?;
        f.waiting = Some(tx);
        (f.stdin.clone(), f.kill.clone(), f.context.clone())
    };
    // Only what this message's turn reads.
    *context.lock().unwrap() = None;
    let mut guard = KillOnDrop { kill, armed: true };
    let _steering = Steering::on(chat, stdin.clone());
    let line = serde_json::json!({ "type": "user", "message": { "role": "user", "content": prompt } }).to_string();
    {
        let mut w = stdin.lock().await;
        if w.write_all(format!("{line}\n").as_bytes()).await.is_err() || w.flush().await.is_err() {
            guard.armed = false;
            return Some(Err(None));
        }
    }
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Err(_) => return Some(Err(Some(late.to_string()))),
            Ok(None) => {
                guard.armed = false;
                return Some(Err(None));
            }
            Ok(Some(Ev::Text(t))) => on_text(&t),
            Ok(Some(Ev::Done(r))) => {
                guard.armed = false;
                if let Some((used, size)) = *context.lock().unwrap() {
                    on_context(used, size);
                }
                return Some(r);
            }
        }
    }
}

/// A turn ended with work still running in the background: when a piece ends
/// Claude Code starts another turn by itself, and its answer goes to `later`
/// (the island's chat and Agent Chat post it in the conversation). A message
/// written meanwhile goes to this same process (`through`). Back among the
/// kept processes once nothing runs and nobody waits.
fn follow(live: Live, later: Option<Later>, on_tasks: Option<OnTasks>, on_working: Option<OnWorking>, tasks: Vec<BgTask>) {
    let Live { mut child, stdin, mut lines, stderr: _, chat, print, session, used: _ } = live;
    let kill = std::sync::Arc::new(tokio::sync::Notify::new());
    let context = std::sync::Arc::new(std::sync::Mutex::new(None));
    FOLLOWING.lock().unwrap().push(Following { chat, print: print.clone(), session: session.clone(), stdin: stdin.clone(), waiting: None, kill: kill.clone(), context: context.clone() });
    let tell = move |t: &[BgTask]| {
        if let Some(f) = &on_tasks {
            f(t);
        }
    };
    let working = move |w: Option<&str>| {
        if let Some(f) = &on_working {
            f(w);
        }
    };
    tauri::async_runtime::spawn(async move {
        let start = std::time::Instant::now();
        let mut tasks = tasks;
        let mut queued: u64;
        crate::log::line(format!("claude: {} lavori in background, aspetto che finiscano", tasks.len()));
        let waiting = |take: bool| -> Option<tokio::sync::mpsc::UnboundedSender<Ev>> {
            let mut all = FOLLOWING.lock().unwrap();
            let f = all.iter_mut().find(|f| f.chat == chat && std::sync::Arc::ptr_eq(&f.kill, &kill))?;
            if take { f.waiting.take() } else { f.waiting.clone() }
        };
        let leave = |reason: &str| {
            crate::log::line(format!("claude: {reason}"));
            FOLLOWING.lock().unwrap().retain(|f| !std::sync::Arc::ptr_eq(&f.kill, &kill));
        };
        let mut idle = false;
        loop {
            // A sub-agent may report a moment after the list emptied: the
            // follower stays with the process while the conversation lives, so
            // a late report still reaches the chat (and messages go `through`).
            let left = if idle { Some(LIVE_IDLE) } else { FOLLOW_MAX.checked_sub(start.elapsed()) };
            let Some(left) = left else {
                let _ = child.start_kill();
                if let Some(w) = waiting(true) {
                    let _ = w.send(Ev::Done(Err(None)));
                }
                tell(&[]);
                leave("lavori in background oltre il limite, processo chiuso");
                return;
            };
            // The user's message gets the text; a turn Claude Code started by
            // itself shows in the chat as one at work.
            let forward = |text: &str| match waiting(false) {
                Some(w) => {
                    let _ = w.send(Ev::Text(text.to_string()));
                }
                None => working(Some(text)),
            };
            let started = |_: &str| {
                if waiting(false).is_none() {
                    working(Some(""));
                }
            };
            let tell_now = |t: &[BgTask]| tell(t);
            let running = tasks.clone();
            let keep_context = |used: u64, size: u64| *context.lock().unwrap() = Some((used, size));
            let mut read = std::pin::pin!(read_lines(&mut lines, &forward, &started, &keep_context, &tell_now, left, "", true, &running, chat));
            let mut stop = std::pin::pin!(kill.notified());
            let outcome = std::future::poll_fn(|cx| {
                if let std::task::Poll::Ready(r) = std::future::Future::poll(read.as_mut(), cx) {
                    return std::task::Poll::Ready(Some(r));
                }
                if std::future::Future::poll(stop.as_mut(), cx).is_ready() {
                    return std::task::Poll::Ready(None);
                }
                std::task::Poll::Pending
            })
            .await;
            match outcome {
                None => {
                    let _ = child.start_kill();
                    if let Some(w) = waiting(true) {
                        let _ = w.send(Ev::Done(Err(Some(crate::stopped_text()))));
                    }
                    working(None);
                    tell(&[]);
                    leave("lavori in background fermati");
                    return;
                }
                Some(Ok((last, shown, true, still))) => {
                    working(None);
                    tasks = still;
                    queued = queued_turns(&last);
                    log_usage(&last);
                    match if from_background(&last) { None } else { waiting(true) } {
                        Some(w) => {
                            let _ = w.send(Ev::Done(Ok((last, shown, tasks.clone()))));
                        }
                        None => {
                            let text = parse_output(&last).filter(|o| !o.is_error).map(|o| o.text).unwrap_or_default();
                            if let (Some(later), false) = (&later, text.trim().is_empty()) {
                                later(text);
                            }
                        }
                    }
                }
                Some(r) => {
                    let _ = child.start_kill();
                    if let Some(w) = waiting(true) {
                        let _ = w.send(Ev::Done(Err(None)));
                    }
                    working(None);
                    tell(&[]);
                    leave(if idle && r.is_err() { "conversazione ferma da 20 minuti, processo chiuso" } else { "il processo con i lavori in background si è chiuso" });
                    return;
                }
            }
            // Nothing runs and no message is on its way: the next read may wait long.
            let was = idle;
            idle = tasks.is_empty() && queued == 0 && waiting(false).is_none();
            if idle && !was {
                crate::log::line("claude: lavori in background finiti".to_string());
            }
        }
    });
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
    let mut session = chat.cli_session();
    // A conversation reopened from the history resumes its own session, as
    // Claude Desktop does (chat_log::open). Its file gone, or kept under
    // another folder (Claude Code would not find it): the conversation goes as
    // text in front of the question, as before.
    let mut prompt = String::new();
    if let Some(fallback) = chat.take_resume_fallback() {
        let cwd = terminal.unwrap_or(&dir);
        if !session.as_deref().is_some_and(|s| crate::desktop::session_in(s, cwd)) {
            crate::log::line("claude: la sessione della cronologia non è in questa cartella, riparto dal testo".to_string());
            chat.set_cli_session(None);
            session = None;
            prompt = fallback;
        }
    }
    // Modifica, Rigenera, Dirama: the session goes on from that answer, as a
    // new session; the process that has the whole conversation goes.
    let resume_at = chat.take_resume_at().filter(|_| session.is_some());
    if resume_at.is_some() {
        drop_live(chat);
    }

    // The front end sends a context with the first message, or with a file
    // added later (pasted in the chat, sent on Telegram).
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

    let locked = chat.read_only();
    let make = |resume: Option<&str>| {
        let mut cmd = command(&exe);
        let mut a = match terminal {
            Some(_) => terminal_args(&dir, model, resume, extra_dir.as_deref(), &connectors, auto),
            None => args(&dir, model, resume, extra_dir.as_deref(), &connectors),
        };
        // Fast mode (as Claude Desktop's): `fastMode` added to the settings this process reads.
        if chat.fast() {
            with_fast(&mut a);
        }
        // «Sotto-agenti» turned on in the chat: the Agent tool too.
        if terminal.is_some() && chat.agents() {
            with_agents(&mut a);
        }
        // Piano, Accetta modifiche (the chat's mode, as Claude Desktop offers them): Claude Code's own modes.
        if let (Some(_), false, Some(mode)) = (terminal, auto, chat.mode()) {
            if let Some(i) = a.iter().position(|x| x == "--permission-mode") {
                if let Some(v) = a.get_mut(i + 1) {
                    *v = mode;
                }
            }
        }
        if locked {
            read_only(&mut a);
        }
        cmd.current_dir(terminal.unwrap_or(&dir)).args(a);
        if let (Some(_), Some(at)) = (resume, resume_at.as_deref()) {
            cmd.args(["--resume-session-at", at, "--fork-session"]);
        }
        // The effort picked in the chat (a change starts another process on the same session).
        if let Some(e) = chat.effort() {
            cmd.arg("--effort").arg(e);
        }
        // The work folder (workdir.rs): readable with Read outside terminal mode too.
        if let (None, Some(w)) = (terminal, work) {
            cmd.arg("--add-dir").arg(w);
        }
        // A turn from Telegram: easyisland-hook passes this on, and pipe.rs asks
        // Consenti / Nega in Telegram instead of on the island (telegram.rs).
        if telegram {
            cmd.env("EASYISLAND_CHANNEL", "telegram");
        }
        // A turn of Agent Chat: its permissions follow «Permessi in Agent Chat».
        if chat.channel() == "agentchat" {
            cmd.env("EASYISLAND_CHANNEL", "agentchat");
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
    // Kept at once: a turn stopped before its end is resumed by the next message.
    let on_session = |id: &str| chat.set_cli_session(Some(id.to_string()));
    let on_context = |used: u64, size: u64| chat.set_context(used, size);

    let (stdout, shown, stderr, success) = if keep {
        let print = fingerprint(&make(None), &dir);
        let id = chat as *const Chat as usize;
        let on_tasks_now = chat.on_tasks();
        let on_tasks = |t: &[BgTask]| {
            if let Some(f) = &on_tasks_now {
                f(t);
            }
        };
        // Work still in the background: the message goes to that same process.
        if let Some(r) = through(id, &print, session.as_deref(), &prompt, on_text, &on_context, limit, late).await {
            match r {
                Ok((last, shown, _)) => {
                    let stderr = String::new();
                    return finish(chat, last, if terminal.is_some() { shown } else { String::new() }, stderr, true);
                }
                Err(Some(e)) => return Err(e),
                Err(None) => crate::log::line("claude: il processo con i lavori in background non c'è più, ne parte un altro".to_string()),
            }
        } else {
            // Started another way (model, folders, settings changed): one process per conversation.
            stop_background(id);
        }
        let mut kept = take_live(id, &print, session.as_deref());
        let mut answer = None;
        // A kept process that is gone is replaced once, resuming the conversation.
        for _ in 0..2 {
            let mut live = match kept.take() {
                Some(l) => l,
                None => spawn_live(make(session.as_deref()), id, print.clone())?,
            };
            match live_turn(&mut live, &prompt, on_text, &on_session, &on_context, &on_tasks, chat.later().as_ref(), limit, late).await {
                Ok((last, shown, tasks)) => {
                    answer = Some((last, shown, live, tasks));
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
        let Some((last, shown, mut live, tasks)) = answer else {
            return Err(t("Claude Code si è interrotto.").into());
        };
        let stderr = live.stderr.lock().unwrap().clone();
        let outcome_ok = parse_output(&last).is_some_and(|o| !o.is_error);
        if let (true, Some(sid)) = (outcome_ok, parse_output(&last).and_then(|o| o.session_id)) {
            live.session = sid;
            live.used = std::time::Instant::now();
            if !tasks.is_empty() {
                follow(live, chat.later(), chat.on_tasks(), chat.on_working(), tasks);
            } else {
                put_live(live);
            }
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
        let (last, shown, stderr, ok) = read_stream(&mut child, on_text, &on_session, &on_context, limit, late, chat as *const Chat as usize).await?;
        (last, if terminal.is_some() { shown } else { String::new() }, stderr, ok)
    };

    finish(chat, stdout, shown, stderr, success)
}

/// The end of a turn of `send_mode`: its result as the chat's reply.
fn finish(chat: &Chat, stdout: String, shown: String, stderr: String, success: bool) -> Result<ChatReply, String> {
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
    fn steps_show_what_they_gave_back_and_the_sub_agents_steps() {
        let mut p = super::Progress::default();
        p.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test"}}]}}"#);
        assert!(p.feed(r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok 12 test"}]}}"#));
        assert!(p.done().contains("```esito\nok 12 test\n```"), "{}", p.done());
        p.feed(r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","is_error":true,"content":[{"type":"text","text":"non trovato"}]}]}}"#);
        assert!(p.done().contains("```errore\nnon trovato\n```"));
        // A long output is cut, a fence inside does not close the block.
        let long: String = (0..50).map(|i| format!("riga {i}\n")).collect::<String>() + "```";
        let block = super::result_block(&long, false);
        assert!(block.contains("riga 29") && !block.contains("riga 30") && block.contains("20"), "{block}");
        // A sub-agent: its steps under its description.
        p.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a1","name":"Agent","input":{"description":"Legge i PDF"}}]}}"#);
        assert!(p.feed(r#"{"type":"assistant","parent_tool_use_id":"a1","message":{"content":[{"type":"tool_use","id":"x","name":"Read","input":{"file_path":"C:/a.pdf"}}]}}"#));
        assert!(p.done().contains("> ⚙ ↳ Legge i PDF · "), "{}", p.done());
    }

    #[test]
    fn fast_mode_goes_in_the_settings() {
        let dir = std::env::temp_dir().join(format!("ei-fast-{}.json", std::process::id()));
        std::fs::write(&dir, r#"{"disableAllHooks":false}"#).unwrap();
        let mut a = vec!["-p".to_string(), "--settings".to_string(), dir.display().to_string()];
        super::with_fast(&mut a);
        let v: serde_json::Value = serde_json::from_str(&a[2]).unwrap();
        assert_eq!(v["fastMode"], true);
        assert_eq!(v["disableAllHooks"], false);
        let mut b = vec!["-p".to_string()];
        super::with_fast(&mut b);
        assert_eq!(b.last().unwrap(), r#"{"fastMode":true}"#);
        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn the_task_list_shows_under_the_steps_and_stays_at_the_end() {
        let mut p = super::Progress::default();
        assert!(p.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TodoWrite","input":{"todos":[{"content":"Leggere","status":"completed","activeForm":"Leggo"},{"content":"Scrivere","status":"in_progress","activeForm":"Scrivo"},{"content":"Provare","status":"pending","activeForm":"Provo"}]}}]}}"#));
        let done = p.done();
        assert!(done.contains("1/3") && done.contains("✅ Leggere") && done.contains("▶️ **Scrivo**") && done.contains("⬜ Provare"), "{done}");
        // Only the last list, not one per update.
        p.feed(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TodoWrite","input":{"todos":[{"content":"Leggere","status":"completed"},{"content":"Scrivere","status":"completed"}]}}]}}"#);
        assert_eq!(p.done().matches("Leggere").count(), 1);
        assert!(p.done().contains("2/2"));
    }

    /// Lines as Claude Code 2.x wrote them for `/compact` (8 Nov 2026).
    #[test]
    fn compact_says_what_it_did_and_moves_the_meter() {
        let mut p = super::Progress { context: 38346, ..Default::default() };
        assert!(!p.feed(r#"{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":38346,"post_tokens":6242}}"#));
        assert_eq!(p.context, 6242);
        assert_eq!(p.compacted, Some((38346, 6242)));
        let line = super::compacted_result(r#"{"type":"result","subtype":"success","is_error":false,"result":"","local_command":"compact","session_id":"s1"}"#, 38346, 6242);
        let out = super::parse_output(&line).unwrap();
        assert!(out.text.contains("38.346") && out.text.contains("6.242"), "{}", out.text);
        assert_eq!(out.session_id.as_deref(), Some("s1"));
        // A result with its own text keeps it.
        let kept = super::compacted_result(r#"{"type":"result","result":"fatto"}"#, 1, 1);
        assert_eq!(super::parse_output(&kept).unwrap().text, "fatto");
    }

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

    #[test]
    fn counts_the_commands_left_in_the_background() {
        // As Claude Code 2 Nov 2026 streams a `sleep 20` with run_in_background.
        let mut p = super::Progress::default();
        p.feed(r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"b1","task_type":"local_bash"}]}"#);
        assert_eq!(p.tasks, vec![crate::claude::BgTask { id: "b1".into(), kind: "local_bash".into(), description: String::new() }]);
        p.feed(r#"{"type":"system","subtype":"task_notification","task_id":"b1","status":"completed"}"#);
        assert_eq!(super::thousands(12345), "12.345");
        p.feed(r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#);
        assert!(p.tasks.is_empty());
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

    /// Work left in the background (Modalità terminale): listed, a message
    /// written meanwhile answered by the same process, the end in `later`:
    /// `cargo test --lib claude_cli::tests::live_background -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_background() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join("ei-bg");
            std::fs::create_dir_all(&dir).unwrap();
            let chat = crate::claude::Chat::default();
            let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            let keep = got.clone();
            chat.set_later(std::sync::Arc::new(move |t: String| {
                println!("LATER: {t}");
                keep.lock().unwrap().push(t);
            }));
            chat.set_on_tasks(std::sync::Arc::new(|t: &[crate::claude::BgTask]| println!("TASKS: {t:?}")));
            chat.set_on_working(std::sync::Arc::new(|w: Option<&str>| println!("WORKING: {}", w.map(|s| s.chars().count().to_string()).unwrap_or_else(|| "fine".into()))));
            let ask = std::env::var("EI_BG_PROMPT").unwrap_or_else(|_| "Con lo strumento Bash avvia in background (run_in_background true) il comando 'sleep 25 && echo fatto', poi rispondi solo 'avviato'. Quando finisce, scrivi 'finito: ' e l'output.".into());
            let first = super::send_kept(&chat, "haiku", &[], false, ask, None, Some(&dir), true, &|_| {}, false, None).await;
            println!("1: {:?}", first.map(|r| r.text));
            let t0 = std::time::Instant::now();
            let second = super::send_kept(&chat, "haiku", &[], false, "Intanto: quanto fa 2+2? Rispondi solo col numero.".into(), None, Some(&dir), true, &|_| {}, false, None).await;
            println!("2 ({:.1} s): {:?}", t0.elapsed().as_secs_f64(), second.map(|r| r.text));
            for _ in 0..90 {
                if got.lock().unwrap().iter().any(|t| t.contains("finito") || t.contains("somma")) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            println!("later: {:?}", got.lock().unwrap());
            assert!(!got.lock().unwrap().is_empty());
            // Back among the kept processes: a third message is answered as usual.
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let third = super::send_kept(&chat, "haiku", &[], false, "E 3+3? Solo il numero.".into(), None, Some(&dir), true, &|_| {}, false, None).await;
            println!("3: {:?}", third.map(|r| r.text));
        });
    }

    /// Ferma on work left in the background: the list empties, the next message starts over.
    #[test]
    #[ignore]
    fn live_background_stop() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join("ei-bg");
            std::fs::create_dir_all(&dir).unwrap();
            let chat = crate::claude::Chat::default();
            chat.set_on_tasks(std::sync::Arc::new(|t: &[crate::claude::BgTask]| println!("TASKS: {}", t.len())));
            let first = super::send_kept(&chat, "haiku", &[], false, "Con lo strumento Bash avvia in background (run_in_background true) il comando 'sleep 120', poi rispondi solo 'avviato'.".into(), None, Some(&dir), true, &|_| {}, false, None).await;
            println!("1: {:?}", first.map(|r| r.text));
            println!("fermato: {}", super::stop_background(&chat as *const _ as usize));
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            assert!(!super::FOLLOWING.lock().unwrap().iter().any(|f| f.chat == &chat as *const _ as usize));
            let second = super::send_kept(&chat, "haiku", &[], false, "Quanto fa 2+2? Solo il numero.".into(), None, Some(&dir), true, &|_| {}, false, None).await;
            println!("2: {:?}", second.map(|r| r.text));
        });
    }

    /// A folder of its own, word by word, on the kept process:
    /// `cargo test --lib claude_cli::tests::live_words -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_words() {
        tauri::async_runtime::block_on(async {
            let chat = crate::claude::Chat::default();
            let folder = std::path::PathBuf::from(std::env::var("WORDS_DIR").unwrap_or_else(|_| "..".into())).canonicalize().unwrap();
            for q in ["In che cartella sei e come si chiama il progetto secondo il suo CLAUDE.md? Poi scrivi otto frasi sui pinguini.", "Che parola hai usato per gli animali? Una riga."] {
                let start = std::time::Instant::now();
                let seen = std::sync::Mutex::new(Vec::<(f32, usize)>::new());
                let on_text = |t: &str| seen.lock().unwrap().push((start.elapsed().as_secs_f32(), t.chars().count()));
                let r = super::send_kept(&chat, "haiku", &[], false, q.to_string(), None, Some(folder.as_path()), false, &on_text, false, None).await;
                let seen = seen.lock().unwrap();
                println!("{:.1} s, {} aggiornamenti: {:?}", start.elapsed().as_secs_f32(), seen.len(), seen.iter().take(8).collect::<Vec<_>>());
                println!("{:?}", r.map(|x| x.text));
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
            // «Invia subito» on a conversation's first message: the next one goes on in it.
            chat.reset();
            let stopped = tokio::time::timeout(std::time::Duration::from_secs(8), ask("Ricorda la parola: kiwi. Poi scrivi una poesia di 60 righe sul mare.")).await;
            assert!(stopped.is_err(), "stopped before the end");
            assert!(chat.cli_session().is_some(), "the session is known from the start of the turn");
            let r = ask("Quale parola ti ho chiesto di ricordare? Solo quella.").await.expect("after a stopped first message");
            println!("primo messaggio fermato → {}", r.text);
            assert!(r.text.to_lowercase().contains("kiwi"), "{}", r.text);
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
    fn the_context_is_the_last_call_and_the_largest_window() {
        let mut p = Progress::default();
        p.feed(r#"{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":1000,"cache_creation_input_tokens":20},"content":[]}}"#);
        p.feed(r#"{"type":"assistant","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":3000,"cache_creation_input_tokens":8},"content":[]}}"#);
        assert_eq!(p.context, 3010);
        // A sub-agent's calls are not this conversation's context.
        p.feed(r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"usage":{"input_tokens":9},"content":[]}}"#);
        assert_eq!(p.context, 3010);
        assert_eq!(super::context_size(r#"{"type":"result","modelUsage":{"a":{"contextWindow":200000},"b":{"contextWindow":1000000}}}"#), 1000000);
        assert_eq!(super::context_size(r#"{"type":"result"}"#), 0);
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

    use super::{args, parse_output, step_line, terminal_args, tool_prefix, with_agents, version_key, Connectors, Progress};
    use crate::settings::McpChoice;
    use std::path::Path;

    fn none() -> Connectors {
        Connectors { enabled: Vec::new(), disabled: Vec::new(), agent: false }
    }

    #[test]
    fn sub_agents_only_when_turned_on() {
        let mut a = terminal_args(Path::new("C:/x"), "", None, None, &none(), false);
        let tools = |a: &[String]| a[a.iter().position(|x| x == "--tools").unwrap() + 1].clone();
        assert!(!tools(&a).split(',').any(|t| t == "Agent"));
        with_agents(&mut a);
        with_agents(&mut a);
        assert_eq!(tools(&a).split(',').filter(|t| *t == "Agent").count(), 1);
    }

    #[test]
    fn terminal_mode_has_the_chat_tools_and_the_users_servers() {
        let c = Connectors {
            enabled: vec![McpChoice { name: "docs".into(), confirm: false }],
            disabled: vec!["altro".into()],
            agent: true,
        };
        let a = terminal_args(Path::new("C:/x"), "opus", Some("abc"), None, &c, false);
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        // The chat's built-in tools only: no sub-agents, workflows, schedules.
        let tools = at("--tools");
        assert!(tools.contains("PowerShell") && tools.contains("Edit") && tools.contains("Skill") && tools.contains("ToolSearch"));
        assert!(!tools.split(',').any(|t| matches!(t, "Agent" | "Workflow" | "ScheduleWakeup")));
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
        // The session from the start of the turn, for a turn stopped halfway.
        assert_eq!(super::init_session(r#"{"type":"system","subtype":"init","session_id":"s9","tools":[]}"#).as_deref(), Some("s9"));
        assert_eq!(super::init_session(r#"{"type":"system","subtype":"init"}"#), None);
        assert_eq!(super::init_session(r#"{"type":"result","subtype":"success","session_id":"s9","result":"init"}"#), None);
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
        // Word by word, then the whole block in its place: nothing shown twice.
        let mut w = super::Progress::default();
        let delta = |t: &str| format!(r#"{{"type":"stream_event","event":{{"type":"content_block_delta","index":0,"delta":{{"type":"text_delta","text":"{t}"}}}},"parent_tool_use_id":null}}"#);
        assert!(w.feed(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Primo."}]}}"#));
        assert!(w.feed(&delta("Ciao ")));
        assert!(w.feed(&delta("a tutti")));
        assert_eq!(w.view(), "Primo.\n\nCiao a tutti");
        assert!(w.feed(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Ciao a tutti"}]}}"#));
        assert_eq!(w.view(), "Primo.\n\nCiao a tutti");
        assert_eq!(w.shown, "Primo.\n\nCiao a tutti");
        assert!(!w.feed(r#"{"type":"stream_event","event":{"type":"message_stop"},"parent_tool_use_id":null}"#));
        assert!(!w.feed(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"dentro"}},"parent_tool_use_id":"t1"}"#));
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
        assert_eq!(at("--allowedTools"), "WebSearch,WebFetch,Read,ToolSearch,mcp__docs_read");
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
