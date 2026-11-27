# The island
> section: Getting started
> summary: How it opens, what it holds and how to use it with the mouse and the keyboard.

## Island or Launcher
**Settings → General → How you use EasyIsland**:
- **Island** (default): the character stays on the screen and the island opens from there.
- **Launcher**: nothing on the screen, neither character nor fixed bar. EasyIsland is a **Windows window** with everything the island has (Overview, Agents, Chat, integrations…, with the character at the top of the menu): open it from the taskbar, the **EasyIsland** folder in Start, the notification area icon or the shortcut, and it stays open until you close it. Closed, EasyIsland stays in the notification area and keeps working: notices arrive in their small window (bottom right if you had chosen "under the island") and permission requests open it by themselves. Choosing the Launcher puts an **EasyIsland icon on the desktop**; to keep it on the taskbar, with the Launcher open right-click its icon → **Pin to taskbar** (Windows does not let programs do it). Started with Windows it stays closed; started by you it opens. Like other apps it reopens where and as big as you left it (so do the chat and the integrations in their windows).

## The character and its states
At rest the character sits in the corner you picked (top centre by default) and moves gently, as if floating. It changes colour with the most urgent state: **blue** while an agent works, **amber** for a pending permission, **red** for an error, **green** when something finished well. When a tab is open it wears that integration's colour.

| What you do | What happens |
|---|---|
| Hover over the character | It grows, hops, looks at you and waves |
| Click, or stay over it for a moment | The character hops and stays where it is; the island opens beside it (below, if it sits at the top) with a wave of light, and a copy of it appears in the menu |
| Click the character (in the fixed bar too) with the island open | If the island is behind another window it comes to the front; if it is already in front it closes |
| Drag the character | It moves where you drop it, even to another screen; the position is saved |
| Drag the bottom corner of the open island | Width and height change up to the screen edges. Double-click: default sizes |
| Drag the open island by its top bar | It stays there while open, then goes back to the character |
| Click the character several times | It gets annoyed; three in a row and it gets dizzy |
| Leave the pointer on it for two seconds | Hearts |
| Drag a file onto the island | It becomes a box, swallows it and asks what to do |
| Drag the character onto a folder in File Explorer or a desktop icon | The path lands in the chat field |
| <kbd>Esc</kbd> or ✕ | Closes the island at once |
| The button with three nodes, at the top | Opens the [memory map](12-memory.md) |
| 📌 | **Keep open**: the island won't close by itself until you remove it |
| — and ▢ | With **Like an app** on (Settings → Island): minimize and full screen. Open, it has its icon on the taskbar and shows in Alt+Tab; closed, it does not. To open it from the taskbar, pin EasyIsland to the taskbar: a click on the icon opens the island. Right-click the icon: your quick actions, **Open the island**, **Ask the chat**, **Box and ask**, **Settings…** |
| Stay open | With **Stay open** on (Settings → Island), when you open it yourself it does not close by itself, as with 📌 |
| You click another window, or one opens (a picker, a program launched from the island…) | The open island goes **behind** it, like any window, without closing; the character stays in front. It comes forward again when you click it, when a permission or a call arrives, or when it tucks away |

## The menu on the left
In the open island, under the character:
- **Overview**: every integration and agent as tiles, each with its state. A click opens the tab; drag to reorder. Coding [agent](07-agents.md) sessions and [tasks](14-tasks.md) are here too; next to «Overview», how many agents are working. Below are your [quick actions](15-actions.md).
- **Chat**: the [chat](08-chat.md) with the AI engine.
- **Files and screen**: file drop, Tray, working folder, Box and ask, Record (see [Files and screen](17-files-and-screen.md)).
- **Your integrations**, each with its logo or an emoji and a dot when there's news; [custom integrations](24-custom-integrations.md) too.

**Your own buttons and tabs.** Ask the chat in words: «put a button to shut the PC down at the bottom left», «add a button at the top that opens my mail», «make a PC tab with Wi-Fi, Bluetooth, printers and Task Manager». Buttons stand at the foot of the menu or at the top next to the others; a tab is a menu entry with its buttons. They can lock, sleep, restart or shut down the PC (the last three ask first), open Windows pages, programs, sites, your quick actions, a section of the island, or put text in the chat. A tab can also show blocks: «make a tab with all the installed apps» (a grid with a search field), the open windows, your quick actions, the files of a folder, the PC's values (processor, memory, disk, battery, network, IP address), the recently opened files, the Tray's files, the clipboard history, VS Code's recent projects, the saved records of one of your integrations (“a tab with my clients”), Notion pages, a chart of the last minutes of processor, memory, graphics card or network, or a text. A click opens the app or the file, brings the window forward, runs the action, copies back to the clipboard, opens the record or the page. At the bottom, under the menu and the views, the island can show a **footer** in three parts (left, center, right): in each, buttons and PC values always in sight, in the order you want (“put processor, memory and disk C in the center of the footer”, “put a button to lock the PC on the right of the footer”, “the IP address on the left”). While the chat asks Allow/Deny the island already shows the result; Deny leaves it as it was. The island's own parts move and hide too, in words: «put Chat at the top of the menu», «hide News», «move the sound button before the others». Overview and Settings always stay. The Overview too: «put the music at the top of the overview», «hide the Vercel tile», «put GitHub first», «add the processor and memory to the overview». A tab or the Overview can also hold an integration's card as it is (mail, tickets, music, usage), the news or the quick actions. Which parts and tiles show is also chosen in Settings → Appearance → Open island → **Overview**. To go back: ask the chat to «undo the last change to the island», or Settings → Appearance → Open island → **Added from the chat** (Remove, Undo the last change).

