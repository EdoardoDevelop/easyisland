# Handoff — EasyIsland

_Aggiornato al 9 ottobre 2026. Versione **0.6.4** in `main` con il tag `v0.6.4` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat, isola grande fino ai bordi e posizione dell'isola aperta; menu col clic destro sul personaggio a riposo, angoli dell'isola aperta trascinata. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **Funzione chiesta da Edoardo:** cartella trascinata nella chat (`docs/idee.md`).
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

### 9 ottobre 2026 — menu col clic destro sul personaggio a riposo, angoli dell'isola staccata
- Clic destro sull'icona a riposo: lo stesso menu dell'area di notifica (Apri, Profilo, Riepilogo, Davanti al cliente, Impostazioni, Pausa, Esci) dove sta il cursore (`show_island_menu` in `lib.rs`, `tray::popup`). Le voci passano dallo stesso gestore del menu dell'area di notifica.
- La finestra a riposo non prende il fuoco (`WS_EX_NOACTIVATE`): per la durata del menu lo prende, sennò un clic fuori non lo chiude. Da provare dal vivo.
- **Angoli:** l'isola aperta trascinata via dal bordo restava squadrata verso il bordo; ora `end_drag` restituisce lo spostamento (agganciato entro 16 px, riportato dentro lo schermo) e gli angoli si arrotondano. Mentre la si trascina, in ogni stato, è arrotondata tutta.

### 9 ottobre 2026 — versione 0.6.4: Goccia predefinita, cronologia delle chat, isola grande, dove si apre
- **Goccia** è il personaggio predefinito (nuove installazioni; chi ne aveva scelto uno lo tiene). README con schermate nuove (`node scripts/screenshots.mjs`, aggiunte `chat-history`, `agenti`, `recap`), sezione Novità e tabella delle versioni.
- **Cronologia delle chat** (`chat_log.rs`, orologio in alto nella chat): fino a 100 conversazioni in `chats.json`, riaperte sul loro motore. Claude Code e opencode ricevono la conversazione di prima come testo. Si spegne e si cancella in Impostazioni → Chat.
- **Isola fino ai bordi dello schermo:** la finestra non è più fissa a 720×560 ma segue la misura scelta (`set_panel_size`, limiti da `panel_limits`).
- **«L'isola si apre»** (Posizione e aspetto): dove sta il personaggio, oppure in alto, al centro o in basso nello schermo (`islandPlace`). Provato nell'anteprima; la finestra vera si sposta solo nell'app.
- Testi rimasti in italiano tradotti (motore «abbonamento», «Pannello aperto», widget, Vassoio, errori degli hook). Il controllo delle traduzioni saltava il resto di un file Rust dopo il primo `#[cfg(test)]`.

### 9 ottobre 2026 — interfaccia in inglese, Ctrl+Space
- **Lingua** (Generale → Lingua: come Windows, italiano, inglese): 1.312 testi in `src/i18n/en.json`, condiviso da isola, impostazioni e Rust (menu, card delle integrazioni, errori). La chat risponde nella lingua scelta. Il cambio vale dal riavvio, offerto con «Riavvia ora». `npm run build` controlla che ogni testo abbia l'inglese. Provata nell'anteprima con `?lang=en`.
- **`Ctrl+Space` apre l'isola** di predefinito (schema 6: chi aveva ancora `Ctrl+Alt+Shift+M` passa a `Ctrl+Space`; una scorciatoia scelta a mano resta).

### 9 ottobre 2026 — prezzi dei modelli, limiti del piano, riepilogo settimanale
- **Modelli di opencode e OpenRouter:** «Carica modelli» dice gratuito, locale o a pagamento (dollari per milione di token), con «solo gratuiti» e il prezzo sotto il campo. opencode lo legge da `cost` di `/api/model`, OpenRouter da `pricing`.
- **Limiti del piano (Pro / Max)** nella card Consumo, presi da Coucou: il relay diventa la `statusLine` di Claude Code (`easyisland-hook statusline`), passa all'app solo `rate_limits` ed esegue la status line di prima, salvata in `statusline-previous.json`. Avviso dall'80 %.
- **Riepilogo settimanale** (`recap.rs`, `src/island/recap.ts`, preso da Coucou): il lunedì dalle 8 la settimana prima degli agenti; anche dal menu dell'area di notifica e da Impostazioni → Agenti. Prova: `/?scene=recap`. Manca l'immagine da condividere.

### 9 ottobre 2026 — versione 0.6.2: ricerca, Vassoio, azioni senza selezione
- **Barra di ricerca** in fondo all'isola aperta (`src/views/search.ts`, `start_apps.rs`): integrazioni, sessioni, azioni ⚡ e programmi del menu Start, anche dello Store. Si spegne in Posizione e aspetto. Provata nell'anteprima; i programmi veri solo nell'app installata.
- **Vassoio:** la puntina fissa un file, che resta dopo il riavvio e con «Svuota» (`inbox-kept.json`).
- **Cielo del Meteo dopo un avvio:** il primo giro dei controlli parte con l'app, spesso prima che l'isola ascolti `widget-update`, e il Meteo (ogni 15 min) restava senza cielo fino al giro dopo. Ora l'isola chiede gli ultimi risultati quando è pronta (`widget_results`, `catchUpWidgets`).
- **Fuoco nella barra di ricerca** quando apri tu l'isola; non per gli avvisi.
- **Azioni ⚡:** «Chiedi a Claude» ora è «Chiedi alla chat». Senza selezione o con appunti vuoti l'azione apre la chat con la domanda già scritta, invece di «Nessun testo selezionato in Browser».
