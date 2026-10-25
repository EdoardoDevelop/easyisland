# Tasks, Heartbeat and Skills
> section: Artificial intelligence
> summary: In the Flows page, together with automations. The personal agent: goals EasyIsland carries forward on its own, periodic checks and your own procedures.

## Tasks
A **task** is a goal you hand to EasyIsland and that it carries forward **on its own**, even while you do something else: it writes a plan, carries it out with the tools, asks you what only you know and finally gives you the result.

Examples: "check tickets open for more than 3 days and prepare a summary", "every Monday at 8 give me the state of the Notion deadlines", "find three NAS suppliers and compare prices".

### Creating one
- **In the chat**: `/compito …`, or ask "do it as a task", "every day at 9…": the chat proposes the task and you create it with Allow.
- **Settings → Flows → New task**: title, goal, when, engine.
- **From Telegram**: `/compito …`.
- **From an automation**: the "Task" step.
- **From a custom integration**: a button of type "task".

### When
| Choice | Example |
|---|---|
| Now | Starts as soon as there's room in the queue |
| Once, at a time | 24/10 at 15:00 |
| Every day | at 9:00 |
| On weekdays | at 8:30 |
| Every week | Monday at 8:00 |
| Every N minutes | every 60 minutes (at least 15) |

### How it works
1. It writes the **plan** (a few concrete steps) and marks each step done.
2. It uses [EasyIsland's tools](10-ai-tools.md) and the engine's, with the usual **Allow / Deny** for anything that changes something.
3. If it needs a decision or a piece of information, it asks you a **question**: a card in the island with options and a free answer, and also on **Telegram** if linked. The first answer wins.
4. It closes with the **result**, short and useful. If it was a check with nothing to say, it closes **quietly**.
5. If the procedure could be useful again, it proposes saving it as a **skill**.

It doesn't send emails, delete or approve anything by itself: it prepares drafts and leaves the last click to you.

In the island each task is a session of the **Tasks** agent in the Agents tab, with plan, steps, questions and permissions like Claude Code. One task at a time; the others wait in the queue.

### States and commands
Waiting for its time, Queued, Working, Waiting for an answer, Paused, Done, Failed, Stopped. From Settings (and the island) you can **run now**, **pause**, **resume**, **stop**, **answer**, **delete** and read the task's **log** (a `.md` file).

**Limits** (Settings → Flows): maximum turns and minutes per run (12 turns and 30 minutes by default), then the task pauses and tells you.

### One engine per task, and helper engines
- Each task can have **its own engine and model** (for example free opencode for checks, Claude for writing).
- You can give it **helper engines**: the leading engine can hand one of them part of the work (a search, a review, a draft) and get the result back, like agents do with sub-agents.

### On Telegram
With Telegram linked you get a message when a task finishes, fails, pauses or waits for an answer. Answer with the buttons or with `/rispondi …`. Tasks' permissions arrive there too (never auto-approved, not even with "Automatic").

## Heartbeat
A **periodic check**: every N minutes the agent looks at the things you wrote in `BATTITO.md` and tells you **only if there's something**.

```
- urgent unassigned tickets in Zammad
- client mails unanswered for more than a day
- today's deadlines in Notion
- disk space under 10 %
```

**Settings → Flows → Heartbeat**: choose how often and open the list with **What to keep an eye on…**. With an empty list it doesn't run and costs nothing.

## Memory digest
Every evening at 22:30 it rereads the day, proposes what to remember, learns from the files in `da-leggere` and on Sundays checks the memory. Turn it on in **Settings → Flows**; details in [Memory](11-memory.md#the-evening-digest).

## Skills
A **skill** is a procedure of yours written in a `.md` file: how you make a quote, how you close a ticket, how you prepare the monthly report. The AI reads it **only when needed**, so you can have many at no cost.

```
---
nome: Ticket closing
descrizione: How to close a Zammad ticket with the summary for the client
motore: subscription
strumenti: list_status, notion_add_row
---
1. Reread the ticket and the internal notes.
2. Write the summary in three lines, no jargon.
3. Add the row to the "Interventions" database in Notion.
4. Leave sending the reply to me.
```

- **Where**: `%APPDATA%\EasyIsland\abilita\`. In **Settings → Flows → Skills** you create, edit, delete them and open the folder. The header keys are in Italian (`nome`, `descrizione`, `motore`, `strumenti`).
- **How they're used**: the chat and tasks see the list (name and description) and read the right one when needed. Each skill is also a **command**: `/ticket-closing` in the chat and on Telegram.
- **Engine**: a skill can state the preferred engine; a task uses it by delegating that step.
- **They improve by themselves**: at the end of a task the agent may propose saving the procedure as a new skill (with Allow / Deny).
