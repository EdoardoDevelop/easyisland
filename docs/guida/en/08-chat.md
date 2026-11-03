# The chat
> section: Artificial intelligence
> summary: Writing, attaching, / and @ commands, assistants, dictation, history, second opinion.

![The chat from the island](../media/chat.png)

## Writing
- The field is **multi-line**: <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line. What you're writing survives a restart. <kbd>↑</kbd> in an empty field brings back the last question.
- Answers are in **markdown**: headings, lists, tables, code with **Copy**. While the engine works you see its reasoning and the tools it uses.
- **■ Stop** interrupts the answer in progress (and the pending permission).
- **You can keep writing while it answers**: <kbd>Enter</kbd> puts the message **in the queue**, under the conversation as "waiting", and it goes by itself as soon as the answer ends, one after the other. On each queued message: **Send now** (stops the answer and sends it now), **Edit** (back in the field) and ✕. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends it at once, skipping the queue. With an empty field the button stays **■ Stop**.
- If you scroll up to read, incoming text doesn't pull you down: ↓ goes back to the bottom.
- **Calculator**: type `840 + 22%` or `15% of 840` and the result appears right away, computed locally. <kbd>Enter</kbd> copies it, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> asks the chat anyway.

## Under each message
- **Copy**.
- **Edit** (on your questions): the text goes back to the field and the conversation restarts from there.
- **↻ Regenerate** (on the last answer).
- **⑂ Branch from here**: a new conversation starting from that point; the previous one stays whole in the history.
- **⇄ Second opinion**: another engine rereads the last question and answer and points out mistakes, gaps or risks (or "looks good"). Its review also reaches the main engine, which can correct itself.

## Attaching
| How | What |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | The copied text or image |
| 📎 next to the microphone, or `@file` and `@cartella` | One or more files, or whole folders, chosen from the PC |
| <kbd>Ctrl</kbd>+<kbd>V</kbd> in the field | Images, and every file and folder copied in File Explorer |
| Dragging files or folders onto the island | Attached to the question, without restarting the conversation |
| `@appunti` | The copied text or image |
| `@finestra` | A picture of an open window |
| `@vassoio` | A file from the Tray |
| Dragging the **chat character** onto a window | That window as context (image, app name, title). <kbd>Esc</kbd> cancels |
| **Box and ask** | An area of the screen (see [Files and screen](17-files-and-screen.md)) |
| **Ask the chat** in Clipboard, Tray, Notion | The chosen item |

Attachments appear **inside the field**, above the text: 📄 a file, 📁 a folder, 📋 copied text; ✕ removes one you don't need. You can add more than one (up to 20) and they all go with the question. For a folder the engine gets its path and the list of files inside; Claude Code and opencode can also open them.

Images go to models that can read them, text files into the message, PDFs to Claude.

## / commands
Type `/` and pick from the menu (arrows, <kbd>Tab</kbd> or <kbd>Enter</kbd>):