**The look, in words.** The chat also changes how the open island looks: «make the island midnight blue fading into purple», «rounder corners», «bigger text», «a monospaced font», «an orange border», «a purple glow», «a slightly darker menu», «make the island at least 900 wide». And each piece: a button with its own background, round, pill or square, small or big, with its name beside the icon; a tab with its own columns and bigger buttons; a block half, a third or a quarter wide (four charts in a row), bigger, with its own colour, background, border and corners; a taller chart, as bars or an area, of the last 1–5 minutes; a big centered text as a heading. While the chat has changed the look, its look wins over Settings → Appearance; it goes back with **Put back as standard** in **Added from the chat**, or by asking the chat.

**When it shows, and in what colour.** Buttons, tabs, blocks and footer values can show only at certain times: at certain hours («the Night button only from 8 pm to 6 am»), on certain days («the Work tab only Monday to Friday»), with a program in front when you open the island («VS Code's projects only when I'm using VS Code»), in one view and not in another («hide CPU and RAM in the footer while I'm in the Overview») or by a value of the PC («the charger button only with the battery under 20%»). And they can change colour past a threshold: «the CPU in the footer red above 80% and orange above 50%», «disk C red when it has less than 10% free».

At the top the character tells you what's going on in a speech bubble. **Right-clicking** inside the island opens a menu with the tab's and EasyIsland's actions.

## The field at the top
One field searches **integrations, sessions, ⚡ actions and installed programs** (Store apps too); typing "today", "tomorrow" or "day" offers **My day today / tomorrow**, which asks the chat for the summary of the day. After three letters it also searches **everywhere**: Notion pages, RDM connections (with Devolutions Cloud **every entry and folder**, opened in the island's RDM card), **memory** pages (the map opens on the page), **past conversations** (they come back in the chat) and **Zammad tickets** (opened in the browser), **3CX phonebook contacts** ("Call …"), when those integrations are on, and the **PC's files** (recently opened ones and those in the Windows index: <kbd>Enter</kbd> opens, <kbd>Shift</kbd>+<kbd>Enter</kbd> shows it in its folder; turned off in Settings → Look → "PC files"). **Open windows** come before the program: typing "outlook" with Outlook already open, <kbd>Enter</kbd> brings it forward instead of opening another. It also finds **Windows pages and commands**: "bluetooth", "printers", "sound", "wifi", "startup apps", "device manager" open the right page; "lock", "sleep", "restart", "shut down" (the last three ask first), "recycle bin", "task manager". "what I did" opens the list of actions with Undo. If you type a **question** the memory surely knows ("which VMs does the Falchi pharmacy have?"), when you stop typing the **quick answer** appears above the results, with its sources, "Copy" and "Ask the chat"; if it is not sure it does not appear. Who writes it (the memory's lines, the Model on this PC or an engine) is chosen in Settings → Chat → "Quick answers in the search". Arrows to choose, <kbd>Enter</kbd> to open, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to ask the chat what you typed, "Search with Google" at the bottom, <kbd>Esc</kbd> to clear. It can be turned off in Settings → Look.

## Quick replies, with the island closed
With **Quick replies** on, next to the closed character you get:
- who is working and what it's doing;
- **Deny / Allow** on simple permissions (questions, plans and risky commands always open the full card);
- **Answer / Decline** on 3CX calls and, during the call, the duration, **Mute** and **Hang up**;
- during a Teams meeting **Microphone**, **Video**, **Leave**;
- while recording, the red dot, the time and **Stop**.

## The bar of the app in use
Next to the closed character a bar can show actions for **the app you're using** (like a Touch Bar): your quick actions for that program and **Keys** actions that press shortcuts for you. Set it up in Settings → Quick actions.

## Cards that come by themselves
The island opens on its own when needed, following the notification rules:
- agents' **permissions and questions** (they stay until you answer; "Later" or <kbd>Esc</kbd> fold them away);
- **session finished** with the last message and **Continue**;
- incoming **calls**, starting **meetings**, **alerts** from integrations and widgets;
- **suggestions at the right moment**: download finished, error copied, dev server started, copied password to clear from the clipboard (see [Files and screen](17-files-and-screen.md));
- **recaps**: morning, end of day and the agents' weekly recap;
- available **updates**.

## From the keyboard
| Keys | What it does |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Space</kbd> | Opens the island (Overview, actions or chat) |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | Chat with the copied text or image already attached |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> | Clipboard history |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Box and ask |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> | Selected text into the Collection, with its source |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Goes to the pending request: <kbd>N</kbd> deny, <kbd>Y</kbd> allow, <kbd>S</kbd> always, <kbd>1</kbd>–<kbd>9</kbd> pick |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | Brings the session's app to the front |
| <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> | Menu of actions on the selected text, in any app |
| <kbd>←</kbd> <kbd>→</kbd> in the island | Previous / next tab |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> / <kbd>Ctrl</kbd>+<kbd>P</kbd> | New chat / keep open |

Every shortcut can be changed in Settings → Quick actions. With the mouse the island doesn't take the keyboard, so it never steals it from the app you're using.

## The notification area icon
Open, Settings…, **Do not disturb** (only permission requests open the island and sound), **In front of a client**, Weekly recap, **Pause** (stops checks, automations and alerts) and Quit.
