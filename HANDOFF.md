# Handoff — EasyIsland

_Aggiornato all'11 ottobre 2026. Versione **0.7.0** in `main` con il tag `v0.7.0` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 e 0.7.0 i nuovi personaggi e la Fiamma animata. Tutte in `docs/prove-dal-vivo.md`.
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

### 11 ottobre 2026 — versione 0.7.0
- Unione in `main` e tag `v0.7.0`: Fiamma animata, Geco con bordo fine e sguardo fino all'orbita, Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova (voci sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — Roccia, Magma e Pietra dal foglio personaggi, Foglia nuova
- Dopo vari tentativi, Roccia, Magma e Pietra sono ricalcati dal foglio personaggi di Edoardo: contorno, occhi e zone di colore misurati sulle viste frontali e salvati come curve (`blobs.ts`, `docs/architettura.md`). Foglia (`leaf.ts`) ha la sagoma misurata sulla foglia di Edoardo, senza il ricciolo, e l'interno a sfumature continue. Contorni ammorbiditi e bordo fine. Confrontati affiancati all'originale e provati nell'anteprima con tutti gli stati.

### 11 ottobre 2026 — Geco: bordo più fine e sguardo fino all'orbita
- Contorno visibile circa la metà di prima. Guardando il mouse la pupilla va dalla posizione di riposo fino al bordo del globo dalla parte del mouse, in orizzontale e in verticale (`GAZE` in `gecko.ts`); prima ne seguiva solo il 35 % e restava quasi ferma. Provato nell'anteprima con lo sguardo simulato nelle quattro direzioni.

### 11 ottobre 2026 — la Fiamma si muove
- La Fiamma ondeggia e tremola di continuo: la punta si muove di più, la base resta ferma, gli strati interni seguono con un ritardo e le scintille salgono (`flame.ts`). Nuovo campo `animated` nel contratto dei personaggi: tiene vivo il ciclo a 30 fps solo a isola visibile (`engine.busy`; `docs/architettura.md`). Provato nell'anteprima; CPU a isola ritirata da verificare dal vivo.

### 11 ottobre 2026 — versione 0.6.9
- Unione in `main` e tag `v0.6.9`: sei nuovi personaggi, Geco, Fiamma, Magma, Pietra, Roccia e Foglia (voce sotto). README con novità, elenco dei personaggi e tabella delle versioni.
