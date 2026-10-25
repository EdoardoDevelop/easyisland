# The island
> section: Getting started
> summary: How it opens, what it holds and how to use it with the mouse and the keyboard.

## The character and its states
At rest the character sits in the corner you picked (top centre by default). It changes colour with the most urgent state: **blue** while an agent works, **amber** for a pending permission, **red** for an error, **green** when something finished well. When a tab is open it wears that integration's colour.

| What you do | What happens |
|---|---|
| Hover over the character | It grows, hops, looks at you and waves |
| Click, or stay over it for a moment | The island opens, aligned to that side |
| Drag the character | It moves where you drop it, even to another screen; the position is saved in the profile |
| Drag the bottom corner of the open island | Width and height change up to the screen edges. Double-click: default sizes |
| Drag the open island by its top bar | It stays there while open, then goes back to the character |
| Click the character several times | It gets annoyed; three in a row and it gets dizzy |
| Leave the pointer on it for two seconds | Hearts |
| Drag a file onto the island | It becomes a box, swallows it and asks what to do |
| Drag the character onto a folder in File Explorer or a desktop icon | The path lands in the chat field |
| <kbd>Esc</kbd> or ✕ | Closes the island at once |
| The button with three nodes, at the top | Opens the [memory map](11-memory.md) |
| 📌 | **Keep open**: the island won't close by itself until you remove it |
| — and ▢ | With **Like an app** on (Settings → Island): minimize and full screen. Open, it has its icon on the taskbar and shows in Alt+Tab; closed, it does not. To open it from the taskbar, pin EasyIsland to the taskbar: a click on the icon opens the island. Right-click the icon: your quick actions, **Open the island**, **Ask the chat**, **Box and ask**, **Settings…** |
| Stay open | With **Stay open** on (Settings → Island), when you open it yourself it does not close by itself, as with 📌 |
| A window opens over the island (a picker, a program launched from the island…) | The island goes **behind** it, without closing. It comes forward again when you click it, when a permission or a call arrives, or when it tucks away |

## The menu on the left
In the open island, under the character:
- **Overview**: every integration and agent as tiles, each with its state. A click opens the tab; drag to reorder.
- **Agents**: coding agent sessions and tasks (see [Coding agents](07-agents.md) and [Tasks](12-tasks.md)), with how many are working.
- **Chat**: the [chat](08-chat.md) with the AI engine.
- **Actions**: your [quick actions](13-actions.md) and suggestions for the app in use.
- **Files and screen**: file drop, Tray, working folder, Box and ask, Record (see [Files and screen](15-files-and-screen.md)).
- **Your integrations**, each with its logo or an emoji and a dot when there's news; [custom integrations](22-custom-integrations.md) too.

At the top the character tells you what's going on in a speech bubble. **Right-clicking** inside the island opens a menu with the tab's and EasyIsland's actions.

## The field at the top
One field searches **integrations, sessions, ⚡ actions and installed programs** (Store apps too). Arrows to choose, <kbd>Enter</kbd> to open, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to ask the chat what you typed, "Search with Google" at the bottom, <kbd>Esc</kbd> to clear. It can be turned off in Settings → Look.

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
The island opens on its own when needed, following the profile's notification rules:
- agents' **permissions and questions** (they stay until you answer; "Later" or <kbd>Esc</kbd> fold them away);
- **session finished** with the last message and **Continue**;
- incoming **calls**, starting **meetings**, **alerts** from integrations and widgets;
- **suggestions at the right moment**: download finished, error copied, dev server started, copied password to clear from the clipboard (see [Files and screen](15-files-and-screen.md));
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
Open, Settings…, **Profile ▸**, **In front of a client**, Weekly recap, **Pause** (stops checks, automations and alerts) and Quit.
