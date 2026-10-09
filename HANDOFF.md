# Handoff — EasyIsland

_Aggiornato al 9 ottobre 2026. Versione **0.6.0** in `main` con il tag `v0.6.0` (la CI pubblica l'installer), installata su questo PC. Si lavora su `claude/sviluppo`. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Prove dal vivo:** opencode, 3CX, Claude Code, gli altri agenti, Outlook, Zammad, Vassoio, schermi secondari e cielo del Meteo sono provati (9 ottobre). Quelle che restano sono in `docs/prove-dal-vivo.md`.
- [ ] **Funzioni chieste da Edoardo:** ricerca unica, ITA/ENG, cronologia delle chat, cartella trascinata nella chat (`docs/idee.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Azioni ⚡:**
  - «Chiedi a Claude» diventa «Chiedi alla chat», perché il motore può essere un altro (impostazioni delle azioni, Vassoio, Appunti, Cattura).
  - Un'azione lanciata senza selezione non deve fermarsi con «Nessun testo selezionato in Browser»: deve funzionare con qualsiasi testo e senza legarsi al Browser (`selectedText` in `island.ts`).
  - Valutare le azioni nel menu contestuale di Windows (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question` anche nella chat (per l'agente c'è), indicazione gratuito/a pagamento nei modelli, controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti del piano dalla `statusLine`, card ripiegabile, riepilogo settimanale, GitHub (`docs/idee.md`).
- [ ] **Da decidere con Edoardo:** Vassoio permanente, nuovi personaggi (rimandati: le prove sono venute male), quali integrazioni tenere, firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo.
- **Gestione credenziali molto piena:** con centinaia di voci, quelle con nomi lunghi vengono rifiutate (errore 8). Se il salvataggio di una chiave fallisce, eliminare voci vecchie.
- **Loghi mancanti:** Cal.com, Rete, Stato del PC e Sicurezza usano ancora il pallino colorato (procedura in `docs/architettura.md`). Meteo, Appunti, Musica e Consumo mostrano l'icona della loro scheda.
- **Claude Code su questo PC:** il login è scaduto (8 ottobre). Finché Edoardo non rifà `claude` → `/login`, la chat «Claude (abbonamento)» non risponde.
- **Cronologia di opencode:** restano 17 sessioni «Chat di EasyIsland» create dalle prove dell'8 ottobre. Si tolgono da opencode Desktop.
- **Hook di Claude Code da reinstallare** (Impostazioni → Agenti) per ricevere `PreCompact`.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 8 ottobre 2026 — cielo del Meteo sul personaggio
- Le «gocce che salgono» erano il sudore dello stato `ratelimit`, che il Meteo usava per la pioggia probabile. Ora il sudore cade lungo la testa.
- Il Meteo manda il tipo di cielo (`sky_kind` in `probes.rs`). Il personaggio lo porta sopra la testa (`character/weather.ts`) sulla pillola Meteo e, con «Cielo sul personaggio: anche quando è inattivo», da inattivo. Prova: `/?scene=meteo`, provato dal vivo il 9 ottobre.
- Nelle pillole e nella Panoramica, Meteo, Appunti, Musica e Consumo mostrano l'icona della loro scheda al posto del pallino.

### 8 ottobre 2026 — domande di opencode nell'isola
- «EasyIsland dice fallito»: il modello aveva chiamato `question` con argomenti sbagliati, poi ha riprovato e opencode aspettava la risposta, invisibile nell'isola.
- Ora le domande di opencode 2 (form) sono la card «ask» e si risponde dall'isola; lo step di errore dice strumento e motivo. Aperta: la prova dal vivo.

### 8 ottobre 2026 — scena con due agenti
- `/?scene=agenti` in `dev/scenes.ts`: Claude Code e opencode (eventi come da `opencode_agent.rs`) nella scheda Agenti, con la barra dei pulsanti. `&claude` seleziona Claude Code. L'isola resta fissata.

### 8 ottobre 2026 — documentazione divisa in `docs/`
- `CLAUDE.md` diventa un indice con le regole. I dettagli sono in `docs/`. L'HANDOFF tiene solo lo stato. Archivio e registro vecchio sono in `docs/archivio/`.
- Tolto `OPTIMIZATIONS.md`: le sue segnalazioni (panici, rebuild per frame) non erano vere nel codice e la CPU non è un problema; le due pulizie reali sono in `docs/idee.md`.

### 8 ottobre 2026 — scheda Agenti per tutti gli agenti
- Gli eventi di opencode arrivavano, ma la scheda Agenti era legata a Claude: ora vale per ogni agente, con la barra dei pulsanti e «In attesa».
- «Apri opencode» porta a Desktop o al terminale, mai a VS Code. Ogni evento di opencode è nel log.
- Aperta: la prova dal vivo.
