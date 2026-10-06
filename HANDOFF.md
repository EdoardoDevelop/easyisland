# Handoff — EasyIsland

_Aggiornato al 6 ottobre 2026 · versione pubblicata **0.5.8** · branch di lavoro `claude/sviluppo`, principale `main` · repository pubblico `EdoardoDevelop/easyisland`._

Il minimo per riprendere il lavoro. Struttura del codice e regole sono in `CLAUDE.md` (caricato in automatico); la storia completa (roadmap originale, analisi, registro dal 1° al 6 ottobre 2026) è in `HANDOFF-archivio.md`.

> Da tenere aggiornato: a ogni modifica rilevante aggiorna la sezione interessata e aggiungi una voce al **Registro** in fondo, compresi i problemi rimasti aperti.

## 1. Cosa fa oggi

Isola in alto (o dove la trascini) con un personaggio (Slime, Goccia o EasyTech) per chi fa supporto IT su un notebook, tra ufficio, clienti e casa.
- **Agenti di programmazione:** Claude Code (permessi Nega/Consenti/Sempre, domande con risposta libera, piano da approvare, diff in tempo reale, esito vero dei test, piano "2/4", avvisi di rischio, modalità e compattazione, card chiusa se rispondi nel terminale), Codex (con Consenti/Nega), Gemini CLI, Cursor e Copilot CLI (solo osservazione).
- **Chat** con Claude (abbonamento o chiave API), OpenRouter, OpenAI, Gemini, Ollama, LM Studio; connettori MCP; **agente** che usa il PC solo con Consenti/Nega.
- **Azioni rapide** (link, programmi, script, prompt su appunti / testo selezionato / file), scorciatoie, suggerimenti ⚡ per l'app in primo piano.
- **File:** "Cosa vuoi farne?", ZIP, **Vassoio** temporaneo (svuotato a ogni avvio, trascinamento verso altre app), Cattura una zona.
- **Integrazioni:** 3CX, Zammad, Outlook classico, Consumo Claude, Stato del PC, Sicurezza, Rete, Meteo, Appunti, Musica, Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com. **Widget** ripetibili: ping, porta, sito, certificato, servizio, API JSON, calendario ICS, domini.
- **Automazioni** "quando… se… allora…", proposte dalle abitudini (spente di serie), profili con cambio automatico, "davanti al cliente", notifiche da script, aggiornamenti firmati.

## 2. Come si lavora

