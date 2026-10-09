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
- Goccia (`drop.ts`, il personaggio predefinito dalla 0.6.4: `default_character` in `settings.rs`, `DEFAULT_SETTINGS` in `state.ts` e primo in `roster.ts`) e Slime (`slime.ts`) sono personaggi "soft": contorno, ombreggiatura e occhio. Tutto il resto è comune. EasyTech è il cubo 3D (`cube.ts`). Chi aveva già scelto un personaggio lo tiene.
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
- **Dimensioni dell'isola aperta:** `islandWidth` (da 560 px) e `islandHeight` (altezza minima, 0 = quella della vista) arrivano fino all'area di lavoro dello schermo meno i margini (`islandMax`, limiti da `panel_limits`). Si regolano trascinando l'angolo (`wireResize`) o in Posizione e aspetto. La finestra è almeno 720×560 (`PANEL_W/H`, uguali in `layout.ts` e `island.rs`); un'isola più grande chiede una finestra più grande (`fitPanel` → `set_panel_size`, `gate.panel_size`), che cambia solo quando l'utente cambia la misura, mai con la vista: così non taglia un'animazione. L'altezza che una vista prende da sola per il contenuto resta entro `MAX_ISLAND_H`. Saluto e sequenza del file hanno misura fissa (`FIXED_SIZE_VIEWS`).
- **Menu col clic destro** sul personaggio a riposo: lo stesso dell'area di notifica (`tray::popup`, comando `show_island_menu`), costruito da `build_menu` e gestito dallo stesso `on_menu_event` (Tauri lo chiama per ogni menu). Durante il menu la finestra perde `WS_EX_NOACTIVATE`, perché `TrackPopupMenu` vuole una finestra in primo piano per chiudersi al clic fuori.
- **Dove si apre (`islandPlace`):** «character» = dove sta il personaggio (come prima); «top», «center», «bottom» = centrata in alto, in mezzo o in basso nell'area di lavoro. Il personaggio a riposo e la vista compatta restano al loro posto (`homePlacement`); solo da aperta la finestra va lì (`open_origin`/`place_origin` in `island.rs`, `placement` con `v: "middle"` in `island.ts`). Chiudendosi si ritira sul posto (altezza 0) e dopo 320 ms la finestra torna al personaggio (`closeAway`). Il trascinamento dell'isola aperta vale da quel punto (`panel_offset_from_drop`). Lasciata entro 16 px da dove si apre ci torna (tocca di nuovo il bordo); altrimenti `end_drag` restituisce lo spostamento e `applyGeometry` arrotonda gli angoli del lato staccato (`openOffset`). Mentre la si trascina (`carried`) l'isola è arrotondata tutta, finché Rust non ha deciso dove è stata lasciata.
- **Liste a scorrimento nuove:** `max-height: calc(Npx + var(--extra-h, 0px))`, così si allungano con l'isola. `--extra-w` allarga la card sinistra della Panoramica.
- Griglie con `minmax(0, 1fr)` e testo troncato con i puntini. Nelle bolle della chat si usa `overflow-wrap: anywhere`.

