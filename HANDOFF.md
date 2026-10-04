# Handoff — EasyIsland (solo Windows)

_Punto di partenza: 1 ottobre 2026. Ultimo aggiornamento: 4 ottobre 2026 (versione 0.5.0, handoff riallineato al codice). Branch di lavoro: `claude/sviluppo`; branch principale: `main`._

> Questo file va tenuto **sempre aggiornato**: a ogni modifica rilevante aggiorna lo stato della sezione interessata e aggiungi una voce al **Registro delle modifiche** (sezione 10), con data, cosa è cambiato e cosa resta aperto.

## 1. Com'è il progetto adesso

**Versione pubblicata: 0.5.4** (tag `v0.5.4`, 4 ottobre 2026; repository pubblico `EdoardoDevelop/easyisland`, le app installate dalla 0.2.0 in poi si aggiornano da sole dopo un clic).

**Cosa fa oggi, in breve:**
- **Isola con personaggio** (Slime, Goccia o EasyTech, il cubo) in alto al centro o dove la trascini, con vista compatta, aggancio ai bordi, sopra la barra delle applicazioni, suoni sintetizzati nel codice.
- **Claude Code:** sessioni, permessi e domande (AskUserQuestion) gestiti dall'isola tramite gli hook; "Apri" riporta all'app della sessione.
- **Chat con Claude** con l'abbonamento (Claude Code) o con la chiave API; connettori MCP dell'utente scelti per profilo; calcolatrice nel campo della chat.
- **Agente:** con l'abbonamento Claude può usare il PC tramite il connettore `easyisland` (app in primo piano, stato delle integrazioni, azioni rapide, programmi, link, appunti, musica, profili, automazioni), con Consenti/Nega per tutto ciò che cambia qualcosa.
- **Automazioni** "quando… se… allora…" con registro, create dalle Impostazioni o a parole dalla chat, e **proposte dalle abitudini** (spente di serie).
- **Azioni rapide** (link, programmi, script, prompt) con scorciatoie globali; suggerimenti per l'app in primo piano nella scheda ⚡.
- **File rilasciati:** "Cosa vuoi farne?" con azioni su file, "Estrai…" per gli ZIP, cronologia dei file caricati.
- **Integrazioni:** Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com, Appunti, Musica e le integrazioni-controllo (Stato del PC, Sicurezza, Rete, Meteo, Outlook classico, Zammad), in pillola o in scheda. **Widget** ripetibili: ping, porta, sito, certificato, servizio, API JSON, calendario ICS, domini.
- **Profili** con cambio automatico, "davanti al cliente", notifiche da script (`easyisland-hook notify`), esporta/importa, aggiornamenti firmati.

**Storia del fork:** EasyIsland è un fork di [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) (Coucou, con il personaggio Mochi). In origine era un'app macOS nativa (Swift) che viveva nel notch del MacBook, con un port Windows in `windows/`.
**Adesso il repo è solo Windows:**

- **Nuovo nome (2 ottobre 2026):** l'app si chiama **EasyIsland**, il personaggio **Slime** (era Mochi). Identifier `it.edoardo.easyisland` (era `fr.louisraille.coucou`), eseguibili `easyisland.exe` ed `easyisland-hook.exe`, named pipe `\\.\pipe\easyisland-<sid>`, cartelle `%APPDATA%\EasyIsland` e `%LOCALAPPDATA%\EasyIsland`. Al primo avvio la migrazione (`src-tauri/src/legacy.rs`) copia impostazioni e chiavi da Coucou; vedi il Registro.
- **Rimossi:** l'app macOS (`NotchBuddy/`, ~11.000 righe Swift + progetto Xcode), le workflow macOS (`build.yml`, `release.yml`) e `scripts/release.sh` (firma/notarizzazione Apple).
- **Spostato alla radice:** tutto il contenuto di `windows/` (Tauri 2 + Rust + TypeScript).
- **Suoni:** i 28 WAV originali (spostati in `assets/sounds/` il 1° ottobre) sono stati sostituiti il 2 ottobre da suoni sintetizzati nel codice (`src/core/synth.ts`); la cartella non esiste più.
- **CI e release:** `.github/workflows/build.yml` gira su `windows-latest` a ogni push/PR su `main` e sui branch `claude/**` (verifica di compilazione, installer come artefatto). Sui tag `v*` pubblica la release: installer, firma per l'updater (`.sig`) e `latest.json` (`PUBLISH: 'true'`; serve il secret `TAURI_SIGNING_PRIVATE_KEY`). Le app installate si aggiornano da lì (`src-tauri/src/updates.rs`).
- **Aggiornati:** `README.md`, `CLAUDE.md` (regole per gli agenti, ora per Windows), `.gitignore`, i percorsi in `LICENSE-ASSETS.md`.
- **Tradotto in italiano:** tutti i testi dell'interfaccia (isola, impostazioni, menu dell'area di notifica, etichette dei passi degli hook), i messaggi d'errore del backend, l'installer NSIS (italiano come lingua principale), README, CLAUDE.md, `docs/SPEC.md`, `docs/INTEGRATIONS.md`, i template delle issue e le note di release. Il prompt di sistema della chat chiede a Slime di rispondere in italiano. Restano in inglese di proposito i commenti e gli identificatori nel codice, `LICENSE` e `LICENSE-ASSETS.md` (testi legali dell'autore originale). Il sito in `docs/*.html` è stato eliminato. Le immagini in `screenshots/` mostrano ancora i testi in inglese.
- **Verificato su Windows (PC di sviluppo, 1–2 ottobre 2026):** `npm run pack` produce l'installer (circa 4,2 MB) senza errori né avvisi, l'installazione per-utente funziona, gli hook di Claude Code arrivano all'isola, i test Rust passavano (27 dell'app, 4 del relay) al 1° ottobre. Il 2 ottobre, dopo il cambio di nome, `cargo test --workspace` passava: 38 test dell'app (più 3 `live_` ignorati di default) e 4 del relay. Al 4 ottobre (0.5.0) nel codice ci sono 70 `#[test]` tra app e relay (compresi i `live_` ignorati di default). La CI compila anche sui branch `claude/**`.

## 2. Mappa veloce

| Cosa vuoi toccare | Dove |
|---|---|
| Personaggi: contratto, registro, elenco | `src/character/character.ts` (`SoftCharacter`, `character()`, `setCharacter`), `src/character/roster.ts`; scelto con `theme.character` |
| Aspetto di Slime / Goccia (forma, colori, riflessi, occhi) | `src/character/slime.ts`, `src/character/drop.ts`, disegnati da `engine.ts`, `greeting.ts` e `src/upload/canvas.ts`; anteprima in `dev/character-preview.html?character=<id>` e `dev/upload-preview.html?character=<id>` (`npm run dev`) |
| Animazioni, stati ed emozioni di Slime | `src/character/engine.ts`, `src/character/greeting.ts` |
| EasyTech, il cubo (personaggio alternativo, `theme.character` = `cube`) | `src/character/cube.ts` (geometria 3D, colori del logo, orientamento verso il cursore: `FOLLOW_*`), disegnato da `engine.ts` (`drawAsCube`), `greeting.ts` e `src/upload/canvas.ts` |
| Posizione, trascinamento, aggancio ai bordi, sopra la barra | front end `src/core/layout.ts` (`anchoredOrigin`, `glueFor`, `cornerRadii`) e `src/island/island.ts` (pointer events); backend `src-tauri/src/island.rs` (`apply_geometry`, `placement_from_drop`, `raise_over_taskbar`), comandi `drag_island` / `end_drag` in `lib.rs` |
| File rilasciati sull'isola | `onDragDrop` in `src/core/bridge.ts` (drop HTML5) + `src-tauri/src/drop.rs` (percorso reale da WebView2) |
| Domande di Claude Code (AskUserQuestion) | `askQuestions` in `src/island/hooks.ts`, vista `buildAsk` in `src/views/views.ts`, risposta `answer {…}` → `decision_json` in `hook/src/main.rs` |
| Viste dell'isola (chat, approvazioni, upload…) | `src/views/` + `src/style.css` |
| Logica apri/chiudi, eventi hook | `src/island/fsm.ts`, `src/island/island.ts`, `src/island/hooks.ts` |
| Finestra Impostazioni | `settings.html`, `src/settings/` |
| Integrazioni con API (Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com) | backend `src-tauri/src/integrations.rs`, front end `src/island/integrations.ts`, `src/views/integrations.ts`, colori/nomi in `src/core/state.ts`; pillola o scheda (`integrationTabs`, `integrationTabIcons`) |
| Integrazioni-controllo (Stato del PC, Sicurezza, Rete, Meteo, Outlook, Zammad) | `settings::PROBE_INTEGRATIONS`, girano nello scheduler di `src-tauri/src/widgets.rs`; codice in `probes.rs`, `outlook.rs`, `zammad.rs`; opzioni in `integrationConfig` |
| Integrazioni Appunti e Musica | `src-tauri/src/clipboard.rs` (testi e immagini, solo in memoria), `src-tauri/src/media.rs` (controlli multimediali di Windows); titolo del brano nella pillola: `pillLabel` in `src/views/views.ts` |
| Immagini negli appunti (lettura, scrittura, PNG, miniature) | `src-tauri/src/clipimage.rs` (formato "PNG" o `CF_DIB`; crate `png` già presente tramite Tauri) |
| Cattura una zona → chiedi a Claude | `src-tauri/src/screenshot.rs` (Strumento di cattura `ms-screenclip:`, PNG nell'inbox), `Island.captureScreen` / `askAboutPicture` in `src/island/island.ts`, pulsante nella scheda + (`buildUpload`), scorciatoia `hotkeyScreenshot` |
| Agente: Claude che usa il PC (connettore MCP `easyisland`) | server stdio `hook/src/mcp.rs`, evento `EasyIslandTool` in `pipe.rs`, esecuzione in `src-tauri/src/agent.rs`; `AGENT_READ_ONLY` e `AGENT_PROMPT` in `claude_cli.rs`; card Consenti/Nega in `src/island/hooks.ts` (`easyislandTarget`, `describeAutomation`) |
| Automazioni "quando… se… allora…" | motore `src-tauri/src/automations.rs` (`validate`, `describe`, `on_widget`), regole in `settings.automations`, pagina `automationsSection` in `src/settings/main.ts` |
| Proposte dalle abitudini | `src-tauri/src/habits.rs` (`analyse`, `habits.jsonl` locale), `habitsEnabled`, `habitsExcluded`, `suggestionsDismissed`, `suggestionsSnoozed`; card `habit-suggestion` nell'isola |
| Suggerimenti per l'app in primo piano (scheda ⚡) | `src-tauri/src/context.rs` (`foreground_app`, `capture_selection`), regole in `src/island/context.ts` (`RULES`, `suggestionsFor`) |
| ZIP, file caricati, calcolatrice | `src-tauri/src/zip.rs` (`builtin:unzip`), `src-tauri/src/files.rs` (inbox) con vista `buildFiles` / `buildUnzip` in `src/views/upload.ts`; `src/core/calc.ts` |
| Chiavi API (Credential Manager) | `src-tauri/src/secrets.rs` (`SERVICE`, `KNOWN_KEYS`) |
| Migrazione da Coucou (impostazioni, chiavi, hook vecchi) | `src-tauri/src/legacy.rs`, `LEGACY_MARKER` in `hooks.rs`, schema 3 in `settings.rs` |
| Chat con Claude (motore, modello, prompt) | `src-tauri/src/claude_cli.rs` (abbonamento), `src-tauri/src/claude.rs` (chiave API) |
| Relay hook di Claude Code | `hook/src/main.rs` + named pipe `src-tauri/src/pipe.rs` |
| Install/uninstall degli hook in `settings.json` | `src-tauri/src/hooks.rs` |
| Icona tray e menu | `src-tauri/src/tray.rs`, icone generate da `scripts/gen-icons.mjs` |
| Suoni (sintetizzati nel codice, nessun file) | `src/core/synth.ts`, riproduzione `src/core/sound.ts`; ascolto in `dev/sounds-preview.html` |
| Installer NSIS | `src-tauri/tauri.conf.json` (`bundle`), `src-tauri/nsis/hooks.nsh` |
| Profili, migrazione, esporta/importa | `src-tauri/src/settings.rs` (`schema_version`, `migrated`, `PROFILE_KEYS`), cambio automatico in `src-tauri/src/profiles.rs` |
| Azioni rapide e scorciatoie globali | `src/views/actions.ts`, `Island.runAction` in `src/island/island.ts`, backend `src-tauri/src/actions.rs` e `src-tauri/src/hotkeys.rs` |
| Widget configurabili (controlli ripetibili) | `src-tauri/src/widgets.rs` (scheduler, ping/TCP/HTTP/TLS/servizio/API JSON), `src-tauri/src/probes.rs` (domini), `src-tauri/src/calendar.rs` (ICS); editor in `src/settings/main.ts` |
| "Copia info PC" | comando `copy_pc_info` in `src-tauri/src/lib.rs` |
| "Davanti al cliente" | `src-tauri/src/presence.rs`, `State.quiet` in `src/core/state.ts` |
| Aggiornamenti da GitHub (controllo, avviso, installazione) | `src-tauri/src/updates.rs` (plugin `tauri-plugin-updater`, chiave pubblica e `latest.json` in `tauri.conf.json`), `showUpdate` in `island.ts`, sezione Aggiornamenti in `src/settings/main.ts`; release in `.github/workflows/build.yml` e `scripts/pack.mjs` |
| Notifiche da script (`easyisland-hook notify`) | `hook/src/main.rs`, vista `notify`, pulsante Prova (`notify_test` in `lib.rs`) |

## 3. Primi passi sul tuo PC Windows

1. Segui la sezione **Installazione** del `README.md`: strumenti con `winget`, `git clone`, `npm install`, `npm run pack`, poi esegui l'installer in `release\`.
2. Dall'icona nell'area di notifica → **Impostazioni…**:
   - **Claude Code → Installa hook…**: controlla il diff e conferma, poi lancia una sessione di Claude Code e verifica che le richieste di permesso arrivino sull'isola;
   - **Chat con Claude**: prova la modalità "Abbonamento Claude" (serve Claude Code con il login fatto);
   - **Posizione e aspetto**: scegli angolo e icona.
3. Per lavorare sul codice: `npm run tauri dev` (l'app vera) o `npm run ui` (solo l'interfaccia nel browser; aggiungi `?character=cube` per EasyTech). `easyisland.exe --settings` apre direttamente le Impostazioni.
4. Fai un push su `main` (o apri una PR) e controlla che la workflow `Build` sia verde: è la prova che l'installer si compila anche su una macchina pulita.

## 4. Decisioni da prendere per personalizzarlo

**Identità (da fare per prima, e una volta sola):**
- [x] Nome dell'app: **EasyIsland**, personaggio **Slime** (2 ottobre 2026).
- [x] Bundle identifier: `it.edoardo.easyisland` in `tauri.conf.json` e `SERVICE` in `src-tauri/src/secrets.rs`. Non cambiarlo più: sposterebbe di nuovo dati e chiavi.
- [x] Copyright: `EdoardoDevelop` in `LICENSE` (accanto a quello originale, richiesto dalla licenza MIT), `copyright` in `tauri.conf.json` e `authors` in `src-tauri/Cargo.toml`.

**Licenza degli asset (importante):** `LICENSE-ASSETS.md` riserva all'autore originale i nomi "Coucou" e "Mochi", il disegno di Mochi, le icone originali e i suoni. Dal 2 ottobre 2026 nomi, personaggio (Slime, disegnato nel codice da un'immagine di riferimento) icona (l'isola) e suoni (sintetizzati nel codice) sono nuovi: **dell'originale non resta nessun asset**, solo il codice MIT.
- Per **uso personale** va bene così com'è.
- Se vuoi **pubblicare o distribuire** la tua versione, gli asset sono già tutti tuoi; il codice (MIT) richiede solo di tenere la nota di copyright originale in `LICENSE`. "EasyIsland" è un nome generico: prima di una distribuzione pubblica conviene una verifica sui marchi.
- **EasyTech**, il cubo (Tema → Personaggio), è ispirato a un logo aziendale: prima di distribuire l'app, verifica di poterlo usare.

**Sito e documenti:** il sito dell'autore originale (`docs/*.html`, `docs/media/`) è stato eliminato il 2 ottobre 2026. Anche `docs/SPEC.md` e `docs/INTEGRATIONS.md` (specifica dell'app macOS originale) sono stati eliminati il 2 ottobre 2026: restano nella storia git. La documentazione è `README.md` più questo file.

