# EasyIsland Guide
> summary: Everything EasyIsland can do, page by page: from installing it to the personal agent that works on its own.

EasyIsland is an **island always at hand** at the top of your Windows screen, with a small animated character. From there you keep an eye on coding agents (Claude Code, Codex, opencode, Antigravity, Gemini CLI), answer their permission requests with one click, chat with the AI engine you prefer, make calls with 3CX, run your quick actions and follow your services. Since version 1.0.0 it is also a **personal agent**: it carries tasks forward on its own, remembers what matters and organises it in a second brain you can explore.

![The island open on the Overview](../media/overview.png)

## Who it is for
- People who **code with an AI agent** and don't want to watch the terminal: permissions, questions, file changes and the end of the work reach the island.
- People who **work with clients** (technicians, consultants, small offices): tickets, the 3CX phone system, Outlook, Teams, remote access, Remote Desktop Manager and Notion in one place.
- Anyone who wants an **AI assistant on their own PC** that really uses their tools, with control over every action.

## What's in this guide
| Part | Pages |
|---|---|
| **Getting started** | [Installation](02-installation.md), [First steps](03-getting-started.md), [The island](04-island.md) |
| **Make it yours** | [Position and look](05-appearance.md), [Profiles and notifications](06-profiles.md) |
| **Coding agents** | [Coding agents](07-agents.md) |
| **Artificial intelligence** | [The chat](08-chat.md), [AI engines](09-engines.md), [Terminal mode and tools](10-ai-tools.md), [Memory and second brain](11-memory.md), [Tasks, Heartbeat and Skills](12-tasks.md) |
| **Getting things done** | [Quick actions and shortcuts](13-actions.md), [Automations](14-automations.md), [Files and screen](15-files-and-screen.md) |
| **Connecting services** | [Integrations](16-integrations.md), [3CX](17-3cx.md), [Notion](18-notion.md), [Microsoft: Outlook, Teams, To Do](19-microsoft.md), [Telegram](20-telegram.md), [Remote support](21-remote-support.md), [Custom integrations](22-custom-integrations.md), [Widgets](23-widgets.md) |
| **Reference** | [Settings, page by page](24-settings.md), [Privacy and security](25-privacy.md), [Command line and scripts](26-command-line.md), [Troubleshooting](27-troubleshooting.md), [For developers](28-development.md) |

## Requirements
- **Windows 10 or 11**, 64-bit. WebView2, which draws the interface, is already part of Windows.
- For the chat with a Claude subscription: **Claude Code on the command line**, signed in (see [AI engines](09-engines.md)).
- Everything else is optional: each integration only asks for what it needs.

## Principles
EasyIsland is built on a few rules that hold everywhere:
- **Nothing happens without you.** Permissions, emails, deletions, installs: always your click. The only exception is the "Automatic" mode you turn on yourself, and even there deletions still ask.
- **No telemetry.** Network requests only go to the services you configure, plus the update check on GitHub, which can be turned off.
- **Secrets kept safe.** Keys, tokens and passwords live in the **Windows Credential Manager**, never on disk or in the interface.
- **Never blocks an agent.** If EasyIsland doesn't answer, agents carry on in the terminal as if it weren't there.
- **Light.** With the island tucked away nothing is drawn: CPU close to zero.

> **Note:** the interface is available in English and Italian (Settings → General → Language). EasyIsland is open source under the MIT license, born as a Windows-only version of Coucou. The code is on [GitHub](https://github.com/EdoardoDevelop/easyisland).
