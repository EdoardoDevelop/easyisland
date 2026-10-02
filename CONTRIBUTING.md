# Contribuire a EasyIsland

Grazie per l'interesse! EasyIsland è un progetto personale, ma segnalazioni e
proposte sono benvenute.

## Per iniziare

Serve Windows 10/11 con Node.js e Rust (toolchain MSVC): i passi sono nella
sezione **Installazione** del [README](README.md).

```powershell
npm install
npm run tauri dev   # l'app vera, con ricaricamento automatico
npm run ui          # solo l'interfaccia nel browser (basta Node)
npm run pack        # l'installer in release\
```

## Regole del progetto

- **Italiano** per testi dell'interfaccia, messaggi d'errore, documentazione e
  messaggi di commit; identificatori e commenti nel codice in inglese.
- TypeScript + Rust (Tauri 2). **Nessuna nuova dipendenza** se non davvero
  inevitabile. Personaggi, icone e suoni sono disegnati o sintetizzati nel codice.
- I segreti stanno in Gestione credenziali di Windows, mai su disco o in git.
- Niente telemetria; chiamate di rete solo verso i servizi configurati
  dall'utente (più il controllo degli aggiornamenti su GitHub, disattivabile).
- Non bloccare mai Claude Code: se l'app non risponde, l'hook esce subito.
- Mai scrivere `%USERPROFILE%\.claude\settings.json` senza backup, diff e
  conferma dell'utente.
- CPU a ~0 % quando l'isola è a riposo.

Le regole complete e la mappa del codice sono in [CLAUDE.md](CLAUDE.md); lo
stato dei lavori in [HANDOFF.md](HANDOFF.md).

## Segnalazioni e pull request

- Per un bug: cosa hai fatto, cosa ti aspettavi, cosa è successo, e un
  estratto di `%LOCALAPPDATA%\EasyIsland\easyisland.log`.
- Una pull request per argomento, con una schermata per le modifiche visive.
- `npm run build` e `cargo test --workspace` devono passare.