**Funzionalità:**
- [ ] Quali integrazioni tieni? Se non usi Stripe, Resend, Cal.com…, rimuoverle alleggerisce codice e Impostazioni.
- [x] **Esclusi per ora (4 ottobre 2026, Edoardo):** widget "Oggi" (6.3), rubrica clienti, timer d'intervento.
- [ ] Funzioni presenti solo su Mac e mai portate: invio di un file via email, trascinare Slime su una finestra per allegarla come contesto, saltare al terminale esatto della sessione. Valuta se ti servono.
- [x] Posizione e aspetto: angolo o bordo, icona a riposo e al passaggio del mouse, apertura dopo N secondi o solo al clic, silenzio a schermo intero (Impostazioni → Posizione e aspetto).
- [x] Slime trascinabile con il mouse (posizione salvata nel profilo), aggancio ai bordi, sopra la barra delle applicazioni, vista compatta sempre visibile, pulsante ✕ per chiudere subito.
- [x] Personaggio a scelta: Slime, Goccia o EasyTech, il cubo (Tema → Personaggio).
- [x] Chat: scegli in Impostazioni tra abbonamento Claude (tramite Claude Code, predefinito) e chiave API. Codice in `src-tauri/src/claude_cli.rs` e `src-tauri/src/claude.rs`.

**Distribuzione:**
- [x] Release su GitHub dai tag `vX.Y.Z` con aggiornamento automatico firmato (2 ottobre 2026). La versione deve coincidere in `package.json`, `Cargo.toml` e `tauri.conf.json` (la CI lo controlla). Passi in README → Pubblicare una versione.
- [x] Repository pubblico (`EdoardoDevelop/easyisland`) e secret `TAURI_SIGNING_PRIVATE_KEY`: le release 0.3.0 e 0.5.0 sono state pubblicate dalla CI (verificato il 4 ottobre 2026).
- [ ] Sul repo c'è anche un tag `windows-latest` con la release "EasyIsland per Windows (ultima)" del 2 ottobre (0.2.0), probabilmente creato per sbaglio. Non dà fastidio all'updater, che legge `releases/latest` (oggi la 0.5.0), ma può confondere chi scarica a mano: valutare se eliminarlo.
- [ ] Firma del codice (certificato Authenticode o Azure Trusted Signing, circa 10 $/mese). Senza, SmartScreen avvisa al primo download manuale e Defender ha già dato un falso positivo una volta. Gli aggiornamenti scaricati dall'app non passano da SmartScreen.
- La chiave privata dell'updater è fuori dal repo (`%USERPROFILE%\.tauri\easyisland.key`, senza password): **va conservata**, se si perde le app installate non accettano più aggiornamenti.

## 5. Contesto d'uso

