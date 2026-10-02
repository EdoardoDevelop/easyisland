# Handoff personale — Coucou (solo Windows)

_Punto di partenza: 1 ottobre 2026. Ultimo aggiornamento: 2 ottobre 2026. Branch: `claude/lucid-lamport-v5nvs3`._

> Questo file va tenuto **sempre aggiornato**: a ogni modifica rilevante aggiorna lo stato della sezione interessata e aggiungi una voce al **Registro delle modifiche** (sezione 10), con data, cosa è cambiato e cosa resta aperto.

## 1. Com'è il progetto adesso

Coucou è un fork di [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou). In origine era un'app macOS nativa (Swift) che viveva nel notch del MacBook, con un port Windows in `windows/`.
**Adesso il repo è solo Windows:**

- **Rimossi:** l'app macOS (`NotchBuddy/`, ~11.000 righe Swift + progetto Xcode), le workflow macOS (`build.yml`, `release.yml`) e `scripts/release.sh` (firma/notarizzazione Apple).
- **Spostato alla radice:** tutto il contenuto di `windows/` (Tauri 2 + Rust + TypeScript).
- **Spostati:** i 28 suoni da `NotchBuddy/Resources/sounds/` ad `assets/sounds/` (`SOUNDS_DIR` in `vite.config.ts` aggiornato).
- **CI:** `.github/workflows/build.yml` gira su `windows-latest` a ogni push/PR su `main` (solo verifica di compilazione) e pubblica l'installer sui tag `v*`, ma solo se `PUBLISH: 'true'`. Oggi è `'false'`, per via del falso positivo di Defender sull'installer non firmato.
- **Aggiornati:** `README.md`, `CLAUDE.md` (regole per gli agenti, ora per Windows), `.gitignore`, i percorsi in `LICENSE-ASSETS.md`.
- **Tradotto in italiano:** tutti i testi dell'interfaccia (isola, impostazioni, menu dell'area di notifica, etichette dei passi degli hook), i messaggi d'errore del backend, l'installer NSIS (italiano come lingua principale), README, CLAUDE.md, `docs/SPEC.md`, `docs/INTEGRATIONS.md`, i template delle issue e le note di release. Il prompt di sistema della chat chiede a Mochi di rispondere in italiano. Restano in inglese di proposito i commenti e gli identificatori nel codice, `LICENSE` e `LICENSE-ASSETS.md` (testi legali dell'autore originale) e il sito in `docs/*.html`. Le immagini in `screenshots/` mostrano ancora i testi in inglese.
- **Verificato su Windows (PC di Edoardo, 1–2 ottobre 2026):** `npm run pack` produce l'installer (circa 4,2 MB) senza errori né avvisi, l'installazione per-utente funziona, gli hook di Claude Code arrivano all'isola, i test Rust passano (27 dell'app, 4 del relay). La CI compila anche sui branch `claude/**`.

## 2. Mappa veloce

| Cosa vuoi toccare | Dove |
|---|---|
| Aspetto/animazioni di Mochi | `src/mochi/engine.ts`, `src/mochi/greeting.ts` |
| Il cubo (personaggio alternativo, `theme.character`) | `src/mochi/cube.ts` (geometria 3D, colori del logo, orientamento verso il cursore: `FOLLOW_*`), disegnato da `engine.ts` (`drawAsCube`), `greeting.ts` e `src/upload/canvas.ts` |
| Posizione, trascinamento, aggancio ai bordi, sopra la barra | front end `src/core/layout.ts` (`anchoredOrigin`, `glueFor`, `cornerRadii`) e `src/island/island.ts` (pointer events); backend `src-tauri/src/island.rs` (`apply_geometry`, `placement_from_drop`, `raise_over_taskbar`), comandi `drag_island` / `end_drag` in `lib.rs` |
| File rilasciati sull'isola | `onDragDrop` in `src/core/bridge.ts` (drop HTML5) + `src-tauri/src/drop.rs` (percorso reale da WebView2) |
| Domande di Claude Code (AskUserQuestion) | `askQuestions` in `src/island/hooks.ts`, vista `buildAsk` in `src/views/views.ts`, risposta `answer {…}` → `decision_json` in `hook/src/main.rs` |
| Viste dell'isola (chat, approvazioni, upload…) | `src/views/` + `src/style.css` |
| Logica apri/chiudi, eventi hook | `src/island/fsm.ts`, `src/island/island.ts`, `src/island/hooks.ts` |
| Finestra Impostazioni | `settings.html`, `src/settings/` |
| Integrazioni (Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com) | backend `src-tauri/src/integrations.rs`, front end `src/island/integrations.ts`, `src/views/integrations.ts`, colori/nomi in `src/core/state.ts` |
| Chiavi API (Credential Manager) | `src-tauri/src/secrets.rs` (`SERVICE`, `KNOWN_KEYS`) |
| Chat con Claude (motore, modello, prompt) | `src-tauri/src/claude_cli.rs` (abbonamento), `src-tauri/src/claude.rs` (chiave API) |
| Relay hook di Claude Code | `hook/src/main.rs` + named pipe `src-tauri/src/pipe.rs` |
| Install/uninstall degli hook in `settings.json` | `src-tauri/src/hooks.rs` |
| Icona tray e menu | `src-tauri/src/tray.rs`, icone generate da `scripts/gen-icons.mjs` |
| Suoni | `assets/sounds/`, motore `src/core/sound.ts` |
| Installer NSIS | `src-tauri/tauri.conf.json` (`bundle`), `src-tauri/nsis/hooks.nsh` |

