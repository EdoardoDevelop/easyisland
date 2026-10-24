# AI engines
> section: Artificial intelligence
> summary: Which engine to choose, how to set it up and what each one can do.

The **default** engine is chosen in **Settings → Chat and AI engines**. From the model name at the top right of the chat you pick another one just for that conversation: the menu shows only the engines that are ready.

## Comparison
| Engine | Cost | EasyIsland's tools | Notes |
|---|---|---|---|
| **Claude subscription** (through Claude Code) | Your Pro/Max plan | Yes | The default. Web search, MCP connectors, terminal mode |
| **Anthropic API key** | Pay as you go | Yes | Web search and EasyIsland's tools |
| **opencode** | Free (Zen) or the provider's | Yes | Free, local or connected providers' models, with commands and files |
| **Antigravity** (Google) | Your Google account | Yes | With its own tools |
| **OpenRouter** | Pay as you go | With terminal mode | One key for hundreds of models |
| **OpenAI** | Pay as you go | With terminal mode | |
| **Gemini** (Google AI Studio) | Pay as you go / free | With terminal mode | |
| **Ollama**, **LM Studio** | Free, on your PC | With terminal mode | Nothing leaves the network |

## Claude subscription
EasyIsland uses **Claude Code installed on the PC** (hidden, no windows) with your Pro or Max plan: no key and no extra cost, but questions count towards the plan's limits. Claude Code stays on between messages, so answers start quickly.

> **Important:** you need **Claude Code on the command line**, signed in. The Claude desktop app alone is not enough (its Claude Code uses the app's sign-in, which other programs can't use). Once:
>
> 1. in PowerShell: `irm https://claude.ai/install.ps1 | iex`
> 2. close and reopen PowerShell, type `claude` and sign in with your account;
> 3. in Settings → Chat press **Check again**: the dot turns green.

Without terminal mode, Claude Code works in an empty folder with only web search, reading web pages and reading the files you drop, plus EasyIsland's tools and the connectors you choose.

### MCP connectors
**Settings → Chat → Connectors** (subscription only): the chat can use the MCP servers you configured in Claude Code for your user (`claude mcp add --scope user …`) and those of active Claude Code plugins, choosing which **profile by profile**. With "ask for confirmation" (default) every operation appears in the island with **Allow / Deny**; turn it off only for read-only connectors. EasyIsland reads only the servers' names, never their configuration. claude.ai connectors are not available this way.

## API keys
For Anthropic, OpenRouter, OpenAI and Gemini: the key goes in its field and ends up in the **Windows Credential Manager**. The model is picked from the list with **Load models** (with the price, when the provider gives it). The answer appears as it arrives; the reasoning of models that show it stays hidden.

## opencode
You need **opencode 2** on the PC. EasyIsland starts a private opencode server only while you chat and stops it after 10 minutes. The model is written as `provider/model` (**Load models**); provider keys stay in opencode (`opencode auth login`). The model can run commands, read and modify files and search the web: every command, change or web access asks **Allow / Deny** (**Always** only for read-only commands); no answer means no.

> **Warning:** with free online models your data may be used to train the model: no client data. For that, use a local model.

## Antigravity
Install the CLI with `irm https://antigravity.google/cli/install.ps1 | iex`, then type `agy` and sign in with Google. With Antigravity's hooks installed, its commands ask Allow / Deny in the island.

## Ollama and LM Studio
Models on your PC or another one on the network: no key, just the address (empty = the default one).

## Several engines together
- **Second opinion** under every answer: another engine acts as reviewer.
- In **tasks** you choose an engine per task and **helper engines** to delegate parts of the work to (see [Tasks](12-tasks.md)).
- **Skills** can state their preferred engine.
- **Telegram** has its own engine and model, chosen with `/motore` and `/modello`.
