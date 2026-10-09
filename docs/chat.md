# Chat e agente che usa il PC

## Motori
- Il motore predefinito è `settings.chatEngine`. Il menu nella chat sceglie un motore solo per la conversazione in corso: `State.chatEngineOverride`, mai salvato, passato a `chat_send` come `engine`. Il menu mostra «(predefinito)» e solo i motori pronti.
- L'elenco e i nomi stanno in `CHAT_ENGINES` di `src/core/state.ts`. Il modello di ogni motore è in `engineModels`, l'indirizzo dei server locali in `engineUrls`. Il modello si salva anche mentre si scrive (dopo mezzo secondo di pausa).
- `src-tauri/src/claude.rs`: API di Anthropic con la chiave.
- `src-tauri/src/claude_cli.rs`: lancia `claude -p` con l'abbonamento dell'utente. `needs_login` riconosce un login scaduto e lo spiega in italiano.
- `src-tauri/src/openai.rs`: OpenRouter, OpenAI, Gemini, Ollama e LM Studio con un client compatibile OpenAI in streaming. Usa l'evento `chat-stream`, nasconde il ragionamento e non ha strumenti.
- Le risposte sono markdown, disegnate da `src/core/markdown.ts`.

## Cronologia (`src-tauri/src/chat_log.rs`, `src/views/chat.ts`)
- Ogni turno riuscito finisce in `chats.json` in `%LOCALAPPDATA%\EasyIsland` (al massimo 100 conversazioni, scritto intero e poi rinominato). Si tiene ciò che la chat mostra e, per i motori che rimandano tutta la conversazione (API, OpenRouter, OpenAI, Gemini, Ollama, LM Studio), i messaggi del modello senza i byte dei file allegati (`without_files`).
- Si riapre dall'orologio in alto nella chat: la lista prende il posto della conversazione e l'isola si allunga (`fitHeight`). Riaprire sostituisce la conversazione in corso e torna al suo motore (`chatEngineOverride`).
- Claude Code (`claude -p`) e opencode tengono la conversazione in una sessione loro, che non sopravvive in modo affidabile: riaperte, ricevono la conversazione di prima come testo davanti alla prima domanda (`Chat::take_preamble`, ultimi 24.000 caratteri). Se il turno fallisce, il testo resta per il tentativo dopo.
- Impostazioni → Chat → Cronologia (`chatHistory`) la spegne e la cancella; «Cancella la cronologia» la svuota. Niente esce dal PC.

## opencode come motore (`src-tauri/src/opencode.rs`, opencode 2)
- Server privato `opencode serve`: porta libera, password casuale, `EASYISLAND_INTERNAL`. `find_exe` cerca l'exe vero dietro gli shim di npm. Il server si spegne dopo 10 minuti senza messaggi e all'uscita (`opencode::shutdown`, `actions::kill_tree` con tutto l'albero dei processi). `generation` evita che il timer di un server vecchio spenga quello nuovo.
- Una sessione per chat, con le regole di `rules()`: `*`=ask, lettura e ricerca consentite, `.env` e `question` negati. Le sessioni create da EasyIsland (`OURS`) vengono cancellate (`forget`) con «Nuova chat», al cambio di motore e allo spegnimento. Se opencode non conosce più la sessione (`SESSION_GONE`) se ne apre una nuova.
- Un turno apre `/api/event`, manda `/prompt` e porta il testo con `chat-stream`. I passi diventano righe `> ⚙ …`. Se non arriva nessun evento per 3 minuti, il turno è interrotto.
- I permessi vanno sulla card dell'isola con `pipe::request_decision`. «Sempre» è offerto solo per i comandi di sola lettura (`read_only()`). Nessuna risposta vale `reject`. Un rifiuto diventa la risposta «Permesso negato».
- Il modello è `fornitore/modello` in `engineModels.opencode`. Sui modelli `opencode/…` (Zen) compare un avviso sulla privacy.
- **Prezzo dei modelli:** «Carica modelli» riceve `ModelOption` (`openai.rs`) con `price` gratuito / a pagamento / locale e il costo in dollari per milione di token. opencode lo prende da `cost` di `/api/model` (una lista di fasce, la prima è il prezzo base; Ollama e LM Studio sono sempre «locale»), OpenRouter da `pricing`. Gli altri motori non lo dicono.
- **API di opencode 2** (diversa dalla 1.x): endpoint sotto `/api/…`; eventi `session.text.delta`, `session.tool.called/success`, `permission.asked` (`action`, `resources`, `save`); risposta con `POST /api/session/{id}/permission/{rid}/reply` e `{"decision"}`; regole `{action, resource, effect}`, dove l'ultima vince.
- Il trait `Ask` esiste perché i test non tocchino la webview (vedi `sviluppo.md`). Test dal vivo: `cargo test --lib opencode::tests::live -- --ignored`.

## Connettori MCP (chat con l'abbonamento)
- Senza connettori: solo WebSearch/WebFetch/Read, con `dontAsk` e `--strict-mcp-config`.
- Con connettori scelti nel profilo (`mcpServers`): `--permission-mode default`. I server non scelti finiscono in `--disallowedTools`, quelli senza conferma in `--allowedTools`. Le altre chiamate passano dall'hook `PermissionRequest` → `easyisland-hook.exe PermissionRequest --chat` → card Consenti/Nega nell'isola.
- `easyisland-hook.exe` ignora i processi con `EASYISLAND_INTERNAL`, tranne le chiamate con `--chat`.
- I connettori di claude.ai non funzionano in `claude -p`.

## Agente: Claude che usa il PC
- `easyisland-hook mcp` (`hook/src/mcp.rs`) è un server MCP stdio con gli strumenti di EasyIsland. Ogni chiamata va all'app sulla named pipe (`EasyIslandTool` in `pipe.rs`) e la esegue `src-tauri/src/agent.rs`.
- La chat con l'abbonamento lo carica con `--mcp-config` (`claude_cli.rs`, `agentTools`). Sono pre-consentiti solo gli strumenti in `AGENT_READ_ONLY` (stessa lista in `mcp.rs`). Il resto passa da Consenti/Nega.
- **Mai** aggiungere uno strumento che esegue comandi arbitrari, invia email o elimina. Per eseguire c'è solo `run_quick_action`. Le automazioni dalla chat passano da `create_automation`, controllata da `automations::validate`, con anteprima nella card.
