# Telegram
> section: Connecting services
> summary: EasyIsland's chat in your Telegram bot, with permission buttons, files both ways, voice messages, tasks and the day.

## Linking the bot
1. On Telegram write to **@BotFather**, `/newbot`, and copy the **token**.
2. **Settings → Integrations → Telegram**: paste the token (it goes into the Credential Manager).
3. **Link**: you get a 6-digit code valid for 10 minutes. Send your bot `/start <code>` from a private chat.

From then on the bot answers **only your chat**. EasyIsland reads Telegram with long polling: no open port, no server in between, only `api.telegram.org`. You can write **with the PC off** too: messages wait on Telegram and EasyIsland handles them in order as soon as it's back, telling you it's doing so. Handy for a "remember that…" while you're out. Telegram keeps them about **24 hours**: older ones are lost.

## The chat on Telegram
A conversation **of its own**, separate from the island's, with engine and model chosen from there. The answer arrives as it's written, with **⏹ Stop**.

| Command | What it does |
|---|---|
| `/nuova` | New conversation |
| `/motore`, `/modello` | Chooses Telegram's engine and model |
| `/stato` | Engine, model, conversation |
| `/riprendi` | Continues here the island's last conversation |
| `/oggi`, `/domani` | The day: tasks, appointments, tickets, weather |
| `/notizie` | The latest news on the subjects you follow |
| `/ricorda …` | Puts what you write in the memory, in the right page |
| `/vassoio` | The Tray's files |
| `/cartella` | The working folder as buttons, with the files |
| `/automatica` | Turns Telegram's Automatic on or off |
| `/compito …` | Creates a task; alone it lists them |
| `/rispondi …` | Answers a task's question |
| `/<skill>` | Uses a skill |

## Permissions
Each permission is a **🔐 Permission requested** message with **✅ Allow** and **❌ Deny**. With terminal mode it works like in the island.

**Telegram's Automatic** (`/automatica` or the switch in Settings): when you're away from the PC, it approves the Telegram chat's permissions by itself, **except deletions**, which it still asks about. It's the only exception to the "never without a click" rule, and only you can turn it on. It never applies to tasks.

## Files
- Photos, documents, videos and audio up to 20 MB go to the **Tray** and reach the engine with the question.
- Every file that enters the Tray during a Telegram answer (an export, a document, a PDF) **is sent to you** on Telegram.

## Voice messages
With a transcription service chosen in **Settings → Telegram → Voice messages**, voice messages become text and the chat answers. The audio isn't kept.

When you send a voice message, a **spoken reply** comes under the written one too (a written message gets a written reply only). It works with Google AI and OpenAI, not OpenRouter; turn it off with **Reply aloud**. Long replies are read for about a minute and a half: the rest is in the written message.

## Tasks and alerts
With Telegram linked you get a message when a task finishes, fails, pauses or asks you something, and you can answer with the buttons. Telegram keeps listening even if the active profile has it off, as long as it's on in any profile.
