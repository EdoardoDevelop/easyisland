# Handoff — EasyIsland

_Aggiornato al 12 ottobre 2026. Versione **0.7.5** in `main` con il tag `v0.7.5` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero; della 0.7.4 l'isola che non si chiude trascinando il personaggio della chat; della 0.7.5 «Questo PC» di 3CX con audio e suoneria e l'avvio dopo un aggiornamento su un altro PC. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
- [ ] **3CX «Questo PC»:** telefono WebRTC nell'isola, suoneria e scheda da telefono fatti nel codice e nell'anteprima; audio vero da provare sul centralino (`docs/prove-dal-vivo.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`).
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **«Sostituisci»** incolla testo semplice: in Word e Outlook il pezzo sostituito perde grassetti e link interni.
- **Limiti del piano da Anthropic:** l'indirizzo (`/api/oauth/usage`) non è documentato e può cambiare; se smette di rispondere il log scrive «limiti del piano da Anthropic: HTTP …» e restano i numeri della status line.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 12 ottobre 2026 — versione 0.7.5
- Unione in `main` e tag `v0.7.5`: 3CX «Questo PC» con suoneria e scheda da telefono, avvio sicuro dopo un aggiornamento (profilo WebView2) e dopo un riavvio del PC (timer senza `Instant - Duration`), campanella 3CX che cambia icona (voci sotto). README con novità e tabella delle versioni.

### 12 ottobre 2026 — EasyIsland che non partiva dopo un riavvio del PC
- Nelle prime ~6 ore dopo l'accensione l'app si chiudeva all'avvio: `habits.rs` e `automations.rs` calcolavano `Instant::now() - durata`, e su Windows l'`Instant` conta dall'accensione, quindi andava sotto zero (panic «overflow when subtracting duration from instant», visto nel log grazie all'hook dei panic). Ora i timer sono `Option<Instant>`; non usare mai `Instant - Duration` senza `checked_sub`. Provato qui 15 minuti dopo un riavvio.
- Campanella dell'intestazione 3CX che non cambiava icona: la card si ridisegna solo se cambia la sua chiave in `views.ts`, che ora include `threecxAlert` e `threecxRing`. Provato nell'anteprima (scena `threecx`).

### 12 ottobre 2026 — EasyIsland che non partiva dopo l'aggiornamento
- Su due PC la 0.7.4 si chiudeva al primo avvio dopo l'aggiornamento: i WebView2 della versione vecchia tenevano occupato il profilo (0x800700AA → panic nel setup). Ora l'avvio aspetta e chiude gli avanzi e, se serve, usa un profilo di riserva per quella volta (`webview_profile.rs`, `docs/sviluppo.md`); i panic finiscono nel log. Provato qui con tre aggiornamenti sopra un'istanza in esecuzione.

### 12 ottobre 2026 — 3CX: telefono nel PC, suoneria, scheda da telefono
- «Questo PC» tra i dispositivi della scheda 3CX: EasyIsland si registra come telefono WebRTC dell'interno, come il web client V20 (messaggi 163, 164/228, 227 ricavati dal suo codice, `myphone.rs`; audio in `src/core/softphone.ts`), con muto, toni e microfono concesso solo all'isola. Suoneria sintetizzata o file MP3/WAV/OGG/M4A dell'utente, silenziabile; avviso della chiamata nell'isola disattivabile (Impostazioni e intestazione della scheda). Scheda ridisegnata come un telefono: tastierino a sinistra, chiamate ed elenchi a destra, barra di icone Team/Chat/Segreteria/Recenti/Perse. Test Rust dei messaggi e anteprima (scena `threecx`); l'audio vero è da provare dal vivo (`docs/integrazioni.md`).

### 12 ottobre 2026 — versione 0.7.4
- Unione in `main` e tag `v0.7.4`. A isola chiusa il personaggio torna al suo colore (quello della scheda vale solo aperta, `drawBot`); trascinando il personaggio della chat l'isola tiene il mouse dalla pressione e il timer di chiusura ricontrolla quando scade (`fsm.ts`); schede e pulsanti dell'intestazione allargano l'isola aperta se non ci stanno (`measureHeader`, `openWidth`). Allargamento provato nell'anteprima; colore e trascinamento da provare dal vivo.
