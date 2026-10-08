# Sviluppo, prove e rilascio

## Build e test
- `npm run build`: typecheck + front end. `cargo test --workspace` in `src-tauri/`. `npm run pack`: installer in `release\`.
- CI: `.github/workflows/build.yml` (windows-latest). I tag `v*` pubblicano quando `PUBLISH` vale `'true'`.
- I test Rust che arrivano a `AppHandle::emit_to` fanno fallire l'avvio del binario dei test con `STATUS_ENTRYPOINT_NOT_FOUND`. Per questo si passa da un trait (es. `Ask` in `opencode.rs`) che i test sostituiscono.
- I test dal vivo sono `#[ignore]` e si lanciano con `-- --ignored`.
- La shell di Claude Code passa variabili proprie (`ANTHROPIC_BASE_URL`, token del desktop). Per riprodurre l'ambiente dell'app usare `env -i` con solo PATH e le cartelle del profilo.

## Anteprima nel browser
- `npm run dev`, poi le scene di `dev/scenes.ts`: `/?scene=diff`, `threecx`, `drop`, `chat&long`, `clipboard&long`, `media&long&summary`, `agenti` (due agenti e la barra della scheda Agenti, `&claude` per l'altro pulsante)… Le scene `diff` e `threecx` espongono `window.island` per simulare eventi con `handleHook`.
- `npm run ui`: solo l'interfaccia nel browser.
- Schermate del README: `node scripts/screenshots.mjs` con `npm run dev` acceso. L'errore EPERM finale riguarda solo la pulizia della cartella temporanea di Edge e si può ignorare.

## Installare su questo PC
- **Mai** lanciare installer o app dalla shell di Claude: l'app Claude è MSIX e reindirizza AppData.
- Dopo `npm run pack`, aggiorna la versione in `release\installa.cmd` e avvialo tramite Esplora file:
  `Start-Process explorer.exe -ArgumentList "`"$PWD\release\installa.cmd`""`
- Per controllare che l'installazione sia andata: `\\localhost\C$\Users\Edoardo\AppData\Local\EasyIsland\` (data dell'exe e riga `started` in `easyisland.log`).

## Pubblicare una versione
1. Stesso numero in `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json`, `package-lock.json` e `Cargo.lock`.
2. Commit su `claude/sviluppo`, unione `--no-ff` in `main`, tag `vX.Y.Z`, push di `main` e del tag. **Unione e tag solo con la conferma di Edoardo.** In modalità automatica il controllo dei permessi li blocca, e in alcuni ambienti il proxy rifiuta l'invio dei tag.
3. La CI pubblica installer, firma e `latest.json`. Le app installate si aggiornano dopo un clic.
- **Chiave dell'updater:** `%USERPROFILE%\.tauri\easyisland.key`, fuori dal repo; su GitHub c'è il secret `TAURI_SIGNING_PRIVATE_KEY`. Se si perde, le app installate non accettano più aggiornamenti: tenerne una copia fuori dal PC.
