# EasyIsland (Windows) — guida per gli agenti AI

App Windows 10/11: un personaggio animato in un'isola in alto mostra le sessioni di Claude Code e altri agenti, la chat con vari motori e le integrazioni; permette di approvare, rispondere, rilasciare file. TypeScript senza framework (Canvas 2D) in `src/`, Rust/Tauri 2 in `src-tauri/`, relay degli hook in `hook/`.

**Lingua: italiano** per interfaccia, errori per l'utente, documentazione, commit. Identificatori e commenti nel codice in inglese.

**i18n:** ogni testo visibile passa da `t("testo italiano")` (TS `src/core/i18n.ts`; Rust `crate::i18n::t` / `tf("… {nome} …", &[("nome", &x)])`), inglese in `src/i18n/en.json` con chiave = italiano. `npm run build` si ferma se ne manca uno (`npm run check:i18n -- --todo`).

## Dove leggere (solo ciò che serve)
- `HANDOFF.md`: stato, da fare, problemi. Leggilo a inizio lavoro.
- `docs/architettura.md`: cartelle, interfaccia, personaggi, layout, suoni, impostazioni, robustezza.
- `docs/chat.md`: motori, opencode, MCP, agente sul PC, Compiti, Abilità, memoria, documenti Word e PDF.
- `docs/agenti.md`: hook e relay, Claude Code, Codex/Gemini/Cursor/Copilot, opencode agente, scheda Agenti.
- `docs/integrazioni.md`: integrazioni, widget, 3CX, consumo, profili, azioni rapide, automazioni, integrazioni personali.
- `docs/strumenti.md`: file rilasciati, Vassoio, appunti, musica, contesto ⚡, ZIP, cattura, calcolatrice.
- `docs/sviluppo.md`: build, test, anteprime, installazione qui, rilascio.
- `docs/anteprima-browser.md`: query string di `npm run dev`.
- `docs/decisioni.md`: decisioni ed esclusioni; controllalo prima di proporre una funzione.
- `docs/idee.md`: progetti non fatti. `docs/prove-dal-vivo.md`: cosa provare con i servizi veri.
- `docs/guida/` (+ `en/`): guida utente, una pagina per argomento → `site/guida/` con `node scripts/guida.mjs`. Se cambia una funzione visibile, aggiorna la pagina e rigenera.
- `README.md` (EN, principale), `README.it.md`, `site/index.html` (EN), `site/it/index.html`, `docs/en/`, `CONTRIBUTING.en.md`: aggiornali insieme a ciò che descrivono.
- `docs/archivio/`: storia vecchia ("HANDOFF 6.6, point …" nei commenti). **Non leggerla** se non serve.

## Build
```
npm install
npm run tauri dev   # sviluppo
npm run build       # typecheck + front end (anche Linux/macOS)
npm run pack        # installer NSIS in release/
```
Rust solo su Windows (MSVC). Test: `cargo test --workspace` in `src-tauri/`.

## Regole
- **Documentazione:** a fine lavoro aggiorna `HANDOFF.md` (stato, Da fare, Problemi noti, voce di 2–4 righe in cima al Registro, max 5 voci; le vecchie in `docs/archivio/registro.md`) e il file di `docs/` dell'area cambiata. Scrivi dove stanno le cose, perché e i vincoli, non il codice. Stile asciutto.
- Nessuna nuova dipendenza se non inevitabile. Personaggi, icone, suoni disegnati/sintetizzati nel codice: niente Rive, Lottie, immagini, audio.
- Segreti solo in Gestione credenziali di Windows, mai su disco, UI o git; il front end chiede solo se una chiave esiste.
- Nessuna telemetria. Rete solo verso servizi configurati dall'utente e controllo aggiornamenti GitHub (`updates.rs`, disattivabile). Aggiornamenti solo dopo un clic, firma verificata; chiave privata mai nel repo.
- Mai bloccare un agente: se l'app non risponde entro il timeout, l'hook esce con 0.
- Mai sovrascrivere `%USERPROFILE%\.claude\settings.json` né le configurazioni degli altri agenti: backup datato, unione, diff, scrittura dopo conferma.
- Mai inviare email o approvare permessi senza clic esplicito. Eccezioni di Edoardo: «Automatica» di Telegram (chiede comunque per le cancellazioni); «Autonomi» di Agent Chat (2/11/2026: nessuna domanda; con la scelta «chat» chiede all'owner «sì/no codice» per eliminare, inviare a nome dell'utente, cambiare il sistema, PC remoto; `docs/integrazioni.md`).
  - Gli strumenti di `agent.rs` non eseguono comandi arbitrari, non inviano email, non eliminano; eccezioni: `notion_delete_row` (cestino di Notion dopo il sì in chat), `quick_action_delete` (Consenti/Nega) e `remote_run` (solo sul PC di «Accesso remoto», Consenti/Nega per comando, password solo in memoria).
  - Integrazioni personali (`custom.rs`): descrizioni e azioni da elenco fisso. Unica azione con codice `script` (Edoardo, 7/11/2026): comandi mostrati e clic su «Esegui» a ogni pressione, valori della scheda solo in un JSON (`EASYISLAND_SCHEDA`), mai nel testo, mai da `custom_call`.
  - Devolutions Cloud (`dvc.rs`): password solo negli appunti privati (svuotati dopo 30 s), mai a schermo, nel log o ai motori; dalla chat la password si chiede solo nella finestra di Windows (CredUI); scritture solo dopo anteprima e clic (o Consenti), rilette e verificate; mai eliminazioni.
  - `memory_note` scrive senza chiedere solo nella memoria della chat (`memory.rs`, .md visibili all'utente).
  - Comandi e modifiche ai file solo dalla «Modalità terminale» (strumenti di Claude Code/opencode, Consenti/Nega nell'isola).
    - Come Claude Desktop (8/11/2026): «Sempre» cliccato su una card di Claude Code vale per tutta la sessione (`permits::SESSION_RULES`, solo quella regola), e le modalità «Accetta modifiche» e «Piano» si scelgono a mano per la conversazione. Il «Terminale» della chat (`terminal.rs`) esegue solo ciò che scrive l'utente, mai i motori.
  - Senza clic passano solo le azioni reversibili consentite per sempre o per compito (`permits.rs`, `REVERSIBLE` in `hook/src/tool_list.rs`), registrate in «Cosa ho fatto» con Annulla: mai aggiungere lì strumenti che inviano, eliminano, aprono o eseguono.
- Isola ritirata: nessun frame di animazione, CPU ~0 %.
- Versione uguale in `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (la CI controlla sui tag).
- Mai cambiare `identifier` in `tauri.conf.json` (sposta dati e credenziali).
- Servizio a istanza singola = **integrazione**, mai widget.
- **Stabilità:** prima di un rilascio e dopo modifiche a hook, viste, integrazioni: `npm run smoke` con `npm run dev` acceso deve dire «nessun errore» (~2,5 min; durante il lavoro `npm run smoke:rapido` o `node scripts/smoke.mjs <scene>`). In Rust niente `[a..b]` o indici su dati esterni (usa `get`): un panic in release chiude l'app (`docs/architettura.md` → Robustezza).
- Modifiche visive coerenti con l'aspetto attuale (`screenshots/`, `dev/scenes.ts`).
