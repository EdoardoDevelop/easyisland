# For developers
> section: Reference
> summary: Building EasyIsland, trying the interface in the browser, contributing and publishing a version.

## Tools
In PowerShell, once:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Close and reopen PowerShell, then:

```powershell
git clone https://github.com/EdoardoDevelop/easyisland.git
cd easyisland
npm install
```

## Commands
| Command | What it does |
|---|---|
| `npm run tauri dev` | The real app, with automatic interface reload |
| `npm run ui` | Just the interface in the browser, on a fake desktop (no Rust needed) |
| `npm run build` | Type check, English strings check and interface build |
| `npm run smoke` | Opens every scene and every Settings page and reports errors (with `npm run dev` running) |
| `npm run pack` | The installer in `release\` |
| `cargo test --workspace` | Rust tests (in `src-tauri`) |
| `node scripts/screenshots.mjs` | Retakes the screenshots from the preview |
| `node scripts/guida.mjs` | Rebuilds this guide from `docs/guida/*.md` and `docs/guida/en/*.md` |

In the browser preview settings change from the address, e.g. `?anchorV=bottom&anchorH=left&character=drop`; test scenes are in `dev/scenes.ts` (`?scene=chat`, `?scene=compiti`…). The Memory window can be tried at `/memoria.html` with made-up data.

## Structure
```
src/            interface (TypeScript, no framework, Canvas 2D)
  character/    the characters
  island/       the island's state machine, hooks, integrations
  views/        the island's views
  settings/     the Settings window
  memory/       the Memory window (graph, maps, timeline)
src-tauri/      Rust backend (Tauri 2): windows, named pipe, AI engines, integrations, tasks, memory
hook/           easyisland-hook.exe: hook relay and MCP server
scripts/        icons, installer, screenshots, guide
site/           the homepage and this guide (GitHub Pages)
docs/           documentation for people working on the code (in Italian); docs/guida/ is this guide
```

## Project rules
- Interface, documentation and commits in **Italian**; identifiers and code comments in English. Every visible text goes through `t("…")` and has its English in `src/i18n/en.json`: the build stops if one is missing.
- **No new dependencies** unless unavoidable: characters, icons and sounds are drawn or synthesised in code.
- Secrets only in the Credential Manager. No telemetry.
- In Rust no indexing or slicing on external data: a panic in release closes the app.
- Before a release `npm run smoke` must say "nessun errore".

The full rules and the code map are in `CLAUDE.md` and `docs/` in the repository (English summaries in `docs/en/`); to contribute read `CONTRIBUTING.en.md`.

## Publishing a version
1. Raise the version, the same, in `package.json`, `Cargo.toml` and `src-tauri/tauri.conf.json` (CI checks they match).
2. Create and push the tag: `git tag vX.Y.Z` and `git push origin vX.Y.Z`.
3. The **Build** workflow compiles the installer, signs it for updates and publishes the release with `latest.json`, which installed apps read to update.

The repository's `TAURI_SIGNING_PRIVATE_KEY` secret is needed once. The homepage and the guide publish by themselves on GitHub Pages at every change of `site/` in `main`.
