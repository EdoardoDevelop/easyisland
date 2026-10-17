# Development, tests and releases

English version of [sviluppo.md](../sviluppo.md). Where the two disagree, the Italian
file is the reference.

## Build and tests
- `npm run build`: type check + front end, and the check that every interface string
  has its English translation. `cargo test --workspace` in `src-tauri/`.
  `npm run pack`: installer in `release\`. The Rust side builds only on Windows
  (MSVC).
- CI: `.github/workflows/build.yml` (windows-latest). `v*` tags publish a release
  when `PUBLISH` is `'true'`; the CI also checks that the version numbers match.
- Rust tests that reach `AppHandle::emit_to` make the test binary fail to start
  (`STATUS_ENTRYPOINT_NOT_FOUND`), so such code goes through a trait (e.g. `Ask` in
  `opencode.rs`) that tests replace.
- Live tests against real services are `#[ignore]` and run with `-- --ignored`,
  e.g. `cargo test --lib opencode::tests::live -- --ignored --nocapture`.
- **After `cargo clean`:** run `cargo build --release -p easyisland-hook` before
  tests and `cargo build`: the app bundles the relay as a resource.
- **Interface smoke test:** `npm run smoke` with `npm run dev` running
  (`PREVIEW_URL=http://localhost:1420` if needed). Headless Edge opens every scene of
  `dev/scenes.ts`, clicks every menu entry, drags the corner, closes and reopens; then
  every Settings page, using every control. Any exception or `console.error` is a
  failure. It includes a fuzz run with random agent events and malformed integration
  data; a failure repeats with the same seed: `/?scene=fuzz&seed=N&steps=3000`. Run it
  before every release and after changes to hooks, views or integrations: it must
  report "nessun errore" (no errors).

## Browser preview
- `npm run dev`, then the scenes of `dev/scenes.ts`, for example `/?scene=diff`,
  `threecx`, `drop`, `chat&long`, `chat&terminal` (terminal mode, `&auto` for
  ⚡ Automatic), `chat&window`, `clipboard&long`, `media&long&summary`, `agenti`,
  `approval`, `meteo&activeIntegrations=integration_weather&sky=rain`, `rewrite`,
  `files&fresh`, `teams&call`, `strip&strip=app`, `capture`…
- `npm run ui`: the interface only, in the browser.
- `/dev/greeting-preview.html`, `/dev/character-preview.html`,
  `/dev/upload-preview.html`, `/dev/sounds-preview.html`.
- README screenshots: `node scripts/screenshots.mjs` with `npm run dev` running; the
  same images go to `site/media/` for the homepage.

## Installing a build on your PC
- After `npm run pack`, run `release\installa.cmd` from File Explorer (it installs
  `EasyIsland-Windows-setup.exe`, the unversioned copy `pack` rebuilds every time).
- To check the installation: the date of the exe and the `started` line in
  `%LOCALAPPDATA%\EasyIsland\easyisland.log`.

## Homepage
- `site/` (static HTML and CSS, images in `site/media/`) is published on GitHub Pages
  by `.github/workflows/pages.yml` on every push to `main` that touches `site/`. The
  "what's new" section at the bottom is updated with every version.

## Publishing a version
1. Same number in `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json`,
   `package-lock.json` and `Cargo.lock`.
2. Update `HANDOFF.md`, the docs and the "what's new" sections (README, English
   README, homepage) and commit them **before** merging.
3. Commit on `claude/sviluppo`, merge `--no-ff` into `main`, tag `vX.Y.Z`, push `main`
   and the tag.
4. The CI publishes the installer, its update signature and `latest.json`. Installed
   apps update after a click.
- **Updater key:** kept outside the repository; GitHub has it as the
  `TAURI_SIGNING_PRIVATE_KEY` secret. If it is lost, installed apps no longer accept
  updates, so keep a copy off the PC. The public key is in `tauri.conf.json`.
