# Strumenti dell'isola

## File rilasciati
- Drag & drop HTML5 nella pagina → `chrome.webview.postMessageWithAdditionalObjects` → `drop.rs`, che legge il percorso reale (`ICoreWebView2File`) ed emette `file-drop`. Il messaggio **deve essere una stringa** (sennò il gestore IPC di wry fallisce). `dragDropEnabled` di Tauri resta spento (non viene mai raggiunto).
- «Cosa vuoi farne?» da `fileActions()`; `builtin:unzip` predefinita per gli ZIP. «Annulla» toglie la copia dal Vassoio (`cancelDrop`, `dropSeq`).
- **Cartella rilasciata** (`is_folder` in `lib.rs`, `onDragDrop`): `files::ingest` la rifiuta; il percorso va nel campo della chat (`pathToChat`).

## Vassoio (`files.rs`)
- Copie nell'inbox, svuotata a ogni avvio. Le funzioni accettano solo nomi semplici dentro l'inbox.
- **Fissati** (puntina, `inbox_keep`): restano a riavvio e «Svuota»; nomi in `inbox-kept.json` accanto all'inbox. Solo l'utente fissa.
- Trascinamento verso altre app: `drag_out` → `SHDoDragDrop`. Griglia/elenco in `localStorage`.
- Azioni di riga (`upload.ts`): «Chiedi alla chat» e «Apri» in vista, il resto (Mostra nella cartella, Sposta nella cartella di lavoro, Tieni/Non tenere più, Togli dal vassoio) nel menu «⋯» (`showMenu` di `ctxmenu.ts`); icone neutre, senza colori per azione.
- Zona appena aggiunta da Riquadra e chiedi (`State.trayFresh`, 5 min) in cima con «Chiedi» (`askAboutPicture`) e «Copia» (`inbox_copy`). Scena `files&fresh`.

## Cartella di lavoro (`workdir.rs`, `src/views/workdir.ts`)
- **È `settings.chatFolder`**, la stessa della Modalità terminale. «Scegli…» (`pick_folder`, `IFileOpenDialog`) in «File e schermo» o Impostazioni → Chat. Vuota/inesistente = nessuna (il terminale usa la cartella utente).
- In «File e schermo» sotto il Vassoio: percorso cliccabile, «..», doppio clic per entrare/aprire, trascinamento fuori (anche cartelle), «+» cartella, Esplora file. Per voce: Chiedi alla chat, Apri, «⋯» Rinomina, Sposta…, Nel Vassoio, Mostra in Esplora file, Copia percorso, Cestino (due clic). Sottocartella in `localStorage`, riletta ogni 5 s a schermo; niente nascosti/sistema; max 500 voci.
- Dal Vassoio «⋯» → «Sposta nella cartella di lavoro» sposta nella cartella aperta (`inbox_to_work`; fra dischi copia e toglie).
- **Sicurezza:** percorsi relativi controllati da `resolve` (niente `..`, unità, collegamenti che escono). Cestino di Windows (`SHFileOperationW`, `FOF_ALLOWUNDO`). Gli strumenti dei modelli leggono e spostano, non eliminano; modifiche e cancellazioni solo dalla Modalità terminale.
- **Chat:** `list_work_folder` (sola lettura, senza chiedere) e `move_to_work_folder` (chiede). Claude Code la riceve con `--add-dir` sempre, opencode con `external_directory`. **Telegram:** `/cartella` e «Sposta nella cartella di lavoro» sotto un file ricevuto.
- Anteprima: scena `files` (`Bridge.workList` finto). Test: `cargo test --lib workdir::`.

## Icone e anteprime (`src/views/filekind.ts`, `thumbs.rs`)
- Icona per estensione (`KINDS`). Immagini con la miniatura di Windows (`IShellItemImageFactory`, 128 px, `THUMBNAILONLY`), PNG data: URL in cache per percorso/data/dimensione (max 300).
- Cartella di lavoro: `workLayout` (elenco/griglia), `workSort` (nome/data), cartelle prima; in `localStorage`.

## Backup (`backup.rs`)
- Impostazioni → Backup: JSON con impostazioni (`export_json`), memoria, abilità, compiti, integrazioni personali, `chats.json`, `habits.jsonl` (base64 se binari; oltre 20 MB no). Fuori: chiavi e file cifrati per questo PC (mappa di Notion, ricette).
- Importazione (anche vecchi file di sole impostazioni): sposta ogni area in `<nome>.prima-del-ripristino-<data>`, accetta solo percorsi interni (`safe_join`), poi riavvia l'app.

