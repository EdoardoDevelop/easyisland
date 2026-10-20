# Handoff — EasyIsland

_Aggiornato al 19 ottobre 2026. Versione **0.9.3** in `main` con il tag `v0.9.3` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat; della 0.9.3 gli strumenti di Notion, Antigravity e Claude API con gli strumenti di EasyIsland, la Seconda opinione, /oggi e /domani. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): riassunto delle integrazioni fatto dall'IA, da solo agli orari scelti e a richiesta da chat, ricerca, Telegram e azioni rapide. Fatti `/oggi` e `/domani` su Telegram; il resto in `docs/idee.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Remote Desktop Manager:** predisposto; prova la settimana prossima sul PC con RDM (`docs/prove-dal-vivo.md`), poi i passi in `docs/idee.md`.
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Occhi troppo grandi** nello stato felice per alcuni personaggi (segnalato il 14 ottobre 2026, quali personaggi è da capire).
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.
- **Rinnovo dell'accesso di Claude Code** (`renew.rs`): provato qui che Claude Code parte invisibile, apre `/usage` e si chiude senza lasciare processi; il rinnovo vero di un accesso scaduto va visto alla prossima scadenza (`docs/prove-dal-vivo.md`). Chiudendolo, Claude Code al lancio dopo può dire che il suo renderer a schermo intero «non ha finito di partire» e usare quello classico una volta.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 20 ottobre 2026 — Velocità: misure, Claude Code acceso, Notion compatto, ricette
- Segnalato da Edoardo: lentezza di tutti i motori. Misure di ogni turno, strumento e token nel log; Claude Code resta acceso tra i messaggi della stessa conversazione (~6 s → ~3 s di avvio); `notion_query` risponde con una tabella compatta, le categorie per nome e i totali già fatti; indice di Notion corto; ricette imparate con l'uso (`recipes.rs`, Impostazioni → Chat → «Ricette»). Tutto in `docs/chat.md` → Velocità e ricette.
- «Quanto ho speso a ottobre» con Claude: 28,7 s → 11,2 s, risposta giusta (1.679,45 €, ricontata dalle righe).
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`; dal vivo `live_speed`, `live_kept` (messaggi di fila, processo morto, Ferma, uscita, con e senza strumenti, nessun processo rimasto) e `notion_tools::tests::live`. Da provare dall'isola e da Telegram (`docs/prove-dal-vivo.md`).

### 19 ottobre 2026 — Conti di Notion uguali tra i motori, ragionamento di opencode su Telegram
- Segnalato da Edoardo: con opencode la risposta non arrivava (fermata dopo 2 minuti), e Claude e opencode davano dati diversi. `notion_query` dava solo le 50 righe più recenti, senza filtri: ora accetta `filter` e `sorts` di Notion, legge fino a 200 righe e dice se sono tutte; l'indice della mappa chiede un solo modo per risposta e niente script per i conti.
- Su Telegram opencode in «modalità codice» mostrava solo «Esegue uno script»: ora sotto la risposta in corso c'è la coda del suo ragionamento (💭), che sparisce quando scrive o usa uno strumento (`opencode.rs`). Lo stesso per Claude Code (`claude_cli.rs`): ogni turno ora arriva man mano (`stream-json`), anche fuori dalla Modalità terminale, con il ragionamento quando Claude Code lo manda. Verificato il 20 ottobre: Claude e opencode danno lo stesso totale di ottobre (1.679,45 €, ricontato dalle righe di Notion).
- **Prove:** `cargo test --workspace`, prova dal vivo di `notion_query` con un filtro per data. Da riprovare la stessa domanda con Claude e opencode.

### 19 ottobre 2026 — Allineamento con le segnalazioni, /oggi e /domani, versione 0.9.3
- Versione **0.9.3** con le voci del 19 ottobre dopo la 0.9.2; README, README.en.md e homepage aggiornati.
- Riletto l'elenco delle segnalazioni dalla prova e allineato con questo file e `docs/`: aggiunti il bug degli occhi nello stato felice (Problemi noti), la giornata di oggi e domani (Da fare, priorità alta, `docs/idee.md`) e TeamViewer tra le idee.
- Segnalato da Edoardo: Antigravity da Telegram non riusciva ad aggiungere in Notion. Due cause: una risposta lunga di uno strumento (50 righe di un database) arrivava tagliata, perché l'app chiudeva la pipe prima che il relay finisse di leggere (`pipe.rs`, ora aspetta che il relay chiuda); `notion_read` dava errore su una pagina senza testo invece delle proprietà. Riprovato con la 0.9.3 installata: riga aggiunta con categoria. Con opencode la nota «Questa conversazione è su Telegram» non si ripete più a ogni messaggio.
- Primo passo della giornata: `/oggi` e `/domani` su Telegram, un turno con gli strumenti di EasyIsland (`docs/integrazioni.md`).
- **Prove:** `cargo build`, `npm run check:i18n`. Da provare con il bot (`docs/prove-dal-vivo.md`).

### 19 ottobre 2026 — Seconda opinione nella chat e su Telegram
- Chiesto da Edoardo, dopo aver ragionato su una «chat tra le IA»: si tiene solo la revisione chiesta a mano (`docs/decisioni.md`). «⇄ Seconda opinione» sotto l'ultima risposta: si sceglie ogni volta il motore, che rivede l'ultima domanda e risposta in un turno a parte, senza strumenti nostri, con Ferma. Il suo testo va davanti alla domanda dopo al motore principale (`second.rs`, `docs/chat.md`).
- **Prove:** `cargo test --workspace`, `npm run build`, `npm run smoke`, scena `?scene=chat&second`. Da provare con motori veri (`docs/prove-dal-vivo.md`).

### 19 ottobre 2026 — Notion per tutti i motori, strumenti di EasyIsland in Antigravity
- Chiesto da Edoardo: ogni motore deve usare le integrazioni di EasyIsland, e Antigravity non arrivava a Notion. Nuovi strumenti di easyisland `notion_search`, `notion_read`, `notion_query`, `notion_add_row` e `notion_update_row` (`notion_tools.rs`), con il collegamento di EasyIsland: i valori si controllano sulla mappa prima di scrivere, quindi niente più righe fuori dal database. Antigravity riceve il server con `agy mcp add`, da Impostazioni → Chat → Antigravity (copia e conferma); i suoi strumenti di sola lettura non chiedono Consenti / Nega (`docs/chat.md`, `docs/agenti.md`).
- Poi, scelto da Edoardo: gli stessi strumenti anche al motore Anthropic con chiave (`claude.rs`, ciclo `tool_use`, elenco unico in `hook/src/tool_list.rs`); opencode li aveva già. Gli altri motori via API per ora no (`docs/idee.md`).
- **Prove:** `cargo test --workspace`, lettura vera (`notion_tools::tests::live`), `npm run build`, `npm run smoke`. Da provare: scritture, Antigravity e il motore Anthropic (su questo PC non c'è la chiave) (`docs/prove-dal-vivo.md`).
