# Privacy and security
> section: Reference
> summary: What stays on the PC, what leaves it, where secrets live and what EasyIsland will never do.

## What it never does
- **Send an email** or **approve a permission** without your click. Only exception: Telegram's "Automatic" turned on by you, which still asks about deletions.
- **Run arbitrary commands** on this PC from the AI's tools: only your quick actions, or terminal mode with a permission for each command.
- **Delete**: tools don't delete, except a Notion row to its trash after your yes in the chat; the working folder uses the Windows Recycle Bin; the memory archives and never deletes.
- **Overwrite** agents' configurations: first a dated backup, the diff and your confirmation.
- **Block an agent**: if EasyIsland doesn't answer, the agent carries on by itself.
- Accept everything without checks: the mode that skips every permission doesn't exist.

## Secrets
API keys, tokens, passwords and secret links live in the **Windows Credential Manager**, never on disk, never in the interface, never in git, never in backups. The interface can only ask whether a key exists. Remote access passwords stay only in memory while the connection is open. The Notion and RDM maps on disk are encrypted with Windows data protection (DPAPI).

## Network
**No telemetry.** Requests only go:
- to the services you configure (AI engines, integrations, widgets, custom integrations to the hosts written in their description);
- to GitHub for the **update check**, which can be turned off in Settings → General.

Updates install **only after a click**, with the **signature verified**. No port is opened on the PC (Telegram uses long polling).

## What stays on the PC
| Data | Where | Notes |
|---|---|---|
| Chat history | `%LOCALAPPDATA%\EasyIsland\chats.json` | Up to 100 conversations; can be cleared or turned off |
| Memory, diary, pages | `%APPDATA%\EasyIsland\memoria` | Readable .md files; off together with the history |
| Tasks, skills, custom integrations | `%APPDATA%\EasyIsland` | Readable files |
| Clipboard | In memory only | Password managers' private items aren't recorded |
| Agents' changes | In memory only | 50 changes, one hour at most |
| Agents' recaps | `recap.json` | Only numbers and folder names |
| Habits (if on) | On the PC | Only program names and times, 45 days, erased with one click |
| Log | `%LOCALAPPDATA%\EasyIsland\easyisland.log` | Technical events, no contents |

## In front of a client
During calls, meetings and remote support the character hides and no name, title or text appears on screen. See [Profiles and notifications](06-profiles.md#in-front-of-a-client).

## AI models
What you write in the chat goes to the engine you choose. With free online models data may be used for training: for client data use a paid plan or a local model (Ollama, LM Studio), which doesn't leave the network.
