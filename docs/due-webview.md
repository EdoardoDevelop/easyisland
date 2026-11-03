# Personaggio e isola in due WebView: note e misure

Lavoro del 28–29/10/2026, in `main`. Come funziona oggi: `docs/architettura.md` → Finestra del personaggio. Qui solo perché, scelte e misure. Resta da provare ai lati e su un secondo schermo (in basso e file rilasciati provati il 29/10).

## Perché
Una finestra è tutta davanti o tutta dietro: l'isola aperta non poteva comportarsi da finestra normale con personaggio e barra davanti, e la vista compatta grande e trasparente costringeva il controllo del cursore a girare sempre (20–60 volte/s).

## Scelte
- **Finestra «personaggio»** (`personaggio.html`, `src/character-window/main.ts`, `create_character_window` in `lib.rs`): piccola, in primo piano, mai attiva; disegna l'icona a riposo e il personaggio compatto. Creata all'avvio subito dopo l'isola (una WebView2 creata dopo resta bianca).
- **Il «cervello» resta nella pagina dell'isola** (`State`, hook, integrazioni, chat, Telegram, eventi Rust): il personaggio riceve ciò che mostra via `BroadcastChannel` (`src/core/link.ts`, stessa origine e profilo, niente Rust) e rimanda le azioni. L'isola risponde ai permessi anche se il personaggio non c'è.
- **Riposo:** Rust (`sync_character`) posa la finestra sopra quella ritirata dell'isola, solo se l'isola lo chiede (`character_rest`); lascia passare i clic (`set_ignore_cursor_events`), l'interazione resta all'isola (`restCanvas` nascosto). Con icona «nessuna» o «punto» resta nascosta.
- **Compatto:** l'isola (`mirrorCompact`) manda dove starà il personaggio a molle ferme (`character_spot`) e nasconde il suo `bot-canvas`; la finestra riceve `gaze`, gesti (`MIRRORED_CALLS`) e nel `look` cielo, meteo, satelliti di Jarvis. L'isola aggiorna il motore senza disegnarlo (`engineBusy`). Il codice compatto dell'isola resta (anteprime, smoke, saluto, tutto schermo, file in arrivo).
- **Isola aperta:** personaggio fermo dove stava (`openSpot`/`compactSpot`), posato rispetto alla finestra **a casa** (`island::home_panel_origin`); lì prende il mouse e un clic chiude. L'isola si sposta di `island::OPEN_CLEARANCE` (`character_clearance`, in `apply_geometry`): sotto, sopra o di fianco, di altezza compatta (min. striscia) + 6 px; alla chiusura scivola a casa (`glide_home` in `set_expanded`).
- **Apertura:** saltello con scintille, onda di luce (`#open-wave`, `openWave`), clone nel menu che cresce con un saluto (`cloneEnter`). Saluto all'avvio e isola a tutto schermo: finestra del personaggio nascosta. A isola aperta si condividono solo le emozioni.
- **Ordine:** niente possesso fra finestre; dopo ogni rialzo dell'isola (`come_forward`, `raise_over_taskbar`) Rust chiama `island::raise_character`. L'isola aperta va dietro a qualunque finestra che si attiva (`step_aside_for`, escluse shell ed EasyIsland), torna con un clic.
- Isola chiusa non nascosta: è solo il riquadro dell'icona/striscia, non disegna. Striscia, barra dell'app e mini agenti restano nell'isola.
- **Animazione a riposo:** CSS di solo `transform` (classe `alive`: galleggia, oscilla, respira, alone) mosso dal compositore; niente battiti di ciglia a intermittenza (non piacevano). Personaggi `animated` (Jarvis, Fiamma) a 15 fps a riposo, compatto (se non segue lo sguardo) e accanto all'isola. Memoria bassa di WebView2 (`webview_memory::set_low`, ripetuto dopo 10 s).

## Misure (EasyIsland + WebView2)
- Prima: 377 MB, CPU 0,27 %. Con la finestra del personaggio: 399 MB, 0,18 %. Ridisegno continuo con Jarvis/Fiamma: 551 MB, 1,87 % (corretto).
- Icona «nessuna»: 356 MB, 0,24 %.
- Compatto sempre visibile con Jarvis Sfera: 459 MB/0,77 % → 414 MB/0,64 % (isola non ridisegna) → 420 MB/0,46 % dopo i risparmi. La pagina del personaggio (~75 MB) è quasi tutta WebView2 di base.
- Isola nascosta risponde in 0–2 ms.
