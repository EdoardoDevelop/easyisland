# Sviluppo, prove e rilascio

## Guida sul sito
- Pagine in `docs/guida/NN-slug.md` e `docs/guida/en/` (stesso NN = stessa pagina; NN = ordine nel menu). Prima riga `# Titolo`, poi `> sezione: …` / `> in breve: …` (EN: `> section:` / `> summary:`).
- `node scripts/guida.mjs` → `site/guida/` e `site/en/guide/` con menu, indice, prima/dopo, ricerca (`search.json`), senza dipendenze; scrive anche `site/sitemap.xml` e mette in ogni pagina canonical, hreflang assoluti e Open Graph (immagine `site/media/og.png`, 1200×630). Le home (`site/index.html`, `site/it/index.html`) hanno gli stessi tag e il JSON-LD `SoftwareApplication` scritti a mano. `robots.txt` non serve: GitHub Pages lo leggerebbe solo alla radice di `edoardodevelop.github.io`; la sitemap si invia da Google Search Console. Immagini da `site/media/` (copiate da `screenshots/`); screenshot della guida: `node scripts/screenshots.mjs guida`.
- Homepage EN `site/index.html` (principale dal 27/10/2026), IT `site/it/index.html`; `site/en/index.html` rimanda alla radice. Le Impostazioni linkano la guida nella lingua dell'interfaccia (`HOMEPAGE` in `src/settings/main.ts`).
- `site/` va su GitHub Pages (https://edoardodevelop.github.io/easyisland/) da `.github/workflows/pages.yml` a ogni push in `main` che tocca `site/`. Le novità in fondo alla homepage si aggiornano a ogni versione.

## Build e test
- `npm run build`: typecheck + front end. `cargo test --workspace` in `src-tauri/`. `npm run pack`: installer in `release\`.
- CI: `.github/workflows/build.yml` (windows-latest). I tag `v*` pubblicano se `PUBLISH` = `'true'`.
- Test Rust che arrivano a `AppHandle::emit_to` fanno fallire l'avvio del binario dei test (`STATUS_ENTRYPOINT_NOT_FOUND`): passare da un trait sostituibile (es. `Ask` in `opencode.rs`).
- Test dal vivo: `#[ignore]`, si lanciano con `-- --ignored`.
- **Dopo `cargo clean`:** prima `cargo build --release -p easyisland-hook`, perché l'app include `target/release/easyisland-hook.exe` come risorsa («resource path … doesn't exist»).
- **Smoke:** `npm run smoke` con `npm run dev` acceso (`PREVIEW_URL=http://localhost:1420` se serve). Più Edge insieme (`SMOKE_JOBS`, di serie fino a 6, ognuno col suo profilo e porta): ~2,5 min invece di oltre 10. `npm run smoke:rapido` (chat, Panoramica, Agenti, Agent Chat, Impostazioni → Chat) ~30 s, per le prove durante il lavoro; `node scripts/smoke.mjs <scene>` per altre. Alla fine ogni Edge si chiude con `Browser.close` (su Windows il processo lanciato è solo un avviatore: con `kill()` restavano Edge appesi sulle porte e le prove dopo non trovavano nessuna pagina pronta). Le pagine delle Impostazioni si provano quando i controlli ci sono tutti (prima, sotto carico, «0 controlli» passava). Edge headless apre ogni scena di `dev/scenes.ts`, clicca ogni voce del menu, trascina, chiude e riapre, poi usa ogni controllo delle Impostazioni. Ogni eccezione o `console.error` è un errore. Include `fuzz` (5 semi: eventi casuali, clic, dati malformati; alla fine sessioni a riposo); si ripete con `/?scene=fuzz&seed=N&steps=3000`. `tsc` controlla anche `dev/`.
- La shell di Claude Code passa variabili sue (`ANTHROPIC_BASE_URL`, token del desktop): per riprodurre l'ambiente dell'app usare `env -i` con solo PATH e cartelle del profilo.

## Anteprima nel browser
- `npm run dev` e le scene di `dev/scenes.ts` (elenco completo in `docs/anteprima-browser.md`). Le scene `diff` e `threecx` espongono `window.island` per simulare eventi con `handleHook`.
- `npm run ui`: solo l'interfaccia.
- `/dev/greeting-preview.html` (`?character=slime`): saluto all'avvio ripetuto su tela grande.
- Schermate: `node scripts/screenshots.mjs` con `npm run dev` acceso (`lang=it` di serie; `SHOT_QUERY=lang=en SHOT_DIR=site/media/en` per le inglesi). Copiarle anche in `site/media/`. Tutti i personaggi: `node scripts/screenshots.mjs characters` (da `dev/characters.html`, nuovi compaiono da soli). L'EPERM finale (pulizia temp di Edge) si ignora.

## Installare su questo PC
- **Mai** lanciare installer o app dalla shell di Claude (MSIX reindirizza AppData).
- Dopo `npm run pack`, avvia `release\installa.cmd` (installa `EasyIsland-Windows-setup.exe`, copia senza versione) tramite Esplora file:
  `Start-Process explorer.exe -ArgumentList "`"$PWD\release\installa.cmd`""`
- Verifica: `\\localhost\C$\Users\Edoardo\AppData\Local\EasyIsland\` (data dell'exe, riga `started` in `easyisland.log`).
- **Avvio dopo un aggiornamento:** i processi WebView2 vecchi possono tenere occupato `%LOCALAPPDATA%\it.edoardo.easyisland\EBWebView` (0x800700AA → panic → 0xc0000409, e WerFault bloccava l'istanza singola). `webview_profile.rs` aspetta, chiude gli avanzi e, se serve, usa `spare\EBWebView`; per questo la finestra dell'isola ha `"create": false` in `tauri.conf.json` e la crea il setup. I panic vanno nel log come `panic: …`.

## Pubblicare una versione
- Novità per intero in `CHANGELOG.md` e `CHANGELOG.en.md`, una riga in «Ultime versioni» dei due README (solo le ultime quattro) e in fondo alle due homepage. Aggiornare `CONTRIBUTING.en.md` e `docs/en/` se cambia ciò che descrivono.
1. Stesso numero in `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json`, `package-lock.json`, `Cargo.lock`.
2. Commit su `claude/sviluppo`, unione `--no-ff` in `main`, tag `vX.Y.Z`, push di `main` e tag. **Unione e tag solo con la conferma di Edoardo** (in modalità automatica i permessi li bloccano; alcuni proxy rifiutano i tag).
3. La CI pubblica installer, firma e `latest.json`; le app si aggiornano dopo un clic.
- **Chiave dell'updater:** `%USERPROFILE%\.tauri\easyisland.key`, fuori dal repo; secret GitHub `TAURI_SIGNING_PRIVATE_KEY`. Se si perde, niente più aggiornamenti: tenerne una copia fuori dal PC.
