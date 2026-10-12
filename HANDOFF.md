# Handoff — EasyIsland

_Aggiornato al 12 ottobre 2026. Versione **0.7.3** in `main` con il tag `v0.7.3` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande; della 0.7.2 il personaggio della chat lasciato su una finestra; della 0.7.3 il piano letto da Anthropic, il tempo rimasto sui permessi e gli appunti rimessi per intero. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX team e chat:** fatti nel codice, da provare sul centralino vero (`docs/prove-dal-vivo.md`). Se qualcosa non arriva, il log dice quali tipi di messaggio manda il centralino (`3cx: event type …`).
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

### 12 ottobre 2026 — versione 0.7.3
- Unione in `main` e tag `v0.7.3`: limiti del piano chiesti ad Anthropic e mostrati nell'intestazione, tempo rimasto sui permessi, appunti rimessi in tutti i formati (voce sotto). README con novità e tabella delle versioni.

### 12 ottobre 2026 — piano da Anthropic, tempo sui permessi, appunti interi
- I limiti del piano arrivano anche usando solo l'app desktop di Claude: la card Consumo li chiede ad Anthropic con l'accesso di Claude Code (`ask_anthropic` in `usage.rs`; decisione del 9 ottobre cambiata con Edoardo, `docs/decisioni.md`), con la settimana Opus, e li mostra anche nell'intestazione dell'isola. Provato dal vivo (risposta vera) e nell'anteprima (scena `usage`).
- Le card del permesso e della domanda dicono quanto manca ai 108 s (scena `approval`). Copia della selezione e «Sostituisci» rimettono gli appunti in tutti i formati: provati dal vivo testo, file e immagine (test `clipboard_round_trip`).

### 11 ottobre 2026 — versione 0.7.2
- Unione in `main` e tag `v0.7.2`: il personaggio della chat trascinato su una finestra la allega come contesto, con la faccia che cambia mentre lo porti (voce sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — il personaggio della chat allega una finestra
- Nella scheda Chat il personaggio si trascina su una finestra di un'altra app: al rilascio ne prende un'immagine (`PrintWindow`), con app e titolo, e la allega alla chat come contesto per tutti i motori (`window_drop.rs`, `ChatContext::Window` con `image`, `docs/strumenti.md`). Funzione di Coucou che mancava. Mentre lo porti il personaggio segue il puntatore in una finestra sua (`carry.rs`) e cambia faccia: sorpreso, contento sopra una finestra, cuori al rilascio. Provati nell'anteprima chip, ✕ e rilascio sull'isola (scene `chat&window`, `chat&pick`) e dal vivo la cattura nativa (test `live`); il gesto intero è da provare (`docs/prove-dal-vivo.md`).

### 11 ottobre 2026 — versione 0.7.1
- Unione in `main` e tag `v0.7.1`: 3CX con team, chat, segreteria, code, trasferimento e deviazione; cielo del Meteo grande dietro il personaggio; immagine di tutti i personaggi nel README (`dev/characters.html`). README con novità e tabella delle versioni.
