# Handoff — EasyIsland

_Aggiornato al 10 ottobre 2026. Versione **0.6.7** in `main` con il tag `v0.6.7` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra. Tutte in `docs/prove-dal-vivo.md`.
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

### 10 ottobre 2026 — scatti dell'isola con il contenuto che scorre
- Aprendo l'isola o trascinandone l'angolo, una vista con barra di scorrimento faceva scattare l'altezza: il contenuto si reimpaginava a ogni fotogramma con la larghezza che si animava. Ora è impaginato subito alla larghezza finale (`--view-w`, `animateGeometry`; `docs/architettura.md`). Riprodotto nell'anteprima facendo avanzare i fotogrammi a mano: prima l'altezza misurata passava da 336 a 271 a metà apertura, ora resta 271.

### 10 ottobre 2026 — versione 0.6.7
- Unione in `main` e tag `v0.6.7`: markdown e «Continua» sulla card «finito», «Chiedi a questa sessione», «Più tardi» sul permesso, «Sempre» di sessione, 📌 come finestra normale (voci sotto). README con novità e tabella delle versioni.

### 10 ottobre 2026 — 📌 «Tieni aperta» come finestra normale
- Con il 📌 l'isola aperta ha l'icona nella barra e in Alt+Tab, non è più sempre in primo piano, si riduce con un clic sull'icona; un permesso fa solo lampeggiare l'icona. Togliendo il 📌 o chiudendo torna com'era (`set_app_mode`, `flash_if_behind` in `island.rs`, `docs/architettura.md`). Compila e passa i test; il comportamento della finestra è da provare dal vivo.

### 10 ottobre 2026 — sessioni: «Continua», «Chiedi», card ripiegabile, «Sempre» di sessione
- **Card «finito»:** risposta in markdown e campo **«Continua»** (`session_reply.rs`): nel terminale scrive nella console della sessione (`easyisland-hook type`, provato con `cmd` e Python veri), in VS Code/Cursor precompila con il link dell'estensione, opencode lo riceve dal servizio.
- **«Chiedi a questa sessione»:** la chat interroga una copia in sola lettura (`--fork-session`, `session_ask` in `claude_cli.rs`); provato dal vivo con una mini-sessione.
- **Card del permesso ripiegabile** («Più tardi» o Esc) e **«Sempre» sempre presente**: senza proposta di Claude Code vale per la sessione e per ciò che si approva (`session_rule`, `docs/decisioni.md`). Anteprima: tutte le card provate; la console di Windows Terminal e VS Code sono da provare dal vivo.

### 10 ottobre 2026 — versione 0.6.6
- Unione in `main` e tag `v0.6.6`: saluto al centro, `Ctrl+Space` che chiude, Claude Code solo con i suoi hook, «Collega opencode», controlli dopo lo standby, passi della sessione (voci sotto). README con novità e tabella delle versioni.
