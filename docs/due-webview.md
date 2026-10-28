# Personaggio e isola in due WebView — lavoro a passi

Branch `claude/due-webview`, iniziato il 28 ottobre 2026 (deciso con Edoardo). A lavoro finito questo file si riassume in `docs/architettura.md` e si cancella. Dopo si riprende la barra fissa (branch `claude/barra-fissa`, `docs/barra-fissa.md`) sopra questo lavoro.

## Perché
Oggi personaggio, vista compatta e isola aperta stanno in una sola finestra. Una finestra però è tutta in primo piano o tutta dietro, e questo pone due problemi:
- L'isola aperta non può comportarsi come una finestra normale (andare dietro alle altre app, spostarsi da sola) mentre personaggio e barra restano davanti.
- Con la vista compatta «sempre visibile», la finestra grande e trasparente obbliga il controllo del cursore a girare sempre per far passare i clic (20–60 volte al secondo).

## Cosa diventa
- **Finestra «personaggio»** (nuova, `personaggio.html`): piccola, sempre in primo piano, mai attiva. Contiene:
  - l'icona a riposo e la vista compatta, con personaggio, striscia (permessi, chiamate, agente al lavoro, barra dell'app in uso) e mini agenti;
  - più avanti la barra fissa.
  - È grande quanto ciò che mostra e prende tutto il mouse: nessun controllo del cursore. Il personaggio non si muove mai verso l'isola.
- **Finestra «isola»** (quella di oggi): solo l'isola aperta, con le viste, il menu e un secondo personaggio, clone di quello nel menu. Si comporta come una finestra: sta accanto al personaggio quando si apre, si sposta per l'intestazione e va dietro alle altre app quando si clicca altrove. Il controllo del cursore gira solo mentre è aperta, come oggi.
- **Il «cervello» resta nella pagina dell'isola:** `State`, `hooks.ts`, `integrations.ts`, chat, Telegram, gli eventi da Rust. La pagina del personaggio riceve solo ciò che mostra e manda indietro ciò che l'utente fa (clic, pulsanti della striscia, file rilasciati). Così il grosso del codice non si sposta.
- **Apertura** (chiesto da Edoardo):
  - il personaggio nella sua finestra fa un'animazione (per esempio un saltello con bagliore);
  - l'isola compare accanto a lui con un effetto: cresce dal lato del personaggio con la molla di oggi e un'onda di luce che parte dal personaggio;
  - il clone nel menu dell'isola entra con la sua animazione.

## Scelte da verificare con una prova (passo 0)
- **Canale tra le pagine:** `BroadcastChannel` tra due WebView dello stesso profilo e della stessa origine. Se non va, eventi Tauri passando da Rust.
- **Memoria in più** del secondo WebView: stimata 30–50 MB, da misurare.
- **Ordine di creazione:** una finestra WebView2 creata dopo quella dell'isola resta bianca (`create_settings_window`). La finestra del personaggio va quindi creata all'avvio, prima dell'isola.
- **Isola chiusa:** finestra nascosta (`hide`), ma la pagina deve continuare a ricevere gli eventi (agenti, chiamate) senza consumare: nessun `requestAnimationFrame` da nascosta. Va verificato che riaprirla non mostri un lampo bianco.

## Passi
- [ ] **0. Prova:**
  - finestra «personaggio» creata all'avvio (trasparente, in primo piano, non attivabile), con il personaggio animato e lo stato preso dall'isola tramite il canale;
  - misurare memoria e CPU a riposo;
  - provare `BroadcastChannel` e il nascondere e mostrare la finestra dell'isola.
- [ ] **1. Canale tipizzato** (`src/core/link.ts`):
  - **isola → personaggio:** stato del personaggio, emozioni, tema e personaggio scelti, voce della striscia, mini agenti, pausa e silenzio;
  - **personaggio → isola:** apri (con la vista), passaggio del mouse, pulsanti della striscia, file rilasciati.
- [ ] **2. Icona a riposo e vista compatta nella finestra del personaggio:**
  - posizione, trascinamento e lascia su finestra o icona (`island.rs` lavora sulla finestra del personaggio);
  - schermi e scala;
  - schermo intero (`quietFullscreen`).
- [ ] **3. L'isola come finestra:**
  - si apre accanto al personaggio, dal suo lato;
  - si sposta per l'intestazione;
  - non è più sempre in primo piano;
  - si nasconde da chiusa;
  - clone del personaggio nel menu; effetto di apertura.
- [ ] **4. Striscia, barra dell'app in uso e mini agenti** nella finestra del personaggio, con le loro azioni.
- [ ] **5. File rilasciati sul personaggio** (`drop.rs`, `window_drop.rs`): aprono l'isola come oggi.
- [ ] **6. Pulizia e verifiche:**
  - togliere dall'isola il codice della vista compatta;
  - scene di `dev/scenes.ts` e `npm run smoke` per le due pagine;
  - documentazione e guida;
  - prova dal vivo.

## Vincoli che restano (`CLAUDE.md`)
- Personaggi, animazioni e impostazioni di oggi restano. Cambia solo che il personaggio non vola più nel menu: al suo posto c'è il clone.
- CPU circa 0 % a riposo: la finestra del personaggio non fa cicli quando è ferma, e l'isola chiusa non disegna.
- Mai bloccare gli agenti: i permessi devono arrivare anche se una delle due pagine non risponde. La pagina dell'isola resta quella che risponde, come oggi.

## Note durante il lavoro
