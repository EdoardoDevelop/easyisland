# Contributing to EasyIsland

[Italiano](CONTRIBUTING.md) · **English**

Thanks for your interest! EasyIsland is a personal project, but bug reports and
proposals are welcome.

## Getting started

You need Windows 10/11 with Node.js and Rust (MSVC toolchain): the steps are in the
**Installation** section of the [README](README.en.md).

```powershell
npm install
npm run tauri dev   # the real app, with live reload
npm run ui          # the interface only, in the browser (Node is enough)
npm run pack        # the installer in release\
```

## Project rules

- **Italian** is the project language for interface text, error messages,
  documentation and commit messages; identifiers and code comments are in English.
  Every string the user sees goes through `t("Italian text")` and has its English
  translation in `src/i18n/en.json` (`npm run build` fails if one is missing).
  English versions of the main documents live next to them (`README.en.md`,
  `docs/en/`).
- TypeScript + Rust (Tauri 2). **No new dependencies** unless truly unavoidable.
  Characters, icons and sounds are drawn or synthesised in code.
- Secrets live in Windows Credential Manager, never on disk or in git.
- No telemetry; network calls only to services the user configured (plus the
  update check on GitHub, which can be turned off).
- Never block Claude Code or another agent: if the app does not answer, the hook
  exits at once.
- Never write `%USERPROFILE%\.claude\settings.json` (or another agent's config)
  without a dated backup, a diff and the user's confirmation.
- ~0 % CPU when the island is at rest.

The full rules and the code map are in [CLAUDE.md](CLAUDE.md) (Italian); the state
of the work in [HANDOFF.md](HANDOFF.md), details per area in [docs/](docs/) and, in
English, [docs/en/](docs/en/).

## Bug reports and pull requests

- For a bug: what you did, what you expected, what happened, and an excerpt of
  `%LOCALAPPDATA%\EasyIsland\easyisland.log`.
- One pull request per topic, with a screenshot for visual changes.
- `npm run build` and `cargo test --workspace` (in `src-tauri/`) must pass; after
  changes to hooks, views or integrations, `npm run smoke` with `npm run dev`
  running must report no errors.