- **Build:** `npm run build` (typecheck + front end), `cargo test --workspace` in `src-tauri/`, `npm run pack` (installer in `release\`). Anteprima nel browser: `npm run dev` con le scene di `dev/scenes.ts` (`/?scene=diff`, `threecx`, `drop`…; `diff` e `threecx` espongono `window.island` per simulare eventi con `handleHook`).
- **Installare su questo PC:** mai lanciare installer o app dalla shell di Claude (l'app Claude è MSIX e reindirizza AppData). Dopo `npm run pack`, aggiorna la versione in `release\installa.cmd` e avvialo tramite Esplora file: `Start-Process explorer.exe -ArgumentList "`"$PWD\release\installa.cmd`""`. Controlla da `\\localhost\C$\Users\Edoardo\AppData\Local\EasyIsland\` (data dell'exe, riga `started` in `easyisland.log`).
- **Pubblicare una versione:** stesso numero in `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (più `package-lock.json` e `Cargo.lock`), commit su `claude/sviluppo`, unione `--no-ff` in `main`, tag `vX.Y.Z`, push di `main` e del tag. La CI (`.github/workflows/build.yml`) pubblica installer, firma e `latest.json`; le app installate si aggiornano dopo un clic. Unione e tag solo con la conferma di Edoardo; in modalità automatica il controllo dei permessi li blocca.
- **Chiave dell'updater:** `%USERPROFILE%\.tauri\easyisland.key` (fuori dal repo, secret `TAURI_SIGNING_PRIVATE_KEY` su GitHub). Se si perde, le app installate non accettano più aggiornamenti: tenerne una copia fuori dal PC.

## 3. Decisioni prese

- **Integrazione o widget:** un servizio o programma che c'è una volta sola è un'integrazione; i widget sono solo controlli ripetibili.
- **Cursor e Copilot CLI solo in osservazione:** sui loro hook di permesso una risposta illeggibile o un errore bloccano lo strumento; l'isola non deve mai poter bloccare un agente.
- **Esclusi per ora:** widget "Oggi", rubrica clienti, timer d'intervento, GitHub rinnovato, funzioni nuove dai progetti simili (timer, avvisi di sistema, sostituzione dei riquadri di volume e luminosità, gioco del personaggio), più sub-agenti in parallelo, consumo a 30 giorni.
- **Saltato:** uso del piano Claude (limiti 5 ore e settimanali): l'app desktop di Claude non esegue la `statusLine`, e Anthropic non pubblica i limiti in token. Al suo posto c'è l'integrazione Consumo Claude (conteggi dalle trascrizioni).
- **Rimandato:** il personaggio (guardaroba, personaggio sul desktop, balla con la musica).
- **Identità:** nome EasyIsland, identifier `it.edoardo.easyisland` (non cambiarlo più). Degli asset di Coucou non resta nulla, solo il codice MIT; EasyTech è ispirato a un logo aziendale: verificare prima di distribuire.

## 4. Da fare

- [ ] **3CX + Zammad: ticket del cliente sulla chiamata in arrivo.** Quando squilla, sotto il chiamante i suoi ticket Zammad aperti (titolo, stato, da quanto), un clic apre il ticket. Dal numero (normalizzato: `+39`, spazi, zeri) cercare il cliente in Zammad, poi i ticket non chiusi suoi o della sua organizzazione. Da verificare sul server: `/api/v1/users/search` e `/api/v1/tickets/search` funzionano senza Elasticsearch? (`zammad.rs` usa `ticket_overviews` apposta.) Regole: solo con entrambe le integrazioni accese, tutto in memoria, niente nomi né titoli davanti al cliente, nessuna azione senza un clic. Seguito possibile: "Nuovo ticket" dalla chiamata.
- [ ] **Remote Desktop Manager (Devolutions)**, come integrazione. **Prima:** capire dove sta la fonte dati delle voci (Devolutions Server, Hub, database SQL o file locale). RDM offre `rdm://open?Filter=<testo>`, `RemoteDesktopManager.exe /DataSource:<id> /Session:<id>` e il modulo PowerShell Devolutions.PowerShell (`Get-RDMSession`, PowerShell 7.2+). Passi: (1) cerca e apri dall'isola con `rdm://open?Filter=…`; (2) "Apri in RDM" sulla chiamata 3CX e sui ticket Zammad; (3) suggerimento ⚡ "Cerca in RDM" su un nome di server o un IP selezionato; (4) solo se serve, elenco delle voci nell'isola (API di Devolutions Server/Hub o PowerShell). Oggi senza codice: azione rapida "Programma" con gli id. Da non fare: legarlo a "davanti al cliente".
- [ ] **Scheda esatta di Windows Terminal** per "Apri" (VS Code è già a posto): il relay legge il titolo della console della sessione, l'app seleziona la scheda con quel nome via UI Automation. Da sperimentare con una sessione vera in Windows Terminal.
- [ ] **Decisioni aperte:** quali integrazioni tenere (Stripe, Resend, Cal.com… se non servono si possono togliere); firma del codice (Authenticode o Azure Trusted Signing: senza, SmartScreen avvisa al primo download); tag `windows-latest` sul repo (release 0.2.0 creata per sbaglio, può confondere chi scarica a mano); funzioni del Mac mai portate (invio di un file per email, personaggio trascinato su una finestra per allegarla).
- [ ] **Idee ancora da valutare:** libreria di comandi PowerShell/cmd con conferma; casa (promemoria, Home Assistant); integrazioni proposte il 2 ottobre e non fatte (Windows Update, stampanti bloccate, Teams, Docker, Git locali, WSL, IMAP, DNS/blacklist, pagine di stato, CISA KEV, RSS, ntfy/Telegram, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI). Dettagli in `HANDOFF-archivio.md`, sezione 7.
- [ ] `screenshots/drop.png` mostra ancora "File caricati": rifarlo con `scripts/screenshots.mjs` (con `npm run dev` acceso).

## 5. Problemi noti

- **Loghi mancanti:** Cal.com, Meteo, Rete, PC, Sicurezza, Appunti, Musica, Consumo usano ancora il pallino colorato; per aggiungerne uno: SVG in `brand/`, una riga nella mappa di `scripts/gen-brands.mjs`, `node scripts/gen-brands.mjs`.
- **CPU con "Sempre visibile":** circa 9–10 % col mouse in movimento, 4 % fermo. Margini: sguardo a 20 fps, finestra più piccola dell'attuale 720×560 quando l'isola è compatta.
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro; ora torna davanti a ogni cambio di finestra in primo piano (0, 120, 470, 1270 ms). Da verificare dal vivo che basti con Start aperto (la barra di Windows 11 sta in una banda più alta).
- **Cattura una zona:** Esc nello Strumento di cattura non si vede; la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione:** se negli appunti c'era un'immagine o dei file, dopo la copia non vengono rimessi (si ripristina solo il testo).
- **Gestione credenziali molto piena:** con centinaia di voci, le credenziali con nomi lunghi vengono rifiutate (`ERROR_NOT_ENOUGH_MEMORY`, errore 8): se il salvataggio di una chiave fallisce, eliminare voci vecchie.
- **Non supportati:** il nuovo Outlook (`olk.exe`, niente COM); Teams via API locale (le riunioni si riconoscono da microfono e webcam); i connettori di claude.ai in `claude -p`; la verifica in due passaggi di 3CX (accesso "interno e password").
- **Goccia:** le pose della tavola (saluto, salto, caduta, onda) non sono fatte. Il personaggio non balla con la musica.
- **Hook di Claude Code da reinstallare** (Impostazioni → Claude) per ricevere `PreCompact`; le Impostazioni lo segnalano con un avviso.

## 6. Da provare dal vivo

Verificato solo con i test o nell'anteprima del browser:
- [ ] **3CX con il centralino vero:** tutto il flusso (accesso, rubrica, chiamate in uscita da ogni dispositivo, in arrivo con Rispondi/Rifiuta, Riaggancia, stato, perse, Recenti, modalità client API). L'isola deve chiudersi quando risponde un collega o rispondi dal telefono: se non succede, mandare le righe `3cx: call` di `easyisland.log`.
- [ ] **Claude Code vero:** esito dei test quando fallisce (output nel campo `error` di `PostToolUseFailure`), `TaskCreate`/`TaskUpdate`, `PermissionRequest` per ExitPlanMode, silenzio a fine lavoro con la sessione in primo piano, pulizia delle sessioni morte (processo giusto anche nell'app desktop di Claude), "Sempre", diff in tempo reale, permesso che resta su un'altra scheda, named pipe da un Claude Code avviato come amministratore.
- [ ] **Altri agenti veri:** Codex (hook, `/hooks`, Consenti/Nega), Gemini CLI, Cursor e Copilot CLI (nomi reali degli strumenti di Copilot, forma di `workspace_roots` su Windows), Claude Code nel terminale di Cursor.
- [ ] **Vassoio:** trascinamento verso Outlook, Teams ed Esplora file.
- [ ] **Outlook** con Outlook aperto; **Zammad** con un server reale; **Consumo Claude**: il messaggio di limite raggiunto non è mai comparso su questo PC.
- [ ] **Selezione e suggerimenti ⚡:** Ctrl+C reale in Excel, Outlook e browser, ripristino degli appunti.
- [ ] **Agente e automazioni:** card Consenti/Nega in una chat vera; ogni tipo di "Quando" e "Prova ora"; proposte dalle abitudini (servono settimane con `habitsEnabled`).
- [ ] **Altri motori della chat** con chiavi vere e Ollama/LM Studio; markdown (Copia, link).
- [ ] **Appunti e Musica** (Ctrl+V, immagini da varie app, Spotify/browser), **Cattura una zona** con entrambi i motori, **calcolatrice**, **ZIP** veri.
- [ ] **Widget:** script del certificato TLS; calendario ICS reale. **"Davanti al cliente"** con Teams e assistenza remota veri. **Spostamento dell'isola** e posizione mantenuta.

## 7. Registro

Il registro completo fino al 6 ottobre 2026 è in `HANDOFF-archivio.md`. Le nuove voci vanno qui sotto, la più recente in alto.

### 6 ottobre 2026 — correzioni dalla prova di Edoardo
- **EasyTech** prende il colore del tema e quello dell'integrazione in primo piano (`wearsIntegrationColor: true`); senza, resta il logo.
- **Panoramica (⌂)** = riepilogo di tutte le integrazioni (`State.summary`, `renderSummary` in `views.ts`; clic su una riga → la sua card). **Claude Code** ha una scheda fissa sua (`tab:claude`) e non è più una pillola (aspetto: icona ✳ di serie, nome o emoji in Impostazioni → Claude → "Scheda nell'isola", salvato in `integrationTabIcons.integration_claude`, `@name` = nome); "VS Code" rinominato "Claude Code" ovunque.
- **Schermi secondari:** trascinando il personaggio su un altro schermo `screen` diventa `monitor:<nome>` (`island::screen_for_drop`, `end_drag`); torna al principale se lo schermo manca.
- **3CX:** Recenti/Perse hanno un titolo con ✕, e lo stesso link richiude l'elenco.
- **«Apri»:** destinazioni per PC (Gestione attività), Sicurezza, Rete, Appunti, Meteo, Outlook, 3CX (`open_integration` in `lib.rs`, solo bersagli fissi); dove non c'è nulla da aprire il pulsante non compare (`canOpen`).
- **«Annulla» su un file rilasciato** ora annulla davvero: toglie la copia dal vassoio e torna indietro (`cancelDrop`, `dropSeq` per la copia che arriva dopo).
- **Vassoio:** pulsante griglia/elenco (ricordato in `localStorage`).
- **Dimensione dell'isola:** `islandZoom` (80–160 %, del PC) in Impostazioni → Posizione, con "Predefinita", e Ctrl+rotellina sull'isola aperta. È lo zoom della WebView; in Rust ogni conversione pagina↔schermo passa da `island::scale_of`/`zoom()`. Da provare dal vivo (Rust non compilato qui).
- **Loghi dei marchi** (3CX, Claude, GitHub, n8n, Notion, Outlook, Resend, Stripe, Vercel, Zammad): copiati da `brand/` in `src/views/brands.ts` come SVG nel codice (`scripts/gen-brands.mjs`, viewBox ritagliati, nero → `currentColor`); l'app non legge mai `brand/`. Usati da `brandOrDot` nelle intestazioni delle card, nelle schede, nella Panoramica e come icona della scheda Claude Code; le pillole restano col personaggio.
- **Colori del personaggio sulla Panoramica:** prima restava col colore e lo stato dell'ultima integrazione aperta (es. 3CX blu e "inattivo" mentre Claude lavorava). Ora sulla ⌂ (`State.characterTask` = null) tiene il colore del tema e mostra lo stato più urgente di tutte (`URGENCY` in `state.ts`: permesso > domanda > errore > limite > lavoro > … > riposo).
- Aperti: prova dal vivo di schermi secondari, Start, zoom.

### 6 ottobre 2026 — handoff ridotto
- `HANDOFF.md` ridotto al minimo per riprendere il lavoro; la versione completa (roadmap 6.1–6.6, analisi 3CX, idee del 2 ottobre, registro dal 1° al 6 ottobre) è in `HANDOFF-archivio.md`, non più aggiornata.
