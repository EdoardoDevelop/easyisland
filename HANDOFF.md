# Handoff — EasyIsland

_Aggiornato all'11 ottobre 2026. Versione **0.7.1** in `main` con il tag `v0.7.1` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata; della 0.7.1 team e chat di 3CX e il cielo grande. Tutte in `docs/prove-dal-vivo.md`.
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
- **Copia della selezione e «Sostituisci»:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo. «Sostituisci» incolla testo semplice: in Word e Outlook il pezzo sostituito perde grassetti e link interni.
- **Limiti del piano:** arrivano solo dalle sessioni che disegnano la status line (terminale, VS Code), non dall'app Claude. Servono gli hook di Claude Code aggiornati (Impostazioni → Agenti → «Aggiorna»).

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 11 ottobre 2026 — versione 0.7.1
- Unione in `main` e tag `v0.7.1`: 3CX con team, chat, segreteria, code, trasferimento e deviazione; cielo del Meteo grande dietro il personaggio; immagine di tutti i personaggi nel README (`dev/characters.html`). README con novità e tabella delle versioni.

### 11 ottobre 2026 — 3CX: team, chat, segreteria, code e trasferimento
- Con «Interno e password» la scheda 3CX ha Team (colleghi con lo stato in tempo reale, Chiama, Scrivi, Rispondi al suo posto), Chat (elenco, conversazione, invio, non letti, «sta scrivendo», avviso con suono e isola aperta), Segreteria (con trascrizione, «Ascolta» sul telefono), In coda / Fuori coda, Trasferisci e Devia. Protocollo ricavato dal web client del centralino di Edoardo (`myphone.rs`, `docs/integrazioni.md`). Provato con i test e nell'anteprima (scena `threecx`); dal vivo da provare.

### 11 ottobre 2026 — il cielo del Meteo in grande dietro il personaggio
- Sole, luna, nuvole, pioggia, neve e temporale sono circa il doppio e stanno dietro la testa, spostati a destra (`weather.ts`, `docs/architettura.md`). Gocce e fiocchi cadono solo sotto la nuvola, sole e luna più in basso perché i raggi non vengano tagliati, fulmine spostato fuori dal corpo. L'anteprima del personaggio mostra anche il cielo piccolo di prima, per confronto. Provato nell'anteprima e nella scena `meteo`.

### 11 ottobre 2026 — versione 0.7.0
- Unione in `main` e tag `v0.7.0`: Fiamma animata, Geco con bordo fine e sguardo fino all'orbita, Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova (voci sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova
- Dopo vari tentativi, Roccia, Magma e Pietra sono ricalcati dal foglio personaggi di Edoardo: contorno, occhi e zone di colore misurati sulle viste frontali e salvati come curve (`blobs.ts`, `docs/architettura.md`). Foglia (`leaf.ts`) ha la sagoma misurata sulla foglia di Edoardo, senza il ricciolo, e l'interno a sfumature continue. Contorni ammorbiditi e bordo fine. Confrontati affiancati all'originale e provati nell'anteprima con tutti gli stati.
