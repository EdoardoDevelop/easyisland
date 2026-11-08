# Handoff — EasyIsland

_7 novembre 2026. **1.0.33** in `main` (tag `v1.0.33`). Si lavora su `claude/sviluppo` (uniti `telegram-voce`, `cattura`, `vocale-ricorda`, `ticket-simili`, `voce-pc`, `agentchat`, `agentchat-autonomi`); in attesa `claude/modello-integrato`. Repo pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale; il funzionamento sta in `docs/` (indice in `CLAUDE.md`).

## Da fare
- [ ] **Notizie** (`docs/chat.md` → Notizie, piano in `docs/idee.md`): fatte (1.0.14–1.0.15) argomenti anche scelti da un motore (mai persone né il nome dell'utente), Google/Bing News, vista elenco/miniature/schede, «Di più»/«Non mi interessa», Panoramica, Buongiorno, Telegram, barra, scheda fissa. Da provare dal vivo; mancano riassunti del motore e argomenti cambiati dalla chat.
- [ ] **Allegati della chat** (1.0.15, `docs/chat.md` → Allegati): più file, cartelle, 📎. Da provare con i vari motori.
- [ ] **Personaggio e isola in due finestre** (`docs/due-webview.md`, `docs/architettura.md`): da provare ai lati e su un secondo schermo (in basso e file rilasciati provati il 29/10).
- [ ] **Barra fissa** (`docs/architettura.md` → Barra fissa): provata in alto; da provare in basso, secondo monitor, menu «…».
- [ ] **Widget della barra** (1.0.13+, `barsys.rs`, card in `src/views/barcard.ts`): da provare dal vivo, soprattutto «Nascondi da sola», sfocatura, winget. Mancano Wi-Fi, Bluetooth, temperature (`docs/idee.md`).
- [ ] **Aspetto a schede con le immagini** (`docs/architettura.md` → Impostazioni): modalità chiara non guardata.
- [ ] **Integrazioni personali** (`docs/integrazioni.md`): da provare con l'app vera. Le 7 voci URGENTI del 7/11 sono nella 1.0.33; PDF, nome del file e riga di «Salvate» provati dal pulsante con «DDT Easytech». Provare dal vivo pulsante script, `quick_action_*`, «In esecuzione» e i motori di Agent Chat nella cartella del progetto, con turni veri, «DDT Easytech» è sul modello HTML con PDF diretto, provato dal pulsante il 7/11.
- [ ] **Guida sul sito** IT/EN (`docs/guida/`, `docs/guida/en/` → `site/guida/`, `site/en/guide/`; homepage EN `site/en/index.html`, schermate EN `site/media/en/`): allineare a ogni funzione nuova (`node scripts/guida.mjs`). Link delle Impostazioni nella lingua dell'app: prossima versione.
- [ ] **Documenti Word e PDF nella chat** (7/11, `docs/chat.md` → Documenti Word e PDF): fatti leggere `.docx` e PDF, creare `.docx` vuoti o dai modelli con preventivi calcolati e immagini, PDF con Word, unire e dividere PDF. Lettura e modelli provati dalla chat il 8/11; immagini, unione e divisione provati con Word e PDF veri, non ancora dalla chat. Il resto in `docs/idee.md`.
- [ ] **Agente personale** (priorità alta, 23/10): fatti Compiti, motori aiutanti, Battito, Abilità, permessi per livelli (1.0.16: «Sempre» sulle reversibili, permessi per compito, «Cosa ho fatto» con Annulla; `docs/chat.md`). Da provare dal vivo. Prossimi: proattività su ticket e chiamate, memoria per cliente (`docs/idee.md`).
- [ ] **Prove dal vivo** delle versioni 0.6.3–0.9.7: elenco in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): fatti `/oggi` e `/domani` (Telegram, chat), voce nel campo in alto e azione rapida, riassunto IA in Buongiorno/Fine giornata con motore a scelta, invio Telegram all'ora scelta (orari in `giornata.rs`). Da provare dal vivo.
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (Graph):** predisposto; da provare registrando l'app in Entra, poi avvisi mail, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Secondo cervello**, **chat nuova e memoria**: da provare con memoria e motori veri (`docs/chat.md`, `docs/prove-dal-vivo.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova sul PC con RDM, poi passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file** («Manda a EasyIsland», azioni sui file; deciso l'11/10, `docs/idee.md`).
- [ ] **opencode:** card per `question` anche nella chat, controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Agent Chat** (1.0.18–1.0.21): server sulla VPS, token `casa` collegato. Server pubblicato sulla VPS (uguale a `main` del repo `agentchat`, controllato il 6/11): provare stati e scrittura dall'isola con i due PC. Da provare: risposte dei motori, capo che affida un lavoro, ascolto spento dall'isola, un «ciao» con due PC accesi (risponde uno solo), `@nome`, nome già preso. Memoria condivisa (lavoro «Condividi la memoria» Sì; casa «Memoria di un altro PC» = lavoro): ricerca da casa con lavoro acceso e spento; nota di lavoro da casa a lavoro spento, poi riaccenderlo.
- [ ] **Spunti dall'app originale:** Amp/Hermes, limiti di Codex, riepilogo come immagine, GitHub (`docs/idee.md`).
- [ ] **Modalità chiara:** funziona, poco usata: provare schede dell'isola e Impostazioni con l'app vera, correggere in `src/style-light.css` / `settings-light.css` (i colori in linea nel TS non cambiano).
- [ ] **Flussi** (`docs/flussi.md`): da provare con flussi veri, soprattutto agente con campi, scelta del modello, ripresa dopo riavvio.
- [ ] **Isola fissa, barra riservata** con tre aree scelte dall'utente, personaggio non trascinabile: decisa; primo passo una prova della barra di Windows (`docs/idee.md`).
- [ ] **Modello integrato** (accantonato 27/10): branch `claude/modello-integrato`, manca la prova dal vivo.
- [ ] **Recapiti tra due EasyIsland** senza VPN né cloud: da valutare (`docs/idee.md`).
- [ ] **Pulizia strutturale** (27/10):
  - immagini della guida rotte su GitHub (`../media/` da `docs/guida/` punta a `docs/media`): percorso vero verso `site/media/`, corretto da `guida.mjs`; niente symlink;
  - `island.rs` `on_foreground_change` crea un thread a ogni cambio di finestra: basta un contatore che faccia uscire i vecchi;
  - test front end con `node --test`, prima `expr.ts`, `markdown.ts`, `calc.ts`;
  - 170 testi inglesi «inutilizzati» di `check:i18n`: alcuni sono composti al momento, guardarli uno per uno.
