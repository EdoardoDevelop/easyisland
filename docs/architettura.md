# Architettura e interfaccia

## Cartelle
- `src/`: front end dell'isola e delle impostazioni (TypeScript, niente framework, Canvas 2D).
  - `src/character/`: i personaggi, scelti con `theme.character`. Il contratto e il registro stanno in `character.ts`, l'elenco in `roster.ts`.
  - `src/island/`: macchina a stati (`fsm.ts`), hook (`hooks.ts`), integrazioni, contesto, piano dell'agente (`plan.ts`), avvisi di rischio (`risk.ts`).
  - `src/views/`: tutte le viste.
  - `src/settings/`: la finestra delle impostazioni.
  - `src/core/`: stato (`state.ts`), markdown, suoni, calcolatrice, layout.
- `src-tauri/`: backend Rust (Tauri 2): finestra, named pipe, API, poller, Gestione credenziali, area di notifica, hook NSIS.
- `hook/`: `easyisland-hook.exe`, il relay degli hook (vedi `agenti.md`).
- `dev/`: anteprime nel browser (`scenes.ts`, `*-preview.html`).
- `scripts/`:
  - `gen-icons.mjs`: icone disegnate nel codice (l'isola, non il personaggio).
  - `gen-brands.mjs`: loghi dei marchi.
  - `pack.mjs`: copia l'installer in `release/`.
  - `screenshots.mjs`: rifà le schermate del README.
- `screenshots/`: le immagini del README, rifatte da `scripts/screenshots.mjs`. Sono il riferimento visivo attuale. Il prototipo originale di Coucou resta solo nella storia git.
- `brand/`: SVG sorgente dei loghi. L'app non lo legge mai.

## Personaggi
- Slime (`slime.ts`) e Goccia (`drop.ts`) sono personaggi "soft": contorno, ombreggiatura e occhio. Tutto il resto è comune. EasyTech è il cubo 3D (`cube.ts`).
- `engine.ts`, `greeting.ts` e `src/upload/canvas.ts` disegnano chiedendo `character()`, mai un personaggio per nome.
- **Nuovo personaggio soft:** un file che esporta un `SoftCharacter` e una riga in `roster.ts`. Si prova con `dev/character-preview.html?character=<id>` e `dev/upload-preview.html?character=<id>`.
- EasyTech prende il colore del tema e quello dell'integrazione in primo piano (`wearsIntegrationColor`).
- Sulla Panoramica (⌂, `State.characterTask` = null) il personaggio ha il colore del tema e mostra lo stato più urgente fra tutti (`URGENCY` in `state.ts`: permesso > domanda > errore > limite > lavoro > … > riposo).
- **Cielo del Meteo:** `src/character/weather.ts` disegna sole, luna, nuvole, nebbia, pioggia, neve o temporale sopra la testa (`BotEngine.sky`, mai sulle mini). Quale cielo e quando lo decide `State.characterSky`:
  - sempre sulla pillola Meteo;
  - sul personaggio inattivo (`idle`) se c'è `weatherOnCharacter`;
  - mai sull'icona a riposo, e nemmeno con una lettura più vecchia di 3 ore.
  Si muovono solo pioggia e neve, che tengono vivo il ciclo come il sudore: con l'isola ritirata il ciclo è fermo comunque. Le gocce di sudore (`ratelimit`) cadono lungo la testa, le altre particelle salgono.
- «Ciao» al passaggio del mouse: `BotEngine.hello()` e `hoverHello()` in `island.ts`, al massimo una volta ogni 1,5 s.

## Isola, layout e posizione
- Geometria in `src/core/layout.ts` (`anchoredOrigin`, `glueFor`, `cornerRadii`, `collapsedBox`, `compactSize`). Lato Rust: `island.rs` (`apply_geometry`, `placement_from_drop`).
- Specifici di Windows e configurabili: posizione (angoli e bordi, trascinamento con `offsetX`/`offsetY`, `overTaskbar`), aggancio ai bordi (`glueEdges`), icona a riposo, vista compatta sempre visibile (`revealDuration` 0), stile al passaggio del mouse.
- **Schermi secondari:** trascinando il personaggio su un altro schermo, `screen` diventa `monitor:<nome>` (`island::screen_for_drop`). Il trascinamento è ancorato al cursore in pixel fisici (`drag_grab`, `drag_island`). Al cambio di scala, `watchScale` ridisegna le tele.
- **Dimensioni dell'isola aperta:** `islandWidth` va da 560 a 704 px. `islandHeight` è l'altezza minima (0 = quella della vista). Si regolano trascinando l'angolo (`wireResize`). La finestra è 720×560 (`PANEL_W/H`): per andare oltre va ingrandita anche in Rust. Saluto e sequenza del file hanno misura fissa (`FIXED_SIZE_VIEWS`).
- **Liste a scorrimento nuove:** `max-height: calc(Npx + var(--extra-h, 0px))`, così si allungano con l'isola. `--extra-w` allarga la card sinistra della Panoramica.
- Griglie con `minmax(0, 1fr)` e testo troncato con i puntini. Nelle bolle della chat si usa `overflow-wrap: anywhere`.

## Viste e intestazione
- La Panoramica (⌂) riassume tutte le integrazioni (`State.summary`, `renderSummary` in `views.ts`). Le righe si riordinano trascinandole, nello stesso ordine delle pillole (`pillOrder`). L'ordine si blocca con `lockOrder`.
- Le integrazioni possono stare in pillola o in scheda nell'intestazione (`integrationTabs`, `integrationTabIcons`; `@logo` = solo il logo, `@name` = il nome). Il pulsante 📌 è `State.keepOpen`.
- Loghi dei marchi: SVG in `brand/`, una riga nella mappa di `scripts/gen-brands.mjs`, poi `node scripts/gen-brands.mjs` genera `src/views/brands.ts`. Si usano con `brandOrDot` e `markIcon` (`dom.ts`). Le integrazioni in `ICON_MARKS` (Meteo, Appunti, Musica, Consumo) non hanno un logo e mostrano al suo posto l'icona predefinita della scheda (`TAB_ICONS`). Le altre senza logo mostrano il pallino.
- **Barra di ricerca** (`src/views/search.ts`, impostazione `searchBar`): in fondo all'isola aperta, tranne chat, saluto e sequenza del file. L'isola si allunga di `SEARCH_H` (36 px) e il personaggio resta centrato sulle viste. Cerca pillole (integrazioni e sessioni), azioni ⚡ e programmi del menu Start (`start_apps.rs`: `Get-StartApps`, app dello Store comprese, in memoria per 5 minuti; senza PowerShell i collegamenti `.lnk`). I risultati coprono la vista; con dei risultati aperti l'isola non si chiude da sola. Quando l'utente apre l'isola (passaggio del mouse, clic, scorciatoia «Apri»: `openByUser`, `focusSearchSoon`) la barra prende la tastiera; mai per un avviso, che ruberebbe i tasti all'app in cui si scrive, né con una richiesta in attesa.
- Markdown delle risposte: `src/core/markdown.ts` (DOM, mai `innerHTML`).

## Impostazioni
- Le pagine sono in `pages()` di `src/settings/main.ts`. «Chat» = motore e connettori (`claudeChatSection`). «Agenti» = una riga per agente (`agentsSection`, `agentRow`; l'id di pagina è ancora `claude`). Altre sezioni: `automationsSection` e `actionsSection`.
- `commit()` salva soltanto; `render()` ricostruisce la pagina intera e si chiama solo quando cambia la struttura (non mentre si scrive).

## Suoni
- I 28 suoni sono sintetizzati in `src/core/synth.ts` e riprodotti da `src/core/sound.ts`. Si ascoltano in `dev/sounds-preview.html`. Il volume di ciascuno è tarato sul WAV originale che ha sostituito.

## Coerenza visiva
Animazioni, tempi e viste vengono dal prototipo originale di Coucou (storia git). Sono specifici di EasyIsland l'aspetto dei personaggi, l'icona dell'app e le opzioni di posizione elencate sopra.