## Altri strumenti
- **Appunti** (`clipboard.rs`, `integration_clipboard`): listener di Windows, cronologia e immagini (`clipimage.rs`) solo in memoria.
- **Media** (`media.rs`, `integration_media`): sessioni multimediali di Windows; copertina come sfondo sfumato (`.media-backdrop`), senza copertina un alone.
- **Suggerimenti ⚡** (`context.rs`, `src/island/context.ts`, regole per app): dopo la copia della selezione gli appunti tornano in tutti i formati (`ClipboardBefore` in `actions.rs`, esclusi handle GDI; oltre 64 MB solo testo). Senza selezione l'azione apre la chat con la domanda scritta (`draftChat`, `State.chatDraft`).
- **Menu sul testo selezionato e «Sostituisci»** (`src/island/selection-menu.ts`, `src/views/rewrite.ts`, `replace`/`clean_reply` in `context.rs`, `rewrite_text` in `lib.rs`):
  - `Win+Alt+A` copia la selezione *prima* del menu (l'app ha ancora il fuoco); menu nativo al mouse (`tray::popup_entries`), clic come evento `tray` «sel:<id>».
  - Solo azioni rapide dell'utente sul testo (`selectionActions`), cartelle come sottomenu, icone da `menuIcon` (RGBA a `IconMenuItem`/`Submenu::new_with_icon`). Senza azioni: «Crea le azioni…»; in Impostazioni «Aggiungi Riscrivi, Correggi, Più formale, In inglese» (`STARTER_REWRITES`).
  - Riscrittura con il motore della chat in una `Chat` nuova, senza connettori né cronologia; `clean_reply` toglie recinti e virgolette.
  - «Sostituisci» solo con clic: `context::replace` torna alla finestra (`CAPTURED`), ricopia e incolla solo se è lo stesso testo (`same_text`), altrimenti «changed» e resta «Copia». Appunti ripristinati.
  - **Formattazione** (`richtext.rs`): con HTML negli appunti (Word, Outlook, browser) il modello riceve segni `⟦n⟧` al posto dei tag; la risposta si ricompone con tag e intestazione originali e si incolla HTML + testo. Segni persi o spostati → testo semplice e avviso (log «sostituisci: formattazione persa»); oltre 150 segni testo semplice. «Senza formattazione»; testo modificato nella card = niente formattazione. Prova con Word: copia, poi `cargo test --lib richtext::live -- --ignored --nocapture`.
  - Prima di Ctrl+C/V si aspetta il rilascio dei tasti (max 1,5 s, poi «held»): Win premuto + Ctrl+C accende i filtri colore.
- **Personaggio lasciato su una cartella** (`folder_drop.rs`, `end_drag`, `pathToChat`): icona a riposo o vista compatta su Esplora file o un'icona del desktop → percorso nel campo della chat (tra virgolette se ha spazi, non inviato), il personaggio torna al suo posto.
  - Esplora file: riga sotto il cursore (UI Automation + cartella) o cartella della scheda attiva (`IShellWindows`). Desktop: nome cercato nel Desktop utente e pubblico. Vale anche per file.
  - La finestra dell'isola diventa trasparente al mouse per un attimo; ricerca su thread COM, max 1,5 s. Niente cartelle virtuali, `.lnk`, riquadro di navigazione.
- **Personaggio della chat lasciato su una finestra** (`window_drop.rs`, `window_pick`/`window_under_cursor`/`window_drop`, `startWindowPick`…`attachWindow`): solo dalla scheda Chat; la finestra diventa contesto (immagine, app, titolo). Altrove trascinare sposta il personaggio.
  - Durante il trascinamento l'isola resta aperta (`fsm.pinned`, `fsm.waiting`), tiene il mouse dalla pressione (`window_pick(true)`); il personaggio segue il puntatore in `carry.rs` (finestra a strati, trasparente al mouse, senza focus, spostata ogni 8 ms, `hide` alla fine). Faccia via `refreshPickCursor` → `carry_frame` (~15/s, ignorato a trascinamento finito). Un cursore CSS non bastava (Windows rimette la freccia fuori dall'isola). Nel browser `#carry-canvas`. Facce `pickFace`, `jiggle`, cuori al rilascio; chip con la finestra di destinazione; Esc annulla. Prova: `cargo test --lib carry::tests::live -- --ignored`.
  - Finestra sotto il cursore: `EnumWindows` dal davanti, saltando EasyIsland, nascoste, cloaked, ridotte, trasparenti al mouse, desktop, barra. Nome da `FileDescription` o nome file.
  - Immagine: `PrintWindow` con `PW_RENDERFULLCONTENT`, ritaglio a `DWMWA_EXTENDED_FRAME_BOUNDS`, max 1600 px, PNG nel Vassoio («Finestra …»). Prova: `cargo test --lib window_drop::tests::live -- --ignored`.
  - `ChatContext::Window` con `image` va col primo messaggio (immagine per API/OpenAI/opencode, percorso per Read di Claude Code); una conversazione in corso ricomincia. ✕ toglie prima della prima domanda. Nel log solo il nome dell'app.
