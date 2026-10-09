# Strumenti dell'isola

## File rilasciati
- Drag & drop HTML5 nella pagina, poi `chrome.webview.postMessageWithAdditionalObjects` → `src-tauri/src/drop.rs`. Il backend legge il percorso reale (`ICoreWebView2File`) ed emette `file-drop`.
- Il messaggio **deve essere una stringa**, altrimenti il gestore IPC di wry fallisce e WebView2 non chiama il nostro.
- Il drop nativo di Tauri (`dragDropEnabled`) resta spento: sui runtime WebView2 attuali non viene mai raggiunto.
- «Cosa vuoi farne?» propone le azioni in `fileActions()`; `builtin:unzip` è quella predefinita per gli ZIP. «Annulla» toglie la copia dal Vassoio (`cancelDrop`, `dropSeq`).

## Vassoio (`files.rs`)
- Copie dei file nell'inbox, svuotata a ogni avvio di proposito. `list_inbox` e le altre funzioni accettano solo nomi semplici dentro l'inbox.
- **File fissati** (puntina, `inbox_keep`): restano dopo il riavvio e con «Svuota». I nomi stanno in `inbox-kept.json` accanto all'inbox, mai dentro. «Togli dal vassoio» li elimina comunque. Solo l'utente li fissa: nessun file diventa permanente da solo.
- Trascinamento verso altre app con `drag_out` → `SHDoDragDrop`. La scelta griglia/elenco è salvata in `localStorage`.

## Altri strumenti
- **Appunti** (`clipboard.rs`, `integration_clipboard`): listener di Windows, cronologia solo in memoria. Le immagini negli appunti stanno in `clipimage.rs`, anche loro solo in memoria.
- **Musica** (`media.rs`, `integration_media`): sessioni multimediali di Windows.
- **Suggerimenti ⚡:** app in primo piano e testo selezionato in `context.rs` + `src/island/context.ts`, con regole per app. Dopo la copia della selezione si ripristina solo il testo degli appunti. Senza selezione (o con appunti vuoti) un'azione non si ferma: apre la chat con la sua domanda già scritta nel campo (`draftChat` in `island.ts`, `State.chatDraft`), e il testo si incolla dopo.
- **Cartella rilasciata sull'isola** (`is_folder` in `lib.rs`, `onDragDrop` in `island.ts`): non entra nella sequenza del file (`files::ingest` rifiuta le cartelle); i percorsi rilasciati vanno nel campo della chat con `pathToChat`, come sotto.
- **Personaggio lasciato su una cartella** (`folder_drop.rs`, `end_drag` in `lib.rs`, `pathToChat` in `island.ts`): trascinando l'icona a riposo o la vista compatta su Esplora file o su un'icona del desktop, il percorso va nel campo della chat (dopo quello che c'è, tra virgolette se ha spazi, non inviato) e il personaggio torna al suo posto invece di spostarsi.
  - Esplora file: la riga sotto il cursore (nome dell'elemento UI Automation unito alla cartella), altrimenti la cartella della scheda attiva (`IShellWindows`, la scheda con la finestra visibile). Desktop: il nome dell'icona cercato nel Desktop dell'utente e in quello pubblico. Vale anche per un file.
  - Per i test di posizione la finestra dell'isola diventa trasparente al mouse per un attimo (gli stessi bit di `set_ignore_cursor_events`); la ricerca gira su un thread COM suo, con 1,5 s al massimo.
  - Niente per cartelle virtuali (Questo PC, Rete), collegamenti `.lnk` a cartelle, il riquadro di navigazione a sinistra.
- **ZIP** (`zip.rs`): .NET via PowerShell.
- **Calcolatrice** nel campo della chat (`src/core/calc.ts`): locale, niente `eval`.
- **Cattura una zona → chiedi alla chat** (`screenshot.rs`): Strumento di cattura di Windows, PNG nell'inbox, scorciatoia `hotkeyScreenshot`. Una cattura annullata resta in ascolto fino a 60 s.