## 3. Primi passi sul tuo PC Windows

1. Segui la sezione **Installazione** del `README.md`: strumenti con `winget`, `git clone`, `npm install`, `npm run pack`, poi esegui l'installer in `release\`.
2. Dall'icona nell'area di notifica → **Impostazioni…**:
   - **Claude Code → Installa hook…**: controlla il diff e conferma, poi lancia una sessione di Claude Code e verifica che le richieste di permesso arrivino sull'isola;
   - **Chat con Claude**: prova la modalità "Abbonamento Claude" (serve Claude Code con il login fatto);
   - **Posizione e aspetto**: scegli angolo e icona.
3. Per lavorare sul codice: `npm run tauri dev` (l'app vera) o `npm run ui` (solo l'interfaccia nel browser; aggiungi `?character=cube` per il cubo). `coucou.exe --settings` apre direttamente le Impostazioni.
4. Fai un push su `main` (o apri una PR) e controlla che la workflow `Build` sia verde: è la prova che l'installer si compila anche su una macchina pulita.

## 4. Decisioni da prendere per personalizzarlo

**Identità (da fare per prima, e una volta sola):**
- [ ] Nome dell'app: `productName` in `src-tauri/tauri.conf.json` e i testi di `README.md`.
- [ ] Bundle identifier: `identifier` in `tauri.conf.json` (oggi `fr.louisraille.coucou`) e `SERVICE` in `src-tauri/src/secrets.rs`. Cambiali insieme. Le chiavi già salvate nel Credential Manager restano sotto il vecchio nome e vanno reinserite.
- [ ] `copyright` in `tauri.conf.json`, `authors` in `src-tauri/Cargo.toml`, il copyright in `LICENSE` (aggiungi il tuo, lasciando quello originale per la parte MIT).

**Licenza degli asset (importante):** `LICENSE-ASSETS.md` riserva all'autore originale il nome "Coucou", il nome "Mochi", il personaggio, le icone e i suoni.
- Per **uso personale** va bene così com'è.
- Se vuoi **pubblicare o distribuire** la tua versione, servono nome, icona, personaggio e suoni tuoi. Il codice (MIT) puoi tenerlo.
- Il **cubo** (Tema → Personaggio) è un personaggio tuo, disegnato dal logo dell'azienda dove lavorerai: per distribuirlo ai colleghi, chiedi prima all'azienda.

**Sito e documenti:** `docs/*.html` (GitHub Pages: privacy, termini, note legali) e `docs/media/` sono quelli dell'autore originale, scritti per il Mac e intestati a lui. Puoi eliminarli o riscriverli. `docs/SPEC.md` e `docs/INTEGRATIONS.md` sono una buona specifica (in francese), ma descrivono il comportamento su macOS.

**Funzionalità:**
- [ ] Quali integrazioni tieni? Se non usi Stripe, Resend, Cal.com…, rimuoverle alleggerisce codice e Impostazioni.
- [ ] Funzioni presenti solo su Mac e mai portate: invio di un file via email, trascinare Mochi su una finestra per allegarla come contesto, saltare al terminale esatto della sessione. Valuta se ti servono.
- [x] Posizione e aspetto: angolo o bordo, icona a riposo e al passaggio del mouse, apertura dopo N secondi o solo al clic, silenzio a schermo intero (Impostazioni → Posizione e aspetto).
- [x] Mochi trascinabile con il mouse (posizione salvata nel profilo), aggancio ai bordi, sopra la barra delle applicazioni, vista compatta sempre visibile, pulsante ✕ per chiudere subito.
- [x] Personaggio a scelta: Mochi o il cubo (Tema → Personaggio).
- [x] Chat: scegli in Impostazioni tra abbonamento Claude (tramite Claude Code, predefinito) e chiave API. Codice in `src-tauri/src/claude_cli.rs` e `src-tauri/src/claude.rs`.

