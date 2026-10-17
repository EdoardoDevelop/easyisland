# Agents, hooks and chat

English version of [agenti.md](../agenti.md) and [chat.md](../chat.md). Where they
disagree, the Italian files are the reference.

## The relay (`hook/`)
- `easyisland-hook.exe` receives Claude Code's hooks and passes them to the app over a
  named pipe that only the user who started the app can open. If the app does not
  answer within the timeout, it exits with 0: **an agent is never blocked.** The
  decision timeout is 108 s (`DECISION_TIMEOUT` in `pipe.rs`).
- Other subcommands: `notify …` (a message from any script), `type <pid>` (writes the
  "Continue" text into a session's console), `statusline` (Claude Code's status line,
  forwarding only the plan limits, then running the user's previous status line),
  `mcp` (EasyIsland's tools as an MCP server).
- **"Always"**: first the rule Claude Code proposes; if it proposes none, a
  **session** rule on what is being approved (the exact command, a `WebFetch` domain,
  all file edits, or the tool by name). Never for questions, plans or multi-line
  commands.
- The relay truncates every string to 2,000 characters and drops `tool_response` and
  `transcript_path`; what is needed whole (the diff of changes, the last message, test
  results) is computed in the relay first (`hook/src/diff.rs`, `testrun.rs`).

## Other agents
- `easyisland-hook <Event> --agent codex|gemini|cursor|copilot|opencode`
  (`hook/src/agents.rs`) translates their events into Claude Code's shape.
- Hooks are installed by `src-tauri/src/hooks.rs`, always with a dated backup, a diff
  and the user's confirmation, into each agent's own file (`~/.claude/settings.json`,
  `~/.codex/hooks.json`, `~/.gemini/settings.json`, `~/.cursor/hooks.json`,
  `~/.copilot/hooks/easyisland.json`).
- **Cursor and Copilot are observe-only:** never permission hooks, because there an
  unreadable answer or an error blocks the tool.
- **opencode 2:** `src-tauri/src/opencode_agent.rs` follows opencode's background
  service (address from `opencode service status`, password kept in memory only),
  translates its events, and answers permissions and questions from the island. Off by
  default (`opencodeWatch`). **opencode 1.x** gets a plugin instead
  (`~/.config/opencode/plugins/easyisland.js`, source in
  `src-tauri/src/opencode-plugin.js`).

## In the island
- Sessions become `AgentTask`s (`src/island/hooks.ts`). Claude Code shows up only when
  its hooks are installed; otherwise opencode if it is followed.
- After `Stop` a session is "finished" and, 5 s later, at rest. If `Stop` never comes
  the character returns to its colour after Claude Code's idle notification or 5
  minutes without events; a pending permission keeps its colour.
- At the end of an answer, if the session's app is in the foreground there is no sound
  or card; otherwise the island opens on the "finished" card, with the last message in
  markdown and **Continue** (the text goes into the session's terminal, VS Code
  extension or opencode service).
- **Ask this session** questions a read-only fork of a Claude Code session
  (`claude -p --resume <id> --fork-session`, read tools only); the real session is
  untouched.
- A permission card can be folded with **Later** or Esc; the request keeps waiting up
  to the relay's limit and the card shows the time left.
- **Weekly and daily recaps** (`recap.rs`, `daily.rs`) keep only counts, the agent's
  id and the project folder's name, never commands or content.
- **EasyIsland's tools in Claude Code**: `claude mcp add --scope user easyisland …`,
  run only after the user confirms and after a dated copy of `~/.claude.json`.

## Chat engines
- The default engine is `settings.chatEngine`; the menu in the chat picks one for the
  current conversation only. Engines: Claude through Claude Code (`claude_cli.rs`,
  the user's subscription), Anthropic's API (`claude.rs`), OpenRouter, OpenAI, Gemini,
  Ollama and LM Studio (`openai.rs`, OpenAI-compatible streaming, no tools), opencode
  (`opencode.rs`).
- One turn is `chat_turn` in `lib.rs`: `chat_send` uses it for the island, `telegram.rs`
  for its own conversation. The streamed text goes to a callback, not straight to the
  island.
- **Telegram** (`telegram.rs`): the chat in a Telegram chat through the user's own bot
  (BotFather token in Credential Manager), long polling only, one chat linked with a
  6-digit code. Engine and model chosen there (`/motore`, `/modello`) apply to that
  conversation only. In terminal mode every permission is an Allow / Deny message with
  buttons in Telegram (`EASYISLAND_CHANNEL=telegram` for Claude Code's hook,
  `Options::telegram` for opencode). Messages sent while the app was closed are dropped.
- **EasyIsland's tools for opencode too**: with `agentTools` on, the private opencode
  server gets `easyisland-hook mcp` as a local MCP server through
  `OPENCODE_CONFIG_CONTENT` (opencode 2 shape: `mcp.servers.<name>` =
  `{type: "local", command: [...]}`); read-only tools are allowed in the session's
  rules, the others ask Allow / Deny. The instructions ride in front of the first message.
- **Work folder** (`workdir.rs`, `settings.chatFolder`): one folder of the PC browsed in
  "Files and screen", by the chat (`list_work_folder`, `move_to_work_folder`, readable
  without asking) and from Telegram (`/cartella`). Every path is checked to stay inside
  it; deleting goes to the Recycle Bin and only from the user's click.
- **History**: `chats.json` in `%LOCALAPPDATA%\EasyIsland`, up to 100 conversations,
  without the bytes of attached files. Nothing leaves the PC.
- **opencode as an engine:** a private `opencode serve` on a free port with a random
  password and `EASYISLAND_INTERNAL`, stopped after 10 minutes without messages. One
  session per chat, with rules: `*` = ask, reading and searching allowed, `.env` and
  `question` denied. Permissions go to the island's card; no answer means reject.
  opencode 2 events used: `session.text.delta`, `session.tool.*`, `permission.asked`
  (`action`, `resources`, `save`); the answer is
  `POST /api/session/{id}/permission/{rid}/reply` with `{"decision"}`.
- **Connectors (MCP)**: with the subscription, the MCP servers configured in Claude
  Code (and those of enabled plugins) can be chosen per profile; by default every call
  asks Allow / Deny in the island.

## Terminal mode (`chatTerminal`, `chatFolder`)
The chat can do what Claude Code or opencode do in a terminal, in a folder the user
chooses.
- **Claude Code**: no tool restrictions, the user's MCP servers, plugins, `CLAUDE.md`,
  skills, permission rules and hooks; every permission question goes to the island.
- **opencode**: the session works in the chosen folder; "Always" applies to whatever
  rule opencode proposes.
- **Other engines** have no tools of their own: in terminal mode they run through
  opencode with the same provider and model. Their API keys go from Credential
  Manager into the private server's environment only — never on disk.
- **⚡ Automatic** (chat header button, terminal mode only, for the current
  conversation only):
  - **Claude Code:** `--permission-mode auto`: Claude Code's own check approves normal
    actions and blocks risky ones.
  - **opencode and the other engines:** answered "once" without a card when `auto_ok`
    allows it: file edits, the web, commands that are not delicate, and connector
    (MCP) tools that do not delete or send. Still on the card: delicate commands
    (`delicate()`: deleting, `git push`/`reset --hard`, installing, the registry,
    services, network, processes, code from a string or the web, `$(…)` and
    backticks), folders outside the working one, and connector tools whose name says
    they delete, archive, send, post, message or share (`mcp_delicate()`).
  - `bypassPermissions` is excluded: it would accept everything with no check.

## Claude using the PC
- `easyisland-hook mcp` (`hook/src/mcp.rs`) is a stdio MCP server with EasyIsland's
  tools; each call goes to the app over the named pipe and is run by
  `src-tauri/src/agent.rs`. Only read-only tools are pre-allowed; everything else asks
  Allow / Deny.
- **Never** add to this server a tool that runs arbitrary commands, sends email or
  deletes. The only way to run something is `run_quick_action`, i.e. an action the
  user created. Real commands are run only by terminal mode, with Allow / Deny.
