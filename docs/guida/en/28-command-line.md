# Command line and scripts
> section: Reference
> summary: Messages on the island from any script, the hook relay and the other tools that connect.

## Messages from scripts
Any script, scheduled task, n8n flow or program can show a message on the island:

```powershell
& "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" notify "Backup" "Done in 4 minutes" --stato ok
```

| Option | Meaning |
|---|---|
| `--stato` | `ok`, `avviso` (warning), `errore` (error) or `info` (colour and sound) |
| `--apri https://…` | Adds a button with a link |
| `--help` | The help |

It exits with **0** if the message arrived and **2** if EasyIsland isn't running, so a script never hangs. The notification rules apply. In **Settings → Notifications** there's the ready-to-copy command and **Try**.

## Questions to the chat
A script, a scheduled task or a remote session (WinRM, always as your own user) can ask EasyIsland's chat a question and read the answer:

```powershell
& "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" ask "which vm does the Falchi pharmacy have?"
& "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" ask "sum up today's news" --engine gemini
```

The question goes the same way as those typed in the island: direct answers, memory, recipes, engine. Under the answer a line says how it came (with no engine or with which engine, steps and tokens, notes found by meaning) and the conversation's id.

| Option | Meaning |
|---|---|
| `--engine` | `subscription`, `api`, `opencode`, `antigravity`, `openrouter`, `openai`, `gemini`, `ollama`, `lmstudio`, `easyisland` (only EasyIsland, no engine); without it, the chat's default |
| `--conversation relay-…` | goes on with the same conversation |
| `--json` | the whole answer, for scripts |

The conversation stays in the chat's history with **Relay ·** in front, so you see what was asked. If the engine wants to run or change something, the Allow/Deny card shows on the island and waits for your click: nothing is approved from the command. It works only on the PC and as your user, no network port; from outside there is Agent Chat.

## Opening Settings
```powershell
& "$env:LOCALAPPDATA\EasyIsland\easyisland.exe" --settings
```

## The agents' relay
`easyisland-hook.exe` is the bridge between agents and the app. Agents call it with the event name and the event JSON on standard input (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`…). It has 300 ms to reach the app and exits with 0 if it can't.

### Your own tool in Agents
Any program can appear in the Agents tab by sending the same events as Claude Code's hooks with an extra field:

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "bot-42",
  "cwd": "C:\\projects\\report",
  "easyisland_agent": { "id": "my-bot", "name": "My bot", "color": "#22C55E" }
}
```

```powershell
$json | & "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" SessionStart
```

## EasyIsland's MCP server
`easyisland-hook.exe mcp` is an MCP server (stdio) with EasyIsland's tools. The chat uses it by itself; for Claude Code outside the app add it from **Settings → Coding agents → EasyIsland's tools in Claude Code** (equivalent to `claude mcp add --scope user easyisland -- …\easyisland-hook.exe mcp`). Outside the app it also has `show_card` (a card with buttons that waits for your choice) and `add_to_tray`.

## The log
`%LOCALAPPDATA%\EasyIsland\easyisland.log`: startup, hook events, permission decisions, chat turn and tool timings, check problems. It stays on your PC.
