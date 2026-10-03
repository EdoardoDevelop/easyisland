# EasyIsland (Windows) — guida per gli agenti AI

EasyIsland è un'app desktop per Windows 10/11: un piccolo personaggio animato (Slime, o in alternativa Goccia o EasyTech) che vive in un'isola in alto al centro dello schermo, mostra le sessioni di Claude Code e alcune integrazioni, e permette all'utente di approvare, rispondere, chattare e rilasciare file dall'isola. Fork solo per Windows di Louis-CFM/coucou (Coucou con il personaggio Mochi; l'app macOS è stata rimossa), rinominato EasyIsland il 2 ottobre 2026. Handoff personale e roadmap: `HANDOFF.md`.

**Lingua del progetto: italiano.** Testi dell'interfaccia, messaggi d'errore mostrati all'utente, documentazione e messaggi di commit sono in italiano. Identificatori e commenti nel codice restano in inglese.

## Dove stanno le cose
- `src/`: front end dell'isola e delle impostazioni (TypeScript, nessun framework, Canvas 2D). `src/character/` i personaggi, scelti con `theme.character`: contratto e registro in `character.ts`, elenco in `roster.ts`; Slime (`slime.ts`) e Goccia (`drop.ts`) sono personaggi "soft" (contorno, ombreggiatura, occhio: tutto il resto è comune), EasyTech è il cubo 3D (`cube.ts`). Li disegnano `engine.ts`, `greeting.ts` e `src/upload/canvas.ts` chiedendo `character()`, mai un personaggio per nome. Nuovo personaggio soft: un file che esporta un `SoftCharacter` e una riga in `roster.ts`; si prova con `dev/character-preview.html?character=<id>` e `dev/upload-preview.html?character=<id>`. `src/island/` macchina a stati, hook e integrazioni, `src/views/` tutte le viste, `src/settings/` la finestra delle impostazioni.
- `src-tauri/`: backend Rust (Tauri 2): finestra, named pipe, API Claude, poller, Gestione credenziali, area di notifica, hook NSIS.
- Chat: due motori scelti in `settings.chatEngine`. `src-tauri/src/claude.rs` chiama l'API con la chiave; `src-tauri/src/claude_cli.rs` lancia `claude -p` (abbonamento dell'utente). Senza connettori: solo WebSearch/WebFetch/Read, `dontAsk` e `--strict-mcp-config`. Con connettori MCP scelti nel profilo (`mcpServers`): `--permission-mode default`, i server non scelti in `--disallowedTools`, quelli senza conferma in `--allowedTools`, e le altre chiamate passano dall'hook `PermissionRequest` → `easyisland-hook.exe PermissionRequest --chat` → card Consenti/Nega nell'isola. `easyisland-hook.exe` ignora i processi con `EASYISLAND_INTERNAL`, tranne le chiamate con `--chat`.
- File rilasciati: drag & drop HTML5 nella pagina, poi `chrome.webview.postMessageWithAdditionalObjects` → `src-tauri/src/drop.rs`, che legge il percorso reale (`ICoreWebView2File`) ed emette `file-drop`. Il drop nativo di Tauri (`dragDropEnabled`) resta spento: sui runtime WebView2 attuali non viene mai raggiunto. Il messaggio deve essere una stringa, altrimenti il gestore IPC di wry fallisce e WebView2 non chiama il nostro.
- `hook/`: `easyisland-hook.exe`, il relay degli hook di Claude Code; `easyisland-hook notify …` manda un messaggio all'isola da qualsiasi script.
- Integrazioni e widget: un servizio o programma che di solito c'è una volta sola è un'**integrazione** (Impostazioni → Integrazioni), mai un widget; i widget sono solo controlli ripetibili (ping, porta, sito, certificato, servizio, API JSON, calendario ICS, domini). Integrazioni con API: `src-tauri/src/integrations.rs`. Integrazioni che sono controlli (`settings::PROBE_INTEGRATIONS`: stato del PC, sicurezza, rete, meteo in `probes.rs`, Outlook in `outlook.rs`, Zammad in `zammad.rs`) girano nello scheduler di `src-tauri/src/widgets.rs` (`all_widgets`), con opzioni in `integrationConfig`. Widget: `widgets.rs`, `probes.rs` (domini), `calendar.rs` (ICS). Profili automatici in `profiles.rs`, "davanti al cliente" in `presence.rs`, azioni rapide in `actions.rs`, scorciatoie globali in `hotkeys.rs`.
- Suoni: i 28 suoni sono sintetizzati nel codice in `src/core/synth.ts` (niente file audio), riprodotti da `src/core/sound.ts`; si ascoltano in `dev/sounds-preview.html`. Il volume di ciascuno è tarato sul WAV originale che ha sostituito.
- `scripts/`: `gen-icons.mjs` (icone disegnate nel codice: l'isola, non il personaggio), `pack.mjs` (copia l'installer in `release/`), `screenshots.mjs` (rifà le schermate del README dalle scene di `dev/scenes.ts`, con `npm run dev` acceso).
- `design/prototype/notch-buddy.html`: prototipo originale, il riferimento visivo. `design/captures/`: catture di riferimento.

