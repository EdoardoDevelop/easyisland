# Handoff — EasyIsland

_Aggiornato all'8 ottobre 2026. Versione **0.6.0** su `claude/sviluppo`: installata su questo PC, non ancora in `main` né taggata. In `main` c'è la 0.5.9, con il tag `v0.5.9` pubblicato. Repository pubblico `EdoardoDevelop/easyisland`._

Solo lo stato attuale. Come funziona il codice: `docs/` (indice in `CLAUDE.md`). Regola di aggiornamento: `CLAUDE.md` → Regole.

## Da fare
- [ ] **Unire la 0.6.0 in `main` e creare il tag `v0.6.0`**, con la conferma di Edoardo (`docs/sviluppo.md`).
- [ ] **Prove dal vivo:** prima di tutto opencode nell'app installata. Elenco completo in `docs/prove-dal-vivo.md`.
- [ ] **Funzioni chieste da Edoardo:** ricerca unica, ITA/ENG, cronologia delle chat, cartella trascinata nella chat (`docs/idee.md`).
- [ ] **3CX + Zammad:** ticket del cliente sulla chiamata in arrivo (`docs/idee.md`).
- [ ] **Remote Desktop Manager** come integrazione. Prima va capito dove sta la fonte dati (`docs/idee.md`).
- [ ] **Scheda esatta di Windows Terminal** per «Apri» (`docs/idee.md`).
- [ ] **opencode:** card per lo strumento `question`, indicazione gratuito/a pagamento nei modelli, controllo di Ollama/LM Studio nel menu (`docs/idee.md`).
- [ ] **Spunti da Coucou:** Amp/Hermes, limiti del piano dalla `statusLine`, card ripiegabile, riepilogo settimanale, GitHub (`docs/idee.md`).
- [ ] **Da decidere con Edoardo:** Vassoio permanente, nuovi personaggi, quali integrazioni tenere, firma del codice, tag `windows-latest` (`docs/idee.md`, `docs/decisioni.md`).

## Problemi noti
- **Sopra la barra:** cliccando la barra o aprendo Start il personaggio va dietro. Torna davanti a ogni cambio di finestra in primo piano. Va verificato con Start aperto.
- **Cattura una zona:** Esc nello Strumento di cattura non si vede, e la cattura annullata resta in ascolto fino a 60 s.
- **Copia della selezione:** un'immagine o dei file che erano negli appunti non vengono rimessi; si ripristina solo il testo.
- **Gestione credenziali molto piena:** con centinaia di voci, quelle con nomi lunghi vengono rifiutate (errore 8). Se il salvataggio di una chiave fallisce, eliminare voci vecchie.
- **Loghi mancanti:** Cal.com, Meteo, Rete, PC, Sicurezza, Appunti, Musica e Consumo usano ancora il pallino colorato (procedura in `docs/architettura.md`).
- **Goccia:** le pose della tavola (saluto, salto, caduta, onda) non sono fatte.
- **Claude Code su questo PC:** il login è scaduto (8 ottobre). Finché Edoardo non rifà `claude` → `/login`, la chat «Claude (abbonamento)» non risponde.
- **Cronologia di opencode:** restano 17 sessioni «Chat di EasyIsland» create dalle prove dell'8 ottobre. Si tolgono da opencode Desktop.
- **Hook di Claude Code da reinstallare** (Impostazioni → Agenti) per ricevere `PreCompact`.

## Registro
Al massimo 5 voci, la più recente in alto. Le più vecchie vanno in `docs/archivio/registro.md`.

### 8 ottobre 2026 — scena con due agenti
- `/?scene=agenti` in `dev/scenes.ts`: Claude Code e opencode (eventi come da `opencode_agent.rs`) nella scheda Agenti, con la barra dei pulsanti. `&claude` seleziona Claude Code. L'isola resta fissata.

### 8 ottobre 2026 — documentazione divisa in `docs/`
- `CLAUDE.md` diventa un indice con le regole. I dettagli sono in `docs/`. L'HANDOFF tiene solo lo stato. Archivio e registro vecchio sono in `docs/archivio/`.
- Tolto `OPTIMIZATIONS.md`: le sue segnalazioni (panici, rebuild per frame) non erano vere nel codice e la CPU non è un problema; le due pulizie reali sono in `docs/idee.md`.

### 8 ottobre 2026 — scheda Agenti per tutti gli agenti
- Gli eventi di opencode arrivavano, ma la scheda Agenti era legata a Claude: ora vale per ogni agente, con la barra dei pulsanti e «In attesa».
- «Apri opencode» porta a Desktop o al terminale, mai a VS Code. Ogni evento di opencode è nel log.
- Aperta: la prova dal vivo.

### 8 ottobre 2026 — «Claude e opencode non funzionano»
- Claude: il login di Claude Code su questo PC è scaduto; la chat ora lo spiega.
- opencode: mancava il modello salvato. Ora si salva mentre si scrive e un avviso lo segnala. Le sessioni di EasyIsland si cancellano da sole.

### 8 ottobre 2026 — opencode 2: motore della chat e agente dal servizio
- `opencode.rs` (server privato, permessi nell'isola) e `opencode_agent.rs` (segue il servizio in background). Il plugin resta solo per la 1.x. Dettagli in `docs/chat.md` e `docs/agenti.md`.