| Command | What it does |
|---|---|
| `/nuova` | New conversation |
| `/cronologia`, `/cerca` | Past conversations, also by words |
| `/ricorda …` | Saves a note to memory without going through the model |
| `/memoria` | Opens the memory |
| `/esporta` | The conversation as Markdown in the Tray |
| `/motore` | Changes engine for this conversation |
| `/oggi`, `/domani` | The day: tasks, appointments, tickets |
| `/compito …` | Hands a goal to a [task](14-tasks.md) |
| `/<action>` | Runs a quick action by name (e.g. `/daily-backup`) |
| `/<skill>` | Uses a [skill](14-tasks.md#skills) |
| `/<assistant>` | New conversation with an assistant |

A `/something` that is not a command goes to the engine as text. (Command names are in Italian in both languages.)

**Templates with fields**: a quick action of type "Ask the chat" with `{{client}}` in the text, picked from `/`, lands in the field instead of being sent; <kbd>Tab</kbd> jumps from one field to the next.

## Assistants
In **Settings → Chat and AI engines → Instructions and memory** you create assistants with **name, emoji, engine and instructions** (for example "SQL reviewer" or "Technical translator"). In the chat you call them with `/name`: a new conversation starts on their engine, with the 🤖 chip.

## Instructions
**Settings → Chat and AI engines → Instructions**: a text told to the chat at the start of every conversation ("Answer briefly. I'm a technician, my clients are small offices…"). It belongs to the profile, so each profile can have its own.

## Dictation
🎤 in the field: click to start and to finish. With a transcription service chosen in Settings → Telegram → Voice messages, it records and transcribes with it; without one, it opens Windows dictation (<kbd>Win</kbd>+<kbd>H</kbd>), local and free.

## Talking to the island
From any program press <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> and speak: the island shows it is listening and, when you pause, transcribes and sends the question to the chat. You can also finish with **End** or by pressing the shortcut again; **Cancel** (or <kbd>Esc</kbd>) throws it away. The reply shows in the chat and, with **Reply aloud** on, is also heard from the speakers; <kbd>Esc</kbd> or the shortcut stop it.

The microphone turns on **only** when you press the shortcut, never by itself. It needs the voice message service (Settings → Telegram → Voice messages); the voice that replies is there with OpenAI and Google AI. The shortcut and the spoken reply are in Settings → Quick actions.

## History
On the left of the chat is the **conversations bar**: **New chat**, the search and your previous conversations (up to 100, only on this PC) grouped by day. The button at the top left of the chat (or <kbd>Ctrl</kbd>+<kbd>B</kbd>) opens and closes it; while it is open the island grows to make room. Drag its right edge to make it wider or narrower (it stays so); a double click on the edge brings it back as it was.

You can keep **several conversations open at once**: switching to another one does not close the one before, and if it was answering it goes on. In the bar a spinning ring shows who is answering, a dot an answer that came while you were elsewhere, **!** a conversation asking for permission (and a line above the field takes you there). **New chat** leaves the current one open. Beyond 8 open conversations, the least used idle one closes by itself: it stays in the history.

On hover, **✎** (or a double click on the title) renames a conversation: Enter saves, Esc cancels, an empty title goes back to the first question. 📌 keeps it among the Pinned, ✕ deletes it. A click reopens one on its engine and you continue it. With API engines it resumes exactly where it was; with the subscription and opencode the conversation is passed along as text. Settings → Chat → **History** clears or turns it off (turning off the memory diary too).

![The conversation history](../media/chat-history.png)

## In a window
Drag the **Chat** entry of the menu out of the island and let go where you like, or press the arrow button at the top of the chat, or right-click **Chat** → **Open in a window**: the chat becomes a normal Windows window, with taskbar and Alt+Tab, to resize and place where you like. It is the same chat: conversations, engines, permissions and Stop stay the island's, and the **Chat** entry in the menu brings the window forward. Closing the window, or the same button (now «Put the chat back in the island»), puts the chat back in the island; the window remembers its size and place. The **Preview** stays beside the chat in the window too, with the same divider to widen it (the window grows if needed), and goes back to the island with the chat.

## Continuing in Claude Desktop
With Claude Code as the engine, **↗** at the top of the chat opens the conversation in the Claude Desktop app, with everything said so far, and you continue it there. When you write in the island's chat again, the messages written in Desktop show up before your question, under the line «Conversation continued in Claude Desktop», and Claude resumes the same session. Better not to write in both at once. It needs Claude Code 2.1.285 or later and signing in with a Claude subscription (not an API key). In terminal mode the session opens in the project folder.

## Asking from elsewhere
- From the **field at the top** of the island with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
- From **Telegram**, with its own conversation (see [Telegram](22-telegram.md)); `/riprendi` continues there the island's last conversation.
- From an "Ask the chat" **quick action** or the <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> menu on the selected text.
