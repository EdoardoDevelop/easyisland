# Per sviluppatori
> sezione: Riferimento
> in breve: Compilare EasyIsland, provare l'interfaccia nel browser, contribuire e pubblicare una versione.

## Strumenti
In PowerShell, una volta sola:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Chiudi e riapri PowerShell, poi:

```powershell
git clone https://github.com/EdoardoDevelop/easyisland.git
cd easyisland
npm install
```

## Comandi
| Comando | Cosa fa |
|---|---|
| `npm run tauri dev` | L'app vera, con ricaricamento automatico dell'interfaccia |
| `npm run ui` | Solo l'interfaccia nel browser, su un finto desktop (non serve Rust) |
| `npm run build` | Controllo dei tipi, dei testi inglesi e build dell'interfaccia |
| `npm run smoke` | Apre ogni scena e ogni pagina delle Impostazioni e segnala gli errori (con `npm run dev` acceso) |
| `npm run pack` | L'installer in `release\` |
| `cargo test --workspace` | I test Rust (in `src-tauri`) |
| `node scripts/screenshots.mjs` | Rifà le schermate dall'anteprima |
| `node scripts/guida.mjs` | Rifà questa guida da `docs/guida/*.md` |

Nell'anteprima del browser le impostazioni si cambiano dall'indirizzo, es. `?anchorV=bottom&anchorH=left&character=drop`; le scene di prova sono in `dev/scenes.ts` (`?scene=chat`, `?scene=compiti`…). La finestra Memoria si prova su `/memoria.html` con dati inventati.

## Struttura
```
src/            interfaccia (TypeScript senza framework, Canvas 2D)
  character/    i personaggi
  island/       macchina a stati dell'isola, hook, integrazioni
  views/        le viste dell'isola
  settings/     la finestra delle Impostazioni
  memory/       la finestra Memoria (grafo, mappe, timeline)
src-tauri/      backend Rust (Tauri 2): finestre, named pipe, motori AI, integrazioni, compiti, memoria
hook/           easyisland-hook.exe: relay degli hook e server MCP
scripts/        icone, installer, schermate, guida
site/           la homepage e questa guida (GitHub Pages)
docs/           documentazione per chi lavora sul codice; docs/guida/ è questa guida
```

## Regole del progetto
- Interfaccia, documentazione e commit in **italiano**; identificatori e commenti nel codice in inglese. Ogni testo visibile passa da `t("…")` e ha l'inglese in `src/i18n/en.json`: la build si ferma se manca.
- **Nessuna dipendenza nuova** se non inevitabile: personaggi, icone e suoni sono disegnati o sintetizzati nel codice.
- Segreti solo in Gestione credenziali. Nessuna telemetria.
- In Rust niente indici o tagli su dati esterni: un panic in release chiude l'app.
- Prima di un rilascio `npm run smoke` deve dire «nessun errore».

Le regole complete e la mappa del codice sono in `CLAUDE.md` e `docs/` nel repository; per contribuire leggi `CONTRIBUTING.md`.

## Pubblicare una versione
1. Alza la versione, uguale, in `package.json`, `Cargo.toml` e `src-tauri/tauri.conf.json` (la CI controlla che coincidano).
2. Crea e invia il tag: `git tag vX.Y.Z` e `git push origin vX.Y.Z`.
3. La workflow **Build** compila l'installer, lo firma per l'aggiornamento e pubblica la release con `latest.json`, che le app installate leggono per aggiornarsi.

Serve una volta il secret `TAURI_SIGNING_PRIVATE_KEY` del repository. La homepage e la guida si pubblicano da sole su GitHub Pages a ogni modifica di `site/` in `main`.