- **ZIP** (`zip.rs`): .NET via PowerShell.
- **Calcolatrice** nel campo della chat (`src/core/calc.ts`): niente `eval`.
- **Raccolta** (`collect.rs`, `src/views/collect.ts`, `hotkeyCollect`, pannello in «File e schermo», «Nella raccolta» nel velo di cattura): frammenti con la fonte passati insieme alla chat (`askAboutText`). Una raccolta in `raccolta.json` (nel backup). Fonte: `context::foreground` e `SourceURL` del CF_HTML (`richtext::Clip::source`), mai la barra degli indirizzi. I campi li ricava la chat alla consegna, nessuna chiamata per aggiungere.
- **Riquadra e chiedi** (`screenshot.rs`, `src/island/capture.ts`, `hotkeyScreenshot`, riquadro in «File e schermo»): `capture_begin` congela lo schermo sotto il mouse (BitBlt `CAPTUREBLT`, in memoria), `capture_frame` lo passa RGBA (`ipc::Response`), `capture_show` allarga **la finestra dell'isola** a quello schermo (niente seconda WebView2: resterebbe bianca). `island::CAPTURING` ferma `apply_geometry` e il controllo del pieno schermo; `capture_end` ripristina. Zona = rettangolo trascinato, px fisici. Azioni: domanda alla chat (`askAboutPicture` + `sendToChat`), azioni rapide prompt dell'utente (mai predefinite), Copia immagine, Copia testo (`Windows.Media.Ocr`, ×2 se piccolo), Nel Vassoio (riapre lì entro 5 min, `trayUntil`, `openingView`). Esc toglie la zona, secondo Esc o tasto destro chiude. Scena `capture`; prova `cargo test -p easyisland --lib screenshot::live -- --ignored --nocapture`.

## Proposte al momento giusto
Rust emette solo `moment` (`moments.rs`); `src/island/moments.ts` decide: contano come avvisi (fermate solo da «Solo permessi»), niente davanti al cliente o in pausa; se l'isola è occupata aspettano fino a un minuto, poi cadono. Vista `src/views/moment.ts`. Interruttori in Impostazioni → Notifiche (`momentDownloads`, `momentErrors`, `momentServers`, `momentCalls`, `clearSecrets`, accesi). `call` («Annota» dopo una chiamata 3CX): `docs/chat.md` → Secondo cervello.
- **Download finito** (`downloads.rs`): `ReadDirectoryChangesW` su `FOLDERID_Downloads` senza sottocartelle; un secondo thread, solo con candidati, annuncia quando la dimensione è ferma da 1,5 s e nessuno scrive (apertura in sola lettura condivisa). Rinominato da `.crdownload`/`.part` = finito. Mai: temporanei (`is_partial`), nascosti/sistema, cartelle, file vuoti, stesso file entro un minuto, file vecchi modificati. Card: Apri, Mostra nella cartella (`file_open` via Esplora file, restano gli avvisi di Windows), Chiedi, azioni sui file (`fileActions(name)`) senza copia nel Vassoio.
- **Errore copiato** (`moments::copied_error` da `clipboard.rs`, solo con Appunti acceso): traceback Python, stack JS/Java/.NET (≥ 2 righe «at …»), panic ed `error[E…]` Rust, panic Go, `npm ERR!`, `error TS…`, porta occupata (`EADDRINUSE`, `WinError 10048`…; porta da `port_in`, proprietario da `devservers::port_owner`). «Spiega e correggi» apre la chat con l'errore (max 8000 caratteri). Lo stesso errore ricopiato non riapre.
- **Server di sviluppo** (`devservers.rs`): `GetExtendedTcpTable` ogni 3 s, la prima lettura è la base. Porta nuova ≥ 1024 su loopback o tutti gli indirizzi, di un programma in `DEV_PROGRAMS`, che risponde a un GET → «Apri nel browser». Stessa porta non torna per 10 min.
- **Password e chiavi copiate** (`clipboard.rs`, `moments::clear_later`): copie riservate (`ExcludeClipboardContentFromMonitorProcessing` o `CanIncludeInClipboardHistory` = 0) non vanno in cronologia e dopo 30 s gli appunti si svuotano se il numero di sequenza è invariato (anche con Appunti spento, senza leggere il contenuto). Con Appunti acceso vale anche per testi che sono chiavi (`looks_secret`: `sk-ant-`, `ghp_`, `AKIA`, JWT, PEM). «Clipboard Viewer Ignore» da solo: fuori dalla cronologia, non svuotato.
- **Card da Claude Code** (`show_card`, `add_to_tray`): `agenti.md` → Server MCP in Claude Code.
