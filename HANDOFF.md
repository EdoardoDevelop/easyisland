# Handoff — EasyIsland (solo Windows)

_Punto di partenza: 1 ottobre 2026. Ultimo aggiornamento: 2 ottobre 2026 (nuovo nome: EasyIsland, personaggio Slime). Branch di lavoro: `claude/sviluppo`; branch principale: `main`._

> Questo file va tenuto **sempre aggiornato**: a ogni modifica rilevante aggiorna lo stato della sezione interessata e aggiungi una voce al **Registro delle modifiche** (sezione 10), con data, cosa è cambiato e cosa resta aperto.

## 1. Com'è il progetto adesso

EasyIsland è un fork di [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) (Coucou, con il personaggio Mochi). In origine era un'app macOS nativa (Swift) che viveva nel notch del MacBook, con un port Windows in `windows/`.
**Adesso il repo è solo Windows:**

- **Nuovo nome (2 ottobre 2026):** l'app si chiama **EasyIsland**, il personaggio **Slime** (era Mochi). Identifier `it.edoardo.easyisland` (era `fr.louisraille.coucou`), eseguibili `easyisland.exe` ed `easyisland-hook.exe`, named pipe `\\.\pipe\easyisland-<sid>`, cartelle `%APPDATA%\EasyIsland` e `%LOCALAPPDATA%\EasyIsland`. Al primo avvio la migrazione (`src-tauri/src/legacy.rs`) copia impostazioni e chiavi da Coucou; vedi il Registro.
- **Rimossi:** l'app macOS (`NotchBuddy/`, ~11.000 righe Swift + progetto Xcode), le workflow macOS (`build.yml`, `release.yml`) e `scripts/release.sh` (firma/notarizzazione Apple).
- **Spostato alla radice:** tutto il contenuto di `windows/` (Tauri 2 + Rust + TypeScript).
- **Suoni:** i 28 WAV originali (spostati in `assets/sounds/` il 1° ottobre) sono stati sostituiti il 2 ottobre da suoni sintetizzati nel codice (`src/core/synth.ts`); la cartella non esiste più.
- **CI e release:** `.github/workflows/build.yml` gira su `windows-latest` a ogni push/PR su `main` e sui branch `claude/**` (verifica di compilazione, installer come artefatto). Sui tag `v*` pubblica la release: installer, firma per l'updater (`.sig`) e `latest.json` (`PUBLISH: 'true'`; serve il secret `TAURI_SIGNING_PRIVATE_KEY`). Le app installate si aggiornano da lì (`src-tauri/src/updates.rs`).
- **Aggiornati:** `README.md`, `CLAUDE.md` (regole per gli agenti, ora per Windows), `.gitignore`, i percorsi in `LICENSE-ASSETS.md`.
- **Tradotto in italiano:** tutti i testi dell'interfaccia (isola, impostazioni, menu dell'area di notifica, etichette dei passi degli hook), i messaggi d'errore del backend, l'installer NSIS (italiano come lingua principale), README, CLAUDE.md, `docs/SPEC.md`, `docs/INTEGRATIONS.md`, i template delle issue e le note di release. Il prompt di sistema della chat chiede a Slime di rispondere in italiano. Restano in inglese di proposito i commenti e gli identificatori nel codice, `LICENSE` e `LICENSE-ASSETS.md` (testi legali dell'autore originale). Il sito in `docs/*.html` è stato eliminato. Le immagini in `screenshots/` mostrano ancora i testi in inglese.
- **Verificato su Windows (PC di sviluppo, 1–2 ottobre 2026):** `npm run pack` produce l'installer (circa 4,2 MB) senza errori né avvisi, l'installazione per-utente funziona, gli hook di Claude Code arrivano all'isola, i test Rust passavano (27 dell'app, 4 del relay) al 1° ottobre. Il 2 ottobre, dopo il cambio di nome, `cargo test --workspace` passa: 38 test dell'app (più 3 `live_` ignorati di default) e 4 del relay. La CI compila anche sui branch `claude/**`.

## 2. Mappa veloce