**Distribuzione:**
- [ ] Firma del codice (certificato Authenticode o Azure Trusted Signing). Senza firma, Defender e SmartScreen segnalano l'installer.
- [ ] Quando l'installer è firmato, metti `PUBLISH: 'true'` nella workflow e crea un tag `vX.Y.Z`. La versione deve coincidere in `package.json`, `Cargo.toml` e `tauri.conf.json` (la CI lo controlla).

## 5. Contesto d'uso

- **Chi lo usa:** tecnico informatico / IT specialist che segue aziende clienti.
- **Dove:** principalmente il **notebook di lavoro** (spesso solo lo schermo del portatile, a volte con monitor esterni, a batteria, su reti diverse: ufficio, clienti, casa). Ma deve servire anche **a casa, per uso personale**.
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

- **Configurazione in un file leggibile:** oggi le preferenze stanno in `%APPDATA%\Coucou\settings.json` (`src-tauri/src/settings.rs`). Aggiungere **Esporta / Importa** nelle Impostazioni (file `.json`, **senza segreti**: le chiavi restano in Gestione credenziali e vanno reinserite), per backup e per avere lo stesso Mochi su notebook e PC di casa.
- **Versione dello schema** (`schemaVersion`) nel file, con migrazione dei campi vecchi: le prossime funzioni aggiungeranno liste (azioni, widget).
- **Temi:** colore del corpo di Mochi (oggi fisso in `src/mochi/engine.ts`, `C.idle` e gradiente), colore e opacità dell'isola (`#island` in `src/style.css`, oggi `#000`), scelta del set di suoni o volume per categoria (avvisi / interazioni / emote).
- **Profili** (es. *Lavoro*, *Casa*, *Concentrazione*): ogni profilo ha le sue integrazioni attive, azioni, widget, posizione, suoni e regole di notifica. Cambio da menu dell'area di notifica e, in automatico, per **rete Wi-Fi/dominio** (ufficio vs casa) e per **orario**. In *Concentrazione* passano solo i permessi di Claude Code.
- **Fatto quando:** esporto da un PC, importo sull'altro e ritrovo tutto tranne le chiavi; cambio profilo e isola, integrazioni e suoni cambiano senza riavvio.

### 6.2 Azioni rapide personalizzate

> **Stato: fatto.** Scheda ⚡ e vista di esecuzione (`src/views/actions.ts`), logica in `Island.runAction` (`src/island/island.ts`), backend `src-tauri/src/actions.rs` (programmi, script con output/timeout/interrompi, appunti) e `src-tauri/src/hotkeys.rs` (`RegisterHotKey`, nessuna dipendenza nuova). Editor in `src/settings/main.ts` (il pulsante "Aggiungi esempi da tecnico IT" è stato tolto il 1° ottobre 2026). Da migliorare: le azioni "su file" non compaiono ancora nella schermata "Cosa vuoi farne?" dopo il rilascio (è disegnata dal canvas in `src/upload/canvas.ts`).

Pulsanti definiti dall'utente, mostrati in una nuova scheda dell'isola (accanto a Panoramica / Chiedi / Rilascia) e richiamabili da tastiera.

- **Tipi di azione:**
  - `url`: apre un link (portale cliente, gestionale, documentazione);
  - `app`: avvia un programma con argomenti (RDP, AnyDesk, PowerShell, Esplora file su una cartella);
  - `script`: esegue uno script PowerShell/cmd **solo dopo un clic esplicito**, mostrando l'output nell'isola (con timeout e pulsante Interrompi);
  - `prompt`: manda a Claude un **prompt salvato** applicato al testo negli appunti o al file rilasciato. Esempi da tecnico IT: "Spiega questo errore e dammi i passi per risolverlo", "Scrivi uno script PowerShell che…", "Analizza questo log", "Scrivi il rapportino d'intervento da questi appunti", "Rispondi a questa mail del cliente in modo professionale".
