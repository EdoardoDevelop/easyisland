# PIANO: Dock al posto della barra di Windows + Top bar (versione 1.1.0) — rivisto dopo lo studio del progetto di riferimento

Piano di tre agenti (PRINCIPALE, EASYTECH, Antigravity), dettagli nei loro file di lavoro fuori dal repo. Codice di riferimento: un progetto di dock per Windows con licenza MIT, copia locale fuori dal repo, solo lettura; «loro» qui sotto è quel progetto. Le parti copiate portano la sua nota di copyright in LICENSE (sezione terze parti); il nome non va nel codice, nei commenti, nei docs, nei commit.

## Decisioni
- **Barra fissa → «Top bar», solo in alto.** `fixedBar: "bottom"` diventa `top` e accende la Dock.
- **Dock in basso**, finestra sua (`dock`) nella stessa WebView2, creata solo se accesa. Capsula sospesa (di serie) o fascia piena. Finestra **ad altezza fissa** (ingrandimento + etichette + ombra), appbar fissa sulla fascia a riposo, clic passanti fuori dalla capsula: mai ridimensionamenti dal vivo.
- **Grafica nostra (WebView, 5 stili, chiaro/scuro)**; dal progetto di riferimento prendiamo la parte Windows, la matematica dell'ingrandimento, i tempi e le trappole.
- **Barra di Windows spenta solo con l'interruttore** e rimessa sempre. Metodo provato: auto-nascondi + barra invisibile con clic passanti (non `SW_HIDE`, Windows 11 la rimostra). Guardiano che controlla anche che l'app risponda.
- **Area notifiche:** niente finta `Shell_TrayWnd`. La freccia `^` apre il riquadro delle icone nascoste di Windows (Win+B, Invio) e lo sposta sotto la freccia. Le icone sempre in vista di Windows non le mostriamo.
- **Pulsanti di sistema = scorciatoie di Windows:** Start (Win), impostazioni rapide (Win+A), notifiche e calendario (Win+N), cerca (Win+S), attività (Win+Tab), widget (Win+W), uscita audio (Win+Ctrl+V), Mostra desktop (Win+D). Con un'app da amministratore davanti la Dock prende prima il fuoco, poi preme i tasti.
- **Un solo catalogo** (`barkinds.ts`, `target` top/dock/both), editor solo in Impostazioni, «Sposta nell'altra barra». Nuovi elementi `sys:apps`, `start`, `systray`, `notifications`, `showdesktop`, `taskview`, `privacy`, `tray`; Wi-Fi in `net`, mixer in `volume`.
- **Effetto «genio» sì** (Edoardo, 19/11): la finestra si riduce nella sua icona della Dock e ne esce al ripristino. Scelta in Impostazioni → Dock, con «Spento». Come loro: mentre è acceso si spengono le transizioni di Windows sulle finestre seguite (`DWMWA_TRANSITIONS_FORCEDISABLED`) e il guardiano le **rimette** se l'app esce o si blocca; animazione disegnata sopra la finestra con la miniatura DWM presa mentre si riduce (`flight.rs`, `genie.rs`). Da provare nella fase 0 sul portatile (CPU, scatti).
- **Non faremo:** anteprime delle finestre ridotte (Windows 11 non le dà: icona grande + titolo), barre di avanzamento e badge, Win+1…9 propri (importiamo le fissate di Windows così coincidono), elenco Wi-Fi/Bluetooth nostro (Win+A), numero delle notifiche di Windows.
- **CPU a riposo ~0:** eventi solo come segnale + rilettura dopo 40 ms; niente eventi di titolo; audio, rete, musica, privacy a eventi (sostituiscono le letture ogni 2 s di `barsys.rs` e `media.rs`).
- **Avvii e operazioni sui file fuori processo:** `easyisland-hook.exe avvia` (JSON su stdin, `AllowSetForegroundWindow`, stderr ereditato, nessun proprietario): lo shell lento non blocca mai la Dock.

