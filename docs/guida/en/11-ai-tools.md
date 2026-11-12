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
| Word and PDF documents | Read them; create new Word documents, also from your templates and with pictures; make their PDF with Word; merge and split PDFs | Creating, making the PDF, merging and splitting yes |

Anything that opens, runs or changes something asks **Allow / Deny** in the island, with a clear description.

**Permission levels.** Reading is always free. Actions that can be undone (adding or changing Notion rows and To Do tasks, putting files in the Tray, moving them to the work folder) also have **Always** on the card: from then on the chat does them without asking, until you take them away in **Settings → Chat → Tool permissions**. «Always» is in Telegram's buttons too. **What I did** lists every action that changed something, from the chat, Telegram or a task, with **Undo** for those that can be undone: it is in Settings → Chat and in the island (type «what I did» in the field at the top). When an action goes through without asking, the island tells you, with **Undo** one click away. Sending, deleting, opening, running and changing settings ask every time.

Rules that never change:
- no tool runs **arbitrary commands on this PC** (that's what terminal mode is for, with a permission for each command);
- no tool **sends email**;
- no tool **deletes**, except a Notion row to its trash after your yes in chat.

You can ask in plain words: "open Outlook and the suppliers' portal", "how is the PC doing?", "run the backup", "add to To Do: call Rossi tomorrow", "how much did I spend in October?" (from Notion).

## Word and PDF documents
The chat reads **Word documents** (`.docx`) and **PDFs**: drag them into the chat or the Tray, or say where they are ("read the contract in Documents\Rossi.pdf"). In Word files it also reads the header, tables and footer; in PDFs the text page by page. **Scans** (photos of paper) and password-protected PDFs cannot be read. The same text reaches every engine, even those that cannot open documents themselves, and the memory when you put a PDF or a Word file in "to read".

It can also **write new Word documents**:
- **from scratch:** "write me a letter to Rossi about renewing the contract, in Word";
- **from your own template:** first say "use this file as a template" (a `.docx` or `.dotx` in the Tray or on the PC). EasyIsland keeps a copy and never changes it. In the template, write in braces where the data goes: `{cliente}`, `{data}`, `{numero}`, `{corpo}` for the text, `{righe}` for the table, `{totale}`. You choose the names: `{vat number}`, `{due date}`, `{contact}`… the chat fills them with what you tell it, and tells you which ones stayed empty. Header, logo, footer and styles stay yours;
- **quotes:** the chat only passes the lines (description, quantity, price, VAT): **EasyIsland computes taxable amount, VAT and total**, never the AI, and `{numero}` becomes the year's progressive number for that template (1/2026, 2/2026…).

The document **always goes in the Tray** and in the work folder, or the folder you ask for; it never overwrites a file. With **Word installed** it also makes the **PDF** ("…and the PDF too", or "turn this Word file into PDF"). Every new document asks **Allow / Deny**.

**Pictures:** "put the logo from the Tray at the top" or "add the site photo, 8 cm wide". PNG, JPEG and GIF, at most as wide as the page.

It can also read **a whole folder** of Word files and PDFs ("analyse the quotes in the Offerte PDF folder"), faster and cheaper than extracting the text with other programs.

**Merging and splitting PDFs:** "merge these three PDFs", "first the quote, then pages 1-2 of the terms", "extract pages 3-5", "split the PDF into one file per page" or "into 1-2 and 3-end". A Word file among the ones to merge becomes PDF with Word. The originals don't change; the new files go in the Tray and the work folder. Fillable fields and bookmarks are not copied; protected PDFs cannot be merged (open them and print them with "Microsoft Print to PDF", then merge that copy).

## Recipes: it learns by use
After a successful answer, EasyIsland remembers **which tools** were needed for that kind of question. On a similar question the chat goes straight to the right tools: faster and with fewer tokens. In **Settings → Chat → Recipes** you see how many there are and forget them with one click.

## Terminal mode
**Settings → Chat → Terminal mode**, together with the **working folder**: the chat works like Claude Code or opencode in a terminal.
- **Claude Code** uses your tools, MCP servers, plugins, `CLAUDE.md`, skills, permission rules and hooks, in the chosen folder. Every permission question reaches the island.
- **opencode** works in the chosen folder; "Always" applies to the commands and changes it proposes a rule for.
- **The other engines** (Anthropic API, OpenAI, OpenRouter, Gemini, Ollama, LM Studio) go through opencode with the same provider and model.

Every command appears **in full** on the card before it runs.

**Claude's effort.** In the engine menu (the "Claude (subscription) ▾" button under the field) choose how much Claude reasons: from **Low** (fast and cheap) to **Max**. It applies at once, even mid-conversation, and stays for the next chats; **Claude Code's default** uses its own.

**Background work.** For long jobs Claude can have several agents work at once, or leave commands running. Under the conversation **In the background** lists each job: **✕** asks to stop one, **Stop all** stops them all. Meanwhile you can keep writing. When they end, Claude writes the result as in a normal reply (you see the steps while it works) and the island tells you, even when closed.

### ⚡ Automatic
The ⚡ button under the chat field (terminal mode only) applies **to the current conversation** and is **on by default**: every new conversation starts in Automatic. A click turns it off and it becomes **Manual** (every action asks Allow / Deny). When on, the chat has an amber border.
- **Claude Code**: its automatic mode approves normal actions and blocks risky ones.
- **opencode and the others**: file changes, web and non-sensitive commands go through by themselves. Sensitive commands stay on the card (deleting, `git push` and `reset --hard`, installing, registry, services, network, processes, downloaded code), as do folders outside the working one and connector tools that delete.

**Claude Code's modes**, as in Claude Desktop: with Claude Code the same button goes, at each click, through **Manual** (every action asks Allow / Deny), **Accept edits** (file edits go by themselves, commands ask), **Plan** (Claude reads and prepares a plan without changing anything; you approve it on the card and then it works, and the chat goes back to Allow / Deny) and **Automatic**.

**"Always" holds for the whole conversation**: a command, a site or file edits allowed with "Always" stop asking while the conversation goes on, even after a long pause.

**Pull request.** In terminal mode, if the project has an open pull request and `gh` (GitHub's command line) is installed and signed in, **#12 ✓** shows next to **Project…** (or **✗ 2** with failing checks, **…** running). A click: **Open the pull request** or **Fix the failing checks**, which asks Claude to read the logs and fix them.

**Comments on the changes.** In the Preview, **Changes** view, a click on a line opens a field for a comment to Claude; **Send to the chat** sends them all together and Claude fixes them, as in Claude Desktop's diff.

**Separate work.** Claude can propose to start an independent piece of work in a new conversation (the card asks Allow / Deny): allowed, the conversation opens in the sidebar and goes on by itself beside yours.

**Separate copy.** In **Project…**, **Separate copy (worktree)** makes a copy of the project on a branch of its own (`git worktree`, in `.claude\worktrees`), as Claude Desktop does for each session: the chat works there and does not touch the other chats' files. It needs git installed; the copy stays until you remove it (`git worktree remove`).

The mode that accepts everything without any check **doesn't exist** in EasyIsland, on purpose.

## The working folder
A folder on the PC chosen by you (in **Files and screen** or Settings → Chat) that the chat **reads without asking** and into which it can move files from the Tray. With terminal mode it's the folder it works in. From Telegram: `/cartella`. Details in [Files and screen](17-files-and-screen.md#working-folder).

## Settings changed from the chat
"Put the character at the bottom right", "turn off the weather", "use opencode as the engine": the chat reads the settings and changes one at a time, with Allow / Deny, saving like the Settings window does.
