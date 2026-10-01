# Coucou (Windows) — guida per gli agenti AI

Coucou è un'app desktop per Windows 10/11: Mochi, un piccolo personaggio animato che vive in un'isola in alto al centro dello schermo, mostra le sessioni di Claude Code e alcune integrazioni, e permette all'utente di approvare, rispondere, chattare e rilasciare file dall'isola. Fork solo per Windows di Louis-CFM/coucou (l'app macOS è stata rimossa). Handoff personale e roadmap: `HANDOFF.md`.

**Lingua del progetto: italiano.** Testi dell'interfaccia, messaggi d'errore mostrati all'utente, documentazione e messaggi di commit sono in italiano. Identificatori e commenti nel codice restano in inglese.

## Dove stanno le cose
- `src/`: front end dell'isola e delle impostazioni (TypeScript, nessun framework, Canvas 2D). `src/mochi/` il personaggio, `src/island/` macchina a stati, hook e integrazioni, `src/views/` tutte le viste, `src/settings/` la finestra delle impostazioni.
- `src-tauri/`: backend Rust (Tauri 2): finestra, named pipe, API Claude, poller, Gestione credenziali, area di notifica, hook NSIS.
- Chat: due motori scelti in `settings.chatEngine`. `src-tauri/src/claude.rs` chiama l'API con la chiave; `src-tauri/src/claude_cli.rs` lancia `claude -p` (abbonamento dell'utente) con hook disattivati, solo WebSearch/WebFetch/Read e `dontAsk`. `coucou-hook.exe` ignora i processi con `COUCOU_INTERNAL`.
- File rilasciati: drag & drop HTML5 nella pagina, poi `chrome.webview.postMessageWithAdditionalObjects` → `src-tauri/src/drop.rs`, che legge il percorso reale (`ICoreWebView2File`) ed emette `file-drop`. Il drop nativo di Tauri (`dragDropEnabled`) resta spento: sui runtime WebView2 attuali non viene mai raggiunto. Il messaggio deve essere una stringa, altrimenti il gestore IPC di wry fallisce e WebView2 non chiama il nostro.
- `hook/`: `coucou-hook.exe`, il relay degli hook di Claude Code.
- `assets/sounds/`: i 28 suoni WAV (percorso dichiarato una sola volta in `vite.config.ts`, `SOUNDS_DIR`).
- `scripts/`: `gen-icons.mjs` (icone disegnate nel codice), `pack.mjs` (copia l'installer in `release/`).
- `docs/SPEC.md`, `docs/INTEGRATIONS.md`: comportamento, viste, stati, integrazioni (scritti per l'originale macOS; le differenze di Windows sono nel `README.md`).
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
- TypeScript + Rust (Tauri 2). Nessuna nuova dipendenza se non davvero inevitabile. Mochi è disegnato nel codice (Canvas 2D), niente Rive/Lottie/immagini.
- I segreti stanno in Gestione credenziali di Windows, mai su disco, nell'interfaccia o in git. Il front end può solo chiedere se una chiave esiste.
- Nessuna telemetria. Chiamate di rete solo verso i servizi configurati dall'utente.
- Non bloccare mai Claude Code: se l'app non risponde entro il timeout dell'hook, l'hook esce subito con 0.
- Non sovrascrivere mai `%USERPROFILE%\.claude\settings.json`: backup datato, unione, mostra il diff, scrivi solo dopo la conferma dell'utente.
- Mai inviare un'email o approvare un permesso di Claude Code senza un clic esplicito.
- Prestazioni: nessun frame di animazione / CPU ~0 % quando l'isola è ritirata.
- La versione sta in tre file che devono coincidere: `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (la CI lo controlla sui tag).
- Cambiare `identifier` in `tauri.conf.json` sposta i dati dell'app e le voci in Gestione credenziali: farlo di proposito, una volta sola.
- Le modifiche visive devono corrispondere al prototipo e alle catture in `design/captures/`. Eccezione voluta: posizione (angoli/bordi, trascinamento con `offsetX`/`offsetY`, `overTaskbar`), aggancio ai bordi (`glueEdges`), icona a riposo, vista compatta sempre visibile (`revealDuration` 0) e stile al passaggio del mouse sono specifici di Windows e configurabili (geometria in `src/core/layout.ts` → `anchoredOrigin`, `glueFor`, `cornerRadii`, `collapsedBox`, `compactSize`; lato Rust `island.rs` → `apply_geometry`, `placement_from_drop`).
