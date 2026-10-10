# Handoff — EasyIsland

_Aggiornato al 10 ottobre 2026. Versione **0.6.5** in `main` con il tag `v0.6.5` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Azioni ⚡:** valutare le azioni nel menu contestuale di Windows (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, card ripiegabile, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Da decidere con Edoardo:** nuovi personaggi (rimandati: le prove sono venute male), firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo.
- **Limiti del piano:** arrivano solo dalle sessioni che disegnano la status line (terminale, VS Code), non dall'app Claude. Servono gli hook di Claude Code aggiornati (Impostazioni → Agenti → «Aggiorna»).

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 10 ottobre 2026 — Claude Code facoltativo, saluto al centro, «Apri l'isola» chiude anche
- **Claude Code solo con i suoi hook:** senza hook installati niente card Claude Code. Con «Collega opencode» (prima «Segui opencode 2») la scheda Agenti parte da opencode «In attesa»; senza agenti la scheda non c'è. `hooksInstalled` lo scrivono solo `boot` e `hooks_apply` (il salvataggio delle Impostazioni non lo tocca più). Nell'anteprima del browser gli hook contano come installati (`?hooksInstalled=false` per provarne l'assenza).
- **Saluto all'avvio** al centro dello schermo di predefinito. In Posizione e aspetto: acceso/spento (`greeting`; spento, il personaggio compare al suo posto senza suono) e dove (`greetingPlace`: centro o dove sta il personaggio). La finestra va al centro con `set_expanded(…, place)` → `gate.open_place`, che vale solo per quell'apertura. Provato nell'anteprima; la finestra vera è da provare dal vivo.
- La scorciatoia «Apri l'isola» (`Ctrl+Space`) premuta con l'isola aperta la chiude (`onHotkey` in `island.ts`). Con una richiesta in attesa resta sulla card, come con Esc o il clic fuori (`collapse`).

### 9 ottobre 2026 — versione 0.6.5
- Unione in `main` e tag `v0.6.5`: cartella nella chat, menu col clic destro, saluto senza isola, `Ctrl+Space` sulla Panoramica, angoli dell'isola staccata (voci sotto). README con novità e tabella delle versioni.

### 9 ottobre 2026 — cartella nella chat, scorciatoia «Apri» sulla Panoramica
- **Cartella rilasciata sull'isola:** finiva nella sequenza del file («Rilascia», poi errore); ora i percorsi vanno nel campo della chat.
- **Scorciatoia «Apri l'isola»** (`Ctrl+Space`): apre la Panoramica invece di ⚡ o della chat; con una richiesta in attesa apre quella.
- **Personaggio lasciato su una cartella:** trascinando il personaggio (a riposo o compatto) su Esplora file o su un'icona del desktop, il percorso va nel campo della chat e il personaggio torna al suo posto (`folder_drop.rs`, `docs/strumenti.md`). Provata la ricerca su Esplora file vero (sfondo, barra degli indirizzi, righe); il desktop e il gesto intero sono da provare dal vivo.
- Feature `Win32_System_Variant` e `Win32_UI_Shell_Common` del crate `windows` già presente.

### 9 ottobre 2026 — saluto all'avvio senza isola
- Il saluto è solo il personaggio con alone e particelle, sul desktop: niente card scura, distintivo o mini personaggi (`Greeting.bare`, classe `greeting` sull'isola). Anteprima ripetuta: `/dev/greeting-preview.html`.

### 9 ottobre 2026 — menu col clic destro sul personaggio a riposo, angoli dell'isola staccata
- Clic destro sull'icona a riposo: lo stesso menu dell'area di notifica (Apri, Profilo, Riepilogo, Davanti al cliente, Impostazioni, Pausa, Esci) dove sta il cursore (`show_island_menu` in `lib.rs`, `tray::popup`). Le voci passano dallo stesso gestore del menu dell'area di notifica.
- La finestra a riposo non prende il fuoco (`WS_EX_NOACTIVATE`): per la durata del menu lo prende, sennò un clic fuori non lo chiude. Provato dal vivo il 9 ottobre.
- **Angoli:** l'isola aperta trascinata via dal bordo restava squadrata verso il bordo; ora `end_drag` restituisce lo spostamento (agganciato entro 16 px, riportato dentro lo schermo) e gli angoli si arrotondano. Mentre la si trascina, in ogni stato, è arrotondata tutta. Provato dal vivo.
