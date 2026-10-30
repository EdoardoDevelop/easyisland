# Terminal mode and tools
> section: Artificial intelligence
> summary: What the AI can do on your PC, with which permissions, and how to work like in a terminal.

## EasyIsland's tools
With **Settings → Chat → Can use the PC** on (default), engines with tools (Claude subscription, Anthropic API key, opencode, Antigravity, and the others with terminal mode) can act on the PC **through EasyIsland**:

| Area | What it can do | Asks first? |
|---|---|---|
| PC and apps | Open programs, folders and links; know the foreground app | Yes |
| Quick actions | List and run them (scripts too, reading their output) | Yes, to run |
| Status | Read PC, network, weather, mail, tickets, integrations | No |
| Clipboard | Read and fill the clipboard | Reading no, writing yes |
| Music | Player status and controls | Controls yes |
| Island | Show a notice | No |
| Files | The Tray, the working folder (read), moving files into it | Moving yes |
| Profiles and settings | Read settings, change one, switch profile | Changing yes |
| Automations | List, create, turn on and off | Creating and changing yes |
| Notion | Map, search, reading, database rows; add, change, delete rows | Writing yes; deleting only after your yes in chat |
| Microsoft To Do | List, add and update tasks (classic Outlook) | Writing yes |
| Remote access | Commands on the client's PC linked to the chat | Always, one by one |
| Memory | Search, save notes, write pages, read sources, check | No (writes only to the memory, never deletes) |
| Tasks and skills | Create tasks, list them; read and save skills | Saving a skill yes |
| Custom integrations | Create, edit, read records and sources, add records, call their actions | Creating, writing and calling yes |

Anything that opens, runs or changes something asks **Allow / Deny** in the island, with a clear description. Rules that never change:
- no tool runs **arbitrary commands on this PC** (that's what terminal mode is for, with a permission for each command);
- no tool **sends email**;
- no tool **deletes**, except a Notion row to its trash after your yes in chat.

You can ask in plain words: "open Outlook and the suppliers' portal", "how is the PC doing?", "run the backup", "add to To Do: call Rossi tomorrow", "how much did I spend in October?" (from Notion).

## Recipes: it learns by use
After a successful answer, EasyIsland remembers **which tools** were needed for that kind of question. On a similar question the chat goes straight to the right tools: faster and with fewer tokens. In **Settings → Chat → Recipes** you see how many there are and forget them with one click.

## Terminal mode
**Settings → Chat → Terminal mode**, together with the **working folder**: the chat works like Claude Code or opencode in a terminal.
- **Claude Code** uses your tools, MCP servers, plugins, `CLAUDE.md`, skills, permission rules and hooks, in the chosen folder. Every permission question reaches the island.
- **opencode** works in the chosen folder; "Always" applies to the commands and changes it proposes a rule for.
- **The other engines** (Anthropic API, OpenAI, OpenRouter, Gemini, Ollama, LM Studio) go through opencode with the same provider and model.

Every command appears **in full** on the card before it runs.

### ⚡ Automatic
The ⚡ button in the chat header (terminal mode only) applies **to the current conversation** and turns off with "New chat". When on, the chat has an amber border.
- **Claude Code**: its automatic mode approves normal actions and blocks risky ones.
- **opencode and the others**: file changes, web and non-sensitive commands go through by themselves. Sensitive commands stay on the card (deleting, `git push` and `reset --hard`, installing, registry, services, network, processes, downloaded code), as do folders outside the working one and connector tools that delete.

The mode that accepts everything without any check **doesn't exist** in EasyIsland, on purpose.

## The working folder
A folder on the PC chosen by you (in **Files and screen** or Settings → Chat) that the chat **reads without asking** and into which it can move files from the Tray. With terminal mode it's the folder it works in. From Telegram: `/cartella`. Details in [Files and screen](17-files-and-screen.md#working-folder).

## Settings changed from the chat
"Put the character at the bottom right", "turn off the weather", "use opencode as the engine": the chat reads the settings and changes one at a time, with Allow / Deny, saving like the Settings window does.
