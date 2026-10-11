# Handoff — EasyIsland

_Aggiornato all'11 ottobre 2026. Versione **0.6.9** in `main` con il tag `v0.6.9` (la CI pubblica l'installer). Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** della 0.6.3 interfaccia in inglese, limiti del piano, card «finito» da un altro programma e riepilogo settimanale; della 0.6.4 cronologia delle chat; della 0.6.5 il personaggio lasciato su un'icona del desktop; della 0.6.6 saluto al centro, Claude Code assente sul notebook e standby con la Rete; della 0.6.7 «Continua», «Chiedi», «Sempre» di sessione e 📌 come finestra; della 0.6.8 menu con `Win+Alt+A`, «Sostituisci» e reazioni del personaggio; della 0.6.9 i nuovi personaggi. Tutte in `docs/prove-dal-vivo.md`.
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Clic destro in Esplora file:** voci di EasyIsland sui file («Manda a EasyIsland», azioni sui file), deciso con Edoardo l'11 ottobre come passo successivo al menu sulla selezione (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti di Codex, riepilogo condivisibile come immagine, GitHub (`docs/idee.md`).
- [ ] **Prova dal vivo dei nuovi personaggi** (`docs/prove-dal-vivo.md`) e verifica della provenienza dei disegni prima di distribuirli.
- [ ] **Da decidere con Edoardo:** firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione e «Sostituisci»:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo. «Sostituisci» incolla testo semplice: in Word e Outlook il pezzo sostituito perde grassetti e link interni.
- **Limiti del piano:** arrivano solo dalle sessioni che disegnano la status line (terminale, VS Code), non dall'app Claude. Servono gli hook di Claude Code aggiornati (Impostazioni → Agenti → «Aggiorna»).

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 11 ottobre 2026 — versione 0.6.9
- Unione in `main` e tag `v0.6.9`: sei nuovi personaggi, Geco, Fiamma, Magma, Pietra, Roccia e Foglia (voce sotto). README con novità, elenco dei personaggi e tabella delle versioni.

### 11 ottobre 2026 — nuovi personaggi: Geco, Fiamma e quattro gelatine
- `src/character/gecko.ts`: testa di geco con due cupole, grandi occhi ambrati e mento crema, ricalcata da un disegno di Edoardo (134×92 px) misurando contorno, occhi e macchie; in anteprima la differenza col disegno resta entro 1–2 px. Pupille che guardano dentro il globo, palpebra che scende nel battito, occhi chiusi sul verde, occhi dentro la scatola del rilascio file (`docs/architettura.md`). Provato in `dev/character-preview.html`, `upload-preview.html` e `greeting-preview.html`; dal vivo da provare.
- `src/character/flame.ts`: fiamma rossa con strati arancione e giallo, base scura, goccia e scintille, ricalcata allo stesso modo da un disegno ma con la faccia comune del motore.
- `src/character/blobs.ts`: Magma (crepe di lava), Pietra (blocchi d'ardesia e cristalli), Roccia (guscio di piastre) e Foglia (corona di foglie), gelatine tonde con le sfumature della Goccia, disegnate da zero nello stile di un'immagine di slime.

### 11 ottobre 2026 — versione 0.6.8
- Unione in `main` e tag `v0.6.8`: menu sul testo selezionato con `Win+Alt+A` (azioni rapide con icone e cartelle), «Sostituisci» con anteprima, «Lavora su» nell'editor delle azioni, reazioni del personaggio, isola senza salti d'altezza (voci sotto). README con novità e tabella delle versioni.

### 11 ottobre 2026 — l'isola saltava scrivendo in «Continua»
- Sulla card «ha finito», con l'isola più alta della vista, ogni lettera faceva saltare il messaggio tra 150 e 267 px: `fitHeight` misurava il riquadro già allungato da `--extra-h`, e l'altezza tornava nel calcolo. Ora `measureFit` misura con `--extra-h` a 0; vale per tutte le viste (piano del permesso, modifiche, liste). Riprodotto e verificato con la scena `finished&islandHeight=440`.

### 11 ottobre 2026 — reazioni del personaggio
- Impostazioni → Notifiche → **Reazioni del personaggio**: per agente finito, in errore o al limite, e per ogni controllo o integrazione accesa (Rete, widget…) si sceglie «Si fa vedere e suona», «Cambia faccia, in silenzio» o «Resta tranquillo» (`settings.reactions`, nei profili; `docs/architettura.md`). Nato dal notebook con la rete instabile che faceva lamentare il personaggio. Logica provata nell'anteprima; dal vivo da provare.