- [ ] **Inglese lingua principale nell'app** (27/10): oggi chiavi in italiano e avvio in italiano. Da decidere: solo lingua predefinita delle nuove installazioni o anche chiavi in inglese.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest`, nota a mano con freccia (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro; torna davanti al cambio di finestra. Verificare con Start aperto.
- **Limiti del piano da Anthropic:** `/api/oauth/usage` non è documentato; se smette, il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): parte invisibile, apre `/usage`, si chiude senza processi; il rinnovo di un accesso scaduto va visto alla prossima scadenza. Dopo, Claude Code può usare una volta il renderer classico.
- **Chiave salvata in opencode vince su quella di EasyIsland** (2/11): in Modalità terminale OpenRouter, OpenAI, Gemini e API Anthropic passano da opencode (`opencode::via`, chiave in `OPENROUTER_API_KEY` ecc.), che preferisce la sua (`opencode auth list`). Sintomo: «User not found» solo in `~/.local/share/opencode/log/opencode.log`. Risolto a mano con `opencode auth logout openrouter`. Da fare: far vincere sempre la chiave di EasyIsland (`providers.openrouter.settings.apiKey` in `OPENCODE_CONFIG_CONTENT` non ha funzionato) o dirlo nell'errore.

## Registro
Max 5 voci, la più recente in alto; le vecchie in `docs/archivio/registro.md`.

