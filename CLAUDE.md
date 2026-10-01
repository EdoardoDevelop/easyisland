# Coucou (Windows) — guide for AI coding agents

Coucou is a Windows 10/11 desktop app: Mochi, a small animated character living in an island at the top-centre of the screen, shows Claude Code sessions and a few integrations, and lets the user approve, answer, chat and drop files from the island. Windows-only fork of Louis-CFM/coucou (the macOS app was removed). Personal handoff and roadmap: `HANDOFF.md`.

## Where things are
- `src/` — island + settings front end (TypeScript, no framework, Canvas 2D). `src/mochi/` the character, `src/island/` state machine/hooks/integrations, `src/views/` every view, `src/settings/` the settings window.
- `src-tauri/` — Rust backend (Tauri 2): window, named pipe, Claude API, pollers, Credential Manager, tray, NSIS hooks.
- `hook/` — `coucou-hook.exe`, the Claude Code hook relay.
- `assets/sounds/` — the 28 WAV sounds (path declared once in `vite.config.ts`, `SOUNDS_DIR`).
- `scripts/` — `gen-icons.mjs` (icons drawn in code), `pack.mjs` (copies the installer to `release/`).
- `docs/SPEC.md`, `docs/INTEGRATIONS.md` — behaviour, views, states, integrations (in French, written for the macOS original; the Windows differences are in `README.md`).
- `design/prototype/notch-buddy.html` — original prototype, the visual source of truth. `design/captures/` — target screenshots.

## Build
```
npm install
npm run tauri dev   # dev build with live reload
npm run pack        # NSIS installer in release/
npm run build       # typecheck + front end only (also works on Linux/macOS)
```
The Rust side only builds on Windows (MSVC toolchain). CI: `.github/workflows/build.yml` (windows-latest); tags `v*` publish when `PUBLISH` is `'true'`.

## Rules
- TypeScript + Rust (Tauri 2). No new dependencies unless truly unavoidable. Mochi is drawn in code (Canvas 2D), no Rive/Lottie/images.
- Secrets live in the Windows Credential Manager, never on disk, in the UI or in git. The front end can only ask whether a key exists.
- No telemetry. Network calls only to services the user configured.
- Never block Claude Code: if the app doesn't answer within the hook timeout, the hook exits 0 immediately.
- Never overwrite `%USERPROFILE%\.claude\settings.json`: dated backup, merge, show the diff, write only after the user confirms.
- Never send an email or approve a Claude Code permission without an explicit click.
- Performance: no animation frames / ~0 % CPU when the island is retracted.
- Version lives in three files that must agree: `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (CI checks it on tags).
- Changing `identifier` in `tauri.conf.json` moves app data and Credential Manager entries: do it on purpose, once.
- Visual changes must match the prototype and the screenshots in `design/captures/`.
