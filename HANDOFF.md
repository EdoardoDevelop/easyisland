# Handoff — EasyIsland

_Aggiornato al 10 ottobre 2026. Versione **0.6.6** in `main` con il tag `v0.6.6` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Azioni ⚡:** valutare le azioni nel menu contestuale di Windows (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Da decidere con Edoardo:** nuovi personaggi (rimandati: le prove sono venute male), firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo.
- **Limiti del piano:** arrivano solo dalle sessioni che disegnano la status line (terminale, VS Code), non dall'app Claude. Servono gli hook di Claude Code aggiornati (Impostazioni → Agenti → «Aggiorna»).

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 10 ottobre 2026 — sessioni: «Continua», «Chiedi», card ripiegabile, «Sempre» di sessione
- **Card «finito»:** risposta in markdown e campo **«Continua»** (`session_reply.rs`): nel terminale scrive nella console della sessione (`easyisland-hook type`, provato con `cmd` e Python veri), in VS Code/Cursor precompila con il link dell'estensione, opencode lo riceve dal servizio.
- **«Chiedi a questa sessione»:** la chat interroga una copia in sola lettura (`--fork-session`, `session_ask` in `claude_cli.rs`); provato dal vivo con una mini-sessione.
- **Card del permesso ripiegabile** («Più tardi» o Esc) e **«Sempre» sempre presente**: senza proposta di Claude Code vale per la sessione e per ciò che si approva (`session_rule`, `docs/decisioni.md`). Anteprima: tutte le card provate; la console di Windows Terminal e VS Code sono da provare dal vivo.

### 10 ottobre 2026 — versione 0.6.6
- Unione in `main` e tag `v0.6.6`: saluto al centro, `Ctrl+Space` che chiude, Claude Code solo con i suoi hook, «Collega opencode», controlli dopo lo standby, passi della sessione (voci sotto). README con novità e tabella delle versioni.

### 10 ottobre 2026 — passi sovrapposti, controlli dopo lo standby
- **Card della sessione:** il passo completato (grigio) finiva una riga sotto, sopra quello in corso. Il testo grigio di ogni riga del ticker era assoluto senza `top` (`src/views/ticker.ts`); ora sta in alto e `.tick-text` è un blocco, così anche i puntini di troppo-lungo funzionano. Il passo con l'ultimo messaggio di Claude passa da `plainText` (ora in `src/core/markdown.ts`, come la card «ha finito»): niente `**`, corsivi, backtick né link in markdown.
- **Controlli e standby** (`widgets.rs`): un controllo che inizia a fallire si mostra solo se lo conferma un secondo controllo 15 s dopo. Dopo il risveglio (salto dell'orologio tra due giri dello scheduler) per 90 s i nuovi errori si riprovano soltanto; un controllo a cavallo dello standby si scarta. Vale per Rete e per ogni widget o integrazione-controllo.

### 10 ottobre 2026 — Claude Code facoltativo, saluto al centro, «Apri l'isola» chiude anche
- **Claude Code solo con i suoi hook:** senza hook installati niente card Claude Code. Con «Collega opencode» (prima «Segui opencode 2») la scheda Agenti parte da opencode «In attesa»; senza agenti la scheda non c'è. `hooksInstalled` lo scrivono solo `boot` e `hooks_apply` (il salvataggio delle Impostazioni non lo tocca più). Nell'anteprima del browser gli hook contano come installati (`?hooksInstalled=false` per provarne l'assenza).
- **Saluto all'avvio** al centro dello schermo di predefinito. In Posizione e aspetto: acceso/spento (`greeting`; spento, il personaggio compare al suo posto senza suono) e dove (`greetingPlace`: centro o dove sta il personaggio). La finestra va al centro con `set_expanded(…, place)` → `gate.open_place`, che vale solo per quell'apertura. Provato nell'anteprima; la finestra vera è da provare dal vivo.
- La scorciatoia «Apri l'isola» (`Ctrl+Space`) premuta con l'isola aperta la chiude (`onHotkey` in `island.ts`). Con una richiesta in attesa resta sulla card, come con Esc o il clic fuori (`collapse`).

### 9 ottobre 2026 — versione 0.6.5
- Unione in `main` e tag `v0.6.5`: cartella nella chat, menu col clic destro, saluto senza isola, `Ctrl+Space` sulla Panoramica, angoli dell'isola staccata (voci sotto). README con novità e tabella delle versioni.
