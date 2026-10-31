<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="EasyIsland icon">

# EasyIsland

**Your personal agent on Windows, in an island always within reach.**

It drives your coding agents (Claude Code, Codex, opencode, Gemini CLI), carries out on its own the tasks you hand it, remembers customers, people and projects in a second brain you can explore, works with your services and tools, and reaches you on Telegram too. With the AI engine you choose, free or local included, and without interrupting what you are doing.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**English** · [Italiano](README.it.md) · **[📖 Full guide](https://edoardodevelop.github.io/easyisland/en/guide/)**

</div>

<img src="site/media/en/overview.png" width="700" alt="EasyIsland open: the Overview with agents, integrations and the Jarvis Sfera character">

**Contents:** [What it does](#what-it-does) · [Latest versions](#latest-versions) · [Installation](#installation) · [How to use it](#how-to-use-it) · [Position and look](#position-and-look) · [Quick actions and shortcuts](#quick-actions-and-shortcuts) · [Integrations](#integrations) · [Widgets](#widgets) · [Customer is watching](#customer-is-watching) · [Messages from scripts](#messages-from-scripts) · [Profiles, theme and backup](#profiles-theme-and-backup) · [Claude Code](#claude-code) · [Chat with Claude](#chat-with-claude) · [Automations](#automations) · [Building it yourself](#building-it-yourself) · [License](#license)

## What it does

- **An agent that works for you**: hand it a **task** and it carries it out on its
  own, with a plan, your tools and an engine of your choice for each task, asking
  you only what only you know (on **Telegram** too); a **Heartbeat** checks now and
  then what you tell it and speaks only when needed; **Skills** are your own
  procedures in .md files; **Terminal mode** lets it use commands and files with
  your Allow / Deny ([Chat with Claude](#chat-with-claude)).
- **Claude Code in the island**: watch sessions work, answer permissions with
  **Deny / Allow / Always** and questions, see **file changes** live, jump back to
  the session's app with one click; also **Codex**, **opencode**, Google's **Antigravity**, **Gemini CLI**
  and Claude Code in **Cursor**'s terminal; a **weekly recap** of the agents and
  the Pro/Max **plan limits** ([Claude Code](#claude-code)).
- **Chat** from the island with Claude (subscription or API key), **opencode**, **Antigravity**, **OpenRouter**,
  **OpenAI**, **Gemini** or local models with **Ollama** and **LM Studio**; attach
  text, files, copied images or a **screen area**; formatted answers (lists,
  tables, code with **Copy**); a calculator in the field; a **history** of
  conversations to reopen ([Chat with Claude](#chat-with-claude)).
- **Quick actions** (links, programs, scripts, keys, questions to Claude) with global
  shortcuts, over 150 icons or the **automatic** one (the site's favicon, the
  program's icon), and suggestions for the app you are using
  ([Quick actions](#quick-actions-and-shortcuts)).
- **Integrations** in the island's menu: 3CX (calls, phone book, incoming calls),
  Microsoft Teams, Zammad, Outlook, PC status, security, network, weather,
  clipboard with text and images, media, recording, GitHub, Vercel, Stripe, n8n,
  Notion, Remote Desktop Manager and more ([Integrations](#integrations));
  **widgets** for websites, certificates, servers, domains, calendars and APIs
  ([Widgets](#widgets)).
- **Automations** "when… then…", created in Settings or in plain words in the
  chat, and suggested from your habits; Claude can also use the PC for you, with
  your consent ([Automations](#automations)).
- **Files and screen**: questions about a file, ZIP extraction, the **Tray** of
  dropped files, the **working folder** as a grid with previews, **Box and ask** on
  an area of the screen and the **Collection**: with `Ctrl+Alt+Shift+R` you set
  aside text from any app (even a name and price from a supplier's site) with its
  source, then hand it all to the chat at once ([How to use it](#how-to-use-it)).
- **A second brain**: the chat's memory in .md files you can see and fix, with
  linked pages about customers, people and projects, files to learn from, an
  engine that tidies it up and a window to explore it (**graph**, also in 3D, mind
  map, concept map, timeline); **news** from the web on the subjects it talks about,
  only those you choose.
- **Personal integrations**: ask the chat for the feature you are missing and it
  becomes a form, a dashboard or a link to one of your services' APIs.
- **Profiles** (work, home, focus) that switch by themselves, a **"customer is
  watching"** mode, messages from any script, settings backup.
- **Eleven characters** (Goccia, the default, Slime, Gecko, Flame, Magma, Stone,
  Rock, Leaf, **Jarvis**, **Jarvis Sfera** and **Jarvis Plasma**), or in their place the **EasyIsland
  logo, your own PNG logo or the weather**; free placement, an island as big as the screen opening where
  you want, Windows 11 or Classic style in **light, dark or automatic** mode, themes, sounds generated in code, interface in **Italian or
  English**; light on battery, no telemetry.

## Latest versions

- **1.0.16** — **Fixed bar** with small islands below its elements, appearance of your choice, new elements and the **program's menu** from the window title; **animated logo**; **your day** summarized by AI; **permission levels** with “What I did”; search everywhere in the top field.
- **1.0.15** — **Chat attachments** inside the field, several at once and whole folders; **News** in a tab of its own with subjects chosen by themselves, Google or Bing News, thumbnails and cards.
- **1.0.14** — **News** on the subjects of your memory from Google News, with “More” and “Not interested”, in the island, the Overview, the morning recap, Telegram and the fixed bar.
- **1.0.13** — **Bar widgets**: clock, volume, microphone, brightness, battery, network and power menu in the fixed bar, with options per element and their cards in the island.

Every version, in detail: [CHANGELOG.en.md](CHANGELOG.en.md).

---

## Installation

**The easiest way:** download `EasyIsland-Windows-X.Y.Z-setup.exe` from the
[latest release](https://github.com/EdoardoDevelop/easyisland/releases/latest) and
run it. It installs for the current user only: no administrator prompt. The
installer is not code-signed yet, so Windows SmartScreen shows a warning: click
**More info → Run anyway**. Then see [After installing](#after-installing). Later
updates arrive by themselves (see [Updating](#updating)).

**Or build it on your PC** with steps 1–4 below: you get the same `.exe`
installer. The first time takes about 15–20 minutes (mostly downloads and
compiling), a few minutes afterwards.

### 1. Tools (first time only)

Open **PowerShell** and install the four tools with `winget`, already part of
Windows 10/11:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

| Tool | What it is for |
|---|---|
| Git | downloading the project |
| Node.js (LTS, 20 or newer) | building the interface |
| Rust (rustup) | building the app and the `easyisland-hook.exe` relay |
| Visual Studio Build Tools, "Desktop development with C++" workload | the linker and Windows libraries Rust uses |

The last command downloads a few GB and can take a while. WebView2, which draws the
interface, is already part of Windows 10/11.

**Close and reopen PowerShell** afterwards so the new commands (`git`, `npm`,
`cargo`) are found. To check:

```powershell
git --version; node --version; cargo --version
```

### 2. Get the project

```powershell
cd $HOME
git clone https://github.com/EdoardoDevelop/easyisland.git
cd easyisland
```

### 3. Build the installer

```powershell
npm install
npm run pack
```

`npm run pack` builds the relay, the interface and the app, and leaves two files
in `release\`:

```
EasyIsland-Windows-X.Y.Z-setup.exe    the installer with its version
EasyIsland-Windows-setup.exe          the same file with a fixed name
```

### 4. Install

```powershell
start .\release\EasyIsland-Windows-setup.exe
```

### After installing

EasyIsland starts and the character greets you; from then on it is in the Start
menu and in the notification area. From the EasyIsland icon in the notification
area → **Settings…**:

1. **Agents → Claude Code → Install…** to see your sessions in the island (see
   below). It also works with the Claude desktop app.
2. **Chat**: choose the engine. "Claude (subscription)" uses your Pro or Max plan
   but **needs the Claude Code command line** installed and signed in (see
   [Chat with Claude](#chat-with-claude)); otherwise choose an API key or another
   engine.
3. **Position and look**: the corner and the icon you prefer.

### Updating

**Automatically:** at startup and then once a day EasyIsland checks GitHub for a
newer release. If there is one, the island shows **Update available** with
**Install** / **Later**: nothing is installed without your click. The update is
signed and the app verifies the signature before running it; it then closes and
reopens by itself. You can check by hand, or turn the check off, in **Settings →
General → Updates**.

**If you built it yourself:**

```powershell
cd $HOME\easyisland
git pull
npm install
npm run pack
start .\release\EasyIsland-Windows-setup.exe
```

The installer replaces the previous version; settings and keys are kept.

### Uninstalling

First, in **Settings… → Agents**, click **Uninstall…** on the Claude Code row: the
uninstaller deliberately does not touch Claude Code's `settings.json`. Then
**Windows Settings → Apps → Installed apps → EasyIsland → Uninstall**.

### Troubleshooting

| Problem | Fix |
|---|---|
| `npm`, `cargo` or `git` "not recognized" | close and reopen PowerShell after installing the tools |
| `linker 'link.exe' not found` | the Visual Studio Build Tools with the C++ workload are missing: run the last `winget` command of step 1 again |
| `error: toolchain 'stable-x86_64-pc-windows-msvc' is not installed` | `rustup default stable-msvc` |
| Defender blocks the installer | it is the false positive described above: use "Run anyway", or start `target\release\easyisland.exe` directly |
| The character does not appear | look in the notification area (the ^ arrow next to the clock) and in the log, `%LOCALAPPDATA%\EasyIsland\easyisland.log` |
| A key or password "does not save" | Windows Credential Manager is full (often hundreds of cached tokens from other apps) and refuses new entries; Settings says so under the field. Delete the entries you don't need from Control Panel → Credential Manager → Generic credentials and try again |
| Open Settings without the notification area | `"%LOCALAPPDATA%\EasyIsland\easyisland.exe" --settings` (also as a shortcut) |

## How to use it

<img src="screenshots/compact.png" width="288" alt="The compact island as a bar, with integrations as mini characters">
<img src="site/media/en/strip-approval.png" width="298" alt="Closed island: a permission request with Deny and Allow next to the character">
<img src="site/media/en/strip-call.png" width="312" alt="Closed island: an incoming 3CX call with Answer and Decline">
<img src="site/media/en/overview.png" width="640" alt="The Overview: every integration as a tile with its status">
<img src="site/media/en/approval.png" width="640" alt="A Claude Code permission request, with Deny and Allow">
<img src="site/media/en/agenti.png" width="640" alt="Agents: Claude Code and opencode at work">
<img src="site/media/en/chat.png" width="640" alt="Chat with Claude from the island">
<img src="site/media/en/files.png" width="640" alt="Files and screen: drop a file, Box and ask, and the tray">

_Screenshots are generated from the preview with `node scripts/screenshots.mjs` (with `npm run dev` running), using the test data of the scenes in `dev/scenes.ts`. They show the Italian interface._

| You do | What happens |
|---|---|
| Move the mouse over the character (top centre, or the corner you chose) | It grows (or stays that way with **Always visible**), hops, looks at you and waves |
| Click the character, or rest the mouse on it if "Open after" allows it | The island opens, aligned to that side |
| Drag the character with the left button (the resting icon too) | It moves where you drop it, even to another screen, and the position is saved in the profile |
| Drag the bottom corner of the open island | Changes the island's width and height, up to the screen edges. Double-click the corner: default size |
| The **menu on the left** of the open island | The character on top, then **Overview**, **Agents**, **Chat**, **Actions**, **Files and screen** and your integrations, each with its logo (or an emoji) and a dot when there is news. At the top, the character tells you in a speech bubble what is happening |
| **Overview** | Every integration and agent as a tile with its status; a click opens one, dragging reorders them |
| **Agents** | The coding agent's session (Claude Code, Codex…): progress, changes, permissions |
| In the chat, drag the character onto another app's window | That window becomes the chat's context: an image of it, with the app's name and title, goes with your question |
| Drag a file onto the island, even onto the resting icon or the edge | The character becomes a box, swallows it and offers to answer questions about the file |
| The clock at the top of the chat | The **history**: earlier conversations, with date and engine; a click reopens one |
| `Esc`, the ✕ at the top right or **Close window** from the taskbar preview | Closes the island at once |
| 📌 at the top right | **Keep open**: the island no longer closes by itself, and becomes a normal window with a taskbar icon |
| Type a calculation in the chat, e.g. `840 + 22%` | The result appears at once; **Enter** copies it, **Ctrl+Enter** asks the chat anyway. Calculated locally |
| Drop a ZIP | Besides "Ask a question" there is **Extract…** |
| **Files and screen** → **Box and ask** (or `Ctrl+Alt+Shift+S`) | The screen freezes: box an area and ask about it, run your quick actions, copy the image or its **text** (recognised by Windows), or keep it in the tray |
| Select text in any app and press `Ctrl+Alt+Shift+R` (or **Into the collection** in Box and ask) | It lands in the **Collection** in **Files and screen** with its source: program, window title and, from Chrome or Edge, the page address. Give it a name and the fields to work out (e.g. "Product, Price, Supplier"); **Ask the chat** hands it all over and the chat fills the fields in a table |
| The button with three nodes at the top of the island | Opens the **memory map**: graph, mind map, concept map and timeline |
| **Files and screen** → **Record** | Records a conversation (microphone and PC audio), the screen or a single window, with Windows only |
| Type in the **field at the top** of the open island | Finds integrations, agent sessions, ⚡ actions and installed programs; at the bottom **Ask the chat** and **Search with Google**. Arrows to choose, **Enter** to open, **Ctrl+Enter** to ask the chat, **Alt+Enter** to search the web, **Esc** to clear |
| Notification area icon | Open, Settings…, Pause, Quit |

Everything else happens by itself: a Claude Code permission request opens the
island with **Deny / Allow** (and **Always** when Claude Code proposes a rule to
remember), a finished session shows Claude's last message, and your integrations
sit in the menu on the left.

**Live changes:** while Claude Code works, every file it changes shows up in the
steps with lines added in green and removed in red (`+12 −3`). A click opens the
**Changes** tab: one tab per file, each change with 3 lines of context and line
numbers, ↗ to open the file in VS Code at that line. The diff comes from the data
Claude Code passes to the hook, without reading the file, and stays in memory only.

## Position and look

**Settings… → Position and look** decides where the character lives and how much
it shows:

- **Position**: top or bottom, left, centre or right; or **drag the character**
  anywhere. The open island can be moved by its header and slides back when
  closed.
- **Screen**: primary, the one under the cursor, or the one you dragged it to.
- **The island opens**: where the character is, or always at the top centre, the
  centre of the screen or the bottom centre.
- **Width** and **Minimum height** of the open island, up to the screen edges.
- **Over the taskbar**, **Snap to edges**, **Compact view** (larger animated
  character or a compact bar), **Quick answers** next to the closed character
  (permissions and 3CX calls without opening the island), **Follows the mouse**,
  **Always visible**, **Resting icon**, **Open after**, **Close button**,
  **Full screen** (hides during videos, games and presentations; permission
  requests still show).
- **In the island** (Settings → Appearance → Theme): the character, the
  **EasyIsland logo**, **your own logo** (a PNG, best with a transparent
  background, kept on this PC and in the backup) or the **weather** (sky and
  temperature from the Weather integration). Logo and weather are still pictures,
  with no animation or states: more professional, and the CPU stays at zero.

To try combinations without building the app (Node only, no Rust):

```powershell
npm install
npm run ui
```

The browser opens on a fake desktop; settings go in the address, e.g.
`http://localhost:1420/?anchorV=bottom&anchorH=left&iconStyle=dot&iconSize=32`.

## Quick actions and shortcuts

**Settings… → Quick actions** creates the buttons of the island's ⚡ tab:

| Type | What it does |
|---|---|
| **Ask the chat** | sends a saved prompt, applied to the copied text or to the file dropped on the island |
| **Script** | runs PowerShell or Command Prompt commands, hidden, and shows the output in the island. It runs **only after a click**; with "Ask for confirmation" it shows the commands first |
| **Program / folder** | starts a program with its arguments (e.g. `mstsc /v:server01`) or opens a folder |
| **Link** | opens an address in the browser |
| **Keys** | sends shortcuts or text to the program in use |

Actions can be grouped in **folders**, reordered and given one of over 150 icons
drawn in code, or the **automatic** one: a link's site favicon or a program's own
icon, taken once and kept in the action.
**Suggestions for the app in use** appear at the top of the ⚡ tab (summarise a mail,
explain data in Excel, fix text in Word, translate a web page…).

**Global shortcuts**, valid in every app (customisable):

- `Ctrl+Space` opens the island on the actions (or the chat);
- `Ctrl+Alt+K` opens the chat with the copied text (or image) attached;
- `Ctrl+Alt+H` opens the **Clipboard** history;
- `Ctrl+Alt+Shift+S` **box and ask**;
- `Ctrl+Alt+Shift+R` puts the **selected text** in the **Collection**, with its source;
- `Ctrl+Alt+Shift+P` goes to the **pending request**: `N` denies, `Y` allows,
  `S` always, `1`–`9` picks an answer;
- `Ctrl+Alt+Shift+T` brings the **session's app** forward;
- `Win+Alt+A` shows your actions on the **selected text** in any app, with a
  before/after preview for the ones that replace it;
- every action can have its own shortcut.

## Integrations

**Settings… → Integrations** turns on the integrations, one per type, shown in the
island's menu and in the **Overview** tiles. Keys, tokens and addresses are kept in
Windows Credential Manager.

| Integration | What it shows |
|---|---|
| **GitHub, Vercel, Stripe, Resend, Notion, Cal.com, n8n** | the service's activity (deploys, payments, emails, bookings, runs), with the service's key; Notion also with tasks, quick notes, pinned pages and search |
| **Zammad** | tickets assigned to you, unassigned and escalated; alerts on a new ticket |
| **Telegram** | EasyIsland's chat in your own Telegram bot (token from @BotFather, linked with a code valid 10 minutes, then for good and to your chat only). A separate conversation with engine and model picked there (`/motore`, `/modello`, `/nuova`, `/stato`); Allow / Deny as buttons; photos and files to the Tray; the chat's files sent back; `/vassoio` and `/cartella`. Only while the PC is on: messages sent while EasyIsland is closed are dropped |
| **Outlook** | unread mail and today's and tomorrow's appointments from classic Outlook; with a Microsoft account, from Microsoft 365 too |
| **Microsoft Teams** | a meeting in progress, with microphone, video, raise hand, share and leave; presence and meetings with a Microsoft account |
| **Remote Desktop Manager** | your connections, searchable from the island's search bar |
| **Remote access** | a temporary connection to a customer's PC with WinRM or SSH (Windows and Linux): address, user and password in memory only, a step-by-step guide to prepare it; with 🔌 the chat runs commands there, each with Allow / Deny. "Close connection" puts TrustedHosts back |
| **PC status** | disk space, memory, battery, uptime, pending restart; **Copy PC info** for a ticket |
| **Security** | antivirus, signature age, last scan, firewall, threats |
| **Network** | Wi-Fi or cable, local and public IP, gateways and DNS, every adapter, VPNs, latency, a continuous ping and **Edit network…** |
| **Weather** | a city's weather (Open-Meteo, free, no key): the sky now, animated, the next 12 hours and 7 days |
| **Clipboard** | the last 30 texts and images copied, plus pinned ones: paste, copy, transform, **Ask the chat**. Memory only, never on disk |
| **Media** | what is playing in any app that shows up in Windows media controls, with artwork and controls |
| **Record** | a conversation, the screen or a window, saved as `.m4a` or `.mp4` |
| **3CX** | the 3CX V20 phone system: call, phone book, incoming calls with **Answer** / **Decline**, team, chat, voicemail, queues; or EasyIsland as the phone itself ("This PC") |

Each integration shows its logo (or a dot) or an emoji in the menu, and has a
**colour** the character wears while its tab is open. Integrations are reordered by
dragging them; which ones are on depends on the profile.

## Widgets

**Settings… → Widgets** adds repeatable checks, as many as you need, with no code:
**Calendar** (ICS link), **Domain expiry**, **Website**, **HTTPS certificate**,
**Ping**, **TCP port**, **Windows service**, **JSON API** (fields to show and an
alert rule). When a check goes from OK to a problem, its menu entry gets a dot, the
character makes a sound and the island shows itself, following the profile's
notification rules.

## Customer is watching

**Settings… → Notifications → Customer is watching**: the character steps aside
when someone might see your screen — during calls (microphone or webcam in use by
any app), during remote assistance, or by hand from the notification area. It hides
the character and mutes sounds (Claude Code permission requests still show), or
only mutes.

## Messages from scripts

Any script, scheduled task, n8n flow or program can show a message on the island:

```powershell
& "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" notify "Backup" "Done in 4 minutes" --stato ok
```

`--stato` is `ok`, `avviso` (warning), `errore` (error) or `info`; `--apri https://…`
adds a button with a link; `--help` shows the help. It exits with 0 if the message
arrived and 2 if EasyIsland is not running, so a script never hangs.

## Profiles, theme and backup

- **Language** (Settings → General): like Windows, Italian or English. The chat
  answers in the same language.
- **Profiles** (*Work*, *Home* and *Focus* to start with) each have their own
  integrations, position, look, sounds, theme and notification rules, and can
  switch by themselves by Wi-Fi network, days and time.
- **Theme**: the character and its colour, the island's colour and opacity,
  separate volumes for alerts, interface and emotions.
- **Backup**: *Export…* saves every setting to a JSON file; *Import…* loads it on
  another PC. API keys are never in the file.

## Claude Code

Open **Settings… → Agents** and click **Install…** on the Claude Code row. You see
the exact diff of what will change in `%USERPROFILE%\.claude\settings.json` and the
path of the dated backup. Nothing is written until you click. Your own hooks are
never touched, and uninstalling removes only EasyIsland's entries.

The relay is a small executable, `easyisland-hook.exe`, copied to
`%LOCALAPPDATA%\EasyIsland\bin\` at startup. It has 300 ms to reach EasyIsland and
exits cleanly if the app is closed, slow or has crashed: **a Claude Code session is
never blocked or slowed down by EasyIsland.** If nobody answers a permission request
in time, Claude Code asks in the terminal as usual.

**Weekly recap** on Mondays (hours at work, sessions, files and lines changed,
commands, permissions: counts only, never commands or content) and **plan limits**
(Pro and Max: 5 hours, week and Opus week, with an alert from 80 %).

**Codex, opencode, Antigravity and Gemini CLI** are installed from the same page with the same
rules (diff, dated backup, confirmation). Codex, opencode and Antigravity permission requests
arrive in the island with **Allow / Deny**; Gemini only shows that it is waiting.
Google's **Antigravity** is also a **chat engine**: install its CLI with
`irm https://antigravity.google/cli/install.ps1 | iex`, run `agy` to sign in with Google,
and install its hooks for Allow / Deny on the chat's commands.
Any other tool can appear in **Agents** by sending events to
`easyisland-hook <Event>` with an `easyisland_agent` field.

## Chat with Claude

**Work folder.** In **"Files and screen"** or **Settings… → Chat**, "Choose…" points to a
folder of the PC. In "Files and screen" you browse it under the Tray (double click to
enter a folder or open a file) and with "⋯" rename, move, copy to the Tray, copy the
path or send to the Recycle Bin; the Tray's green icon moves a file there. The chat
(with EasyIsland's tools) reads it without asking and moves Tray files into it; in
terminal mode it is the folder the chat works in. From Telegram: `/cartella`.

**Settings… → Chat** picks the **default** engine; the model name at the top right of
the chat picks another one for that conversation only:

- **Claude subscription (through Claude Code)**, the default: uses Claude Code on the
  PC (`claude -p`, hidden) and your Pro or Max plan. **It needs the Claude Code
  command line, signed in** — the desktop app alone is not enough. To install it:
  `irm https://claude.ai/install.ps1 | iex`, then run `claude` and sign in, then
  **Check again** in Settings → Chat.
- **Anthropic API key**, **OpenRouter**, **OpenAI** and **Gemini**: the key goes to
  Credential Manager, the model is picked from the list.
- **Ollama** and **LM Studio**: models on your PC or network, no key.
- **opencode** (opencode 2): free, local or connected models, **with tools**. Every
  command, edit or web access asks **Allow / Deny** in the island.

**Terminal mode** (Settings → Chat) lets the chat run commands, edit files and use
your MCP servers, plugins and skills in a folder you choose, with Allow / Deny for
each step. **⚡ Automatic** lets ordinary operations through for one conversation:
file edits, web access, commands that are not delicate and connector tools; deleting,
publishing, installing, changing the system, sending messages and folders outside the
working one still ask.

**Connectors**: the chat can use the MCP servers you configured in Claude Code,
chosen per profile, with "ask for confirmation" on by default.

Keys are kept in **Windows Credential Manager**, never on disk and never in the
interface. The chat **history** (up to 100 conversations) stays on this PC only.

No telemetry. EasyIsland's network requests go to the services you configure, plus
one more: the update check, which reads a release file on GitHub and can be turned
off.

## Automations

**Settings… → Automations**: when something happens, EasyIsland does something for
you — at a time, at startup, on unlock, on a Wi-Fi network, when a program starts,
when a USB drive is plugged in, when a file arrives in a folder, when an
integration or widget reports a problem, when a download finishes, on a 3CX call, when
an agent finishes or waits, when a Teams meeting starts or ends… with filters,
conditions and limits ("at most every N minutes"). **Then** is a sequence of steps:
a quick action, an alert, a profile switch, opening a program, folder or link,
asking the chat.

You can also **ask Claude in plain words** in the chat ("every weekday at 9 open
Outlook"): the island shows the automation with **Allow / Deny** before creating it.

**Suggestions from your habits** (off by default) note when you open programs
(names only), turn on or unlock the PC, Wi-Fi networks and USB drives, locally and
for at most 45 days, and suggest automations at most once a day.

**Claude can use the PC**: with the subscription, the chat can open programs,
folders and links, run your **quick actions**, read the status of PC, network,
weather, mail and tickets, use the clipboard and media, show an alert and switch
profile. Anything that opens, runs or changes something asks **Allow / Deny** first.
Claude cannot run arbitrary commands, send email or delete.

## Building it yourself

For people working on the code. The tools are those of step 1 of
[Installation](#installation).

```powershell
npm install
npm run tauri dev      # the real app, with live reload of the interface
npm run ui             # the interface only, in the browser (no Rust needed)
npm run build          # type check + interface build
npm run pack           # builds the installer into release/
```

Sounds, icons and characters are all generated in code: no audio or image files.
See [docs/en/development.md](docs/en/development.md) for tests, previews and
releases, and [docs/en/architecture.md](docs/en/architecture.md) for the layout of
the code.

### Structure

```
./
  src/                 island front end (TypeScript, no framework)
    character/         the characters and the greeting, in Canvas 2D
    island/            state machine, hooks, integrations
    views/             every view of the island
    settings/          the settings window
  src-tauri/           Rust backend: window, named pipe, Claude APIs, integrations, 3CX, automations
  hook/                easyisland-hook.exe: the relay for the agents and the "easyisland" MCP connector
  scripts/             icons, installer packaging, README screenshots
  dev/                 browser previews (characters, sounds, drop) and screenshot scenes
  screenshots/         the images of this README
  docs/                project notes (Italian); English versions in docs/en/
```

### Log

`%LOCALAPPDATA%\EasyIsland\easyisland.log`: hook events, permission decisions,
poller problems. It stays on your computer.

## License

MIT for the code: see `LICENSE`. EasyIsland's names, characters, icons and sounds are
drawn or synthesised in code.