- **Per chi:** chi lavora su un notebook tra ufficio, clienti e casa (per esempio nel supporto IT), e lo usa anche per scopi personali.
- **Dove:** spesso solo lo schermo del portatile, a volte con monitor esterni, a batteria, su reti diverse.
- **Conseguenze per il progetto:**
  - niente diritti di amministratore richiesti (l'installer è già per-utente);
  - attenzione ai **dati dei clienti**: niente telemetria, chiavi solo in Gestione credenziali, e in prospettiva la possibilità di escludere la chat AI in certi contesti;
  - leggerezza a batteria (CPU ~0 % a riposo resta una regola);
  - la separazione **lavoro / personale** va prevista fin dall'inizio (vedi "Profili" più sotto).

## 6. Roadmap decisa

In ordine di implementazione consigliato: 6.1 → 6.2 → 6.3 → 6.4 → 6.5. Ogni punto dice cosa fare, dove e quando è finito. **Stato al 4 ottobre 2026:** tutto fatto tranne il widget "Oggi" (6.3), escluso per ora; molte parti vanno ancora provate dal vivo (vedi "Da provare dal vivo" in fondo al registro).

### 6.1 Fondamenta per la personalizzazione

> **Stato: fatto.** `schemaVersion` 2 con migrazione (`Settings::migrated` in `src-tauri/src/settings.rs`), profili con `PROFILE_KEYS`, cambio da Impostazioni/menu del vassoio (`src-tauri/src/tray.rs`) e automatico per Wi-Fi/giorni/orario (`src-tauri/src/profiles.rs`), filtro notifiche `notify`, tema (`theme`) e esporta/importa. Test Rust in `settings.rs`.

Serve prima degli altri punti, perché azioni e widget vivono nella configurazione.

- **Configurazione in un file leggibile:** oggi le preferenze stanno in `%APPDATA%\EasyIsland\settings.json` (`src-tauri/src/settings.rs`). Aggiungere **Esporta / Importa** nelle Impostazioni (file `.json`, **senza segreti**: le chiavi restano in Gestione credenziali e vanno reinserite), per backup e per avere lo stesso Slime su notebook e PC di casa.
- **Versione dello schema** (`schemaVersion`) nel file, con migrazione dei campi vecchi: le prossime funzioni aggiungeranno liste (azioni, widget).
- **Temi:** colore del corpo di Slime (`SLIME_GREEN` in `src/character/slime.ts`), colore e opacità dell'isola (`#island` in `src/style.css`, oggi `#000`), scelta del set di suoni o volume per categoria (avvisi / interazioni / emote).
- **Profili** (es. *Lavoro*, *Casa*, *Concentrazione*): ogni profilo ha le sue integrazioni attive, azioni, widget, posizione, suoni e regole di notifica. Cambio da menu dell'area di notifica e, in automatico, per **rete Wi-Fi/dominio** (ufficio vs casa) e per **orario**. In *Concentrazione* passano solo i permessi di Claude Code.
- **Fatto quando:** esporto da un PC, importo sull'altro e ritrovo tutto tranne le chiavi; cambio profilo e isola, integrazioni e suoni cambiano senza riavvio.

### 6.2 Azioni rapide personalizzate

> **Stato: fatto.** Scheda ⚡ e vista di esecuzione (`src/views/actions.ts`), logica in `Island.runAction` (`src/island/island.ts`), backend `src-tauri/src/actions.rs` (programmi, script con output/timeout/interrompi, appunti) e `src-tauri/src/hotkeys.rs` (`RegisterHotKey`, nessuna dipendenza nuova). Editor in `src/settings/main.ts` (il pulsante "Aggiungi esempi da tecnico IT" è stato tolto il 1° ottobre 2026). Le azioni "su file" (prompt con input `file`) compaiono solo nella schermata "Cosa vuoi farne?" dopo il rilascio (`layoutChoose` in `src/upload/canvas.ts`), non nella scheda ⚡; "Altre…" scorre i gruppi quando non stanno tutte nella riga.

Pulsanti definiti dall'utente, mostrati in una nuova scheda dell'isola (accanto a Panoramica / Chiedi / Rilascia) e richiamabili da tastiera.

- **Tipi di azione:**
  - `url`: apre un link (portale cliente, gestionale, documentazione);
  - `app`: avvia un programma con argomenti (RDP, AnyDesk, PowerShell, Esplora file su una cartella);
  - `script`: esegue uno script PowerShell/cmd **solo dopo un clic esplicito**, mostrando l'output nell'isola (con timeout e pulsante Interrompi);
  - `prompt`: manda a Claude un **prompt salvato** applicato al testo negli appunti o al file rilasciato. Esempi da tecnico IT: "Spiega questo errore e dammi i passi per risolverlo", "Scrivi uno script PowerShell che…", "Analizza questo log", "Scrivi il rapportino d'intervento da questi appunti", "Rispondi a questa mail del cliente in modo professionale".
- **Scorciatoia globale** configurabile (es. `Win+Shift+M`) per aprire Slime su chat o azioni, e una seconda per "chiedi a Slime sul testo copiato". Rust: `tauri-plugin-global-shortcut` (valutare se accettabile come dipendenza) oppure `RegisterHotKey` dalla crate `windows` già presente.
- **Configurazione:** lista in Settings (`actions: [{ id, name, icon, color, kind, target, args, prompt, confirm }]`) con editor nelle Impostazioni, riordinabile, legata al profilo.
- **Sicurezza:** niente esecuzione automatica; gli script mostrano il comando prima di partire se `confirm: true` (predefinito); nessun segreto nella configurazione (eventuali chiavi tramite riferimento alla Gestione credenziali).
- **Fatto quando:** creo un'azione "Spiega errore", copio un messaggio d'errore, premo la scorciatoia e ricevo la spiegazione nell'isola.

### 6.3 Slime che usa i tuoi connettori (MCP)

> **Stato: fatto, tranne il widget "Oggi".** Elenco dei server da `~/.claude.json` (solo i nomi), scelta per profilo con conferma per server (`mcpServers` in Settings). Con connettori attivi `claude -p` gira in `--permission-mode default`, i server non scelti sono in `--disallowedTools`, quelli senza conferma in `--allowedTools`; le altre chiamate passano da un hook `PermissionRequest` → `easyisland-hook.exe PermissionRequest --chat` → card Consenti/Nega nell'isola (`handleChatPermission` in `src/island/hooks.ts`). Meccanismo verificato con il Claude Code reale (allow esegue, deny blocca). Widget "Oggi" escluso per ora (decisione del 4 ottobre 2026). I connettori di claude.ai non si caricano in `claude -p`.

Prima di questo punto `src-tauri/src/claude_cli.rs` lanciava `claude -p` con `--strict-mcp-config` e senza `--mcp-config`, quindi **nessun** server MCP, e strumenti limitati a WebSearch/WebFetch/Read. Oggi è ancora così solo quando nel profilo non c'è nessun connettore scelto.

- **Impostazione "Connettori in chat":** elenco dei server MCP configurati in Claude Code (leggibile con `claude mcp list`) con un interruttore per ciascuno; EasyIsland genera un file `--mcp-config` con solo quelli scelti, e aggiunge i relativi strumenti ad `--allowedTools` (es. `mcp__<nome-server>__*`).
- **Esempi d'uso:** "cosa ho in calendario oggi?", "aggiungi un promemoria per venerdì", "cerca nei documenti del cliente X". Qualunque operazione che **modifica** dati (crea, aggiorna, invia) va **proposta prima** e confermata con un clic nell'isola, mai eseguita da sola.
- **Widget "Oggi"** opzionale: attività e promemoria del giorno da un connettore scelto, nella panoramica.
- **Per profilo:** nel profilo *Lavoro* si possono escludere i connettori personali e viceversa.
- **Fatto quando:** chiedo "cosa ho in programma oggi?" e Slime risponde usando un connettore abilitato; chiedo di aggiungere un promemoria e mi chiede conferma prima di scriverlo.
- **Chat con l'abbonamento:** Claude Code viene cercato anche nell'app desktop di Claude (`%APPDATA%\Claude\claude-code\<versione>`) e nell'estensione VS Code, sempre la versione più recente (`find_claude` in `claude_cli.rs`). La chat ha il pulsante **Nuova chat**.

### 6.4 Widget configurabili (integrazioni senza codice)

> **Stato: fatto.** Backend `src-tauri/src/widgets.rs` (ping con `IcmpSendEcho`, porta TCP, HTTP, certificato TLS con una breve chiamata PowerShell — host e porta passati come variabili d'ambiente —, servizio Windows via Service Control Manager, API JSON con percorsi e regola di avviso), scheduler unico con intervallo ×3 a batteria, segreti delle intestazioni come `widget:<id>:<nome>` in Gestione credenziali. Front end: pillole/scheda in `src/views/integrations.ts`, avvisi in `src/island/integrations.ts`, editor con modelli e "Prova" in `src/settings/main.ts`. Il ping ICMP usa la stessa funzione (`icmp_ms`) della latenza della sonda *Rete*, verificata dal vivo il 2 ottobre. Non verificato su Windows reale: lo script del certificato TLS. Le 7 integrazioni originali restano scritte a mano (non convertite in modelli).

> **Regola decisa il 3 ottobre 2026 (Edoardo):** tutto ciò che è un'integrazione a tutti gli effetti, cioè un servizio o un programma che di solito c'è una volta sola (Outlook, Zammad, Stato del PC, Sicurezza, Rete, Meteo…), è un'**integrazione** e non un widget. I widget restano solo per i controlli ripetibili (ping, porta, sito, certificato, servizio, API JSON, calendario ICS, domini). Superata quindi l'idea qui sotto delle integrazioni come "modelli pronti" del widget.

Un tipo di widget generico al posto delle integrazioni scritte a mano (le 7 attuali in `src-tauri/src/integrations.rs` diventano "modelli pronti").

- **Definizione:** `{ id, name, color, url, method, headers (con riferimenti a chiavi in Gestione credenziali), every (secondi), fields: [{ label, path (JSONPath semplice) }], alert: { when: "path op valore", level } }`.
- **Sonde integrate**, utili da tecnico IT, che non richiedono un'API:
  - `ping` / `porta TCP` di un host (server del cliente, NAS, firewall);
  - `HTTP` con codice atteso e tempo di risposta;
  - **scadenza certificato TLS** di un dominio (avviso a 30/7 giorni);
  - stato di un servizio Windows locale.
- **Visualizzazione:** pillola con mini-Slime colorato (come oggi), scheda di dettaglio con i campi, badge e suono quando scatta un avviso.
- **Prestazioni:** tutte le richieste nel backend Rust, nessun polling con l'app in pausa, intervalli più lunghi a batteria.
- **Fatto quando:** aggiungo dalle Impostazioni un widget che controlla `https://cliente.it` e il certificato, senza ricompilare, e Slime mi avvisa se il sito non risponde.

### 6.5 Agente: Claude che usa il PC, automazioni, proposte dalle abitudini

> **Stato: fatto (4 ottobre 2026), da provare dal vivo.** Tre livelli, nell'ordine in cui sono stati fatti; i dettagli sono nel registro (sezione 10).

1. **Connettore MCP `easyisland`** (`hook/src/mcp.rs` → named pipe → `src-tauri/src/agent.rs`): nella chat con l'abbonamento Claude legge lo stato del PC e delle integrazioni e può aprire programmi e link, usare appunti e musica, cambiare profilo, eseguire **solo** le azioni rapide dell'utente. Pre-consentite solo le operazioni in `AGENT_READ_ONLY`; il resto passa da Consenti/Nega. Impostazione `agentTools`.
2. **Automazioni locali** (`src-tauri/src/automations.rs`): quando (orario, avvio, sblocco, Wi-Fi, programma, chiavetta, cartella, avviso o novità di un'integrazione/widget) + solo nel profilo + allora (azione rapida, avviso, profilo, programma, link), con registro e "Prova ora".
3. **Automazioni dalla chat** (`create_automation`, `set_automation_enabled`, `list_automations`), con anteprima nella card di conferma e controllo `automations::validate`; nessuno strumento per eliminare.
4. **Proposte dalle abitudini** (`src-tauri/src/habits.rs`, spento di serie): orari, avvio, rete, chiavetta, sequenze, automazioni da spegnere, programmi esclusi; al massimo una proposta al giorno, sempre con un clic.

- **Regole:** mai strumenti che eseguono comandi arbitrari, inviano email o eliminano; le abitudini registrano solo nomi di programmi e orari, in locale.
- **Fatto quando:** in una chat vera chiedo "ogni giorno feriale alle 9 apri Outlook", confermo la card e il giorno dopo Outlook si apre da solo.

## 7. Idee da valutare (non ancora decise)

Pensate per il supporto IT sul notebook, ma utili anche a casa.

**Già realizzate** (restano qui come promemoria di da dove vengono): screenshot → chiedi a Claude ("Cattura una zona", 4 ottobre), notifiche da qualsiasi script (`easyisland-hook notify`, 2 ottobre), info rapide della macchina (integrazione Stato del PC/Rete e "Copia info PC"), modalità "davanti al cliente" (`presence.rs`), ticketing (integrazione Zammad), meteo (integrazione Meteo), Outlook classico (integrazione Outlook), musica in riproduzione (integrazione Musica).

**Ancora da valutare:**
- **Integrazione 3CX** _(proposta del 4 ottobre 2026, da ragionarci)_. Centralini ormai tutti V20 (la V18 non si aggiorna né si rinnova più). È un'**integrazione** (istanza singola), come Zammad. Tre strade, non esclusive:
  1. **Senza API, con qualsiasi licenza:** "Chiama con 3CX" aprendo `tel:+39…` (l'app 3CX per Windows gestisce i link `tel:`): suggerimento **Chiama** nella scheda ⚡ quando il testo selezionato è un numero, azione rapida su un numero copiato. Poco codice, nessuna credenziale. Le chiamate in corso le riconosce già "davanti al cliente" (microfono in uso).
  2. **API ufficiali (XAPI + Call Control API):** documentate e stabili, ma serve una licenza **8SC o superiore** e un amministratore che crei un client API (Admin Console → Integrazioni → API: Client ID e chiave, da tenere in Gestione credenziali). Permettono: stato dell'interno modificabile dall'isola, chiamate perse con "Richiama", chiamata in arrivo nell'isola con il nome del chiamante (eventualmente con i ticket Zammad aperti), trigger per le automazioni.
  3. **API del client (come fa l'app 3CX):** web client e app per Windows entrano con le credenziali dell'interno e ricevono un token di sessione utente, poi leggono stato e cronologia e tengono un websocket per gli eventi in tempo reale. Niente licenza 8SC+ né Admin Console, ma **non è documentata** (un aggiornamento del centralino può romperla), usa le credenziali dell'utente (accesso a tutto ciò che vede lui; da gestire un eventuale 2FA) e gli indirizzi esatti non si conoscono: vanno osservati sul web client V20 (login fatto da Edoardo nel browser integrato, analisi delle richieste di rete senza salvare il token).
  - **Come funziona davvero il web client V20** (analisi del 4 ottobre 2026 sul centralino di Edoardo: codice pubblico del web client più le richieste viste dopo il login fatto da lui; nessun token o dato salvato). Login con utente e password (nessun accesso Microsoft/Google, niente captcha; il codice gestisce un eventuale codice 2FA): `POST /webclient/api/Login/GetAccessToken` → token, rinnovato con `POST /connect/token` (`refresh_token`). Poi `POST /webclient/api/MyPhone/session` → chiave di sessione. Da lì quasi tutto passa dal **protocollo binario "MyPhone"**: `POST /MyPhone/MPWebService.asmx` (`application/octet-stream`, intestazione `MyPhoneSession`), messaggi **protobuf** generati con protobufjs e compresi nel JavaScript del web client con i numeri dei campi (es. `RequestCallHistory`: CallType=1, DnOwner=2, RecordLimit=3, RecordOffset=4…; `RequestChangeStatus`: ProfileId=1, CustomMessage=2, QueueStatus=3, DND…). Tempo reale: websocket binario `wss://<centralino>/ws/webclient?sessionId=…&pass=…`. XAPI (`/xapi/v1`) con il token dell'utente viene usata solo per `MyUser` e `MyTokens`, non per chiamate o stato.
  - **Messaggi utili presenti:** `RequestMyInfo` (stato, profilo attuale), `RequestGetFwdProfiles` + `RequestChangeStatus` (stati Disponibile / Non disturbare…), `RequestCallHistory` / `RequestCallHistoryCount`, `MissedCallsCount` / `RequestResetMyMissedCalls`, `RequestMakeCall` (chiamata dal dispositivo registrato, es. l'app 3CX), più le notifiche dal websocket (chiamate in arrivo, cambi di stato).
  - **Valutazione:** la strada 3 è fattibile senza licenza 8SC+ né Admin Console, ma richiede di estrarre lo schema protobuf dal web client (la busta del messaggio con `typeId` e i messaggi che servono) e di riscriverlo in Rust senza dipendenze nuove (un piccolo codificatore/decodificatore protobuf, i campi sono pochi). Rischio: protocollo non documentato, può cambiare con un aggiornamento di 3CX (lo schema va rigenerato). Credenziali dell'interno in Gestione credenziali.
  - Da chiarire prima: licenza del centralino, chi può creare un client API, app per Windows o web client sul PC. Regole come sempre: numeri e nomi solo in memoria, nessuna azione (richiamare, cambiare stato) senza un clic. Fonti: [Configuration API](https://www.3cx.com/docs/configuration-rest-api/), [Call Control API V20](https://www.3cx.com/community/threads/updated-call-control-api-for-v20.125697/).
- **Rubrica clienti** _(esclusa per ora, 4 ottobre 2026)_: per ogni cliente collegamenti RDP/AnyDesk/TeamViewer, portali, credenziali (solo riferimenti alla Gestione credenziali), note e azioni rapide dedicate. Si apre cercando il nome dall'isola.
- **Timer d'intervento** _(escluso per ora, 4 ottobre 2026)_: avvio/stop per cliente dall'isola, riepilogo a fine giornata, rapportino generato da Claude ed esportato (file o connettore scelto).
- **Libreria di comandi:** comandi PowerShell/cmd usati spesso (es. `gpupdate /force`, reset dello spooler, `sfc /scannow`, diagnostica di rete) da copiare o eseguire con conferma.
- **Casa:** promemoria personali, eventuale Home Assistant.

**Proposte di integrazione del 2 ottobre 2026** (gratuite o tramite app già sul PC; dettagli e priorità nella conversazione di quel giorno). Fatte finora: stato del PC (con riavvio in sospeso), antivirus/firewall/Defender (Sicurezza), rete, microfono/webcam in uso ("davanti al cliente"), musica, Outlook classico, meteo, calendari ICS, scadenza domini, Zammad. Le altre restano da valutare:
- *Sul PC, senza configurazione:* stato del PC (disco, RAM, batteria, uptime, riavvio in sospeso), Windows Update, Defender, rete (IP locale/pubblico, Wi-Fi, VPN, latenza), stampanti bloccate, microfono/webcam in uso, musica in riproduzione (controlli multimediali di Windows), Teams in riunione → Slime silenzioso.
- *App installate:* Outlook classico (prossimo appuntamento, mail non lette, via COM), Teams (API locale di terze parti), Docker, repository Git locali, WSL, sessioni remote attive (AnyDesk/TeamViewer/RDP → modalità "davanti al cliente").
- *Servizi gratuiti:* meteo Open-Meteo (senza chiave), calendari ICS (Google/Outlook senza OAuth), posta IMAP, scadenza domini (RDAP), DNS e blacklist (DoH/DNSBL), pagine di stato (statuspage `/api/v2/status.json`), vulnerabilità CISA KEV, feed RSS, notifiche sul telefono (ntfy, bot Telegram).
- *Self-hosted / casa:* Home Assistant, Uptime Kuma, Proxmox, Synology/TrueNAS, UniFi, Pi-hole, GLPI/Zammad (ticket).
- Quelle a istanza singola vanno fatte come **integrazioni** (regola del 3 ottobre, vedi 6.4); il widget configurabile resta per i controlli ripetibili.

## 8. Regole da non rompere (sono anche in `CLAUDE.md`)

- L'hook non deve **mai** bloccare Claude Code: timeout breve, poi esce con 0.
- `settings.json` di Claude Code non si sovrascrive mai: backup datato, merge, diff, scrittura solo dopo conferma.
- Niente telemetria. Le chiavi stanno solo nel Credential Manager.
- Nessuna approvazione di permessi e nessuna email senza un click esplicito.
- CPU a ~0 % quando l'isola è nascosta.

## 9. Note per riprendere con Claude Code

Apri una sessione su questo repo e scrivi, per esempio: _"Leggi HANDOFF.md e CLAUDE.md, poi facciamo il widget «Oggi» (6.3)"_, _"proviamo dal vivo le automazioni"_ oppure _"valutiamo un'idea della sezione 7"_. Per una nuova versione: stesso numero nei tre file, unione di `claude/sviluppo` in `main`, tag `vX.Y.Z`. `CLAUDE.md` viene caricato in automatico e contiene già struttura e regole. A fine lavoro aggiorna questo file (stato e registro).

## 10. Registro delle modifiche

### 4 ottobre 2026 — versione 0.5.4
- Versione **0.5.4** nei tre file (più `package-lock.json` e `Cargo.lock`), `claude/sviluppo` unito in `main`, tag `v0.5.4`. Rispetto alla 0.5.3: README completo con le nuove schermate, cartella `design/` tolta, scheda ⚡ che cresce con le azioni su due righe, messaggio di Gestione credenziali piena che riconosce anche l'errore 8.

### 4 ottobre 2026 — README completo, nuove schermate, via la cartella design
- **README:** nuova sezione "Cosa fa" in cima con i collegamenti; sezione **3CX** (i due accessi e come configurarli, cosa fa la scheda); spostamento dell'isola aperta, riordino di pillole e schede, Cattura una zona e allegati della chat nella tabella "Come si usa"; soluzione per "la chiave non si salva" (Gestione credenziali piena); pagina Automazioni nell'elenco delle Impostazioni; struttura del repository aggiornata (`dev/`, `screenshots/`, niente `design/`); esempio del tag di versione generico. Corretto un carattere di controllo (backspace) che rovinava il percorso `%USERPROFILE%\.local\bin`.
- **Schermate** (`scripts/screenshots.mjs`, scene in `dev/scenes.ts`): rifatte tutte, con le pillole di più integrazioni in panoramica e barra compatta, più le nuove `actions` (scheda ⚡ con i suggerimenti per Outlook), `threecx`, `clipboard`, `media`, `network` (scena nuova), `suggestion` e le pagine `settings-integrations` e `settings-automations`. Nota: lanciate tutte insieme, dopo la sesta l'isola risultava chiusa (altezza 0); una alla volta (`node scripts/screenshots.mjs <nome>`) riescono tutte.
- **Correzione nella scheda ⚡** (trovata con la schermata): con le azioni su due righe l'isola non cresceva abbastanza e l'ultima riga restava tagliata. L'altezza ora è quella vera della scheda (`scrollHeight`, compreso il margine sotto i suggerimenti) e un `ResizeObserver` la ricalcola quando i pulsanti vanno a capo mentre l'isola si allarga.
- **Correzione:** nel controllo "Gestione credenziali piena" delle Impostazioni la regola `\b8\b` era stata scritta con due caratteri di controllo; ora riconosce anche l'errore 8.
- **Via `design/`** (prototipo HTML, animazioni e catture di Coucou): non c'era più nulla del repository originale da usare. Aggiornati CLAUDE.md (il riferimento visivo sono le schermate in `screenshots/` e le scene, il prototipo resta nella storia git), `LICENSE-ASSETS.md` (nessun asset di Coucou nei file, solo nella storia git), README e due commenti nel codice.

### 4 ottobre 2026 — versione 0.5.3
- Versione **0.5.3** nei tre file (più `package-lock.json` e `Cargo.lock`), `claude/sviluppo` unito in `main`, tag `v0.5.3`. Rispetto alla 0.5.2: integrazione 3CX (prima versione, con il centralino vero verificati solo login e stato dell'interno), isola spostabile anche a riposo e da aperta (spostamento temporaneo, rientro con la curva di chiusura), scelta del dispositivo disegnata nella scheda, spiegazione quando Gestione credenziali è piena.

### 4 ottobre 2026 — integrazione 3CX (prima versione), isola spostabile ovunque
- **3CX** (`integration_3cx`, `src-tauri/src/threecx/`, scheda `src/views/threecx.ts`): chiamare (numero o ricerca in rubrica, Invio chiama), chiamate in arrivo (l'isola si apre sulla scheda 3CX con suono e resta aperta finché squilla, `threecx-call` → `incomingCall` in `src/island/integrations.ts`; "davanti al cliente" = solo badge), Rispondi / Rifiuta / Riaggancia, durata della chiamata, stato modificabile, chiamate perse, Recenti, scelta del dispositivo ("Da …", `integrationConfig.threecxDevice`, elenco disegnato nella scheda perché il menu nativo di un `<select>` finisce dietro l'isola).
- **Due accessi** (Impostazioni → Integrazioni → 3CX, `integrationConfig.threecxMode`; credenziali `3cx-url`, `3cx-user`, `3cx-password`, `3cx-client-id`, `3cx-client-secret`):
  - *Interno e password* (`threecx/myphone.rs`): il protocollo del web client V20, ricostruito dal suo codice pubblico (vedi sezione 7 → 3CX). `GetAccessToken` → cookie → `/connect/token` (`client_id=Webclient`) → `MyPhone/session` → richieste protobuf `GenericMessage` su `MPWebService.asmx` e aggiornamenti `MyInfo` (completi poi a delta per Id/Action) dal websocket `/ws/webclient`. Rispondi = `RequestAutoAnswerConnection` (solo dispositivi comandabili, es. app 3CX), Rifiuta/Riaggancia = `RequestDropCall`, stato = `RequestChangeStatus`, rubrica = `RequestLookupContact`, cronologia = `RequestCallHistory`. Verifica in due passaggi non ancora gestita (messaggio chiaro).
  - *Client API* (`threecx/api.rs`): `client_credentials` → Call Control API (`/callcontrol/{interno}`, `makecall`, `participants/{id}/answer|drop`, eventi da `/callcontrol/ws`), rubrica da XAPI `Users` e `Contacts` (**campi di `Contacts` non verificati**). Senza stato e cronologia.
- **Senza dipendenze nuove:** protobuf minimo scritto a mano (`threecx/pb.rs`); websocket con WinHTTP di Windows (`src-tauri/src/wss.rs`, solo la feature `Win32_Networking_WinHttp` della crate `windows`), chiudibile da un altro thread. Connessione solo con l'integrazione accesa e non in pausa; si riconnette da sola (attesa crescente fino a 5 min); `threecx::settings_saved` la riavvia solo se cambiano accensione, modalità o interno; `secret_set` dei `3cx-*` e la pausa la riavviano. Numeri e nomi solo in memoria; il log scrive solo stato ed errori.
- **Isola spostabile in ogni stato** (`wireInput` in `island.ts`): l'icona a riposo (clic apre, trascinamento sposta: prima si apriva alla pressione e non si poteva spostare), l'isola compatta (com'era) e l'isola aperta dall'intestazione (spazio vuoto, non schede e pulsanti; resta aperta mentre la porti). **Spostare l'isola aperta è temporaneo** (richiesta di Edoardo): resta dove la porti finché è aperta; alla chiusura il personaggio torna al suo posto e l'apertura successiva riparte da lì. Lo scostamento sta solo in memoria (`PollGate.panel_offset`, azzerato da `set_expanded` chiamato da `setMode`; `apply_geometry` lo aggiunge solo da aperta), non nelle impostazioni. Alla chiusura la finestra non salta a casa: scivola verso il posto del personaggio mentre l'isola si richiude, con la stessa curva e durata dell'animazione di chiusura (340 ms, `glide_home` / `close_curve` in `island.rs`; si interrompe se l'isola si riapre). Il posto del personaggio (`anchorH/V`, `offsetX/Y`, salvato) cambia solo trascinando l'icona a riposo o l'isola compatta; `end_drag` lo scrive nel log (`island moved: …`). Segnalato da Edoardo: dopo averla spostata si riapriva nella posizione predefinita; nel file la posizione era quella predefinita. Se succede ancora, il log dice se lo spostamento era stato salvato.
- **Gestione credenziali piena (causa trovata):** su questo PC 287 voci, di cui 216 token in cache di Xbox (`XblGrts|…`) e 52 di Adobe; Windows rifiuta le voci nuove con nome oltre ~24 caratteri ("Risorse di memoria insufficienti"), quindi nessuna chiave di EasyIsland si salvava (`3cx-url.it.edoardo.easyisland` = 29). Soluzione lato utente: eliminare i token Xbox (comando dato a Edoardo). Nelle Impostazioni ora un salvataggio non riuscito spiega il motivo sotto il campo.
- Verificato: test Rust (protobuf, MyInfo a delta, contatti, cronologia, eventi API, URL, numeri), anteprima del browser con dati finti (`?scene=threecx`). **Da provare con il centralino vero:** tutto il resto.

### 4 ottobre 2026 — versione 0.5.2
- Versione **0.5.2** nei tre file (più `package-lock.json` e `Cargo.lock`), `claude/sviluppo` unito in `main`, tag `v0.5.2`. Rispetto alla 0.5.1: pillole e schede (anche ⌂ 💬 ⚡ +) riordinabili trascinandole nell'isola, con "Blocca lo spostamento" e "Ripristina l'ordine".

### 4 ottobre 2026 — pillole e schede riordinabili nell'isola
- **Trascinamento:** nella panoramica le pillole, e nell'intestazione tutte le schede (le fisse ⌂ 💬 ⚡ + e quelle delle integrazioni, mescolabili tra loro), si spostano trascinandole (`src/views/sortable.ts`: oltre 5 px la pressione diventa trascinamento, l'elemento attraversa i vicini, al rilascio il clic viene ignorato; un clic fermo funziona come prima).
- **Due ordini, del profilo** (in `PROFILE_KEYS`): `pillOrder` per le pillole, usato da `State.loadIntegrationTasks`, e `tabOrder` per la riga delle schede (id `tab:home`, `tab:chat`, `tab:actions`, `tab:drop` e quelli delle integrazioni; `buildHeader` ordina la riga a ogni cambio). Quelli non elencati seguono nell'ordine predefinito. `State.reorder` sposta solo gli elementi trascinati, nei posti che occupavano tra tutti, così l'integrazione in primo piano e le schede non si mescolano con le pillole. Salvato dall'isola (`reorder` in `island.ts` → `saveSettings`); la finestra Impostazioni riprende il valore dal suo `settings-changed`.
- **Cambiato:** le pillole con un avviso non vanno più per prime (l'ordine ora è dell'utente; l'avviso resta visibile col badge). La barra compatta continua a mettere prima quelle con un avviso (solo 4 posti).
- **Impostazioni → Integrazioni:** "Blocca lo spostamento" (`lockOrder`, del PC) e "Ripristina l'ordine" (svuota `pillOrder` e `tabOrder`).
- Verificato nell'anteprima del browser con trascinamenti veri: scheda Musica spostata prima di GitHub, pillola n8n davanti a VS Code, clic su una pillola che apre ancora l'integrazione, nessuno spostamento con il blocco attivo; schede fisse ("+" al primo posto, Musica tra le fisse) con eventi simulati, perché il pannello in quel momento non disegnava.

### 4 ottobre 2026 — versione 0.5.1
- Versione **0.5.1** nei tre file (più `package-lock.json` e `Cargo.lock`), `claude/sviluppo` unito in `main`, tag `v0.5.1`. Rispetto alla 0.5.0: "Cattura una zona → chiedi a Claude", immagini negli Appunti (e con Ctrl+Alt+K), titolo del brano nella pillola Musica, "+N" nella barra compatta, scorciatoie registrate premendo i tasti.

### 4 ottobre 2026 — scorciatoie registrate premendo i tasti
- Tutti i campi delle scorciatoie (Impostazioni → Azioni rapide: le quattro globali e quella di ogni azione) catturano la combinazione premuta: clic sul campo, "Premi i tasti…", poi la combinazione viene scritta e salvata (`hotkeyInput` in `src/settings/main.ts`). Mentre si tengono premuti solo i modificatori il campo li mostra ("Ctrl+Alt+…"); un tasto senza Ctrl, Alt o Win viene rifiutato con un suggerimento sotto il campo; Esc annulla, Canc/Backspace toglie la scorciatoia, ✕ la svuota; Tab da solo passa al campo dopo. Tasti ammessi gli stessi di `hotkeys::parse` (lettere, cifre anche del tastierino, F1–F24, Spazio, Invio, Tab, Esc).
- **Scorciatoie sospese mentre un campo ascolta** (`hotkeys::suspend`, comando `hotkeys_suspend`): altrimenti premendo una combinazione già registrata partirebbe l'azione invece di arrivare al campo. Riprendono all'uscita dal campo e, per sicurezza, comunque dopo 2 minuti.
- Verificato nell'anteprima del browser con eventi simulati (il pannello non disegnava i clic veri). **Da provare nell'app installata**: una combinazione già in uso (es. Ctrl+Alt+K) che deve finire nel campo senza aprire l'isola; AltGr sulle tastiere italiane arriva come Ctrl+Alt.

### 4 ottobre 2026 — installazione finita nella cartella dell'app Claude (risolto)
- **Cosa è successo:** l'app desktop di Claude è un'app a pacchetto (MSIX). Tutto ciò che un suo processo scrive in `%APPDATA%` / `%LOCALAPPDATA%` viene reindirizzato in `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\…`. Le installazioni lanciate dalla shell di Claude Code (0.3.0, 0.5.0) e l'app avviata da lì leggevano e scrivevano in quella copia: le impostazioni di due giorni (Goccia, integrazioni, azione "Resoconto") esistevano solo lì, e la cartella vera aveva le impostazioni del 3 ottobre e nessun `easyisland.exe`. È emerso riavviando l'app da Gestione attività.
- **Risolto:** impostazioni recenti copiate nella cartella vera (backup della precedente: `%APPDATA%\EasyIsland\settings.backup-2026-10-04-pre-ripristino.json`), storico delle abitudini copiato, installer eseguito da Edoardo con doppio clic, copia nella cartella di Claude eliminata. Verificato dal log vero: app avviata dalla cartella giusta, impostazioni corrette, hook che arrivano.
- **Regola:** non eseguire mai installer o app direttamente dalla shell di Claude Code. Si compila con `npm run pack`, poi si installa da Esplora file: a mano con un doppio clic, oppure dalla shell facendolo partire tramite Esplora file (`explorer.exe release\installa.cmd`: lo script, escluso da git, installa in silenzio e riavvia l'app, fuori dal reindirizzamento). Per leggere le cartelle vere dalla shell: `\\localhost\C$\Users\<utente>\AppData\…` (non reindirizzato).

### 4 ottobre 2026 — Cattura una zona, immagini negli Appunti, titolo del brano, "+N" nella barra
- **Cattura una zona → chiedi a Claude** (`src-tauri/src/screenshot.rs`): scorciatoia **Ctrl+Alt+Shift+S** (`hotkeyScreenshot`, del PC, in Impostazioni → Azioni rapide) o pulsante **Cattura una zona** nella scheda + dell'isola. L'isola si ritira, si apre lo Strumento di cattura di Windows (`ms-screenclip:`, lo stesso di Win+Shift+S: zona, finestra o schermo intero); l'immagine che copia viene salvata come PNG nell'inbox ("Schermata AAAA-MM-GG hh.mm.ss.png", quindi anche in "File caricati") e la chat si apre con l'immagine allegata, pronta per la domanda (`Island.captureScreen` → `askAboutPicture`). Gli appunti vengono osservati solo durante la cattura (ogni 150 ms, massimo 60 s); Esc nello Strumento di cattura non viene segnalato, quindi la cattura annullata resta in ascolto fino al timeout, e una nuova cattura o un testo copiato la chiudono. Funziona con entrambi i motori: con la chiave API l'immagine va come blocco `image`, con l'abbonamento Claude la legge con Read.
- **Immagini negli Appunti** (`clipboard.rs` + nuovo `clipimage.rs`): la cronologia registra anche le immagini copiate (se c'è anche un testo, come per le celle di Excel, vince il testo). Tenute **solo in memoria** come PNG, al massimo 10 non fissate, con una miniatura per l'isola; la stessa immagine copiata di nuovo sale in cima invece di duplicarsi. Nella scheda: miniatura e dimensioni; clic = incolla, poi copia, **Chiedi a Claude** (salva una copia PNG nell'inbox e apre la chat, `clipboard_ask`), fissa, elimina; niente trasformazioni. Le copie private (password manager) restano escluse come per il testo. **Ctrl+Alt+K** con un'immagine negli appunti (e nessun testo) apre la chat con l'immagine allegata (`clipboard_picture`).
- **Lettura e scrittura delle immagini** (`clipimage.rs`): formato "PNG" se un'app lo mette, altrimenti `CF_DIB` (24 e 32 bit, righe dal basso o dall'alto, maschere dei colori; il quarto byte a 0 vale "opaco"); in scrittura `CF_DIB` a 32 bit più "PNG" (trasparenza in Office e nei browser). Limite 33 milioni di pixel. Il PNG passa dalla crate `png` 0.18, **già nel progetto tramite Tauri** (tray-icon, muda): aggiunta come dipendenza diretta, nessun codice nuovo da scaricare (stesso caso di `webview2-com`).
- **Pillola Musica:** mostra il titolo del brano (allineato a sinistra dopo il mini personaggio) e nel suggerimento "In riproduzione / In pausa: titolo — artista"; senza musica resta "Musica".
- **Vista compatta a barra:** con più di 4 integrazioni mostra 3 mini personaggi (prima quelli con un avviso) e "+N" al quarto posto, senza cambiare la geometria della finestra.
- `files.rs`: `save_new` (file creati da EasyIsland nell'inbox) e `unique_dest` in comune con `ingest`. Scena di anteprima `?scene=clipboard` con un'immagine finta.
- Verificato: test Rust (DIB a 24/32 bit, senza alpha, rotti; PNG andata e ritorno; miniature; cronologia con immagini e limite), `cargo test --workspace` (66 + 6), `npm run build`, anteprima del browser (riga immagine con i suoi pulsanti, pulsante nella scheda +, pillola col titolo, "+3" nella barra). **Da provare dal vivo:** vedi l'elenco in fondo.

### 4 ottobre 2026 — handoff riallineato al codice
- Sezioni 1, 2, 4, 6, 7, 9 e "Problemi noti" aggiornate: riassunto di cosa fa l'app alla 0.5.0, mappa con agente, automazioni, abitudini, integrazioni-controllo, Appunti/Musica, contesto ⚡, ZIP/file caricati/calcolatrice, registro dei personaggi e suoni sintetizzati (tolto il vecchio riferimento ad `assets/sounds/`); nuova sezione **6.5** (agente); idee della sezione 7 già realizzate separate dalle altre; repository pubblico e secret segnati come fatti; numero dei test aggiornato.
- Nuovo elenco **"Da provare dal vivo"** in fondo, che raccoglie le verifiche sparse nelle voci del registro.
- Aperto: il tag `windows-latest` sul repo (vedi sezione 4 → Distribuzione).

### 4 ottobre 2026 — versione 0.5.0
- Versione **0.5.0** nei tre file (la 0.4.0 è stata saltata di proposito), `claude/sviluppo` unito in `main`, tag `v0.5.0`. Rispetto alla 0.3.0: proposte di automazioni dalle abitudini (prima e seconda tappa: orari, avvio, rete, chiavetta, sequenze, automazioni da spegnere, programmi esclusi).

### 4 ottobre 2026 — Proposte dalle abitudini, seconda tappa
- **Sequenze:** "dopo aver aperto X apri quasi sempre Y entro 5 minuti" (almeno 5 volte e nel 60% delle aperture di X) → proposta "Quando apri X, apro anche Y?", cioè un'automazione "quando parte X → apri Y" (`seq|x|y`). Non proposta se un'automazione fa già la stessa cosa (`existing` ora considera anche l'eseguibile del trigger "programma").
- **Automazioni non più utili:** quelle create da una proposta ricordano da dove vengono (`origin` = impronta, in `Automation`); ogni loro esecuzione è annotata (`auto`, non "Prova ora"). Se nelle ultime esecuzioni (almeno 5, guardate fino a 7) nell'80% dei casi il programma aperto non è stato usato entro 30 minuti, o subito dopo è stato scelto a mano un altro profilo, l'isola propone **"Spengo l'automazione «…»?"** con il pulsante **Spegni** (`off|id`, `Suggestion.accept`, `Notice.suggestionAccept`). Spegnere non la elimina; "No, mai" vale anche qui, con "Spegni comunque" tra le rifiutate.
- **Programmi da non osservare:** campo in Impostazioni → Automazioni (`habitsExcluded`, es. "steam.exe, spotify"): non vengono più annotati e sono ignorati dall'analisi anche per lo storico già raccolto. `habits::apply` tiene in pari acceso/spento ed esclusioni a ogni salvataggio.
- Test: sequenza trovata, programma escluso ignorato, sequenza già coperta non riproposta, automazione inutilizzata segnalata con "Spegni". Build, installazione e avvio verificati; le proposte vere servono settimane di uso.

### 4 ottobre 2026 — Proposte di automazioni dalle abitudini (prima tappa)
- **Da attivare a mano:** Impostazioni → Automazioni → "Proposte dalle tue abitudini" → "Proponimi automazioni" (`habitsEnabled`, del PC, spento di serie). Spento non si registra niente (verificato: nessun file creato).
- **Cosa registra** (`src-tauri/src/habits.rs`, file locale `%LOCALAPPDATA%\EasyIsland\habits.jsonl`, 45 giorni, "Cancella lo storico"): un programma che viene in primo piano per la prima volta in 2 ore (nome e percorso dell'eseguibile, mai titoli o contenuti; esclusi i programmi di Windows), avvio di EasyIsland, sblocco del PC, cambio di rete Wi-Fi (ogni 10 min), unità collegata (ogni 10 s), azione rapida usata (`habit_note_quick` da `runAction`), profilo scelto a mano (Impostazioni o menu). Niente in pausa. Il primo piano arriva dall'hook di `context.rs`, senza polling.
- **Analisi** (pura, testata, `analyse`): sugli ultimi 21 giorni, (1) un programma aperto per la prima volta nella giornata alla stessa ora (±30 min dalla mediana) in almeno 5 giorni e nel 60% dei giorni attivi (solo feriali se capita solo di lunedì–venerdì) → automazione "a un orario" qualche minuto prima, che apre quel programma; (2) un programma aperto entro 10 min dall'avvio in almeno 4 avvii e nel 60% → "all'avvio"; (3) un profilo scelto entro 10 min dal collegamento a una rete, 3 volte e nel 60% → "rete Wi-Fi → profilo"; (4) un'azione rapida usata entro 10 min dal collegamento di un'unità, 3 volte e nel 60% → "chiavetta → azione". Mai una proposta già coperta da un'automazione esistente. Impronta stabile (`fp`, es. `time|outlook.exe|wd|08:30`, orario arrotondato alla mezz'ora): la stessa abitudine dà sempre la stessa proposta.
- **Proposte:** analisi ogni 6 ore (e quando si apre la pagina); **al massimo una al giorno** arriva all'isola, tra le 9 e le 20, come card "Proposta" con **Crea / Non ora / No, mai** (`habit-suggestion`, `Notice.suggestion`, `answerSuggestion`); le altre stanno nella pagina. Crea = automazione normale (controllata da `automations::validate`), modificabile. Non ora = di nuovo tra 30 giorni se l'abitudine continua (`suggestionsSnoozed`). No, mai = non più proposta, salvata con l'automazione in `suggestionsDismissed` (impostazioni del PC, quindi nel backup): nella pagina "Proposte rifiutate" con **Crea comunque** e **Togli dai rifiutati**.
- Scena di anteprima `?scene=suggestion`. Test: abitudine del mattino nei giorni feriali (e nessuna proposta per orari casuali o per il weekend sporadico), avvio / rete / chiavetta, troppi pochi dati.
- **Seconda tappa (da fare):** sequenze ("dopo X apri quasi sempre Y"); controllo che le automazioni create da una proposta servano ancora (es. il programma aperto e subito chiuso) con la domanda se spegnerle; esclusione di programmi scelti dall'utente.

### 4 ottobre 2026 — versione 0.3.0
- Versione **0.3.0** nei tre file (`package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json`), `claude/sviluppo` unito in `main`, tag `v0.3.0`: la CI pubblica la release e le app installate dalla 0.2.0 in poi si aggiornano dopo un clic. Contiene tutto il lavoro dal 3 al 4 ottobre: Appunti, Musica, integrazioni in scheda, icone colorate, suggerimenti per l'app in uso, calcolatrice, Estrai ZIP, Tieni aperta, file caricati, connettore MCP `easyisland` (Claude usa il PC), automazioni e automazioni create dalla chat.

### 4 ottobre 2026 — Automazioni create a parole dalla chat (terzo passo dell'agente)
- Nuovi strumenti del connettore `easyisland`: `list_automations` (sola lettura, pre-consentito), `create_automation` e `set_automation_enabled` (con Consenti / Nega). Nessuno strumento per eliminare: si elimina solo nelle Impostazioni.
- **Anteprima = la card di conferma**: per `create_automation` l'isola mostra "Creare l'automazione «…» / Quando: … / Allora: …" con i nomi veri di azioni rapide, profili e integrazioni (`describeAutomation` in `src/island/hooks.ts`). Consenti = l'automazione viene creata e accesa.
- **Controllo** (`automations::validate`): tipi di trigger e di passo ammessi, orario HH:MM, giorni 1–7, id di azioni rapide, profili e integrazioni esistenti, link solo http/https, da 1 a 10 passi; un errore torna a Claude con la spiegazione, senza salvare niente. Salvataggio come dalle Impostazioni (`update_settings` in `agent.rs`: disco + `settings-changed` alle due finestre). `automations::describe` riassume ogni automazione per `list_automations`. Il prompt di sistema invita Claude a proporre un'automazione quando la richiesta è ricorrente.
- Verificato: test (controllo delle proposte), build, connettore installato provato a mano (`list_automations`; `create_automation` con orario sbagliato rifiutata senza scrivere nulla). **Da provare in una chat vera:** "ogni giorno feriale alle 9 apri Outlook".

### 4 ottobre 2026 — Automazioni "quando… se… allora…" (secondo passo dell'agente)
- **Nuova pagina Impostazioni → Automazioni** (`automationsSection` in `src/settings/main.ts`). Ogni automazione: nome, acceso/spento, **Quando** (a un orario in certi giorni; all'avvio di EasyIsland dopo N secondi; quando sblocchi il PC; quando ti colleghi a una rete Wi-Fi; quando parte un programma; quando colleghi una chiavetta o un disco; quando arriva un file in una cartella; quando un'integrazione-controllo o un widget segnala un problema e/o una novità, es. nuovo ticket), **Solo nel profilo** (facoltativo), **Allora** una sequenza di passi (azione rapida di qualsiasi profilo, avviso nell'isola, passa a un profilo, apri programma o cartella, apri link), "Avvisami ogni volta", **Prova ora**. Sotto, il **Registro** delle ultime esecuzioni (in memoria, 100), aggiornato dall'evento `automations-log`.
- **Motore** (`src-tauri/src/automations.rs`): un thread che guarda ogni 5 s (30 s se nessuna automazione è accesa) e interroga solo ciò che serve alle automazioni accese: elenco dei processi (`presence::processes`), lettere delle unità (`GetLogicalDrives`), contenuto delle cartelle (ogni 10 s, solo file nuovi), rete Wi-Fi (`profiles::current_ssid`, ogni 30 s). Lo sblocco arriva da Windows (`WTSRegisterSessionNotification` su una finestra solo-messaggi, nuova feature `Win32_System_RemoteDesktop`). I controlli passano da `widgets.rs` → `automations::on_widget` (passaggio da ok a warn/error = problema; `event` = novità; il primo risultato non fa partire niente). Un orario scatta una volta per minuto; l'avvio una volta per automazione. In pausa non parte niente.
- **Esecuzione:** le automazioni girano senza chiedere (approvate creandole), con i limiti di sempre: link solo http/https, programmi con `open_app`, script delle azioni rapide nascosti con l'esito nel registro. Uno script con "Chiedi conferma" o una domanda a Claude vengono passati all'isola (`automation-action` → `island.runAction`), che chiede Esegui / apre la chat. Errori: avviso rosso nell'isola sempre; esito ok solo con "Avvisami ogni volta".
- `automations` nelle impostazioni (del PC, non del profilo; `serde(default)`, nessuna migrazione). Comandi `automations_log`, `automation_run_now`. Test: parsing con i valori predefiniti e passaggi dei controlli.
- **Verificato:** build, test, pagina nell'anteprima del browser, avvio dell'app installata senza errori. **Da provare dal vivo:** ogni tipo di "Quando" (orario, sblocco, chiavetta, cartella, programma, Wi-Fi, integrazione) e "Prova ora".
- **Prossimo passo (livello 3):** creare le automazioni a parole dalla chat, con nuovi strumenti del connettore `easyisland` (es. `list_automations`, `propose_automation` che mostra un'anteprima da confermare nell'isola).

### 4 ottobre 2026 — Claude può usare il PC: il connettore MCP "easyisland" (primo passo dell'agente)
- **Cosa fa:** nella chat con l'abbonamento (motore Claude Code) Claude ha gli strumenti di EasyIsland: `get_foreground_app`, `list_status` (ultimo risultato di integrazioni-controllo e widget: PC, sicurezza, rete, meteo, Outlook, Zammad, controlli dell'utente), `list_quick_actions` / `run_quick_action` (solo le azioni rapide dell'utente: link, programmi, script con output; non quelle "domanda a Claude"), `open_app`, `open_url` (solo http/https), `read_clipboard` / `write_clipboard`, `show_notice`, `media_status` / `media_control`, `list_uploaded_files`, `list_profiles` / `switch_profile`. **Nessun comando arbitrario**: per eseguire qualcosa Claude può solo usare le azioni rapide create dall'utente.
- **Permessi:** decide Claude Code, come per i connettori. Pre-consentiti solo gli strumenti che non cambiano niente (`AGENT_READ_ONLY` in `claude_cli.rs`, stessa lista in `hook/src/mcp.rs`, più avvisi e play/pausa); tutti gli altri passano dall'hook `PermissionRequest --chat` → card **Consenti / Nega** nell'isola, con la descrizione in italiano (`easyislandTarget` in `src/island/hooks.ts`: "Aprire outlook", "Eseguire lo script «Backup»:" con il testo dello script…).
- **Com'è fatto:** `easyisland-hook mcp` (nuovo `hook/src/mcp.rs`) è un server MCP stdio (JSON-RPC, un messaggio per riga) che conosce l'elenco degli strumenti e inoltra ogni chiamata all'app sulla stessa named pipe degli hook (evento `EasyIslandTool`, risposta `{"ok","text"}` su una riga; massimo 330 s). `pipe.rs` la passa a `agent.rs`, che esegue. La chat scrive `chat-mcp.json` nella cartella della chat e passa `--mcp-config` (con `--strict-mcp-config` se l'utente non ha scelto connettori suoi), `--permission-mode default` e l'hook dei permessi anche senza connettori. Il prompt di sistema spiega gli strumenti (`AGENT_PROMPT`). `widgets.rs` ricorda l'ultimo risultato di ogni controllo (`last_result`), `media.rs` l'ultimo stato (`last`).
- **Impostazione:** Impostazioni → Claude → "Claude può usare il PC" (`agentTools`, del PC, acceso di serie). Solo con il motore abbonamento; con la chiave API la chat resta senza strumenti.
- **Verificato:** test Rust (app e hook), build, e il connettore installato provato a mano via stdio con l'app accesa (initialize, tools/list, profili, azioni rapide, stato di rete e meteo, rifiuto di un link non web). **Non ancora provato dentro una chat vera con Claude**: la card Consenti/Nega per questi strumenti e il flusso completo.
- **Prossimi passi (livelli 2 e 3 della proposta):** automazioni locali "quando… se… allora" (orari, avvio, Wi-Fi, app, dispositivi, cartelle, eventi delle integrazioni) con registro; poi creazione delle automazioni a parole tramite nuovi strumenti del connettore, con anteprima da confermare.

### 3 ottobre 2026 — cronologia dei file caricati
- Nella scheda **+** (Rilascia) il pulsante **File caricati ›** apre la vista `files` (`buildFiles` in `src/views/upload.ts`): le copie dei file rilasciati sull'isola, cioè la cartella `%LOCALAPPDATA%\EasyIsland\inbox`, dalla più recente, con dimensione e "quanto tempo fa". Per ogni file: **Chiedi a Claude** (lo riapre in "Cosa vuoi farne?" senza ricopiarlo, `askAboutFile`), **Apri** (con il suo programma), **Mostra nella cartella** (Esplora file con il file selezionato), **Elimina**; doppio clic apre. **Elimina tutti** chiede un secondo clic entro 3,5 s. Gli originali non vengono mai toccati; le copie si cancellano comunque da sole dopo una settimana (`sweep`, com'era).
- Rust (`files.rs`): `list_inbox`, `delete_from_inbox`, `clear_inbox`, `inbox_path`, che accetta solo un nome semplice (niente `..`, barre o percorsi assoluti: test `inbox_names_cannot_leave_the_inbox`). Comandi `inbox_list`, `inbox_delete`, `inbox_clear`, `inbox_open`.
- Verificato nell'anteprima del browser con file finti. Da provare nell'app installata: apri / mostra / elimina sui file veri.

### 3 ottobre 2026 — calcolatrice, "Estrai…" per gli ZIP, pulsante "Tieni aperta"
- **Calcolatrice** (`src/core/calc.ts`, nel campo della chat): scrivendo un calcolo compare sopra il campo "= risultato" in tempo reale; Invio copia il risultato negli appunti (senza separatore delle migliaia, così si incolla come numero), Ctrl+Invio lo manda comunque a Claude. Parser a discesa ricorsiva, niente `eval`: + − × ÷ (anche `x`, `:`, `*`, `/`), `^`, parentesi, meno unario; numeri all'italiana ("1.234,5"; senza virgola il punto è decimale, salvo gruppi di tre cifre); percentuali come una calcolatrice tascabile ("840 + 22%" = 1.024,8, "840 − 10%" = 756, "15% di 840" = 126, "22%" = 0,22). Un numero da solo o un testo non sono calcoli. Divisione per zero → nessun risultato. Casi provati nell'anteprima.
- **"Estrai…" per gli ZIP** (`src-tauri/src/zip.rs`): rilasciando un .zip, "Cosa vuoi farne?" offre "Estrai…" (azione predefinita `builtin:unzip` in `fileActions()`, prima delle azioni dell'utente). La vista `unzip` (`buildUnzip` in `src/views/upload.ts`) mostra numero di file, dimensione estratta e i primi 12 nomi; poi "Estrai accanto all'originale", "In Download", "Sul Desktop" (cartella vera anche se spostata su OneDrive). Estrae sempre in una cartella nuova col nome dello ZIP ("nome (2)" se esiste), che si apre in Esplora file. Nessuna dipendenza: `System.IO.Compression` di .NET via PowerShell, percorsi passati in variabili d'ambiente; `ExtractToDirectory` rifiuta i percorsi che escono dalla cartella. `DroppedFile` ricorda ora anche `source` (il percorso originale; `path` è la copia in inbox). Script provati su uno ZIP di prova (elenco, estrazione, cartella "(2)").
- **Pulsante "Tieni aperta"** (📌 nell'intestazione, viola; pieno quando attivo): niente chiusura automatica e niente conto alla rovescia finché è acceso (`State.keepOpen`, `fsm.keepOpen` / `setKeepOpen`); Esc e ✕ chiudono comunque, e chiudere lo spegne. Spegnendolo col mouse fuori dall'isola riparte il ritardo normale.
- Correzione: nell'elenco dei file dello ZIP le righe si schiacciavano una sull'altra (flex che le restringeva nell'altezza massima); ora hanno altezza fissa e la lista scorre, con una barra sottile.
- Verificato nell'anteprima del browser. Da provare nell'app installata: copia del risultato, estrazione di uno ZIP vero dalla barra delle applicazioni o da Esplora file.

### 3 ottobre 2026 — "Cosa fai adesso": azioni suggerite per l'app in primo piano
- In cima alla scheda ⚡ compare "Per Outlook / Excel / Word / PowerPoint / Browser / Codice / Terminale / Teams / PDF" con 2-3 pulsanti (es. Outlook: Riassumi la mail, Scrivi una risposta, Cosa devo fare?); per ogni altra app tre azioni generiche (Riassumi, Traduci, Correggi) col nome del programma. Regole e prompt in `src/island/context.ts` (`RULES`, `suggestionsFor`); desktop e barra delle applicazioni esclusi.
- **Come funziona** (`src-tauri/src/context.rs`): quando l'isola si apre (`setMode("expanded")` → `refreshForeground`) chiede l'app in primo piano (`foreground_app`: exe e titolo della finestra, EasyIsland escluso). Niente in background. Al clic su un suggerimento `capture_selection` aspetta che i tasti modificatori siano rilasciati, manda Ctrl+C all'app (l'isola non prende il focus), attende il cambio degli appunti (max 600 ms), legge il testo e **rimette negli appunti il testo di prima**; la copia non entra nella cronologia Appunti (`clipboard::ignore_next`). Se l'app in primo piano è l'isola stessa non manda nulla. Senza testo selezionato: "Seleziona prima il testo in …". Poi apre la chat con il prompt e il testo come contesto ("Testo da Outlook").
- Interruttore "Suggerimenti per l'app in uso" in Impostazioni → Azioni rapide (`contextActions`, del PC, acceso di serie).
- Verificato nell'anteprima del browser con un'app finta (Outlook). **Da provare nell'app installata:** Ctrl+C reale in Outlook/Excel/browser e ripristino degli appunti; con Excel si copiano i valori delle celle, non le formule (per "Spiega la formula" va selezionato il testo nella barra della formula).
- **Correzione (stesso giorno):** dopo aver usato la chat l'isola aveva il focus ed era lei "l'app in primo piano": restava il nome vecchio ("Per Claude" stando su Chrome) e Ctrl+C non partiva. Ora un hook `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` (`context::spawn`, si sveglia solo al cambio di finestra) ricorda l'ultima finestra che non è EasyIsland; `foreground_app` restituisce quella, e `capture_selection` le ridà il focus (`SetForegroundWindow`) prima di Ctrl+C. L'app in uso si rilegge anche aprendo la scheda ⚡. Nuova feature del crate `windows`: `Win32_UI_Accessibility`.

### 3 ottobre 2026 — icone più grandi e colorate
- Ogni pulsante con icona ha il suo colore in `--c` (impostato nel codice): il simbolo è disegnato in quel colore su una tinta leggera dello stesso colore (`color-mix`), più forte al passaggio del mouse e quando è attivo. Regole in fondo a `src/style.css` ("Colourful icons") e `src/settings/settings.css`.
- **Barra dell'isola:** schede più grandi (34×26, icone 16 px) e colorate: ⌂ azzurro, 💬 viola, ⚡ ambra, + verde; impostazioni grigio-blu, audio ciano (rosso se muto), chiudi rosso. Pallino più grande nelle schede delle integrazioni.
- **Card:** freccia "Apri" 12 px azzurra, "…" dei dettagli ambra, indietro azzurro; Appunti con pulsanti 22 px (copia azzurro, trasforma ambra, fissa viola, elimina rosso); Musica con pulsanti 30/36 px nel colore dell'integrazione e play con alone; invio della chat viola 32 px, "Nuova chat" con + verde; icone del ticker, del timer e di Notion più grandi.
- **Impostazioni:** il menu laterale usa le icone disegnate di `action-icons.ts` al posto dei simboli Unicode, in riquadri colorati di 28 px (pieni sulla pagina aperta): Generale chiave inglese, Aspetto immagine, Notifiche avviso, Claude scintille, Azioni fulmine, Integrazioni rete, Widget grafico, Backup nuvola. `Page` ha ora `icon` (nome di `action-icons.ts`) e `color`.
- Non toccate: icona dell'app, icone delle azioni rapide (hanno già il colore dell'azione). Verificato nell'anteprima del browser.

### 3 ottobre 2026 — integrazioni come pillole o come schede
- Impostazioni → Integrazioni: per ogni integrazione "Mostra come" → *Pillola nella panoramica* (com'era) o *Scheda in alto nell'isola*. Nuovo campo `integrationTabs` (elenco di id; del profilo, in `PROFILE_KEYS`; vuoto di serie). Le integrazioni in scheda compaiono nell'intestazione dopo ⌂ 💬 ⚡ +, con pallino del loro colore e nome (pallino verde se hanno un avviso), e non sono più tra le pillole (`State.otherTasks` le esclude, `State.tabTasks` / `isTab`). Il clic sulla scheda apre la panoramica con quella integrazione nella card di sinistra; ⌂ torna alla prima integrazione non in scheda. Funziona solo per le integrazioni accese. Verificato nell'anteprima del browser (`&integrationTabs=integration_media,integration_clipboard`).
- Stesso giorno: la scheda può mostrare il nome (com'era) o un'icona. "Mostra come" ha tre scelte (pillola, scheda con il nome, scheda con un'icona); con l'icona compare un campo per un'emoji o una o due lettere, precompilato con un suggerimento per integrazione (`TAB_ICONS` in `src/settings/main.ts`: 📋 Appunti, 🎵 Musica, 🐙 GitHub…). Nuovo campo del profilo `integrationTabIcons` (id → icona); con l'icona la scheda è compatta e il nome resta nel suggerimento al passaggio del mouse.
- Stesso giorno: aprendo la scheda di un'integrazione si vede solo quella, a tutta larghezza, senza pillole (in `buildOverview` le pillole sono vuote quando l'integrazione in primo piano è in scheda, quindi vale la classe `solo`). Le pillole restano solo su ⌂.

### 3 ottobre 2026 — integrazioni Appunti e Musica
- **Appunti** (`integration_clipboard`, `src-tauri/src/clipboard.rs`): cronologia dei testi copiati. Una finestra solo-messaggi con `AddClipboardFormatListener` si sveglia solo a `WM_CLIPBOARDUPDATE` (nessun polling). Ultimi 30 testi più quelli fissati, ognuno fino a 20.000 caratteri; all'isola ne arriva un'anteprima di 300. **Solo in memoria**: mai su disco, si svuota alla chiusura (anche i fissati). Non registra le copie segnate come private (`ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` = 0, `Clipboard Viewer Ignore`), né niente con l'integrazione spenta o l'app in pausa. Nella scheda: clic su una riga = rimette il testo negli appunti e manda Ctrl+V all'app in primo piano (l'isola non prende il focus); al passaggio del mouse copia senza incollare, trasforma e incolla (MAIUSCOLO, minuscolo, una riga, senza spazi, JSON formattato, URL decodificato), fissa, elimina; "Svuota" tiene i fissati. Comandi `clipboard_use`, `clipboard_pin`, `clipboard_remove`, `clipboard_clear`. Nuova scorciatoia globale `hotkeyClipboard` (predefinita Ctrl+Alt+H, in Impostazioni → Azioni rapide) che apre l'isola sulla scheda Appunti, se l'integrazione è accesa.
- **Musica** (`integration_media`, `src-tauri/src/media.rs`): cosa sta suonando, da tutto ciò che compare nei controlli multimediali di Windows (`GlobalSystemMediaTransportControlsSessionManager`), in locale. Un controllo ogni 2 s solo con l'integrazione accesa; all'isola arriva un messaggio solo se cambia qualcosa (brano, play/pausa, salto della posizione > 3 s); la copertina (data URL, max 600 KB) si legge una volta per brano. La scheda mostra copertina, titolo, artista · app, barra di avanzamento che scorre da sola tra un aggiornamento e l'altro, e ⏮ ⏯ ⏭ (`media_command`). Nuove feature del crate `windows` (nessuna nuova dipendenza): `Foundation`, `Media_Control`, `Storage_Streams`, `Win32_System_Com`, `Win32_System_LibraryLoader`, `Win32_Graphics_Gdi`.
- Entrambe in Impostazioni → Integrazioni, spente di serie; la pillola è quella normale, nessun suono né badge. `refresh_integration` le gestisce (`clipboard::publish`, `media::refresh`); la scheda chiede lo stato da sola la prima volta (`ensureLoaded`). Scene di anteprima `?scene=clipboard` / `?scene=media` con `&activeIntegrations=integration_clipboard,integration_media`. Test Rust per trasformazioni, base64 e nomi delle app.
- Verificato: build Rust e front end, test, schede nell'anteprima del browser con dati finti. **Non ancora provato nell'app installata**: incolla con Ctrl+V nell'app in primo piano, lettura reale di Spotify o del browser, copertine.
- Aperti: immagini copiate non registrate (solo testo); il personaggio non "balla" con la musica; la pillola Musica non mostra il titolo del brano. _(Immagini e titolo fatti il 4 ottobre 2026.)_

### 3 ottobre 2026 — sfondo a isola chiusa
- Nuova opzione del tema `theme.compactBackground` (predefinita accesa; Impostazioni → Aspetto → Tema, "Sfondo a isola chiusa"). Spenta, mentre l'isola non è aperta (vista compatta: al passaggio del mouse o "Sempre visibile") lo sfondo dell'isola diventa trasparente (`#island.bare`, `applyBare` in `island.ts`) e resta solo il personaggio, con l'ombra leggera dell'icona a riposo; aprendo l'isola il colore torna con una dissolvenza. L'icona a riposo (isola nascosta) non aveva già sfondo. Verificato nell'anteprima del browser.

### 3 ottobre 2026 — EasyTech: lo sguardo lo fanno gli occhi
- Seguendo il cursore il cubo ruotava quasi per intero (tutto lo sguardo −1…1 andava nella rotazione) e gli occhi scorrevano solo del 17% della faccia, fermati da un limite per occhio. Ora (costanti in `cube.ts`) il cubo si inclina appena (`CUBE_TURN` 0.38 in orizzontale, `CUBE_TIP` 0.18 in verticale, perché a riposo guarda già in basso) e la coppia di occhi scorre fino a quasi il bordo della faccia (`CUBE_EYE_X` 0.3, `CUBE_EYE_Y` 0.26, `cubeEyeRoom`) senza stringersi. Stesse proporzioni nel motore, nel saluto e nel caricamento. Verificato nell'anteprima nelle 9 direzioni.

### 3 ottobre 2026 — personaggi intercambiabili, nuovo personaggio Goccia
- **Contratto comune** (`src/character/character.ts`): registro (`registerCharacters`, `characters()`, `character()`, `setCharacter`) ed elenco in `roster.ts`. Due famiglie: **soft** (`SoftCharacter`: `point` per il contorno, `palette`, `drawBody`, `drawEye`, più `size`, `face`, `aspect`, `color`, `wobbles`) ed EasyTech, il cubo 3D (`kind: "cube"`, disegnato da `cube.ts`). Motore, saluto, caricamento file e isola non nominano più nessun personaggio: chiedono `character()` e usano `kind` solo per distinguere il cubo. Prima c'erano 11 `character() === "cube"` in 4 file con funzioni di Slime cablate.
- **Goccia** (`src/character/drop.ts`, id `drop`), dalla tavola di Edoardo: punta in alto e base arrotondata, palette #9FE8FF / #4DB8FF / #1F6FB7 (con un colore del tema la ricava dal colore scelto), riflessi lucidi senza gocciolature, occhi ovali con riflesso bianco. Tutti gli stati, le espressioni, le mani, la gelatina, i mini, il saluto e la trasformazione in scatola del caricamento vengono dal codice comune. Verificato nelle anteprime `dev/character-preview.html?character=drop` e `dev/upload-preview.html?character=drop`; Slime invariato.
- Impostazioni → Aspetto: i personaggi vengono dal registro; la riga del colore mostra il colore del personaggio scelto ("Colore di Goccia", predefinito il suo) e sparisce per EasyTech. `theme.character` è ora una stringa (id); il campo del colore resta `slimeColor` per compatibilità dei file.
- **Goccia rifinita** (stesso giorno, 8 punti): contorno in un'unica curva (`teardrop` in `drop.ts`: x ∝ sin t·(sin²(t/2)+r²)^(m/2), y = −cos t) al posto di due metà cucite che facevano uno spigolo sui fianchi; punta appena arrotondata (`TIP_R`); pancia piena (`TIP_M` 1.08); bordo più sottile e un po' trasparente; riflesso principale a mezzaluna lungo il contorno in alto a sinistra più uno piccolo accanto alla punta; tolti il riflesso che sembrava una lacrima e il puntino che sembrava un terzo occhio; luce riflessa corta sul bordo del fondo (più in alto sembrava una bocca); occhi più grandi e più distanti. Idee buone prese da una proposta di ChatGPT (bordo, luce traslucida in alto, ombra interna, sfumatura a 4 passaggi).
- Non fatto: le pose della tavola (saluto con la mano, salto, caduta, onda) restano quelle comuni del motore; le "mani a goccia" sono le stesse ellissi degli altri.

### 3 ottobre 2026 — integrazioni Outlook e Zammad; Stato del PC, Sicurezza, Rete e Meteo da widget a integrazioni
- **Regola:** i servizi e programmi a istanza singola sono integrazioni, non widget (vedi 6.4). Diventano integrazioni (`settings::PROBE_INTEGRATIONS`): `integration_system`, `_security`, `_network`, `_weather`, `_outlook`, `_zammad`. Restano widget: ping, porta TCP, sito, certificato, servizio Windows, API JSON, calendario ICS, scadenza domini.
- **Come girano:** sono controlli, quindi usano lo scheduler dei widget (`widgets::all_widgets` aggiunge quelli accesi in `activeIntegrations`, con id = id dell'integrazione): pausa, ×3 a batteria, "Aggiorna" (`widget_refresh`) e `widget-update` come i widget. Opzioni in `integrationConfig` (impostazioni del PC, non del profilo): `systemWarn`, `outlookWarn`, `weatherCity`. Zammad come n8n: `zammad-url` e `zammad-token` in Gestione credenziali. Front end: `PROBE_INTEGRATIONS` in `src/core/state.ts`, scheda come quella dei widget (`widgetCard`), voci con opzioni e descrizione in Impostazioni → Integrazioni (`IntegrationDef.options` / `hint`); i tipi spariscono dalla pagina Widget.
- **Conversione (schema 5, `Settings::migrated`):** i widget di quei tipi, in cima e in ogni profilo, diventano l'integrazione accesa in quel profilo; il primo di ogni tipo passa le opzioni (soglia disco, minuti Outlook, città). Indirizzo e token di un widget Zammad vengono spostati in `zammad-url` / `zammad-token` all'avvio (`apply_pending_secrets`). Test in `settings.rs`.
- **Outlook classico** (`src-tauri/src/outlook.rs`): mail non lette nella Posta in arrivo e appuntamenti da adesso a fine domani (riunioni annullate escluse), via COM con una breve chiamata PowerShell ogni 60 s. Si aggancia solo a un Outlook già aperto (`GetActiveObject`), non lo avvia mai; chiuso = "Outlook non è aperto", livello ok. Testo e avviso "tra N minuti" da `calendar::describe`. Il nuovo Outlook (olk.exe) non ha COM: non supportato. Script con soli apici singoli (le virgolette doppie si perdono passando l'argomento a powershell.exe). Provato su questo PC solo con Outlook chiuso.
- **Zammad** (`src-tauri/src/zammad.rs`): conteggi da `/api/v1/ticket_overviews` (viste dell'agente per `link`: `my_assigned`, `all_unassigned`, `all_escalated`), funziona anche senza Elasticsearch; titoli dei 3 non assegnati più recenti da `?view=all_unassigned`; escalation > 0 → giallo; "Apri Zammad" (`open_zammad`). **Non ancora provato con un server reale**: la forma delle risposte di `ticket_overviews` va verificata.
- **Eventi:** `WidgetResult.event` annuncia qualcosa di appena successo anche se il livello non cambia (suono, badge, isola visibile, in `handleWidget`). Lo usa Zammad: "Nuovo ticket: #… titolo" quando i non assegnati aumentano (il primo controllo fissa solo il punto di partenza).

### 3 ottobre 2026 — azioni su file in "Cosa vuoi farne?", trascinamento sopra la barra
- Dopo il rilascio di un file, la schermata "Cosa vuoi farne?" mostra tra "Fai una domanda" e "Annulla" le azioni rapide di tipo *prompt* con input "File rilasciato sull'isola", ognuna con il pallino del suo colore. Il clic avvia la chat sul file con il prompt salvato (`Island.runAction`). Queste azioni **non** compaiono più nella scheda ⚡ (`tabActions()` / `fileActions()` in `src/views/actions.ts`); restano richiamabili con la loro scorciatoia, se ce l'hanno.
- I pulsanti sono disegnati dal canvas (`layoutChoose` in `src/upload/canvas.ts`), dimensionati sull'etichetta (nomi lunghi accorciati con "…"), con le aree di clic ricostruite. Se non stanno tutte nella riga, **Altre…** scorre i gruppi successivi; ogni nuovo file riparte dal primo. Senza azioni su file la schermata è identica a prima. Stessi pulsanti nella vista HTML `choose` (`src/views/upload.ts`). Anteprima `dev/upload-preview.html?azioni=0…4`.
- **Correzione, file dietro l'isola:** con l'isola sopra la barra delle applicazioni, il file trascinato spariva dietro l'isola. L'immagine del trascinamento è una finestra topmost della shell (`SysDragImage`) e `raise_over_taskbar` rimetteva l'isola in cima a tutto, sopra di lei. Ora, se quella finestra è visibile, l'isola si mette subito sotto (sempre sopra la barra). In più `spawn_drag_raise` (`src-tauri/src/island.rs`) tiene l'isola davanti alla barra ogni 100 ms mentre il tasto sinistro è premuto, anche a riposo (solo con `over_taskbar` attivo).
- **Correzione, caricamento fermo a 0 %:** se il file arrivava con l'isola compatta (il caso normale sopra la barra), `onDragDrop` avviava la sequenza (`UploadSeq.enterZone`) e poi apriva l'isola; l'apertura passa dalla vista predefinita (`fsm` → `home` → `expand(defaultView)`) e `stopSequenceIfLeaving` spegneva subito la sequenza: il personaggio non seguiva il file e la barra restava a 0. Ora prima si apre, poi parte la sequenza. Il log scrive lo stato dell'isola a ogni ingresso/rilascio (`dropState`).
- Verificato nell'anteprima del browser (0, 2 e 4 azioni, pagine di "Altre…") e nell'app installata (trascinamento sopra la barra: file visibile, personaggio che lo insegue, caricamento completo).

### 2 ottobre 2026 — release pubbliche e aggiornamenti automatici (0.2.0)
- **Aggiornamenti:** plugin ufficiale `tauri-plugin-updater` (unica dipendenza nuova: serve a verificare la firma). `src-tauri/src/updates.rs` controlla un minuto dopo l'avvio e poi ogni 24 ore `https://github.com/EdoardoDevelop/easyisland/releases/latest/download/latest.json`; se c'è una versione nuova l'isola mostra l'avviso con **Installa** / **Più tardi** (`showUpdate`), l'installer scaricato viene verificato con la chiave pubblica in `tauri.conf.json` e parte in modalità `passive` (l'app si chiude e si riapre). Impostazione `updateCheck` (del PC, attiva di default) e sezione **Aggiornamenti** in Impostazioni → Generale con "Controlla ora".
- **Release:** sui tag `v*` la CI compila con `--config src-tauri/tauri.updater.json` (artefatti dell'updater) e pubblica installer, `.sig` e `latest.json`, generato da `scripts/pack.mjs`. Senza il secret la pubblicazione si ferma con un messaggio chiaro.
- Versione **0.2.0** nei tre file. Firma provata in locale: installer, `.sig` e `latest.json` generati.
- **Documenti:** `CONTRIBUTING.md` riscritto in italiano per EasyIsland; eliminati `docs/SPEC.md` e `docs/INTEGRATIONS.md` (app macOS originale, restano nella storia git). `LICENSE` con il copyright di `EdoardoDevelop` accanto a quello originale; `LICENSE-ASSETS.md` ridotto agli asset originali rimasti come riferimento (`design/`). `copyright` dell'installer e `authors` aggiornati.
- **HANDOFF ripulito** dai dettagli personali in vista del repository pubblico (stato del PC, contesto di lavoro).
- Da fare (Edoardo): secret `TAURI_SIGNING_PRIVATE_KEY`, repository pubblico, tag `v0.2.0`. L'app installata prima della 0.2.0 non ha l'updater: la 0.2.0 va installata a mano una volta.

### 2 ottobre 2026 — nuove schermate del README, slime verde con Claude Code
- **Schermate rifatte** (`screenshots/`, a 2×, sfondo trasparente): saluto, vista compatta, panoramica con una sessione al lavoro, permesso, chat, rilascio file, Impostazioni → Aspetto. Si rigenerano con `node scripts/screenshots.mjs` (tutte o per nome) con `npm run dev` acceso: lo script pilota Edge headless con il DevTools protocol (nessuna dipendenza) e ritaglia l'isola.
- Scene di sviluppo in `dev/scenes.ts`, attivate da `?scene=…` nell'anteprima del browser (solo `import.meta.env.DEV`, non entrano nell'app); `settings.html?page=aspetto` apre una pagina delle Impostazioni.
- **Correzione:** con la pillola di Claude Code in primo piano (il caso normale) lo slime prendeva il colore della pillola, bianco, ed era quasi sempre bianco. Ora per Claude Code resta verde (o il colore del tema); le altre integrazioni lo colorano come prima.

### 2 ottobre 2026 — "Apri" riporta all'app della sessione
- Prima "Apri terminale" apriva la cartella in VS Code solo se `code` era nel `PATH`, altrimenti in Esplora file: su questo PC `code` non è nel PATH, quindi si apriva sempre la cartella.
- Il relay ora inoltra anche `CLAUDE_CODE_ENTRYPOINT` (`entrypoint`); il front end ricava dove gira la sessione (`sessionHost`: `desktop` = app Claude, `vscode` = estensione o terminale di VS Code, `wt` = Windows Terminal, `terminal` = altro) e il pulsante si chiama **Apri Claude**, **Apri VS Code** o **Apri terminale**. Vale per la schermata "ha finito", per quella d'errore (prima diceva sempre "Apri in n8n") e per la pillola VS Code.
- Backend `src-tauri/src/apps.rs` (comando `open_session`): porta in primo piano la finestra principale dell'app (`EnumWindows` sui processi `claude.exe`, `code.exe`, `windowsterminal.exe`…, con il tocco di Alt per poter usare `SetForegroundWindow`); per VS Code apre la cartella con `code`, cercato anche in `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin` e in Program Files. Ultima risorsa: Esplora file.
- Verificato dal vivo (`live_apps_are_found`): trova la finestra dell'app Claude e `code.cmd` fuori dal PATH. Provato da Edoardo con un clic vero: l'app torna in primo piano.
- Una console classica (cmd/PowerShell senza Windows Terminal) non sempre viene trovata: in quel caso si apre VS Code o la cartella.

### 2 ottobre 2026 — correzione: personaggio invisibile
- Nel commit `f03d83b` l'altezza della finestra aperta era passata a 560 solo nel front end (`layout.ts`), non in `island.rs` (rimasta 320): con l'isola ancorata in basso il personaggio veniva disegnato sotto il bordo della finestra e non si vedeva. Ora `PANEL_H` è 560 anche in Rust.
- Nuovo test `panel_size_matches_the_front_end` (`island.rs`): legge `layout.ts` e fallisce se le dimensioni della finestra non coincidono.
- Verificato sul PC: finestra 720×560 in basso a sinistra, `cargo test` 39 + 3 ignorati.

### 2 ottobre 2026 — integrazioni senza limite, isola che si adatta, icone delle azioni
- **Nessun limite di 4:** tolti `MAX_ACTIVE` dalle Impostazioni, il controllo in `State.toggleIntegration` e lo `slice(0, 4)` delle pillole nella panoramica. Integrazioni e widget attivi compaiono tutti, due per riga; quelli con un avviso vanno per primi.
- **Isola adattiva:** ogni vista può dichiarare l'altezza naturale del suo contenuto (`ViewHost.fitHeight`); l'isola cresce fino a `MAX_ISLAND_H` (544 px) e torna più bassa quando il contenuto si riduce (`islandSize(…, fit)` in `src/core/layout.ts`, `fit` in `Island.syncDom`). La usano la panoramica (scheda in primo piano + righe di pillole) e la scheda Azioni. Oltre l'altezza massima le pillole scorrono.
- La finestra aperta passa da 720×320 a **720×560** (`PANEL_H` in `layout.ts` e `island.rs`), trasparente e senza clic fuori dall'isola come prima.
- **Widget:** la scheda mostra tutti i campi (prima al massimo 3) e i valori lunghi vanno a capo invece di essere tagliati (`.w-field`, `.w-value`); il riepilogo pure. I pulsanti in fondo ("Aggiorna", "Copia info PC", "Impostazioni…") vanno a capo come blocchi interi.
- **Icone delle azioni rapide:** al posto del campo di testo (emoji) c'è un pulsante che apre una griglia di 51 icone disegnate nel codice (`src/views/action-icons.ts`), colorate come l'azione. Si salvano come `i:<nome>`; le vecchie emoji restano visibili finché non si cambiano, il vecchio "⚡" diventa il fulmine.
- Verificato nell'anteprima: 7 integrazioni + 3 widget (10 pillole), widget Rete con 5 campi lunghi visibili per intero, isola a ~340 px; selettore di icone nelle Impostazioni. `tsc` e `cargo test` verdi.
- Resta: la vista compatta a barra mostra ancora al massimo 4 mini personaggi (spazio fisso di 2×2). _(Dal 4 ottobre 2026: 3 più "+N".)_

### 2 ottobre 2026 — suoni generati nel codice
- I 28 WAV di Coucou (`assets/sounds/`) sono stati eliminati: ogni suono è sintetizzato in `src/core/synth.ts` (toni con glissando, vibrato e "tremolio" di gelatina, rumore filtrato) e generato all'avvio da `Sound.preload()` (circa 40 ms per tutti, nessun file).
- Carattere: lo slime fa suoni morbidi e gelatinosi (splat dello schiaffo, boing del saluto, blop quando inghiotte un file); gli avvisi restano brevi e distinguibili (permesso a tre note, domanda che sale, errore che scende, arpeggio di fine lavoro).
- Il volume di ciascun suono è tarato sull'RMS del WAV originale che ha sostituito: il cursore del volume (0–0,2, predefinito 0,12) e i volumi per famiglia valgono come prima.
- Tolto da `vite.config.ts` il plugin che serviva e copiava i WAV (`SOUNDS_DIR`). Nuova pagina `dev/sounds-preview.html` per ascoltarli tutti.
- Con questo non resta nessun asset dell'originale (nomi, personaggio, icona, suoni sono nuovi).
- Verificato: typecheck, i 28 suoni generati dall'app nell'anteprima, nessuna richiesta di file `.wav`. Ascoltati e approvati da Edoardo nella pagina di prova.

### 2 ottobre 2026 — Slime ed EasyTech, effetto gelatina
- **Nomi dei personaggi:** Ezzy diventa **Slime**, il cubo diventa **EasyTech** (solo il nome mostrato: il valore interno resta `cube`). Nelle frasi che valgono per entrambi l'interfaccia dice "il personaggio"; la chat non ha più un nome proprio ("La chat vuole usare un connettore"). Cartella `src/ezzy/` → `src/character/`, `drawEzzy` → `drawCharacter`.
- **Impostazioni, schema 4:** `theme.character` `"ezzy"`/`"mochi"` → `"slime"`, `iconStyle` `"ezzy"`/`"mochi"` → `"character"`, `ezzyColor`/`mochiColor` → `slimeColor`, anche nei profili e nei file esportati (test `mochi_and_ezzy_values_become_slime`).
- **Tolta l'ombra** nella parte bassa dello slime (la fascia di gelatina più scura e il gradiente verso il basso): il corpo resta chiaro fino alla base. Tolta anche la pozza scura sotto la base (`drawSlimePuddle` eliminato): lo slime appoggia direttamente sull'isola.
- **Effetto gelatina** (`Jelly` e `applyJelly` in `src/character/slime.ts`): due molle smorzate (inclinazione della cima ~3,2 Hz, allungamento ~4,2 Hz, poco smorzate) che ricevono un colpo da ogni variazione di velocità del corpo — salti, scosse d'errore, inclinazioni, schiacciamenti, schiaffi — e dal trascinamento dell'isola (`BotEngine.jiggle` da `island.ts`). La base resta ferma, la cima ondeggia e si assesta in circa un secondo; occhi e riflessi si muovono con il corpo. Lo sguardo che segue il mouse è escluso di proposito, così a riposo il ciclo di animazione si ferma come prima. EasyTech resta rigido.
- In `dev/character-preview.html`: clic = schiaffo, trascinare = scuotere.
- Verificato: `tsc`, `cargo test --workspace` (38 + 4), simulazione a 60 fps della gelatina (schiaffo, permesso, errore, occhiolino: oscilla e si ferma entro ~1 s), anteprima nel browser.

### 2 ottobre 2026 — Ezzy diventa uno slime, nuova icona
- **Personaggio:** tolto tutto l'aspetto di Mochi (corpo crema a superellisse, occhi a pillola). Ezzy è uno slime ispirato all'immagine di riferimento di Edoardo: cupola di gelatina con base piatta e piccola "gonna", pozza scura sotto, contorno scuro, gelatina più scura nel terzo inferiore, riflesso grande in alto a sinistra, gocce e bollicine, occhi neri tondi con riflesso bianco. Tutto in `src/ezzy/slime.ts` (`slimePoint`, `drawSlimeBody`, `drawSlimeEye`), disegnato nel codice.
- Verde di base `#5EC738` (`SLIME_GREEN`); negli stati prende il colore dello stato (blu al lavoro, giallo per i permessi, rosso per gli errori…), il colore del tema (Impostazioni → Tema → Colore di Ezzy, predefinito "Verde") e quello dell'integrazione in primo piano. I mini nelle pillole sono slime semplificati (niente pozza né gocce).
- Restano uguali stati, emozioni, tempi, particelle, saluto con le "mani" (ora due gocce di gelatina), trasformazione in scatola per i file rilasciati. Le forme d'occhio speciali (cuori, stelle, spirali, archi) sono quelle di prima.
- **Icona dell'app e dell'area di notifica** (`scripts/gen-icons.mjs`): non più il personaggio ma l'isola — pillola scura con bordo a gradiente indaco → ciano, luce di stato verde e due righe di testo (una sotto i 24 px). Si legge su barre chiare e scure.
- Nuova pagina di sviluppo `dev/character-preview.html`: tutti gli stati, le emozioni, i mini e il saluto, anche con `?character=cube`.
- `CLAUDE.md`: l'aspetto del personaggio e l'icona sono eccezioni volute al prototipo.
- Verificato nell'anteprima del browser (stati, emozioni, mini, saluto, sequenza del file, cubo invariato); `npm run build` e installer da rifare dopo il commit.
- Da fare: nuove schermate per README (`screenshots/`) con lo slime.

### 2 ottobre 2026 — nuovo nome: EasyIsland, personaggio Ezzy
- **Rinominato tutto:** Coucou → EasyIsland, Mochi → Ezzy, in interfaccia, installer, README, CLAUDE.md, SPEC/INTEGRATIONS, template delle issue, workflow e codice. `productName` EasyIsland, `identifier` e `SERVICE` della Gestione credenziali `it.edoardo.easyisland`, crate `easyisland` / `easyisland_lib` / `easyisland-hook`, named pipe `easyisland-<sid>`, variabile `EASYISLAND_INTERNAL`, evento `EasyIslandNotify`, cartella `src/ezzy/`, stato del saluto della macchina a stati `greeting` (era `coucou`). Installer: `EasyIsland-Windows-X.Y.Z-setup.exe`.
- Restano di proposito i riferimenti all'originale: `LICENSE`, `LICENSE-ASSETS.md`, `design/`, la nota "fork di Louis-CFM/coucou" in README e CLAUDE.md, le voci passate di questo registro. Eliminato il sito dell'autore originale (`docs/*.html`, `docs/media/`).
- **Migrazione al primo avvio** (`src-tauri/src/legacy.rs`), solo se `%APPDATA%\EasyIsland\settings.json` non esiste ancora: copia `%APPDATA%\Coucou\settings.json` e le chiavi da `fr.louisraille.coucou` (elencate con `CredEnumerateW`, nuova feature `Win32_Security_Credentials` della crate `windows`, nessuna dipendenza nuova). Se l'avvio automatico era attivo lo registra per EasyIsland. I file e le chiavi di Coucou vengono solo letti, mai cancellati.
- **Impostazioni, schema 3:** i valori `"mochi"` (`iconStyle`, `theme.character`) diventano `"ezzy"` e `theme.mochiColor` diventa `ezzyColor`, anche dentro i profili e nei file esportati prima del cambio.
- **Hook di Claude Code:** le voci con `coucou-hook` sono riconosciute come nostre; Impostazioni → Claude Code avvisa se ci sono ancora ("hook della vecchia versione") e **Reinstalla hook…** le sostituisce (diff e conferma come sempre).
- **Repository:** il lavoro continua in un repo nuovo, privato e autonomo (non fork), `EdoardoDevelop/easyisland`, con tutta la storia git.
- Verificato: `npm run build`, `cargo test --workspace` (38 + 4, più il nuovo `live_legacy_keys_are_found` eseguito a mano: l'elenco delle credenziali funziona).
- Da fare: installare EasyIsland, controllare che la migrazione porti impostazioni e chiavi, reinstallare gli hook, poi disinstallare Coucou (le due app hanno identifier diversi e possono girare insieme: due isole).

### 2 ottobre 2026 — verifica dell'handoff e unificazione su `main`
- Tutto il lavoro Windows (prima solo sul branch `claude/lucid-lamport-v5nvs3`) è ora su `main`; i vecchi branch `claude/*` sono stati eliminati.
- Handoff verificato contro il codice e corretto: data, lingua di `SPEC.md`/`INTEGRATIONS.md` (italiano), paragrafo superato in 6.3, mappa con i moduli nuovi (profili, azioni, widget, sonde, presenza, notify), numero dei test, posizione di `copy_pc_info` (`lib.rs`).
- `CLAUDE.md`: descritta la chat con i connettori MCP (`--permission-mode default`, hook `PermissionRequest --chat`) e i moduli nuovi.
- Il widget `ping` usa `icmp_ms` invece di una sua copia della chiamata `IcmpSendEcho` (`src-tauri/src/widgets.rs`); il messaggio d'errore è ora sempre "non risponde".
- Scorciatoia predefinita per aprire Mochi: `Ctrl+Alt+Shift+M` (era `Ctrl+Alt+M`, in conflitto con un altro programma). Aggiornati `settings.rs`, `state.ts` e `README.md`.
- Da fare: compilare e far girare `cargo test` su Windows (la modifica a `widgets.rs` è verificata solo dalla CI).

### 2 ottobre 2026 — integrazioni locali, "davanti al cliente", notify, Impostazioni a pagine
- **Nuovi tipi di widget** (`src-tauri/src/probes.rs`, `calendar.rs`), con modelli pronti nell'editor:
  - *Stato del PC*: disco di sistema, memoria, batteria, uptime, riavvio richiesto (Win32 + registro). Pulsante **Copia info PC** (PowerShell + appunti, comando `copy_pc_info` in `lib.rs`).
  - *Sicurezza*: antivirus e firewall dal Centro sicurezza (`root/SecurityCenter2`, vale anche per prodotti di terze parti), firme e scansioni di Defender, minacce; una chiamata PowerShell ogni 30 minuti.
  - *Rete*: adattatori (`GetAdaptersAddresses`), VPN riconosciute per nome o tipo, Wi-Fi (`netsh`), latenza ICMP verso 1.1.1.1, IP pubblico da api.ipify.org con cache di 15 minuti.
  - *Calendario ICS*: link segreto in Gestione credenziali (`widget:<id>:ics`); ricorrenze DAILY/WEEKLY/MONTHLY/YEARLY con INTERVAL, COUNT, UNTIL, BYDAY (anche 1MO/-1FR), BYMONTHDAY, BYMONTH, EXDATE e RECURRENCE-ID; UTC convertito con le regole di Windows, TZID trattato come fuso del PC. Avvisa N minuti prima (`warnDays` usato come minuti).
  - *Meteo* (Open-Meteo, geocoding una volta per città) e *Scadenza domini* (RDAP, WHOIS per .it, .eu, .ch, .de, .fr, .uk, .es).
- **"Davanti al cliente"** (`src-tauri/src/presence.rs`): chiamata = microfono/webcam in uso (registro `CapabilityAccessManager\ConsentStore`), assistenza = `SM_REMOTESESSION`, `QuickAssist.exe`, `TeamViewer_Desktop.exe` più i programmi elencati; voce manuale nel menu dell'area di notifica. Front end: `State.quiet` unisce schermo intero e presenza, `Sound.suppressed`.
- **`coucou-hook notify`** (`hook/src/main.rs`): messaggio sull'isola da qualsiasi script, vista `notify`; esce con 2 se Coucou non c'è. Pulsante Prova (`notify_test`).
- **Impostazioni**: finestra 980×720 (minimo 760×520) con menu laterale e 8 pagine; ricorda l'ultima (localStorage).
- Verificato dal vivo su questo PC con `cargo test -p coucou --lib live_ -- --ignored --nocapture`: stato del PC, sicurezza, rete, meteo, domini e info PC funzionano. Calendario solo con i test (nessun link reale).


### 2 ottobre 2026 — panoramica senza integrazioni
- Con tutte le integrazioni spente il riquadro delle pillole a destra non compare più: la scheda principale prende tutta l'isola (classe `solo` su `.overview`, `src/views/views.ts` + `src/style.css`).
- Anteprima nel browser: i parametri lista si passano separati da virgole (`?activeIntegrations=` per nessuna).

### 2 ottobre 2026 — "Segue il mouse" nella vista compatta
- Nuova opzione **Posizione e aspetto → Segue il mouse** (`followCursorCompact`, per profilo, **spenta** di default). A isola aperta il personaggio segue sempre il cursore.
- Spenta: nella vista compatta non guarda il cursore ma resta vivo. A intervalli casuali (`WANDER_MIN_MS` + `WANDER_SPREAD_MS`, 1,8–6 s) sbatte le palpebre, si gira a guardare altrove (il cubo ruota), torna dritto o, solo a riposo, fa una smorfia (occhiolino, sorriso, sbadiglio, sorpresa). Codice: `scheduleWander` / `wander` in `island.ts`.
- Tra un gesto e l'altro il ciclo di animazione è fermo e i movimenti del mouse non lo svegliano: nell'anteprima circa 5 fps medi, solo durante i gesti.

### 2 ottobre 2026 — consumo di CPU
- Misurato per processo (Coucou + WebView2). Con "Sempre visibile" e il mouse in movimento il consumo era circa il **24 %** di un core, quasi tutto disegno (pagina 8 %, GPU 11 %): ogni spostamento del cursore, anche lontano, faceva ridisegnare a 60 fps.
- **Fotogrammi inutili saltati:** se il cursore si muove ma lo sguardo cambia meno di `LOOK_EPS` (lontano dall'isola il `tanh` è già al massimo), il ciclo non riparte (`onCursor` in `island.ts`).
- **Solo sguardo a 30 fps:** quando l'unica cosa che si muove è lo sguardo, il ciclo gira ogni `LOOK_FRAME_MS` (33 ms); animazioni, geometria, saluto e drop restano a 60 (`busyBeyondLook` in `engine.ts`).
- **Lettura del cursore adattiva:** 60 Hz vicino all'isola, 20 Hz oltre `FAR_FROM_ISLAND` (240 px); il ritorno davanti alla barra delle applicazioni è a tempo (`RAISE_EVERY`, 150 ms), non a giri del ciclo (`spawn_cursor_poll` in `island.rs`).
- **Risultato:** mouse in movimento circa 9–10 %, mouse fermo circa 4 % (processo principale da 2,1 % a 0,8 %), nessuna attività 0 fps. Le misure risentono degli hook della sessione di Claude Code in corso.

### 2 ottobre 2026 — il cubo (commit `f65d871`)
- Nuovo personaggio **Cubo**, ispirato al logo dell'azienda, scelto da Tema → Personaggio (per profilo, `theme.character`; Mochi resta il predefinito).
- A riposo ha i colori del logo; negli altri stati prende il colore dello stato. Occhi squadrati di Mochi su una faccia, strisce del logo su tutte le facce.
- Segue il cursore: la faccia con gli occhi punta verso il mouse (direzione di riposo spostata verso il cursore e riconvertita in rotazioni, `orientation` in `cube.ts`); mostra la faccia di sotto o quella dietro; gli occhi scivolano un poco sulla faccia.
- Disegnato anche nel saluto iniziale e nell'animazione del file, con le mani del colore del cubo.
- `vite.config.ts`: il watcher ignora `target/` e le cartelle Rust (andava in crash con `EBUSY` durante ogni compilazione).

### 1 ottobre 2026 — isola e impostazioni (commit `1654150`)
- **Rilascio dei file riparato:** sui runtime WebView2 attuali il drop nativo di Tauri non veniva mai raggiunto. Ora drop HTML5 nella pagina + `postMessageWithAdditionalObjects` → `drop.rs` (percorso reale). `dragDropEnabled` spento, rimosso il vecchio `RevokeDragDrop`.
- **Domande di Claude Code (AskUserQuestion):** si rispondono dall'isola; `coucou-hook` rimanda `allow` con `updatedInput` + `answers`. Verificato con Claude Code 2.1.x. Non è descritto nella documentazione degli hook: se un aggiornamento di Claude Code lo rompe, la domanda torna semplicemente al terminale.
- **Posizione:** trascinamento, aggancio ai bordi, sopra la barra delle applicazioni (`SetWindowPos(HWND_TOPMOST)` diretto, perché `set_always_on_top` non fa nulla se il flag è già attivo), vista compatta sempre visibile, ✕ per chiudere, apertura solo al clic (il trascinamento di un file apre comunque).
- **Correzioni:** una race rimetteva il click-through sopra l'icona a riposo; nelle Impostazioni le azioni non si potevano eliminare o modificare più di una volta (la finestra sostituiva gli oggetti che stava modificando); note impaginate accanto ai campi.
- **Altro:** Claude Code trovato anche nell'app desktop e nell'estensione VS Code; "Nuova chat"; `coucou.exe --settings`; tolti gli esempi da tecnico IT.

### Problemi noti e cose aperte
- [ ] **CPU con "Sempre visibile":** ridotta il 2 ottobre (da circa 24 % a circa 9–10 % col mouse in movimento, circa 4 % fermo). Margini ancora possibili: sguardo a 20 fps, finestra più piccola della 720×560 attuale quando l'isola è compatta.
- [x] **Scorciatoia `Ctrl+Alt+M`** già usata da un altro programma: la predefinita per aprire l'isola è ora `Ctrl+Alt+Shift+M`. Chi ha già salvato `Ctrl+Alt+M` la tiene: va cambiata a mano in Impostazioni → Azioni rapide.
- [x] **Icona dell'area di notifica:** era Mochi anche con il cubo; dal 2 ottobre è l'isola, uguale per ogni personaggio.
- [x] Le immagini in `screenshots/` (README) sono rifatte con lo slime (2 ottobre) e, dal 4 ottobre, anche con le integrazioni; la cartella `design/` (prototipo e catture di Coucou) è stata tolta il 4 ottobre e resta nella storia git.
- [ ] **Sopra la barra:** cliccando la barra, il personaggio va dietro per un istante (circa 0,15 s) prima di tornare davanti.
- [x] Outlook classico (COM): fatto il 3 ottobre (integrazione Outlook, solo con Outlook già aperto; il nuovo Outlook `olk.exe` non è supportato).
- [ ] Teams via API locale non fatto: le riunioni si riconoscono dal microfono/webcam in uso.
- [ ] I connettori di claude.ai non si caricano in `claude -p`. (Widget "Oggi" escluso per ora.)
- [x] Vista compatta a barra: oltre 4 integrazioni, 3 mini personaggi e "+N" (4 ottobre 2026).
- [x] Appunti con le immagini e titolo del brano nella pillola Musica (4 ottobre 2026). Resta: il personaggio non "balla" con la musica.
- [ ] Cattura una zona: Esc nello Strumento di cattura non si vede; la cattura annullata resta in ascolto fino a 60 s.
- [ ] Goccia: le pose della tavola (saluto con la mano, salto, caduta, onda) non sono fatte, usa quelle comuni.
- [ ] Decisioni ancora aperte (sezione 4): quali integrazioni tenere; funzioni del Mac mai portate; firma del codice.
- [ ] **Installare solo da Esplora file**, mai direttamente dalla shell di Claude Code: l'app Claude è MSIX e reindirizza AppData. Dalla shell: `explorer.exe release\installa.cmd` (vedi il registro del 4 ottobre).
- [ ] **Gestione credenziali molto piena:** su un PC con centinaia di voci, le credenziali con nomi lunghi sono state rifiutate con `ERROR_NOT_ENOUGH_MEMORY` (errore 8, anche da `cmdkey`), le corte no. Le chiavi di EasyIsland (`<chiave>.it.edoardo.easyisland`) sono lunghe: se il salvataggio di una chiave fallisce, eliminare voci vecchie da Gestione credenziali.

### Da provare dal vivo
Funzioni verificate solo con i test o nell'anteprima del browser, da provare nell'app installata (raccolte dalle voci del registro):
- [ ] **Agente:** card Consenti/Nega per gli strumenti `easyisland` in una chat vera; "ogni giorno feriale alle 9 apri Outlook" creato dalla chat.
- [ ] **Automazioni:** ogni tipo di "Quando" (orario, sblocco, chiavetta, cartella, programma, Wi-Fi, integrazione) e "Prova ora".
- [ ] **Proposte dalle abitudini:** servono settimane di uso con `habitsEnabled` acceso.
- [ ] **Appunti:** incolla con Ctrl+V nell'app in primo piano; immagini copiate da browser, Paint, Office e Strumento di cattura (miniatura, incolla, Chiedi a Claude). **Musica:** Spotify o browser reali, copertine, titolo nella pillola.
- [ ] **Cattura una zona:** Ctrl+Alt+Shift+S e pulsante nella scheda +; domanda a Claude con entrambi i motori; Ctrl+Alt+K con un'immagine copiata.
- [ ] **Suggerimenti ⚡:** Ctrl+C reale in Outlook/Excel/browser e ripristino degli appunti.
- [ ] **Calcolatrice:** copia del risultato. **ZIP:** estrazione di uno ZIP vero. **File caricati:** apri / mostra / elimina sui file veri.
- [ ] **Outlook** con Outlook aperto (provato solo chiuso). **Zammad** con un server reale (forma della risposta di `ticket_overviews`).
- [ ] **Widget:** script del certificato TLS; calendario con un link ICS reale.
- [ ] **"Davanti al cliente":** in una chiamata Teams vera e con una sessione di assistenza remota.
- [ ] **3CX con il centralino vero:** collegamento con interno e password, rubrica, chiamata in uscita da ogni dispositivo, chiamata in arrivo (apertura, Rispondi, Rifiuta), Riaggancia, stato, perse e Recenti; poi la modalità client API, compresa la rubrica XAPI.
- [ ] **Spostamento dell'isola** da icona a riposo, compatta e aperta, e posizione mantenuta alla riapertura.
