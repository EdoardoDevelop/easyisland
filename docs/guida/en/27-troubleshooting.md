# Troubleshooting
> section: Reference
> summary: The most common questions and problems, with what to do.

## Install and startup
| Problem | Solution |
|---|---|
| SmartScreen or Defender block the installer | It's the warning for unsigned programs: **More info → Run anyway** |
| The character doesn't show | Look in the notification area (^ next to the clock); check it isn't **Paused**, that full screen isn't hiding it and that "in front of a client" isn't on; read the log |
| I can't find Settings | Notification area icon → Settings…, or `easyisland.exe --settings` |
| The character goes behind the taskbar | Clicking the taskbar or opening Start can cause it: it comes back on the next window change |

## Agents
| Problem | Solution |
|---|---|
| Claude Code sessions don't arrive | Settings → Coding agents → Install…, then open a **new** session |
| Codex sends nothing | After installing, open `/hooks` in Codex and approve EasyIsland's hooks |
| opencode doesn't show | With opencode 2 turn on **Connect opencode**; with 1.x restart opencode after installing |
| The permission doesn't reach the island | EasyIsland has a time limit: if it doesn't answer, the agent asks in the terminal. Check Pause and the profile's notifications |

## Chat
| Problem | Solution |
|---|---|
| "Claude subscription" is red | You need Claude Code on the command line, signed in: `irm https://claude.ai/install.ps1 \| iex`, then `claude` and sign in; then **Check again** |
| "Sign-in expired" | EasyIsland tries to renew it by itself; otherwise open `claude` and sign in again |
| An MCP connector doesn't show | It must be configured for the user (`--scope user`) and chosen in the profile; claude.ai's aren't available |
| The chat doesn't use tools | Settings → Chat → **Can use the PC** on, and an engine with tools (subscription, Anthropic key, opencode, Antigravity) |
| Slow answers | The log writes the seconds of every turn and tool: look there for what weighs |

## Keys and integrations
| Problem | Solution |
|---|---|
| A key "won't save" | The Windows Credential Manager is full (often of other apps' cached tokens): delete unneeded entries from Control Panel → Credential Manager → Generic credentials |
| "Missing: key" | The integration needs a credential: open its row and enter it |
| Outlook reads nothing | You need **classic** Outlook open, or the Microsoft account |
| 3CX won't connect | Check address with port, extension and web client password; two-step verification isn't supported |
| Notion answers 403 | The Notion integration must be allowed to read, update and insert, and be added to the pages and databases |
| Telegram doesn't answer | It works only with the PC on and the chat linked with `/start <code>` |

## Memory and tasks
| Problem | Solution |
|---|---|
| The Memory window is empty | The memory fills up by using the chat, with `/ricorda` and with files in `da-leggere`; history must be on |
| A task is paused | It reached the maximum turns or minutes, or waits for an answer: resume it or answer |
| The Heartbeat doesn't run | With an empty `BATTITO.md` it doesn't run, on purpose |

## The log
`%LOCALAPPDATA%\EasyIsland\easyisland.log` tells what happened: it's the first thing to look at, and to attach to a report on [GitHub](https://github.com/EdoardoDevelop/easyisland/issues).
