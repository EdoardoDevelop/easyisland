# Handoff — EasyIsland

_Aggiornato al 23 ottobre 2026. Versione **0.9.9** in `main` con il tag `v0.9.9` (la CI pubblica l'installer). Si lavora su `claude/sviluppo` verso la **1.0.0**: EasyIsland agente personale (`docs/idee.md`). Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Integrazioni personali:** fatte nel codice e nell'anteprima (`docs/integrazioni.md`); da provare con l'app vera (`docs/prove-dal-vivo.md`).
- [ ] **EasyIsland agente personale, 1.0.0** (priorità alta, chiesto da Edoardo il 23 ottobre 2026): fatti i **Compiti** con motore per compito, motori aiutanti e **Battito**, e le **Abilità** (`docs/chat.md`; da provare dal vivo domande e permessi, `docs/prove-dal-vivo.md`). Prossimi: proattività su ticket e chiamate, permessi per livelli, memoria per cliente. Piano in `docs/idee.md`.
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC; della 0.7.7 «Cerchia e chiedi» e il personaggio durante una chiamata 3CX; della 0.7.8 il nuovo impianto, le risposte rapide, la card del Meteo e il personaggio che torna al suo colore; della 0.7.9 le proposte al momento giusto, il riepilogo del giorno e gli strumenti in Claude Code; della 0.8.0 il rinnovo dell'accesso di Claude Code, il ping e le impostazioni di rete, la Rubrica di 3CX; della 0.8.2 «Sostituisci» con la formattazione in Word, Outlook e Gmail; della 0.8.3 la «Modalità terminale» e ⚡ «Automatica» della chat, Notion con l'account vero; della 0.8.4 le automazioni con contesto e le Impostazioni sopra l'isola; della 0.8.5 la barra dell'app in uso e il menu contestuale; della 0.8.6 le azioni Tasti, Teams e l'account Microsoft; della 0.8.7 Registra e ⚡ «Automatica» con i connettori di opencode; della 0.8.8 Telegram, la cartella di lavoro e gli strumenti di EasyIsland con opencode; della 0.8.9 «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate», il mini Notion e i vocali da Telegram; della 0.9.0 Antigravity come agente e come motore; della 0.9.1 Remote Desktop Manager con l'Hub (vault utente, elenco offline, Sincronizza); della 0.9.2 Ferma nella chat e su Telegram e la mappa di Notion per la chat; della 0.9.3 gli strumenti di Notion, Antigravity e Claude API con gli strumenti di EasyIsland, la Seconda opinione, /oggi e /domani; della 0.9.4 velocità e ricette della chat; della 0.9.5 Microsoft To Do (sul PC con Outlook) e gli hook senza Git Bash; della 0.9.6 Accesso remoto ed eliminazione di righe di Notion dalla chat; della 0.9.7 la chat nuova, la memoria e la RAM di WebView2. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **La giornata di oggi e domani** (priorità alta): riassunto delle integrazioni fatto dall'IA, da solo agli orari scelti e a richiesta da chat, ricerca, Telegram e azioni rapide. Fatti `/oggi` e `/domani` su Telegram; il resto in `docs/idee.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Notion, seconda parte:** «Manda a Notion», scheda cliente su 3CX/Zammad, avviso delle scadenze (`docs/idee.md`).
- [ ] **Account Microsoft (API):** predisposto (accesso, Outlook e Teams con Graph); da provare registrando l'app in Entra (`docs/prove-dal-vivo.md`), poi avvisi di mail nuove, chat, automazioni (`docs/integrazioni.md`).
- [ ] **Chat nuova e memoria:** fatte nel codice; da provare con i motori veri e da guardare dopo qualche giorno d'uso (`docs/prove-dal-vivo.md`).
- [ ] **Accesso remoto:** fatto nel codice; collegamento vero con WinRM e SSH (Windows e Linux) da provare su un PC di un cliente (`docs/prove-dal-vivo.md`).
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

### 23 ottobre 2026 — Integrazioni personali potenziate
- Chiesto da Edoardo: studiare come potenziare le integrazioni personali e farlo. Aggiunti numerazione automatica, colonne calcolate nelle righe, campi condizionali, collegamento a un'altra integrazione, totali nell'elenco, «Compila con l'IA» da un testo incollato, esportazione CSV, modello automatico (`docs/integrazioni.md`).
- **Prove:** `cargo test --workspace` (3 test nuovi), clippy, `npm run build`, `npm run smoke`; con Edge nell'anteprima: totali di riga, campo condizionale, riquadro «Compila», CSV.

### 23 ottobre 2026 — Integrazioni personali create dalla chat
- Chiesto da Edoardo: «crea un'integrazione per i preventivi», programmabile al 100%. Nuovi `custom.rs` e `src/views/custom.ts`: la chat scrive una descrizione (campi di ogni tipo, tabelle, formule, modello del documento, azioni), mai codice; EasyIsland la disegna nell'isola con modulo e schede salvate.
- Strumenti `custom_*` (creare e cambiare con Consenti / Nega), Impostazioni → Integrazioni → Create da te. Decisione in `docs/decisioni.md`.
- **Prove:** `cargo test --workspace` (3 test nuovi sulle descrizioni), clippy, `npm run build`, `npm run smoke` (scena `custom`); nell'anteprima con Edge: righe, totali (1.501,00 € + IVA = 1.831,22 €) e modello compilato.

### 23 ottobre 2026 — Compiti anche su Telegram, riordino della memoria, versione 0.9.9
- Versione **0.9.9** con le voci del 23 ottobre; README, README.en.md e homepage aggiornati.
- Chiesto da Edoardo: fare «cosa resta» del confronto con gli altri agenti. Permessi e domande dei compiti anche su Telegram (prima risposta vince, mai «Automatica»), `/rispondi`, abilità come comandi su Telegram, Riordino della memoria serale con conferma (`docs/chat.md`).
- **Prove:** `cargo test --workspace` (test nuovo sulla prima risposta), clippy, `npm run build`, `npm run smoke`. Le prove con Telegram e con la memoria vera servono un tuo tocco: `docs/prove-dal-vivo.md`.

### 23 ottobre 2026 — Battito, ripetizioni, confronto con gli altri agenti
- Chiesto da Edoardo: tutti i test possibili e studiare i concorrenti. Provati dal vivo compiti, abilità e aiutanti (un compito ha letto un'abilità e affidato un calcolo a un aiutante); prove tolte dopo con `release/pulisci-prove.cmd`.
- Dallo studio (`docs/idee.md` → Confronto): Battito con `BATTITO.md` e `quiet`, `every:N` e `weekly:G:HH:MM`, procedure salvate come abilità a fine compito.
- **Prove:** `cargo test --workspace`, clippy senza avvisi nei moduli nuovi, `npm run build`, `npm run smoke`, prova dal vivo del Battito.

### 23 ottobre 2026 — Abilità, motore per compito e motori aiutanti
- Chiesto da Edoardo: agente programmabile, un motore per ogni compito e più motori in un compito. Nuovo `skills.rs` (procedure .md con nome, descrizione, motore preferito, strumenti; elenco davanti alla conversazione, `skill_read`, `skill_save`, comandi `/id` nella chat).
- Ogni compito ha motore, modello e aiutanti; `task_delegate` affida un pezzo del lavoro a un aiutante (`Channel::Helper`). Rivista la decisione sui più motori insieme (`docs/decisioni.md`).
- **Prove:** `cargo test --workspace` (test nuovi su abilità e aiutanti), `npm run build`, `npm run smoke`; dal vivo vedi la voce del Registro sopra o `docs/prove-dal-vivo.md`.