- **Scorciatoia globale** configurabile (es. `Win+Shift+M`) per aprire Mochi su chat o azioni, e una seconda per "chiedi a Mochi sul testo copiato". Rust: `tauri-plugin-global-shortcut` (valutare se accettabile come dipendenza) oppure `RegisterHotKey` dalla crate `windows` già presente.
- **Configurazione:** lista in Settings (`actions: [{ id, name, icon, color, kind, target, args, prompt, confirm }]`) con editor nelle Impostazioni, riordinabile, legata al profilo.
- **Sicurezza:** niente esecuzione automatica; gli script mostrano il comando prima di partire se `confirm: true` (predefinito); nessun segreto nella configurazione (eventuali chiavi tramite riferimento alla Gestione credenziali).
- **Fatto quando:** creo un'azione "Spiega errore", copio un messaggio d'errore, premo la scorciatoia e ricevo la spiegazione nell'isola.

### 6.3 Mochi che usa i tuoi connettori (MCP)

> **Stato: fatto, tranne il widget "Oggi".** Elenco dei server da `~/.claude.json` (solo i nomi), scelta per profilo con conferma per server (`mcpServers` in Settings). Con connettori attivi `claude -p` gira in `--permission-mode default`, i server non scelti sono in `--disallowedTools`, quelli senza conferma in `--allowedTools`; le altre chiamate passano da un hook `PermissionRequest` → `coucou-hook.exe PermissionRequest --chat` → card Consenti/Nega nell'isola (`handleChatPermission` in `src/island/hooks.ts`). Meccanismo verificato con il Claude Code reale (allow esegue, deny blocca). Da fare: widget "Oggi"; i connettori di claude.ai non si caricano in `claude -p`.

Oggi `src-tauri/src/claude_cli.rs` lancia `claude -p` con `--strict-mcp-config` e senza `--mcp-config`, quindi **nessun** server MCP, e strumenti limitati a WebSearch/WebFetch/Read.

- **Impostazione "Connettori in chat":** elenco dei server MCP configurati in Claude Code (leggibile con `claude mcp list`) con un interruttore per ciascuno; Coucou genera un file `--mcp-config` con solo quelli scelti, e aggiunge i relativi strumenti ad `--allowedTools` (es. `mcp__<nome-server>__*`).
- **Esempi d'uso:** "cosa ho in calendario oggi?", "aggiungi un promemoria per venerdì", "cerca nei documenti del cliente X". Qualunque operazione che **modifica** dati (crea, aggiorna, invia) va **proposta prima** e confermata con un clic nell'isola, mai eseguita da sola.
- **Widget "Oggi"** opzionale: attività e promemoria del giorno da un connettore scelto, nella panoramica.
- **Per profilo:** nel profilo *Lavoro* si possono escludere i connettori personali e viceversa.
- **Fatto quando:** chiedo "cosa ho in programma oggi?" e Mochi risponde usando un connettore abilitato; chiedo di aggiungere un promemoria e mi chiede conferma prima di scriverlo.
- **Chat con l'abbonamento:** Claude Code viene cercato anche nell'app desktop di Claude (`%APPDATA%\Claude\claude-code\<versione>`) e nell'estensione VS Code, sempre la versione più recente (`find_claude` in `claude_cli.rs`). La chat ha il pulsante **Nuova chat**.

### 6.4 Widget configurabili (integrazioni senza codice)

> **Stato: fatto.** Backend `src-tauri/src/widgets.rs` (ping con `IcmpSendEcho`, porta TCP, HTTP, certificato TLS con una breve chiamata PowerShell — host e porta passati come variabili d'ambiente —, servizio Windows via Service Control Manager, API JSON con percorsi e regola di avviso), scheduler unico con intervallo ×3 a batteria, segreti delle intestazioni come `widget:<id>:<nome>` in Gestione credenziali. Front end: pillole/scheda in `src/views/integrations.ts`, avvisi in `src/island/integrations.ts`, editor con modelli e "Prova" in `src/settings/main.ts`. Non verificati su Windows reale: il ping ICMP e lo script del certificato (qui non c'è PowerShell). Le 7 integrazioni originali restano scritte a mano (non convertite in modelli).

Un tipo di widget generico al posto delle integrazioni scritte a mano (le 7 attuali in `src-tauri/src/integrations.rs` diventano "modelli pronti").