## Fasi
| Fase | Cosa | Chi | Rilascio |
|---|---|---|---|
| 0 | **Prototipo (1 giorno):** barra di Windows invisibile e ritorno su 23H2/24H2; Start, Win+N, Win+A, Win+B con la barra invisibile; anteprima DWM sopra una WebView o in un popup nativo; finestre da amministratore | PRINCIPALE + EASYTECH | no |
| 1 | **Top bar:** nome, solo in alto, migrazione, docs | Antigravity + PRINCIPALE | con la 2 |
| 2 | **Dock accanto alla barra di Windows:** `taskwin.rs` (finestre, gruppi per AUMID, porta davanti/riduci/chiudi con la sequenza provata), `applist.rs` (fissate importate e sincronizzate da Windows, icone con cache su disco, avvio dal relay, app dello Store), pulsanti-scorciatoia, rete/audio/privacy a eventi; finestra Dock, ingrandimento, puntini, menu, riordino, file sulle icone, nascondi da sola; editor | EASYTECH + Antigravity + PRINCIPALE (`appbar.rs` a due barre, finestra `dock`, relay `avvia`) | 1.1.0-beta |
| 3 | **Spegnere la barra di Windows:** `taskbar_hide.rs`, guardiano `easyisland-hook guardia-barra`, ripristino all'avvio, all'uscita, da comando e nell'uninstaller; freccia delle icone nascoste | PRINCIPALE | **1.1.0** |
| 4 | **Come la barra di Windows:** effetto «genio», anteprime, recenti nel menu, spring-load, «chiede attenzione», mixer per app, lingua, musica a eventi, gruppi di fissate e cartella scorciatoie | EASYTECH + Antigravity | 1.1.x |
| — | Solo se lo chiedi: Wi-Fi/Bluetooth nostri, notifiche lette, avanzamento e badge, Dock per ogni schermo | — | — |

## Interfaccia Rust ↔ Dock
- Eventi: `dock-windows` `{ add, change, remove }`, `Win = { hwnd, app, title, icon, active, minimized, attention, lastUsed }`; `dock-icons` `{ chiave: dataURL }` (icone grandi, una volta per app); `dock-covered`.
- Comandi: `dock_windows()`, `dock_do(what, hwnd?, app?, files?)`, `dock_recent(app)`, `dock_thumbs([{hwnd,x,y,w,h}])`, `apps_catalog()`.
- `bars::emit` manda gli eventi di sistema a ogni barra accesa e all'isola.

## Cosa copiamo (loro → nostro)
- PRINCIPALE: `taskbar.rs` → `taskbar_hide.rs`; `guard.rs` → relay `guardia-barra`; tentativi della presa (`app.rs`) → `taskbar_hide.rs`; `launcher.rs` `toggle_hidden_icons` → elemento `systray`.
- EASYTECH: `tracker.rs`, `launcher.rs`, `pins.rs`, `icons.rs`+`icon_cache.rs`, `shell_work.rs` (nel relay), `status.rs`, `watch.rs` → `regwatch.rs`, `keyboard.rs`; `media.rs` riscritto a eventi.
- Antigravity + EASYTECH: `genie.rs` (curva) e `flight.rs` (finestra del volo, transizioni, cattura) → `genie.rs`/`src/dock/genie.ts`. Antigravity: `magnify.rs`+`layout.rs` → `src/dock/magnify.ts` con test; `roster.rs` → logica fissate/gruppi/recenti (Rust); costanti e macchine a stati di `app.rs`/`edge_watch.rs` (ingrandimento, anteprima dopo 420 ms, spring-load 600 ms, bordo 2 px, nascondi 250/150 ms); ripiego opaco con risparmio energia e «riduci trasparenza».

## Trappole da evitare (dai loro CHANGELOG)
Finestra ridotta che risulta ancora «davanti» (il clic la ripristina, non la riduce); ripristino e fuoco separati; titoli che cambiano consumano CPU; finestre nascoste a tutto schermo all'accesso non sono un gioco; explorer non pronto all'avvio (riprovare, mai salvare uno stato falso, un elenco di fissate illeggibile non vuol dire «nessuna»); shell lento fuori dal thread della Dock; mouse letto al clic, non dall'ultimo movimento; trascinamenti con finestra senza fuoco (controllare il tasto vero); menu chiuso = azzerare ingrandimento e nascondi da sola; antivirus (niente processi nascosti strani).

## File
- **PRINCIPALE:** `appbar.rs`, `taskbar_hide.rs`, relay (`guardia-barra`, `ripristina-barra`, `avvia`), uninstaller NSIS, finestra `dock` e registrazioni in `lib.rs`, migrazione in `settings.rs`, LICENSE, unioni.
- **EASYTECH:** `taskwin.rs`, `applist.rs`, `thumbs.rs`, `regwatch.rs`, `barsys.rs`, `media.rs`, dati delle voci in `barkinds.ts`, card di sistema in `barcard.ts`.
- **Antigravity:** `dock.html`, `src/dock/*` (con `magnify.ts`), `personaggio.html`/`character-window`, editor in `settings/main.ts`, `pictures.ts`, CSS.
- **In comune:** `bridge.ts` (in fondo, una riga per comando), `state.ts`/`settings.rs` (PRENDO nel canale).

## Da documentare all'avvio
`docs/decisioni.md` (Top bar solo in alto; barra di Windows sostituibile su scelta), `docs/idee.md` (systray e barra sostitutiva non più esclusi), `docs/architettura.md` → Barra fissa/Dock, guida (pagina «Dock»), LICENSE.