| Cosa vuoi toccare | Dove |
|---|---|
| Aspetto di Slime (lo slime: forma, colori, riflessi, occhi) | `src/character/slime.ts`, usato da `engine.ts`, `greeting.ts` e `src/upload/canvas.ts`; anteprima di stati ed emozioni in `dev/character-preview.html` (`npm run dev`) |
| Animazioni, stati ed emozioni di Slime | `src/character/engine.ts`, `src/character/greeting.ts` |
| EasyTech, il cubo (personaggio alternativo, `theme.character` = `cube`) | `src/character/cube.ts` (geometria 3D, colori del logo, orientamento verso il cursore: `FOLLOW_*`), disegnato da `engine.ts` (`drawAsCube`), `greeting.ts` e `src/upload/canvas.ts` |
| Posizione, trascinamento, aggancio ai bordi, sopra la barra | front end `src/core/layout.ts` (`anchoredOrigin`, `glueFor`, `cornerRadii`) e `src/island/island.ts` (pointer events); backend `src-tauri/src/island.rs` (`apply_geometry`, `placement_from_drop`, `raise_over_taskbar`), comandi `drag_island` / `end_drag` in `lib.rs` |
| File rilasciati sull'isola | `onDragDrop` in `src/core/bridge.ts` (drop HTML5) + `src-tauri/src/drop.rs` (percorso reale da WebView2) |
| Domande di Claude Code (AskUserQuestion) | `askQuestions` in `src/island/hooks.ts`, vista `buildAsk` in `src/views/views.ts`, risposta `answer {…}` → `decision_json` in `hook/src/main.rs` |
| Viste dell'isola (chat, approvazioni, upload…) | `src/views/` + `src/style.css` |
| Logica apri/chiudi, eventi hook | `src/island/fsm.ts`, `src/island/island.ts`, `src/island/hooks.ts` |
| Finestra Impostazioni | `settings.html`, `src/settings/` |
| Integrazioni (Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com) | backend `src-tauri/src/integrations.rs`, front end `src/island/integrations.ts`, `src/views/integrations.ts`, colori/nomi in `src/core/state.ts` |
| Chiavi API (Credential Manager) | `src-tauri/src/secrets.rs` (`SERVICE`, `KNOWN_KEYS`) |
| Migrazione da Coucou (impostazioni, chiavi, hook vecchi) | `src-tauri/src/legacy.rs`, `LEGACY_MARKER` in `hooks.rs`, schema 3 in `settings.rs` |
| Chat con Claude (motore, modello, prompt) | `src-tauri/src/claude_cli.rs` (abbonamento), `src-tauri/src/claude.rs` (chiave API) |
| Relay hook di Claude Code | `hook/src/main.rs` + named pipe `src-tauri/src/pipe.rs` |
| Install/uninstall degli hook in `settings.json` | `src-tauri/src/hooks.rs` |
| Icona tray e menu | `src-tauri/src/tray.rs`, icone generate da `scripts/gen-icons.mjs` |
| Suoni | `assets/sounds/`, motore `src/core/sound.ts` |
| Installer NSIS | `src-tauri/tauri.conf.json` (`bundle`), `src-tauri/nsis/hooks.nsh` |
| Profili, migrazione, esporta/importa | `src-tauri/src/settings.rs` (`schema_version`, `migrated`, `PROFILE_KEYS`), cambio automatico in `src-tauri/src/profiles.rs` |
| Azioni rapide e scorciatoie globali | `src/views/actions.ts`, `Island.runAction` in `src/island/island.ts`, backend `src-tauri/src/actions.rs` e `src-tauri/src/hotkeys.rs` |
| Widget configurabili e sonde | `src-tauri/src/widgets.rs` (scheduler, ping/TCP/HTTP/TLS/servizio/API JSON), `src-tauri/src/probes.rs` (stato del PC, sicurezza, rete, meteo, domini), `src-tauri/src/calendar.rs` (ICS); editor in `src/settings/main.ts` |
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
- [ ] Funzioni presenti solo su Mac e mai portate: invio di un file via email, trascinare Slime su una finestra per allegarla come contesto, saltare al terminale esatto della sessione. Valuta se ti servono.
- [x] Posizione e aspetto: angolo o bordo, icona a riposo e al passaggio del mouse, apertura dopo N secondi o solo al clic, silenzio a schermo intero (Impostazioni → Posizione e aspetto).
- [x] Slime trascinabile con il mouse (posizione salvata nel profilo), aggancio ai bordi, sopra la barra delle applicazioni, vista compatta sempre visibile, pulsante ✕ per chiudere subito.
- [x] Personaggio a scelta: Slime o EasyTech, il cubo (Tema → Personaggio).
- [x] Chat: scegli in Impostazioni tra abbonamento Claude (tramite Claude Code, predefinito) e chiave API. Codice in `src-tauri/src/claude_cli.rs` e `src-tauri/src/claude.rs`.