## Viste e intestazione
- La Panoramica (⌂) riassume tutte le integrazioni (`State.summary`, `renderSummary` in `views.ts`). Le righe si riordinano trascinandole, nello stesso ordine delle pillole (`pillOrder`). L'ordine si blocca con `lockOrder`.
- Le integrazioni possono stare in pillola o in scheda nell'intestazione (`integrationTabs`, `integrationTabIcons`; `@logo` = solo il logo, `@name` = il nome). Il pulsante 📌 è `State.keepOpen`.
- Loghi dei marchi: SVG in `brand/`, una riga nella mappa di `scripts/gen-brands.mjs`, poi `node scripts/gen-brands.mjs` genera `src/views/brands.ts`. Si usano con `brandOrDot` e `markIcon` (`dom.ts`). Le integrazioni in `ICON_MARKS` (Meteo, Appunti, Musica, Consumo) non hanno un logo e mostrano al suo posto l'icona predefinita della scheda (`TAB_ICONS`). Le altre senza logo mostrano il pallino.
- **Saluto all'avvio** (`src/character/greeting.ts`, `Greeting.bare`): solo il personaggio con alone e particelle, senza card, distintivo né mini personaggi. Durante il saluto l'isola ha la classe `bare greeting` (`applyBare`): sfondo trasparente, niente ritaglio mentre cresce, particelle sfumate verso il bordo della tela (maschera in `style.css`). Prova senza l'app: `/dev/greeting-preview.html`.
- **Barra di ricerca** (`src/views/search.ts`, impostazione `searchBar`): in fondo all'isola aperta, tranne chat, saluto e sequenza del file. L'isola si allunga di `SEARCH_H` (36 px) e il personaggio resta centrato sulle viste. Cerca pillole (integrazioni e sessioni), azioni ⚡ e programmi del menu Start (`start_apps.rs`: `Get-StartApps`, app dello Store comprese, in memoria per 5 minuti; senza PowerShell i collegamenti `.lnk`). I risultati coprono la vista; con dei risultati aperti l'isola non si chiude da sola. Quando l'utente apre l'isola (passaggio del mouse, clic, scorciatoia «Apri»: `openByUser`, `focusSearchSoon`) la barra prende la tastiera; mai per un avviso, che ruberebbe i tasti all'app in cui si scrive, né con una richiesta in attesa.
- Markdown delle risposte: `src/core/markdown.ts` (DOM, mai `innerHTML`).

## Impostazioni
- Le pagine sono in `pages()` di `src/settings/main.ts`. «Chat» = motore e connettori (`claudeChatSection`). «Agenti» = una riga per agente (`agentsSection`, `agentRow`; l'id di pagina è ancora `claude`). Altre sezioni: `automationsSection` e `actionsSection`.
- `commit()` salva soltanto; `render()` ricostruisce la pagina intera e si chiama solo quando cambia la struttura (non mentre si scrive).

## Lingua
- Italiano o inglese (`settings.language`: `""` = come Windows, `"it"`, `"en"`). Un solo dizionario, `src/i18n/en.json`, chiave = testo italiano, usato da TypeScript (`src/core/i18n.ts`: `t`, `tn`, `locale()`) e da Rust (`src-tauri/src/i18n.rs`: `t`, `tf`, `english()`, `prompt()` per la lingua delle risposte della chat).
- Le finestre sono costruite in una lingua sola: la pagina la sa prima che giri qualunque modulo (`localStorage` `easyisland.lang`, condiviso da isola e impostazioni; `?lang=en` nell'anteprima). Dopo il boot `syncLanguage` la allinea alle impostazioni (ricarica una volta). Cambiarla in Generale → Lingua offre «Riavvia ora» (`restart_app`); Rust cambia subito.
- `scripts/check-i18n.mjs` (dentro `npm run build`) trova ogni `t("…")`/`tn`/`N_` nel TypeScript e `t`/`tf` nei file Rust che usano `crate::i18n`, e fallisce se manca l'inglese. Restano in italiano di proposito: i messaggi del relay (`hook/`, salvo «Chiede un permesso nel terminale», tradotto nell'isola), le descrizioni degli strumenti e le risposte per il modello (`agent.rs`, `mcp.rs`), le etichette di «Copia info PC».
- Giorni e mesi abbreviati in Rust non passano dal dizionario («mar» è sia martedì sia marzo): tabelle inglesi accanto a quelle italiane (`calendar.rs`, `usage.rs`).

## Suoni
- I 28 suoni sono sintetizzati in `src/core/synth.ts` e riprodotti da `src/core/sound.ts`. Si ascoltano in `dev/sounds-preview.html`. Il volume di ciascuno è tarato sul WAV originale che ha sostituito.

## Coerenza visiva
Animazioni, tempi e viste vengono dal prototipo originale di Coucou (storia git). Sono specifici di EasyIsland l'aspetto dei personaggi, l'icona dell'app e le opzioni di posizione elencate sopra.
