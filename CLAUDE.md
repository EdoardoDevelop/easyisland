# EasyIsland (Windows) — guida per gli agenti AI

App desktop per Windows 10/11: un personaggio animato (Slime, Goccia o EasyTech) in un'isola in alto sullo schermo mostra le sessioni di Claude Code e degli altri agenti, la chat con vari motori e le integrazioni, e permette di approvare, rispondere e rilasciare file. È un fork solo per Windows di Louis-CFM/coucou. TypeScript senza framework (Canvas 2D) in `src/`, Rust con Tauri 2 in `src-tauri/`, relay degli hook in `hook/`.

**Lingua del progetto: italiano.** Testi dell'interfaccia, messaggi d'errore per l'utente, documentazione e commit sono in italiano. Identificatori e commenti nel codice restano in inglese.

**Interfaccia in italiano o inglese.** Ogni testo che l'utente vede passa da `t("testo italiano")` (TypeScript: `src/core/i18n.ts`; Rust: `crate::i18n::t` / `tf("… {nome} …", &[("nome", &x)])`) e ha l'inglese in `src/i18n/en.json`, chiave = testo italiano. `npm run build` si ferma se ne manca uno (`npm run check:i18n -- --todo` li elenca).

## Dove leggere (solo ciò che serve al compito)
- `HANDOFF.md`: stato, cose da fare, problemi aperti. Leggilo a inizio lavoro.
- `docs/architettura.md`: mappa delle cartelle, interfaccia, personaggi, layout, suoni, impostazioni.
- `docs/chat.md`: motori della chat, opencode come motore, connettori MCP, agente che usa il PC.
- `docs/agenti.md`: hook e relay, Claude Code, Codex/Gemini/Cursor/Copilot, opencode come agente, scheda Agenti.
- `docs/integrazioni.md`: integrazioni, widget, 3CX, consumo, profili, azioni rapide, automazioni e abitudini.
- `docs/strumenti.md`: file rilasciati, Vassoio, appunti, musica, contesto ⚡, ZIP, cattura, calcolatrice.
- `docs/sviluppo.md`: build, anteprime, test, installazione su questo PC, pubblicazione di una release.
- `docs/decisioni.md`: decisioni prese ed esclusioni. Controllalo prima di proporre una funzione.
- `docs/idee.md`: idee e progetti non ancora fatti, con i dettagli.
- `docs/prove-dal-vivo.md`: elenco di ciò che va ancora provato con i servizi veri.
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
- Mai inviare un'email o approvare un permesso senza un clic esplicito. L'agente non ha strumenti che eseguono comandi arbitrari, inviano email o eliminano.
- Prestazioni: nessun frame di animazione e CPU ~0 % quando l'isola è ritirata.
- La versione sta in `package.json`, `Cargo.toml` e `src-tauri/tauri.conf.json` e deve coincidere (la CI lo controlla sui tag).
- Non cambiare `identifier` in `tauri.conf.json`: sposterebbe i dati dell'app e le voci in Gestione credenziali.
- Un servizio a istanza singola è un'**integrazione**, mai un widget.
- Le modifiche visive restano coerenti con l'aspetto attuale (`screenshots/`, scene in `dev/scenes.ts`). Vedi `docs/architettura.md`.