**Distribuzione:**
- [x] Release su GitHub dai tag `vX.Y.Z` con aggiornamento automatico firmato (2 ottobre 2026). La versione deve coincidere in `package.json`, `Cargo.toml` e `tauri.conf.json` (la CI lo controlla). Passi in README → Pubblicare una versione.
- [ ] Rendere il repository pubblico (serve agli aggiornamenti: da un repo privato l'app non può scaricare la release senza token) e aggiungere il secret `TAURI_SIGNING_PRIVATE_KEY`.
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

In ordine di implementazione consigliato: 6.1 → 6.2 → 6.3 → 6.4. Ogni punto dice cosa fare, dove e quando è finito.

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

> **Stato: fatto, tranne il widget "Oggi".** Elenco dei server da `~/.claude.json` (solo i nomi), scelta per profilo con conferma per server (`mcpServers` in Settings). Con connettori attivi `claude -p` gira in `--permission-mode default`, i server non scelti sono in `--disallowedTools`, quelli senza conferma in `--allowedTools`; le altre chiamate passano da un hook `PermissionRequest` → `easyisland-hook.exe PermissionRequest --chat` → card Consenti/Nega nell'isola (`handleChatPermission` in `src/island/hooks.ts`). Meccanismo verificato con il Claude Code reale (allow esegue, deny blocca). Da fare: widget "Oggi"; i connettori di claude.ai non si caricano in `claude -p`.

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

## 7. Idee da valutare (non ancora decise)

Pensate per il supporto IT sul notebook, ma utili anche a casa.

- **Notifiche da qualsiasi script:** comando `easyisland notify --titolo … --stato ok|errore --apri <url>` (riusa la named pipe del relay). Qualunque script, attività pianificata o n8n può mandare un avviso a Slime.
- **Rubrica clienti:** per ogni cliente collegamenti RDP/AnyDesk/TeamViewer, portali, credenziali (solo riferimenti alla Gestione credenziali), note e azioni rapide dedicate. Si apre cercando il nome dall'isola.
- **Timer d'intervento:** avvio/stop per cliente dall'isola, riepilogo a fine giornata, rapportino generato da Claude ed esportato (file o connettore scelto).
- **Info rapide della macchina:** IP locale e pubblico, rete/VPN, batteria, spazio disco, nome PC. Con un clic si copia tutto per un ticket.
- **Screenshot → chiedi a Slime:** scorciatoia che cattura una zona dello schermo (es. una finestra d'errore) e la manda alla chat.
- **Libreria di comandi:** comandi PowerShell/cmd usati spesso (es. `gpupdate /force`, reset dello spooler, `sfc /scannow`, diagnostica di rete) da copiare o eseguire con conferma.
- **Modalità "davanti al cliente":** con un clic (o in automatico quando parte una condivisione schermo o una sessione di assistenza remota) Slime sparisce e nessuna notifica personale compare.
- **Ticketing:** widget per il conteggio dei ticket aperti/in scadenza dal sistema di helpdesk usato (via widget configurabile 6.4, se ha un'API).
- **Casa:** promemoria personali, eventuale Home Assistant, meteo.

**Proposte di integrazione del 2 ottobre 2026** (gratuite o tramite app già sul PC; dettagli e priorità nella conversazione di quel giorno):
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

Apri una sessione su questo repo e scrivi, per esempio: _"Leggi HANDOFF.md e CLAUDE.md, poi implementiamo la 6.1 (fondamenta)"_ oppure _"facciamo la sezione 4 → Identità con nome X"_. `CLAUDE.md` viene caricato in automatico e contiene già struttura e regole. A fine lavoro aggiorna questo file (stato e registro).

## 10. Registro delle modifiche

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
- Resta: la vista compatta a barra mostra ancora al massimo 4 mini personaggi (spazio fisso di 2×2).

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
- [ ] **CPU con "Sempre visibile":** ridotta il 2 ottobre (da circa 24 % a circa 9–10 % col mouse in movimento, circa 4 % fermo). Margini ancora possibili: sguardo a 20 fps, finestra più piccola della 720×320 attuale quando l'isola è compatta.
- [x] **Scorciatoia `Ctrl+Alt+M`** già usata da un altro programma: la predefinita per aprire Mochi è ora `Ctrl+Alt+Shift+M`. Chi ha già salvato `Ctrl+Alt+M` la tiene: va cambiata a mano in Impostazioni → Azioni rapide.
- [x] **Icona dell'area di notifica:** era Mochi anche con il cubo; dal 2 ottobre è l'isola, uguale per ogni personaggio.
- [x] Le immagini in `screenshots/` (README) sono rifatte con lo slime (2 ottobre); `design/captures/` resta il riferimento originale con Mochi.
- [ ] **Sopra la barra:** cliccando la barra, Mochi va dietro per un istante (circa 0,15 s) prima di tornare davanti.
- [ ] Da verificare su Windows reale: controllo del certificato TLS dei widget (6.4). Il ping ora usa `icmp_ms`, già verificata.
- [ ] "Davanti al cliente" da provare in una chiamata vera (Teams) e con una sessione di assistenza; il calendario con un link ICS reale.
- [ ] Outlook classico (COM) e Teams via API locale non fatti: il calendario passa da ICS, le riunioni dal microfono/webcam in uso.
- [ ] **Gestione credenziali molto piena:** su un PC con centinaia di voci, le credenziali con nomi lunghi sono state rifiutate con `ERROR_NOT_ENOUGH_MEMORY` (errore 8, anche da `cmdkey`), le corte no. Le chiavi di EasyIsland (`<chiave>.it.edoardo.easyisland`) sono lunghe: se il salvataggio di una chiave fallisce, eliminare voci vecchie da Gestione credenziali.
