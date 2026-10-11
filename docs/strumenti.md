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
- **Menu sul testo selezionato e «Sostituisci»** (`src/island/selection-menu.ts`, `src/views/rewrite.ts`, `replace` e `clean_reply` in `context.rs`, `rewrite_text` in `lib.rs`):
  - `hotkeySelectionMenu` (`Win+Alt+A`) copia la selezione *prima* di aprire il menu, mentre l'app ha ancora il fuoco; il menu è nativo, al mouse (`tray::popup_entries`) e il clic torna come evento `tray` «sel:<id>». Così funziona in ogni app, browser compresi: Windows non ha un menu del tasto destro comune per il testo, e le estensioni del browser sono state scartate (deciso con Edoardo l'11 ottobre 2026).
  - Voci: **solo le azioni rapide dell'utente** che lavorano sul testo selezionato (`selectionActions`), con le cartelle come sottomenu e le icone (disegnate su una tela nel colore dell'azione da `menuIcon`, passate come RGBA a `IconMenuItem`/`Submenu::new_with_icon`); nessuna voce predefinita (deciso con Edoardo l'11 ottobre 2026). Senza azioni il menu offre solo «Crea le azioni…», che apre le Impostazioni; lì «Aggiungi Riscrivi, Correggi, Più formale, In inglese» crea quattro azioni normali da cui partire (`STARTER_REWRITES` in `settings/main.ts`).
  - La riscrittura usa il motore della chat ma in una `Chat` nuova, senza connettori e senza cronologia; la risposta passa da `clean_reply` (toglie recinti di codice e virgolette attorno).
  - «Sostituisci» solo con un clic: `context::replace` torna sulla finestra da cui veniva la selezione (`CAPTURED`), la ricopia e incolla solo se è ancora la stessa (`same_text` ignora fine riga e spazi ai bordi), altrimenti «changed» e resta «Copia». Incolla testo semplice: in Word e Outlook il pezzo sostituito perde grassetti e link interni. Gli appunti tornano come prima (solo testo, come per la copia).
  - Prima di Ctrl+C/Ctrl+V si aspetta che i tasti della scorciatoia siano lasciati (fino a 1,5 s, poi «held»): con Win ancora premuto Ctrl+C accenderebbe i filtri colore di Windows.
- **Cartella rilasciata sull'isola** (`is_folder` in `lib.rs`, `onDragDrop` in `island.ts`): non entra nella sequenza del file (`files::ingest` rifiuta le cartelle); i percorsi rilasciati vanno nel campo della chat con `pathToChat`, come sotto.
- **Personaggio lasciato su una cartella** (`folder_drop.rs`, `end_drag` in `lib.rs`, `pathToChat` in `island.ts`): trascinando l'icona a riposo o la vista compatta su Esplora file o su un'icona del desktop, il percorso va nel campo della chat (dopo quello che c'è, tra virgolette se ha spazi, non inviato) e il personaggio torna al suo posto invece di spostarsi.
  - Esplora file: la riga sotto il cursore (nome dell'elemento UI Automation unito alla cartella), altrimenti la cartella della scheda attiva (`IShellWindows`, la scheda con la finestra visibile). Desktop: il nome dell'icona cercato nel Desktop dell'utente e in quello pubblico. Vale anche per un file.
  - Per i test di posizione la finestra dell'isola diventa trasparente al mouse per un attimo (gli stessi bit di `set_ignore_cursor_events`); la ricerca gira su un thread COM suo, con 1,5 s al massimo.
  - Niente per cartelle virtuali (Questo PC, Rete), collegamenti `.lnk` a cartelle, il riquadro di navigazione a sinistra.
- **ZIP** (`zip.rs`): .NET via PowerShell.
- **Calcolatrice** nel campo della chat (`src/core/calc.ts`): locale, niente `eval`.
- **Cattura una zona → chiedi alla chat** (`screenshot.rs`): Strumento di cattura di Windows, PNG nell'inbox, scorciatoia `hotkeyScreenshot`. Una cattura annullata resta in ascolto fino a 60 s.
