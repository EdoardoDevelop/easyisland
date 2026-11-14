# Handoff — EasyIsland

_11 novembre 2026. **1.0.43** in `main` (tag `v1.0.43`). Si lavora su `claude/sviluppo` (uniti `telegram-voce`, `cattura`, `vocale-ricorda`, `ticket-simili`, `voce-pc`, `agentchat`, `agentchat-autonomi`; il 14/11 `domande`, `consumo`, `smistatore`); in attesa `claude/modello-integrato`. Repo pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale; il funzionamento sta in `docs/` (indice in `CLAUDE.md`).

## Da fare
- [ ] **Smistatore** (14/11, ramo `claude/smistatore`): `docs/chat.md` → Smistatore. Da provare nell'app: una domanda ripetuta (stato del PC, azioni rapide) che dopo due turni uguali risponde da sola, «Chiedi al motore», i numeri in Impostazioni → Chat. Tappa 3 in `docs/idee.md`.
- [ ] **VLAN ID in Modifica rete…** (13/11, ramo `claude/domande`): `docs/integrazioni.md` → Rete. Da provare l'applicazione vera da amministratore su una scheda con VLAN (e il ritorno a 0).
- [ ] **Domande con le scelte nella chat** (13/11, ramo `claude/domande`): `docs/chat.md` → Domande e piano. Provate con un processo vero di Claude Code (driver) e nell'anteprima; da provare nell'app: domanda dall'isola, «Altro…», «Non ora», Ferma con la card aperta, Piano con «Procedi», un permesso normale non risposto (deve restare negato).
- [ ] **Browser e portali dei fornitori** (12/11, in `main` dalla 1.0.45): `docs/chat.md` → Anteprima e Portali dei fornitori. Provati solo con test e con gli script sulle pagine vere (estrazione, blocco del carrello, modulo di accesso); da provare nell'app (`docs/prove-dal-vivo.md`). Seguiti in `docs/idee.md`.
- [ ] **Importa abilità** (1.0.43, `docs/chat.md` → Abilità → Importa): provato su The Agency vera con `live_scan` e nell'anteprima; da provare nell'app con «Da Claude Code», una cartella vera e «Adatta con un motore» con i vari motori (risposta nel formato giusto, durata). Seguiti in `docs/idee.md`.
- [ ] **Terminale vero nella chat** (9/11): fatto con ConPTY e xterm.js (`docs/chat.md` → Terminale); da provare dal vivo (editor, Ctrl+C, finestra staccata). Restano più schede e scelta della shell (`docs/idee.md`).
- [ ] **Riduci animazioni** (`docs/architettura.md` → Accessibilità): personaggi, apertura dell'isola, Ezzy, luccichio e transizioni CSS non lo rispettano ancora; scelto di rimandarlo il 9/11.
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
- **Test instabile** `cc_memory::tests::project_folders_read_as_paths` (10/11): una volta su due nella suite completa fallisce, da solo passa; probabile gara con un altro test sulla lingua o sulle variabili d'ambiente. Da rendere indipendente.
- **Chiave salvata in opencode vince su quella di EasyIsland** (2/11): in Modalità terminale OpenRouter, OpenAI, Gemini e API Anthropic passano da opencode (`opencode::via`, chiave in `OPENROUTER_API_KEY` ecc.), che preferisce la sua (`opencode auth list`). Sintomo: «User not found» solo in `~/.local/share/opencode/log/opencode.log`. Risolto a mano con `opencode auth logout openrouter`. Da fare: far vincere sempre la chiave di EasyIsland (`providers.openrouter.settings.apiKey` in `OPENCODE_CONFIG_CONTENT` non ha funzionato) o dirlo nell'errore.

## Registro
Max 5 voci, la più recente in alto; le vecchie in `docs/archivio/registro.md`.

### 14/11 — Smistatore: registro dei turni, risposte dirette, dati letti prima (ramo `claude/smistatore`, da `claude/consumo`)
Edoardo: niente LLM integrato che si allena da solo; tappe 1, 2 e 4 dello smistatore che impara con le Ricette (`router.rs`). Registro cifrato dei turni; domande che una ricetta risolve sempre con la stessa lettura risposte senza motore, «⚡ Chiedi al motore» le rimanda; altrimenti le letture fisse della ricetta fatte prima del motore. Test e anteprima (`?scene=chat&pensa=diretta`); da provare nell'app dopo qualche giorno di ricette. `docs/chat.md` → Smistatore.

### 14/11 — Memoria più pulita e ricerca per significato (ramo `claude/consumo`)
Edoardo: «fai tutti e 5». Dopo la risposta: REGOLA → note, [[Pagina]] → pagina, SUPERATA n → archivio, niente dettagli del momento né lavoro su EasyIsland; il riordino sposta in archivio le note copiate nella loro pagina; note su eventi con data passata in archivio; ricerca per significato facoltativa (`memory_meaning.rs`, provata con OpenRouter). Da provare nell'app sul portatile (memoria piena). Poi: Mappa concettuale, le pagine senza relazioni (create dal riordino del 14/11 alle 7) si agganciano alle pagine che nominano, tratteggiate; nomi di file riservati (`com1.md`…) rinominati; test con `USERPROFILE` serializzati (`ENV_LOCK`). `docs/chat.md` → Memoria.

### 13/11 — Consumo di tutti i motori (ramo `claude/consumo`, da `claude/domande`)
Edoardo: «Consumo Claude» per tutti i motori, separati; clic sulle percentuali in alto = motore successivo. Fatto: integrazione «Consumo» con una sezione per motore (opencode dalle sue statistiche, OpenRouter credito e limite, Antigravity e gli altri dalle risposte in EasyIsland), intestazione a giro. Provato dal vivo opencode e OpenRouter (test ignorato `engine_sections_live`) e nell'anteprima; da provare nell'app. `docs/integrazioni.md` → Consumo. Poi, dai dati del portatile (126 passi, ~5 M token il 13/11, ~10.000 caratteri davanti a ogni conversazione): davanti solo le note-regola e le abilità che c'entrano, ricette confrontate nei due sensi, «trovato per la domanda» con più parole in comune. `docs/chat.md` → Memoria, Abilità.

### 13/11 — Antigravity come Claude: modello, impegno, modalità; niente attesa (ramo `claude/domande`)
Edoardo: in Turbo l'isola chiedeva Consenti/Nega su ogni comando e Antigravity aspettava fino a 2 minuti: ora l'isola trattiene solo `ask_permission` (fuori dalla chat), e senza progetto la sessione si chiama «Antigravity». Nella chat Antigravity ha modello, impegno, Manuale/Accetta modifiche/Piano/Automatica e la card del piano con «Procedi». `docs/agenti.md`, `docs/chat.md`. Da provare con agy vero nell'app (Piano, Automatica).

### 13/11 — VLAN ID in «Modifica rete…» (ramo `claude/domande`)
Edoardo: poter cambiare anche la VLAN. Campo VLAN ID per le schede il cui driver la prevede (`netconfig.rs` `network_vlan`), applicata per ultima con la stessa conferma di Windows; avviso della breve disconnessione. Lettura provata qui (Ethernet `RegVlanid`), comando provato con `-WhatIf`; da provare l'applicazione vera. `docs/integrazioni.md` → Rete.