- **Definizione:** `{ id, name, color, url, method, headers (con riferimenti a chiavi in Gestione credenziali), every (secondi), fields: [{ label, path (JSONPath semplice) }], alert: { when: "path op valore", level } }`.
- **Sonde integrate**, utili da tecnico IT, che non richiedono un'API:
  - `ping` / `porta TCP` di un host (server del cliente, NAS, firewall);
  - `HTTP` con codice atteso e tempo di risposta;
  - **scadenza certificato TLS** di un dominio (avviso a 30/7 giorni);
  - stato di un servizio Windows locale.
- **Visualizzazione:** pillola con mini-Mochi colorato (come oggi), scheda di dettaglio con i campi, badge e suono quando scatta un avviso.
- **Prestazioni:** tutte le richieste nel backend Rust, nessun polling con l'app in pausa, intervalli più lunghi a batteria.
- **Fatto quando:** aggiungo dalle Impostazioni un widget che controlla `https://cliente.it` e il certificato, senza ricompilare, e Mochi mi avvisa se il sito non risponde.

## 7. Idee da valutare (non ancora decise)

Pensate per il lavoro da tecnico IT sul notebook, ma utili anche a casa.

- **Notifiche da qualsiasi script:** comando `coucou notify --titolo … --stato ok|errore --apri <url>` (riusa la named pipe del relay). Qualunque script, attività pianificata o n8n può mandare un avviso a Mochi.
- **Rubrica clienti:** per ogni cliente collegamenti RDP/AnyDesk/TeamViewer, portali, credenziali (solo riferimenti alla Gestione credenziali), note e azioni rapide dedicate. Si apre cercando il nome dall'isola.
- **Timer d'intervento:** avvio/stop per cliente dall'isola, riepilogo a fine giornata, rapportino generato da Claude ed esportato (file o connettore scelto).
- **Info rapide della macchina:** IP locale e pubblico, rete/VPN, batteria, spazio disco, nome PC. Con un clic si copia tutto per un ticket.
- **Screenshot → chiedi a Mochi:** scorciatoia che cattura una zona dello schermo (es. una finestra d'errore) e la manda alla chat.
- **Libreria di comandi:** comandi PowerShell/cmd usati spesso (es. `gpupdate /force`, reset dello spooler, `sfc /scannow`, diagnostica di rete) da copiare o eseguire con conferma.
- **Modalità "davanti al cliente":** con un clic (o in automatico quando parte una condivisione schermo o una sessione di assistenza remota) Mochi sparisce e nessuna notifica personale compare.
- **Ticketing:** widget per il conteggio dei ticket aperti/in scadenza dal sistema di helpdesk usato (via widget configurabile 6.4, se ha un'API).
- **Casa:** promemoria personali, eventuale Home Assistant, meteo.

## 8. Regole da non rompere (sono anche in `CLAUDE.md`)

- L'hook non deve **mai** bloccare Claude Code: timeout breve, poi esce con 0.
- `settings.json` di Claude Code non si sovrascrive mai: backup datato, merge, diff, scrittura solo dopo conferma.
- Niente telemetria. Le chiavi stanno solo nel Credential Manager.
- Nessuna approvazione di permessi e nessuna email senza un click esplicito.
- CPU a ~0 % quando l'isola è nascosta.

## 9. Note per riprendere con Claude Code

Apri una sessione su questo repo e scrivi, per esempio: _"Leggi HANDOFF.md e CLAUDE.md, poi implementiamo la 6.1 (fondamenta)"_ oppure _"facciamo la sezione 4 → Identità con nome X"_. `CLAUDE.md` viene caricato in automatico e contiene già struttura e regole. A fine lavoro aggiorna questo file (stato e registro).

## 10. Registro delle modifiche

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
- [ ] **CPU con "Sempre visibile":** circa 18 % di un core (personaggio animato + lettura del cursore a 60 Hz). Va contro la regola "CPU ~0 % a riposo": proposto di rallentare animazione e lettura del cursore quando non succede nulla.
- [ ] **Scorciatoia `Ctrl+Alt+M`** non disponibile (già usata da un altro programma): sceglierne un'altra in Impostazioni → Azioni rapide.
- [ ] **Icona dell'area di notifica:** è un'immagine fissa (`scripts/gen-icons.mjs`), quindi resta Mochi anche con il cubo.
- [ ] **Sopra la barra:** cliccando la barra, Mochi va dietro per un istante (circa 0,15 s) prima di tornare davanti.
- [ ] Da verificare su Windows reale: ping ICMP e controllo del certificato TLS dei widget (6.4).
