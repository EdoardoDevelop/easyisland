# EasyIsland (Windows) — guida per gli agenti AI

App desktop per Windows 10/11: un personaggio animato (Goccia, Slime, Geco, Fiamma, una delle gelatine o Jarvis) in un'isola in alto sullo schermo mostra le sessioni di Claude Code e degli altri agenti, la chat con vari motori e le integrazioni, e permette di approvare, rispondere e rilasciare file. TypeScript senza framework (Canvas 2D) in `src/`, Rust con Tauri 2 in `src-tauri/`, relay degli hook in `hook/`.

**Lingua del progetto: italiano.** Testi dell'interfaccia, messaggi d'errore per l'utente, documentazione e commit sono in italiano. Identificatori e commenti nel codice restano in inglese.

**Interfaccia in italiano o inglese.** Ogni testo che l'utente vede passa da `t("testo italiano")` (TypeScript: `src/core/i18n.ts`; Rust: `crate::i18n::t` / `tf("… {nome} …", &[("nome", &x)])`) e ha l'inglese in `src/i18n/en.json`, chiave = testo italiano. `npm run build` si ferma se ne manca uno (`npm run check:i18n -- --todo` li elenca).

## Dove leggere (solo ciò che serve al compito)
- `HANDOFF.md`: stato, cose da fare, problemi aperti. Leggilo a inizio lavoro.
- `docs/architettura.md`: mappa delle cartelle, interfaccia, personaggi, layout, suoni, impostazioni.
- `docs/chat.md`: motori della chat, opencode come motore, connettori MCP, agente che usa il PC, Compiti (obiettivi che l'agente porta avanti da solo, con motori aiutanti), Abilità (procedure .md dell'utente).
- `docs/agenti.md`: hook e relay, Claude Code, Codex/Gemini/Cursor/Copilot, opencode come agente, scheda Agenti.
- `docs/integrazioni.md`: integrazioni, widget, 3CX, consumo, profili, azioni rapide, automazioni e abitudini, integrazioni personali create dalla chat.
- `docs/strumenti.md`: file rilasciati, Vassoio, appunti, musica, contesto ⚡, ZIP, cattura, calcolatrice.
- `docs/sviluppo.md`: build, anteprime, test, installazione su questo PC, pubblicazione di una release.
- `docs/anteprima-browser.md`: tutte le query string di `npm run dev` (scene, parametri, impostazioni dall'URL).
- `docs/decisioni.md`: decisioni prese ed esclusioni. Controllalo prima di proporre una funzione.
- `docs/idee.md`: idee e progetti non ancora fatti, con i dettagli.
- `docs/prove-dal-vivo.md`: elenco di ciò che va ancora provato con i servizi veri.
- `docs/guida/` (e `docs/guida/en/` in inglese): la **guida per l'utente** (una pagina .md per argomento), pubblicata sul sito come `site/guida/` con `node scripts/guida.mjs`. Quando cambia una funzione visibile, aggiorna la sua pagina e rigenera.
- `README.md` (inglese, la pagina principale del repo) e `README.it.md`; homepage inglese in `site/index.html`, italiana in `site/it/index.html`. `docs/en/` e `CONTRIBUTING.en.md`: versioni inglesi per chi arriva da fuori. Da aggiornare insieme quando cambia ciò che descrivono.
- `docs/archivio/`: storia vecchia (roadmap 6.1–6.6 citata nei commenti come "HANDOFF 6.6, point …", registro passato). **Non leggerla** se il compito non lo richiede.

## Build
```
npm install
npm run tauri dev   # sviluppo con ricaricamento automatico
npm run build       # typecheck + front end (anche su Linux/macOS)
npm run pack        # installer NSIS in release/
```
La parte Rust si compila solo su Windows (MSVC). Test Rust: `cargo test --workspace` in `src-tauri/`.

## Regole
- **Documentazione:** a fine lavoro (o quando cambia lo stato) aggiorna `HANDOFF.md`: stato, Da fare, Problemi noti e una voce di 2–4 righe in cima al Registro. Il Registro tiene al massimo 5 voci: le più vecchie vanno in `docs/archivio/registro.md`. Se cambi come funziona un'area, aggiorna il suo file in `docs/`. Scrivi dove stanno le cose, perché e quali vincoli ci sono, non la descrizione del codice.
- Nessuna nuova dipendenza se non davvero inevitabile. Personaggi, icone e suoni sono disegnati o sintetizzati nel codice: niente Rive, Lottie, immagini o file audio.
- I segreti stanno in Gestione credenziali di Windows, mai su disco, nell'interfaccia o in git. Il front end può solo chiedere se una chiave esiste.
- Nessuna telemetria. Chiamate di rete solo verso i servizi configurati dall'utente, più il controllo degli aggiornamenti su GitHub (`updates.rs`), disattivabile. Gli aggiornamenti si installano solo dopo un clic, con la firma verificata. La chiave privata non entra mai nel repo.
- Non bloccare mai Claude Code né un altro agente: se l'app non risponde entro il timeout, l'hook esce subito con 0.
- Non sovrascrivere mai `%USERPROFILE%\.claude\settings.json` né i file di configurazione degli altri agenti: backup datato, unione, diff, scrittura solo dopo la conferma dell'utente.
- Mai inviare un'email o approvare un permesso senza un clic esplicito (unica eccezione: l'«Automatica» di Telegram accesa dall'utente, che chiede comunque per le cancellazioni, `docs/integrazioni.md`). Gli strumenti di EasyIsland (`agent.rs`) non eseguono comandi arbitrari, non inviano email e non eliminano, tranne `notion_delete_row` (la riga va nel cestino di Notion solo dopo che l'utente ha detto sì in chat) e `remote_run` (comandi solo sul PC remoto di «Accesso remoto» collegato alla chat, ognuno con Consenti / Nega; password solo in memoria, `docs/integrazioni.md`). Le integrazioni personali (`custom.rs`) sono descrizioni, mai codice: le loro azioni sono un elenco fisso. `memory_note` scrive senza chiedere solo nella memoria della chat (`memory.rs`, file .md che l'utente vede e corregge, `docs/chat.md`). Comandi e modifiche ai file li fa solo la «Modalità terminale» della chat, con gli strumenti di Claude Code o opencode e Consenti / Nega nell'isola (`docs/chat.md`). Senza un clic passano solo le azioni reversibili che l'utente ha consentito per sempre o per un compito (`permits.rs`, `REVERSIBLE` in `hook/src/tool_list.rs`), e finiscono in «Cosa ho fatto» con Annulla: mai aggiungere a quell'elenco uno strumento che invia, elimina, apre o esegue.
- Prestazioni: nessun frame di animazione e CPU ~0 % quando l'isola è ritirata.
- La versione sta in `package.json`, `Cargo.toml` e `src-tauri/tauri.conf.json` e deve coincidere (la CI lo controlla sui tag).
- Non cambiare `identifier` in `tauri.conf.json`: sposterebbe i dati dell'app e le voci in Gestione credenziali.
- Un servizio a istanza singola è un'**integrazione**, mai un widget.
- **Stabilità:** prima di un rilascio e dopo modifiche a hook, viste o integrazioni, `npm run smoke` con `npm run dev` acceso deve dire «nessun errore». In Rust niente tagli `[a..b]` o indici su dati esterni (usa `get`): in release un panic chiude l'app. Regole in `docs/architettura.md` → Robustezza.
- Le modifiche visive restano coerenti con l'aspetto attuale (`screenshots/`, scene in `dev/scenes.ts`). Vedi `docs/architettura.md`.
