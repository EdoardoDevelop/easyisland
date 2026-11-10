# EasyIsland versions

What changed in each version, newest first. The latest ones are summed up in the [README](README.md#latest-versions).

**1.0.38** — **One look for every window**, after a design review: island, Memory, Preview and Flows in Windows 11 colours, dark and
light. **Memory** stays readable with hundreds of nodes (names no longer overlap, the graph opens fitted to the window), has its bar on
one row with «Maintenance» and clickable `[[links]]`; it also reads **Claude Code's own memory**, read only, without duplicates and with
each note's date. At the top the island says **what is wrong right now**, never «All quiet.» over an error; card content starts at the
top; integration cards share one style; the **Tray** keeps two actions and puts the rest in the ⋯ menu. Agent Chat says when a **token is
in the wrong field**, and the log no longer writes tokens or keys.

**1.0.37** — **The island no longer freezes** when a chat names a network path that does not answer (e.g. the shared
folder of a server that is off): paths are checked away from the interface and a network server gets a second and a half at most.
The **Memory** window opens maximized; the **empty chat** drawing moves in the chat's own window too.

**1.0.36** — **A real terminal in the chat.** The **Terminal** is Windows' console (PowerShell 7 when installed) drawn as in Windows
Terminal: colours, Tab, arrows and history, **Ctrl+C** to stop a command (copies when text is selected), **Ctrl+V** to paste, editors,
passwords and the interactive questions of `npm` and `git`; it fits its panel and follows the chat into its window. The **empty chat**
drawing starts again by itself after a moment out of view.

**1.0.35** — **The "cards" chat, more polished and more accessible.** Cards are the chat's only look, with adjustable **card
opacity** and shared measures for spacing, radii and text; the **detached window** has its own margin and follows the island's theme and
colour, scrollbars show only under the mouse and the **Preview** is light in light mode. **Ezzy**, EasyIsland's animated logo, is among the
characters. An **empty chat** shows a faint, slow drawing (Ezzy, a turning island, a sea of dots, stars, aurora, network; in Appearance →
Chat) and below it your **last three conversations** to pick up with one click. Replies read as clearly as questions, the header icons are
drawn, the title is short and paths become the file's name. Accessibility: text with enough **contrast** in dark and light, controls of at
least **24 px**, a keyboard **focus ring** and **screen reader announcements** when a reply arrives, a permission is needed or an agent
finishes. The chat's **terminal** opens in the right-hand panel like the Preview (under it when it is open) and the **chat in a window**
opens maximized.

**1.0.34** — **The chat does everything Claude Desktop does, and more.** With Claude Code, conversations reopened from the history
**resume their session** with all its context, and so do Edit, Regenerate and Branch, from that very point. The **context ring** is always
there, after background work and when reopening a chat too; **/compatta** summarizes the conversation with any engine. The mode button goes
through **Allow / Deny**, **Accept edits**, **Plan** and **Automatic**, and "Always" holds for the whole conversation. The "/" menu has
**Claude Code's commands**, your skills and plugins; the engine menu has **model** and **fast mode** for the conversation. Each step opens
on its **output**, **sub-agents** show their steps, the **task list** stays in sight, and a message written while Claude works **joins its
work at once**. **⟲ Files** puts files back as they were before a question, even after a restart. The history also has the **terminal's
and Desktop's sessions**. For projects: **separate copy** (worktree), **pull request** with its checks and "Fix", **comments on the lines**
of the changes, your own PowerShell **terminal** and **separate work** Claude can propose. Fewer tokens: PDFs without repeated headers, long
results without files, sub-agents on Sonnet. No more lost questions when a turn breaks off, **passwords masked** on disk, duplicate notes
refused.

**1.0.33** — **More complete custom integrations**, all of them and not just delivery notes: real **HTML templates** with values always
escaped, long dates, Italian numbers, conditions and resources such as a logo. Line breaks no longer break tables. **A4 PDF** straight from a
card, saved to the Tray and a folder. From the chat you choose **where to save** and **what to call the file**, with several fields too, and how cards read in the list. A button can run a **script** after a confirmation, and card data also reaches quick actions. Agents can
**create and change quick actions**, and a `.json` edited by hand shows up without a restart.
The **Agent Chat** card has **Running**: on the PC where an engine is working you see what it does, step by step. Engines work in the project's folder, go on with the conversation for an hour, read in full the
messages they answer and no longer do the same job twice.

**1.0.32** — **The memory in the field at the top**: the search looks at everything in the Map, notes and the other PC included, and when it
finds something an animated **constellation** opens with the node and its neighbours. Arrows and clicks move it, **Enter** opens a new chat
that starts from that node. The chat first reads a page's **card** instead of the whole text, can say **how two pages are linked** and
marks **inferred** links.

**1.0.31** — **Chat reworked in the details**: two-row field with project, engine and modes next to the text, **New** and **Search**
side by side, history with titles only and the details in the tooltip, the project's git branch and a **context ring** with Claude.
**Animated icons** on hover and click, a classic paperclip. At startup the logo leaves cleanly and the character fades in. No more
glows in the cards, windowed chat without a frame, and Preview keeps every tab reachable.

**1.0.30** — **Multi agent with one voice**: while the engines work you see the steps, then a single answer arrives already
reviewed, with **✓ Checked** underneath. The reviewer's text and the engines' names no longer enter the answer: only a serious
error has it rewritten, and an engine that can open files and data checks first.

**1.0.29** — **Memory map**: between two pages only the written links remain, a name shared in the text no longer ties
them. **Agent Chat**: when an engine cannot answer (an expired login, say) it now says so in the chat with the reason,
closing the assignment, and calling the PC by name lets the other engine step in.

**1.0.28** — **Multi agent in the chat**: in Settings → Chat pick the engines and turn the button on in the conversation.
The chat's engine leads and answers you, the others do pieces of the work read-only and you see a line for each. Before
the answer an engine from another maker **checks the work** without knowing who did it, looking at files and git: the
lead weighs the findings and fixes, and under the answer you find **✓ Checked by…** or what is left to look at.

**1.0.27** — **The line that types itself no longer cuts off**: of the reasoning it shows whole sentences only, it always
finishes what it started and no longer erases letter by letter: new text starts on an empty line. When several steps
arrive together it shows the latest, the others stay in the list.

**1.0.26** — **The chat works like a real tool**: full answers, no longer written for a tiny window; the text arrives
**word by word**; with **Project…** each conversation works in its own folder and reads the project's rules and git,
and the sidebar **groups conversations by project**, with «+» to start one there. While the agent works, the current
activity **types itself** with a caret; steps are lighter and fold into «N steps» when the answer is done. **Stop** is
neutral and turns red under the pointer; new microphone and send icons.

**1.0.25** — **Stop and «Send now»** no longer lose the conversation: even when the first answer is stopped,
the next message carries on the same session. **Agent Chat with Jeeves**: the PC tells the server what it can do
(integrations, engines, folders), so the coordinator gives each task to the right PC; the answers to a task stay
in its thread.

**1.0.24** — **Agent Chat with a map**: the chat is split into topics (your requests, who works on them,
done, open or blocked) and every agent gets it besides the last messages, so it knows what was already decided;
in the card, **Topics** lists them and a click shows that topic's messages. **AI advice** on Zammad tickets: the
chat opens with the ticket, the customer and similar tickets, the answer stays as the ticket's advice and is
updated when new messages arrive, with its history. **RDM with Devolutions Cloud** only from the cloud, with a
pane for each entry: user, password hidden with the eye and Copy. The **field at the top** also finds RDM
entries and folders (opened in the card) and 3CX contacts. In the chat's replies **files and folders are
clickable**: Preview, Open, Download, Open location. The **memory check** proposes its fixes with a checkbox and
a comment each. The memory map's neural network moves with the mouse still too.

**1.0.23** — **Zammad on the island**: the card shows your views with their counts, opens the ticket
with every message and lets you change state (with the reminder when pending), owner and priority,
write an internal note or answer the customer by email. **Devolutions Cloud** in the RDM card: vaults
and folders, «Copy password» to the clipboard (emptied after 30 seconds), new credentials and Password
Lists with a preview and a confirmation, the Zammad or 3CX customer tied to their folder; from the chat
too, with the password asked only in the Windows window. The **memory map** has six new views
(Galaxy, Neural network, Bubbles, Rings, River, Where it comes from) in a menu, coloured groups,
filters and «How is it linked to…»; «Link with AI» checks the guessed links and keeps only the right
ones. In the **chat** you write while it answers: messages wait in a queue, with **Send now**. Title
and text **fonts** to pick in Appearance, the fixed bar too. **Agent Chat** says who is working and on
what, and you write in it from the island with your own name. A click on the character with the island
open behind another window brings it **to the front** instead of closing it.

**1.0.22** — **Chat and integrations in a window**: drag the menu entry out of the island, or press
the arrow at the top, and the chat or an integration's card becomes a Windows window to move and
resize, with taskbar and Alt+Tab; the same button puts it back in the island. The **Preview** stays
beside the chat in the window too. The chat has the **conversations bar** on the left
(<kbd>Ctrl</kbd>+<kbd>B</kbd>), with an edge to drag to widen it, and keeps **several conversations
open at once**, each with its own engine and Stop. The **Memory** window shows this PC's memory, the
one of another PC shared through Agent Chat, or both together.

**1.0.21** — **A truly autonomous Agent Chat**: with “Autonomous” the engines do everything on
their own, deleting included, asking you nothing; whoever wants the questions in the chat for deleting
and sending picks that in the Settings. A **script started in the background** no longer goes
unanswered: when it ends the engine picks up by itself and the result reaches the chat. The chat page
connects again.

**1.0.20** — **Agent Chat does the work once**: a message naming nobody gets **one** engine's answer
in the whole chat, the one of the first PC that **takes it on**, at once even when the other PC is off;
so no double work and the free engines don't use up messages for nothing. Give each engine a **name** in
the Settings (`@lia` instead of `@casa/claude`) and see today's **turns and tokens** per engine. In the
chat page, the **row of names** above the field and a dot for **who is on**. **Memory shared between two
PCs**: for example the work memory at home, kept apart from yours; when it finds nothing it asks the work
PC if it is on, and work notes said at home reach it even with that PC off. The engines are
**autonomous**: what deletes, sends or changes the system they ask in the chat with “sì/no code”.
**Attachments** with name, size and SHA-256, sent by the engines too; “fermo” and “fermi” really stop them.

**1.0.19** — **A more autonomous Agent Chat**: when you write without naming anyone every engine
answers, each on its own. **Claude is the lead**: when something has to be done it decides who does it
and hands it to the other engines by name. With the **PC off** EasyIsland remembers where it was: when
back on, Claude reads what came meanwhile and answers once to what is still open. What is useful
(decisions, clients, projects, jobs) goes into the **Memory** by itself. On the island there is the
**Agent Chat** card with the status, the last messages and listening to turn off or on; in the Settings
the link to install the server, now open source.

**1.0.18** — **Agent Chat**: EasyIsland takes part in your chat between AI agents (a server of your
own, address and personal token in Settings → Integrations) and **answers by itself** when someone calls
it with @name. Several engines on the same EasyIsland, each with its own name (`@notebook/claude`,
`@notebook/codex`): `@notebook` calls them all. A **consult** asks every engine of every EasyIsland the
same question and the first one writes the synthesis. Brakes against loops between agents: “@name stop”,
a cap on answers per hour and one on messages in a row between agents without you; the island tells you
when an agent names you. Even without a server, “ask the other engines too” in the chat asks several
engines the same question at once and compares their answers.

**1.0.17** — **Talk**: <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> turns on the microphone, at a pause
the question goes to the chat and the reply is heard from the speakers. **Telegram answers voice
messages aloud** (OpenAI or Google AI), and a voice message starting with “remember” goes into the
memory. **Remember this**: the selected text, “remember that…” in the top field or `/ricorda` on
Telegram go into the memory with where they came from; “Remember” also in the text menu and in Box and
ask, **Take a note** after a 3CX call, pages proposed from closed tickets and important emails,
commitments and a weekly recap. **Prepare** a Zammad ticket assigned to you: the chat with the
customer's page, similar tickets and a draft reply. **Continue in Claude Desktop** from the chat with
Claude Code, with what you write there coming back to the island. News: the look (list, thumbnails,
cards) is chosen in the tab.

**1.0.16** — A livelier **fixed bar**: the character grows under the mouse and the bar swells around
it; a click on an element opens its card in a **small island below it**, as tall as its content, closed
by a click outside; a light shadow under the bar; right click on the bar for EasyIsland's menu with
«Customize the bar…». **Bar appearance** of your choice (band or islets, opacity, blur, margins, text,
auto-hide) and new elements: processor, memory, disk, graphics card with a graph, language, recycle bin,
updates, music, weather, VS Code projects and the **window title** with the program's name and icon. A
click on the title opens the **menu of the program** in front: its entries with their shortcuts (all of
them, submenus included, for classic programs), the window menu with Chrome's and Edge's entries and your
quick actions for that program. **Animated EasyIsland logo**: it draws itself in the greeting at start
and can sit in the island and the bar instead of the character. **Today and tomorrow**: an AI summary in
the morning and end-of-day recaps, on Telegram at the chosen time, in the top field and as a quick action.
**Permission levels**: «Always» for actions that can be undone, from Telegram too, and **What I did**
with Undo. The top field **searches everywhere**: memory, past conversations and Zammad tickets. News
from Google and Bing together, without duplicates.

**1.0.15** — **Chat attachments**: they sit inside the field, above the text, and there can be more
than one (up to 20), **whole folders** too: 📎 next to the microphone or `@file` and `@cartella` open
Windows' multi-select dialog, Ctrl+V takes every copied file and folder and a drop on the island
attaches them all. For a folder the engine gets its path and the list of its files. **News**: the tab
is always in the island's menu and can be switched off in Settings; subjects are chosen by themselves
from the memory once a day (an engine keeps only news-worthy ones: never people, customers or your own
name) and each has its own switch; source **Google News or Bing News** (with the article's picture and a
summary line); tab look of your choice among **list, thumbnails and cards**; the list scrolls when there
are many.

**1.0.14** — **News** (Settings → News): EasyIsland suggests the subjects your memory talks about
(never people or customers) and, for those you follow, searches Google News every 4 hours in the app's
language, filtering on the PC the words to avoid, the news already seen and the same story told again by
other papers. You find them in the island's **News** entry, in a box at the bottom of the Overview, in
the morning Good morning card, on Telegram with `/notizie` and as an element of the fixed bar. On each
news item **More** (more news on the subject and more on the same story right away), **Save** to the
memory and **Not interested**: after a few, the island asks whether to stop following the subject.
Fixed: «The island opens» was hidden and ignored with the fixed bar; now it applies there too. In the
guide the language button always leads to the right page.

**1.0.13** — **Bar widgets** (Settings → Look → Fixed bar): «+ Add» opens a catalog by group with clock
and date, volume, microphone, brightness, battery, network speed and power menu, besides integrations,
widgets, the strip and quick actions; system elements can be added more than once (two clocks with
different zones). In «Options» you choose the format with placeholders, a second text shown after a
click, the tooltip and what click, middle click, right click and wheel do. A click opens the **card in
the island**, right below the bar: the month's calendar with the other zones and upcoming appointments,
the volume, microphone and brightness sliders, battery and network. The power menu always asks before
sleeping, restarting or shutting down. Coucou is no longer mentioned.

**1.0.12** — The **fixed bar** goes back in place by itself when you turn the monitor off and on, change
it or change resolution or scale: before, it kept the old size or came away from the edge and had to be
turned off and on again. The same when Explorer restarts.

**1.0.11** — **Fixed bar** (Settings → Look → Fixed bar): a band at the top or the bottom that Windows
keeps free like the taskbar, with the character at the start, centre or end, the integrations, widgets,
quick actions and permission strip you choose, «…» for what does not fit, a background like the island,
transparent or a colour, and a **height** of your choice (character, icons and text adapt); a click opens
the island right below. The **character lives in a window of its own**: at rest it always moves with
light animations and fades in; with the island open only the one in the menu is left. The **Look** page
has six **tabs** (Theme, Character, Position, Fixed bar, Closed island, Open island) and next to each
setting a **small picture** of the island shows what it changes; in Character the chosen character moves,
in Position the corner can be picked with a click. Fixed: «Snap to edges» off did nothing at the top centre.

**1.0.10** — **Rename conversations** in the chat history: ✎ next to 📌, or a double click on the
title; Enter saves, Esc cancels, an empty title goes back to the first question. The history search
finds the new title too.

**1.0.9** — **Preview**: files and web pages in a real browser, **inside the island** in a panel to the
right of the chat (as wide as you drag its edge, closed and reopened from the chat's button) or in a
separate window, your choice in Settings → Chat; **Fit / 100% / Original** zoom, phone and tablet sizes,
light and dark, console and highlighted file changes. The chat **sees the page** (elements with a
reference), clicks and types with Allow / Deny, waits for the page to be ready and reads failed
requests. The **chat's steps** say in plain words what it is doing, on Telegram too. The **chat's
permissions** appear inside the conversation with Deny / Always / Allow, even with "Permissions and
calls" off. Memory: page summaries and aliases and a search that follows strong links. README and
homepage are English first (Italian in `README.it.md` and `/it/`). Fixed: with the Preview open the
island no longer resized and its corner did not follow the mouse.

**1.0.8** — **New logo**: a speech bubble with a rainbow stroke, dark inside, with two white eyes,
readable even at 16 px; the same drawing is the logo in the island. **Jarvis Sfera** is the default character of a new install.
README with a table of contents and new screenshots; the version history is in
[CHANGELOG.en.md](CHANGELOG.en.md).

**1.0.7** — **Flows**: automations become flows, built in their own window (Settings → Flows → Edit):
the flow from top to bottom, blocks to **drag** in or add with "+", a panel with the data to insert in one
click, ready-made templates and "Describe it in words" (the chat prepares it). New blocks: **Agent** (works
with EasyIsland's tools and the flow waits for its result, with answers in fields too), **Choice** by rules
or by the model, **For each** item of a list, **Question** on Telegram too. Each step can **try again** and
have a way out on errors; a restart halfway does not redo actions already done; **Runs** with each step's
outcome and "Resume from here". One **Flows** page with the tasks. Memory and Flows opened from Settings
now come to the front. README and site present EasyIsland as a personal agent.

**1.0.6** — **Light, dark or automatic mode** for both styles (Settings → Appearance → Theme), the
Settings window too; Automatic follows Windows. The **Appearance** page reorganised in five sections
(Theme, Character, Position, Closed island, Open island). **Jarvis Plasma**: a blue and violet plasma
globe with ever-changing filaments; Jarvis Sfera in brighter colours. **Memory**: a **memory engine** of
your choice, free ones too, writes topic pages and relations by itself (additions only, the «Link with
AI» button and after the evening digest), a better linked graph and the **3D graph** to turn with the
mouse.

**1.0.5** — **Jarvis**: a new character, an assistant's interface with a glowing core and rings that
never stop, rhythm and colour for every state, a satellite for every agent at work and the seconds on
the outer ring. **Jarvis Sfera**: the same idea as a sphere of points rippling like sound. With Jarvis
the weather is a small sign in the corner. Fixed: closing the island from its taskbar preview made it
disappear until EasyIsland was restarted.

**1.0.4** — **Collection**: select some text in any app (even a name and price on a supplier's site)
and `Ctrl+Alt+Shift+R` puts it in "Files and screen" with its source, page included from Chrome and
Edge; a zone of the screen too, from Box and ask. Give it a name and the fields to work out, and "Ask
the chat" hands it all over at once. **Memory map** one click away in the island. Fixed: the map said
"memory empty" and the Concept map stopped with some pages.

**1.0.3** — **Logo or weather instead of the character** (Settings → Appearance → "In the island"):
the EasyIsland logo, your own PNG or the weather, as still pictures with no animation. **Over 150
icons** for quick actions and an **automatic icon**: a link's site favicon, a program's own icon.
**Box and ask** replaces Circle and ask: you drag a box. A file dragged onto the resting island opens
it. Fixed: Settings jumped to the top when changing a select or a switch; the coloured halo at the
bottom was hard to see with the Windows 11 theme.

**1.0.2** — **The island as an app** (Settings → Island): open, it has its taskbar icon and shows in
Alt+Tab, with minimize and full screen; closed, it disappears, and it opens from the pinned icon,
whose right-click menu offers your quick actions. **Stay open** when you open it yourself. Larger text
in the open island. **Work folder** as grid or list, by name or date, with icons by file type and
**picture previews** (in the Tray too). **Full backup** with memory, chats, tasks and skills. Telegram
is the same in every profile; Settings open on General and no longer jump to the top. Fixed: the
island behind a window came back over it when the mouse crossed it.

**1.0.1** — **Telegram with the PC off**: messages written to the bot while EasyIsland was off are
handled when it starts again, in order, knowing when you wrote them. **The island steps behind**
windows that open over it (like the work folder picker) without closing, and comes back with a click
or when needed. **More complete automations**: "Wait" and "Ask before going on" steps, stop after an
error, and from your habits only whole routines (start of the day with profile, programs and the
day at a glance), never "open one program at a time".

**0.9.9** — **EasyIsland becomes an agent**. **Tasks**: give it a goal and it carries it on by
itself with a plan, steps and a result, now, at a time, every day, every week or every N minutes;
you see it work in the Agents tab and it asks you when it needs to. Each task has its own engine and
can get help from other engines. **Skills**: your procedures in .md files that the chat and the
tasks follow when they fit, also as `/name` commands. **Heartbeat**: a periodic check of what you
write in `BATTITO.md`, telling you only when there is something. **Memory digest** every evening,
keeping only the notes you approve. Tasks' permissions and questions on Telegram too.

**0.9.8** — **Windows 11 look**, now the default: the island and the settings are grey like
Windows' own windows, with the accent colour you picked in Windows, switches, fields and buttons
like the system's, line icons instead of emojis and every setting on one line with its explanation
below. The large logos in the Overview tiles and the integrations' colours stay. The previous look
is still there: Settings → Look → Theme → Style → Classic.

**0.9.7** — **A handier chat**: a multi-line field that keeps the draft, files pasted or dropped
into a conversation going on, Copy / Edit / ↻ Regenerate / ⑂ Branch under the messages, `/`
commands (your quick actions too), an `@` menu to attach the clipboard, a window or a Tray file,
templates with `{{fields}}`, **Assistants** with engine and instructions, 🎤 dictation, history
search and 📌, Markdown export, per-profile instructions and `/riprendi` on Telegram. **Memory** in
.md files: notes the chat remembers in every conversation and a day-by-day diary, at no token cost.
WebView2 uses far less RAM with the island compact.

**0.9.6** — **Remote access**: a quick connection to a customer's PC with WinRM or SSH
(Windows and Linux), nothing saved; with 🔌 the chat works on it, every command with Allow /
Deny; a step-by-step guide to prepare the PC and a cleanup at the close. **Notion** rows can be
deleted from the chat too, after your yes (they go to Notion's trash).

**0.9.5** — **Hooks in every shell**: without Git Bash, Claude Code runs hooks through
PowerShell and the previous command stopped it at every tool; now it works in Git Bash, PowerShell
and cmd (Settings → Agents → Update). **Microsoft To Do** from the chat, through classic Outlook:
read, add, change and complete tasks. The **open island** can be taken to another screen and stays
there.

**0.9.4** — **Faster chat**: Claude Code stays on between the messages of a conversation;
Notion rows come as a compact table with categories by name and totals already worked out; the
chat learns **recipes** as it is used and goes straight to the right tools on similar questions
(Settings → Chat → Recipes). While it works it also shows its reasoning, in the island and on
Telegram. "How much did I spend in October": from 29 to 12 seconds.

**0.9.3** — **Notion for every engine**: the chat reads and adds rows through EasyIsland's own
connection, which checks the values before writing (no more empty pages). **EasyIsland's tools**
reach **Antigravity** and **Claude with an API key** too. **⇄ Second opinion**: another engine
reviews the last answer, in the island and on Telegram. **/oggi** and **/domani** on Telegram:
the day at a glance.

**0.9.2** — **Stop** in the chat and on Telegram (■ instead of Send, ⏹ Stop and /stop): the
answer stops and the engine is closed. **Notion map for the chat**: your Notion's structure stays
on the PC, encrypted, so the chat no longer searches for it in every conversation.

**0.9.1** — **Remote Desktop Manager with Devolutions Hub**: the list also reads the user
vault (it used to stay empty) and opens the connection in its vault. The list stays on this
PC, encrypted for your Windows user, and updates only with **Sync**: RDM need not run when
you don't need it; a dot shows whether it is open.

**0.9.0** — Google's **Antigravity** like Claude Code and opencode: its sessions (the
`agy` CLI, IDE and app) in the island with steps, diffs and **Allow / Deny** on commands
and MCP tools, and as a **chat engine** with its own tools, from Telegram too; the
setup steps are in the settings.

**0.8.9** — **Mini Notion** in the Notion tab: your chosen pages, shown as tiles, open
in the island looking as in Notion (headings, lists, checkboxes, toggles, callouts, code,
images) and are edited there, with "/" for block types; databases as Table, Board (drag
the cards), List and Gallery, linked views included. **Telegram voice messages**
transcribed with Gemini, OpenAI or OpenRouter, with their own audio model.
**Telegram "Automatica"** (asks only before deleting), **settings the agents can change**,
**"Permissions and calls"** that can leave the island closed, clearer chat and agent settings.

**0.8.8** — **Telegram**: EasyIsland's chat in your own bot (made with @BotFather),
linked once with a code and to your chat only. Pick engine and model from there
(`/motore`, `/modello`); in terminal mode Allow / Deny arrive as buttons; photos and
files go to the Tray, and files the chat puts in the Tray reach you on Telegram
(`/vassoio`). **Work folder**: a folder of the PC in "Files and screen", with
subfolders, Rename, Move, To the Tray, Recycle Bin and dragging out; Tray files move
into it; the chat reads it and moves files into it, Telegram opens it with `/cartella`.
**opencode** now has EasyIsland's tools like Claude (Tray, apps, notices, quick actions,
automations).

**0.8.7** — **Record**: a conversation (microphone and PC audio) or the screen with
audio, or a **single window** picked from a list or by dropping the character on it,
with Windows only; a red dot with Stop next to the character, and at the end *To the
tray*, *Open*, *Show in folder*. In the search bar, **Search with Google**
(`Alt+Enter`). **Teams** and **Remote Desktop Manager** logos, the coloured glow at the
bottom of every tab, and clicking a tab while typing in the search bar closes and
clears it. With **⚡ Automatic** in the chat, opencode now uses connector tools (Notion
and others) without asking, except those that delete or send something. English
documentation: this README and [docs/en/](docs/en/).

**0.8.6** — **Microsoft Teams**: a meeting in progress recognised from microphone and
webcam, Microphone, Video, Raise hand, Share and Leave in the card and next to the
closed character, "Join from the copied link", automations when a meeting starts and
ends. **Microsoft account (API)**, to be tested: once signed in, Outlook reads mail and
calendar from Microsoft 365 (new Outlook too) and Teams shows presence and meetings
with "Join". A fully customisable **bar for the app in use**: only your actions,
**Keys** actions (shortcuts and text in the current program), questions about all the
text in the window, icon only or text only, "Bar only".

**0.8.5** — **Bar for the app in use** next to the closed character, like a Touch Bar:
your quick actions tied to the program you are using and the ⚡ suggestions for
Outlook, Excel, Word and the browser. A **right-click menu** in the island instead of
the browser's. **Overview** with large, faded logos in the corner of each tile.

| Version | Date | What's new |
|---|---|---|
| **1.0.8** | 26 Oct 2026 | New logo, Jarvis Sfera by default, README with contents and history in CHANGELOG.en.md |
| **1.0.7** | 26 Oct 2026 | Flows: window with blocks to drag, agents, choices, for-each, Telegram questions, runs |
| **1.0.6** | 25 Oct 2026 | Light/dark/automatic mode, Appearance reorganised, Jarvis Plasma, memory engine, 3D graph |
| **1.0.5** | 25 Oct 2026 | Jarvis and Jarvis Sfera characters, the island no longer disappears when closed from the taskbar |
| **1.0.4** | 25 Oct 2026 | Collection (text and areas with their source, for the chat), memory map from the island |
| **1.0.3** | 25 Oct 2026 | Logo or weather instead of the character, over 150 icons and an automatic icon for actions, Box and ask |
| **1.0.2** | 24 Oct 2026 | The island as an app, Stay open, working folder as a grid with previews, full backup |
| **1.0.1** | 24 Oct 2026 | Telegram even with the PC off, the island stepping behind windows, automations with Wait and Ask |
| **1.0.0** | 24 Oct 2026 | Second brain and Memory window, personal integrations made from the chat, full guide on the site |
| **0.9.9** | 23 Oct 2026 | EasyIsland as an agent: Tasks with a plan and several engines, Skills, Heartbeat, memory digest, tasks on Telegram |
| **0.9.8** | 22 Oct 2026 | Windows 11 look by default (grey, Windows' accent colour, line icons), Classic kept as a style |
| **0.9.7** | 22 Oct 2026 | Handier chat (Edit, Regenerate, Branch, / commands, @ menu, Assistants, dictation) and memory in .md, less RAM |
| **0.9.6** | 21 Oct 2026 | Remote access with WinRM and SSH for IT support, Notion rows deletable from the chat |
| 0.9.5 | 20 Oct 2026 | Hooks in every shell (no Git Bash needed), Microsoft To Do, open island on another screen |
| 0.9.4 | 20 Oct 2026 | Faster chat: Claude Code kept on, compact Notion with totals, recipes, visible reasoning |
| 0.9.3 | 19 Oct 2026 | Notion for every engine, tools in Antigravity and Claude API, Second opinion, /oggi and /domani |
| 0.9.2 | 19 Oct 2026 | Stop in the chat and on Telegram, Notion map for the chat |
| 0.9.1 | 18 Oct 2026 | Remote Desktop Manager with the Hub: user vault, encrypted offline list, Sync |
| 0.9.0 | 18 Oct 2026 | Google's Antigravity: sessions in the island with Allow / Deny and a chat engine, with setup steps |
| 0.8.9 | 18 Oct 2026 | Mini Notion in the tab (pages and databases viewed and edited in the island), Telegram voice messages, Telegram "Automatica", settings from the agents, "Permissions and calls" |
| 0.8.8 | 17 Oct 2026 | Telegram (chat, engine and model from there, Allow / Deny, files both ways), work folder in "Files and screen", the chat and Telegram, EasyIsland's tools for opencode too |
| 0.8.7 | 17 Oct 2026 | Record (conversation, screen or one window), Search with Google, Teams and RDM logos, glow in every tab, search closing on tab click, ⚡ Automatic with connector tools, English documentation |
| 0.8.6 | 16 Oct 2026 | Microsoft Teams (meetings, controls, Join), Microsoft account with the APIs for Outlook and Teams (to be tested), customisable app bar with Keys actions |
| 0.8.5 | 16 Oct 2026 | App bar next to the closed character, right-click menu in the island, Overview with large logos |
| 0.8.4 | 15 Oct 2026 | Automations with new events, filters, more conditions, repeats and event data in the steps; Settings above the island; Notion with views and alerts; Remote Desktop Manager (beta); grouped Integrations |
| 0.8.3 | 15 Oct 2026 | Terminal mode in the chat for every engine, ⚡ Automatic, Notion with tasks, notes and pinned pages, connectors from Claude Code plugins |
| 0.8.2 | 14 Oct 2026 | Replace keeping the original formatting (or not), tray after Box and ask, Media instead of Music |
| 0.8.1 | 14 Oct 2026 | Network: adapter chosen with buttons, a ping for each adapter's gateway |
| 0.8.0 | 14 Oct 2026 | New logo, Network with every adapter, continuous ping and adapter settings, album art in Music, Settings in a window, 3CX phone book, Claude Code sign-in renewal for plan limits |
| 0.7.9 | 14 Oct 2026 | Suggestions at the right moment (downloads, copied errors, dev servers, secrets removed from the clipboard), daily recap, EasyIsland tools in Claude Code |
| 0.7.8 | 13 Oct 2026 | New island with a menu on the left and an Overview, quick answers with the island closed, animated weather card |
| 0.7.7 | 13 Oct 2026 | Box and ask with OCR, character visible during 3CX calls, default ringtone, integration colours |
| 0.7.0–0.7.6 | 11–13 Oct 2026 | New and redrawn characters, 3CX softphone, team, chat and voicemail, a window as chat context, plan limits from Anthropic |
| 0.6.x | 8–11 Oct 2026 | Selected-text menu with preview, chat history, opencode 2, English interface, `Ctrl+Space`, weekly recap |
| 0.5.x | 4–7 Oct 2026 | 3CX, tray, more chat engines and agents, live file changes, habit-based automation suggestions |
| 0.3.0 | 4 Oct 2026 | Automations, Claude using the PC from the chat, calculator, ZIP |
| 0.2.0 | 2 Oct 2026 | First public release, automatic updates |

The full history, in Italian, is in [CHANGELOG.md](CHANGELOG.md).