## Build
```
npm install
npm run tauri dev   # build di sviluppo con ricaricamento automatico
npm run pack        # installer NSIS in release/
npm run build       # typecheck + solo front end (funziona anche su Linux/macOS)
```
La parte Rust si compila solo su Windows (toolchain MSVC). CI: `.github/workflows/build.yml` (windows-latest); i tag `v*` pubblicano quando `PUBLISH` vale `'true'`.

## Regole
- `HANDOFF.md` va tenuto sempre aggiornato: a ogni modifica rilevante aggiorna lo stato della sezione interessata e aggiungi una voce al Registro delle modifiche (sezione 10), compresi i problemi rimasti aperti.
- TypeScript + Rust (Tauri 2). Nessuna nuova dipendenza se non davvero inevitabile. Il personaggio è disegnato nel codice (Canvas 2D), niente Rive/Lottie/immagini.
- I segreti stanno in Gestione credenziali di Windows, mai su disco, nell'interfaccia o in git. Il front end può solo chiedere se una chiave esiste.
- Nessuna telemetria. Chiamate di rete solo verso i servizi configurati dall'utente, più il controllo degli aggiornamenti su GitHub (`src-tauri/src/updates.rs`), disattivabile. Gli aggiornamenti si installano solo dopo un clic, con la firma verificata; la chiave privata non entra mai nel repo.
- Non bloccare mai Claude Code: se l'app non risponde entro il timeout dell'hook, l'hook esce subito con 0.
- Non sovrascrivere mai `%USERPROFILE%\.claude\settings.json`: backup datato, unione, mostra il diff, scrivi solo dopo la conferma dell'utente.
- Mai inviare un'email o approvare un permesso di Claude Code senza un clic esplicito.
- Prestazioni: nessun frame di animazione / CPU ~0 % quando l'isola è ritirata.
- La versione sta in tre file che devono coincidere: `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (la CI lo controlla sui tag). Un tag `vX.Y.Z` pubblica la release da cui le app installate si aggiornano.
- Cambiare `identifier` in `tauri.conf.json` sposta i dati dell'app e le voci in Gestione credenziali: farlo di proposito, una volta sola.
- Le modifiche visive devono corrispondere al prototipo e alle catture in `design/captures/`. Eccezioni volute: l'aspetto del personaggio (Slime, Goccia ed EasyTech, non il Mochi del prototipo: il prototipo resta il riferimento per animazioni, tempi e viste), l'icona dell'app, posizione (angoli/bordi, trascinamento con `offsetX`/`offsetY`, `overTaskbar`), aggancio ai bordi (`glueEdges`), icona a riposo, vista compatta sempre visibile (`revealDuration` 0) e stile al passaggio del mouse sono specifici di Windows e configurabili (geometria in `src/core/layout.ts` → `anchoredOrigin`, `glueFor`, `cornerRadii`, `collapsedBox`, `compactSize`; lato Rust `island.rs` → `apply_geometry`, `placement_from_drop`).