### 8/11 — Dal portatile: meno token, niente domande perse, niente password su disco
Analisi di 41 chat, log e sessioni di Claude Code del portatile (`docs/chat.md`). PDF senza intestazioni e piè ripetuti, cartelle senza righe già date (-13 % sui 62 PDF delle offerte), `MAX_MCP_OUTPUT_TOKENS` a 50.000, sotto-agenti di sola lettura su Sonnet e strumenti di EasyIsland al posto dei comandi (prompt), Read/Grep/Glob senza card. Domanda in cronologia appena mandata (`chat_log::begin`), password mascherate in cronologia e memoria (`redact.rs`, una pulizia all'avvio), note doppie rifiutate, opencode in pausa a credito finito. Poi `/compatta` (Claude Code: il suo `/compact` con «da X a Y token»; altri motori: riassunto e ripartenza) e anello del contesto anche dopo i lavori in background (mancava). Conversazioni di Claude Code riaperte dalla cronologia: stessa sessione con tutto il contesto e anello subito, come Claude Desktop (`chat_log` `session`, `desktop::session_in`/`last_context`). Poi pari a Desktop: «Sempre» per tutta la sessione, Modifica/Rigenera/Dirama nella stessa sessione (`--resume-session-at`), Accetta modifiche e Piano, comandi di Claude Code nel menu «/», sessioni del terminale in cronologia, ⟲ File (`checkpoints.rs`), lista delle attività, copia separata (worktree). Da provare sul portatile.

### 8/11 — Lavori in background nella chat
Sul portatile Claude Code aveva lasciato 4 sotto-agenti in background: i loro risultati venivano letti e buttati, e un messaggio scritto intanto apriva un secondo processo che li rilanciava. Ora lista sotto la conversazione con ✕ e «Ferma tutto», messaggi allo stesso processo, risultati nella chat con avviso (`docs/chat.md` → Modalità terminale). `document_read` legge anche una cartella intera. Provato sul portatile con 6 agenti e 62 PDF: risultati e confronto finale arrivati; aggiunto il turno «al lavoro» mentre Claude scrive da solo, i passi che si scrivono con i caratteri, le frasi d'attesa mentre ragiona e l'impegno di Claude nel menu del motore (sul portatile era quello predefinito, più alto).

### 8/11 — Immagini nei Word, unire e dividere PDF
`![didascalia](percorso)` nel corpo di `document_create` (PNG, JPEG, GIF, larghe al massimo quanto la colonna); `pdf_merge` (anche estrarre e riordinare, Word convertiti prima) e `pdf_split` in `pdfpages.rs`, con il parser di `pdftext.rs`. PDF cifrati rifiutati. Revisioni e commenti esclusi.

### 7/11 — Documenti Word e PDF nella chat
`document_read`, `document_templates`, `document_template_add`, `document_create`, `document_pdf` (`docx.rs`, `ooxzip.rs`, `pdftext.rs`, `documents.rs`): ZIP e lettore PDF scritti in casa, nessuna dipendenza nuova (`flate2`, `crc32fast` erano già nell'albero). Modelli in `documenti\modelli`, segnaposto anche spezzati fra run, totali e numero calcolati dall'app, PDF con Word. Testo dei PDF e dei Word anche ai motori via API e a «da-leggere». Provato con Word e file veri; manca la prova dalla chat dell'app.

### 7/11 — Agent Chat: motori con più contesto
Cartella del progetto, conversazione che continua (60 min, 20 turni), messaggio intero, un incarico che ripete l'owner non apre un secondo turno (`docs/integrazioni.md`). Da provare con turni veri.
