# Handoff personale — Coucou (solo Windows)

_Punto di partenza: 1 ottobre 2026. Branch: `claude/lucid-lamport-v5nvs3`._

## 1. Com'è il progetto adesso

Coucou è un fork di [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou). In origine era un'app macOS nativa (Swift) che viveva nel notch del MacBook, con un port Windows in `windows/`.
**Adesso il repo è solo Windows:**

- **Rimossi:** l'app macOS (`NotchBuddy/`, ~11.000 righe Swift + progetto Xcode), le workflow macOS (`build.yml`, `release.yml`) e `scripts/release.sh` (firma/notarizzazione Apple).
- **Spostato alla radice:** tutto il contenuto di `windows/` (Tauri 2 + Rust + TypeScript).
- **Spostati:** i 28 suoni da `NotchBuddy/Resources/sounds/` ad `assets/sounds/` (`SOUNDS_DIR` in `vite.config.ts` aggiornato).
- **CI:** `.github/workflows/build.yml` gira su `windows-latest` a ogni push/PR su `main` (solo verifica di compilazione) e pubblica l'installer sui tag `v*`, ma solo se `PUBLISH: 'true'`. Oggi è `'false'`, per via del falso positivo di Defender sull'installer non firmato.
- **Aggiornati:** `README.md`, `CLAUDE.md` (regole per gli agenti, ora per Windows), `.gitignore`, i percorsi in `LICENSE-ASSETS.md`.
- **Tradotto in italiano:** tutti i testi dell'interfaccia (isola, impostazioni, menu dell'area di notifica, etichette dei passi degli hook), i messaggi d'errore del backend, l'installer NSIS (italiano come lingua principale), README, CLAUDE.md, `docs/SPEC.md`, `docs/INTEGRATIONS.md`, i template delle issue e le note di release. Il prompt di sistema della chat chiede a Mochi di rispondere in italiano. Restano in inglese di proposito i commenti e gli identificatori nel codice, `LICENSE` e `LICENSE-ASSETS.md` (testi legali dell'autore originale) e il sito in `docs/*.html`. Le immagini in `screenshots/` mostrano ancora i testi in inglese.
- **Verificato qui (Linux):** `tsc --noEmit` e `vite build` passano, i 28 WAV finiscono in `dist/sounds`, il workspace Cargo si risolve. **Non verificato:** la build Rust/Tauri. Gira solo su Windows, quindi il primo vero test sarà la CI o il tuo PC.

## 2. Mappa veloce

| Cosa vuoi toccare | Dove |
|---|---|
| Aspetto/animazioni di Mochi | `src/mochi/engine.ts`, `src/mochi/greeting.ts` |
| Viste dell'isola (chat, approvazioni, upload…) | `src/views/` + `src/style.css` |
| Logica apri/chiudi, eventi hook | `src/island/fsm.ts`, `src/island/island.ts`, `src/island/hooks.ts` |
| Finestra Impostazioni | `settings.html`, `src/settings/` |
| Integrazioni (Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com) | backend `src-tauri/src/integrations.rs`, front end `src/island/integrations.ts`, `src/views/integrations.ts`, colori/nomi in `src/core/state.ts` |
| Chiavi API (Credential Manager) | `src-tauri/src/secrets.rs` (`SERVICE`, `KNOWN_KEYS`) |
| Chat con Claude (motore, modello, prompt) | `src-tauri/src/claude_cli.rs` (abbonamento), `src-tauri/src/claude.rs` (chiave API) |
| Relay hook di Claude Code | `hook/src/main.rs` + named pipe `src-tauri/src/pipe.rs` |
| Install/uninstall degli hook in `settings.json` | `src-tauri/src/hooks.rs` |
| Icona tray e menu | `src-tauri/src/tray.rs`, icone generate da `scripts/gen-icons.mjs` |
| Suoni | `assets/sounds/`, motore `src/core/sound.ts` |
| Installer NSIS | `src-tauri/tauri.conf.json` (`bundle`), `src-tauri/nsis/hooks.nsh` |

## 3. Primi passi sul tuo PC Windows

1. Installa [Rust](https://rustup.rs), Node 20+ e Visual Studio Build Tools ("Desktop development with C++").
2. `npm install`, poi `npm run tauri dev`. Mochi deve comparire in alto al centro dello schermo.
3. Apri **Impostazioni… → Claude**, inserisci la tua API key Anthropic e prova la chat.
4. Apri **Impostazioni… → Claude Code → Install hooks…**: controlla il diff e conferma. Poi lancia una sessione di Claude Code e verifica che le richieste di permesso arrivino sull'isola.
5. `npm run pack`: l'installer finisce in `release/`.
6. Fai un push su `main` (o apri una PR) e controlla che la workflow `Build` sia verde. È il primo test reale della build Rust dopo lo spostamento delle cartelle.

## 4. Decisioni da prendere per personalizzarlo

**Identità (da fare per prima, e una volta sola):**
- [ ] Nome dell'app: `productName` in `src-tauri/tauri.conf.json` e i testi di `README.md`.
- [ ] Bundle identifier: `identifier` in `tauri.conf.json` (oggi `fr.louisraille.coucou`) e `SERVICE` in `src-tauri/src/secrets.rs`. Cambiali insieme. Le chiavi già salvate nel Credential Manager restano sotto il vecchio nome e vanno reinserite.
- [ ] `copyright` in `tauri.conf.json`, `authors` in `src-tauri/Cargo.toml`, il copyright in `LICENSE` (aggiungi il tuo, lasciando quello originale per la parte MIT).

**Licenza degli asset (importante):** `LICENSE-ASSETS.md` riserva all'autore originale il nome "Coucou", il nome "Mochi", il personaggio, le icone e i suoni.
- Per **uso personale** va bene così com'è.
- Se vuoi **pubblicare o distribuire** la tua versione, servono nome, icona, personaggio e suoni tuoi. Il codice (MIT) puoi tenerlo.

**Sito e documenti:** `docs/*.html` (GitHub Pages: privacy, termini, note legali) e `docs/media/` sono quelli dell'autore originale, scritti per il Mac e intestati a lui. Puoi eliminarli o riscriverli. `docs/SPEC.md` e `docs/INTEGRATIONS.md` sono una buona specifica (in francese), ma descrivono il comportamento su macOS.

**Funzionalità:**
- [ ] Quali integrazioni tieni? Se non usi Stripe, Resend, Cal.com…, rimuoverle alleggerisce codice e Impostazioni.
- [ ] Funzioni presenti solo su Mac e mai portate: invio di un file via email, trascinare Mochi su una finestra per allegarla come contesto, saltare al terminale esatto della sessione. Valuta se ti servono.
- [x] Chat: scegli in Impostazioni tra abbonamento Claude (tramite Claude Code, predefinito) e chiave API. Codice in `src-tauri/src/claude_cli.rs` e `src-tauri/src/claude.rs`.

**Distribuzione:**
- [ ] Firma del codice (certificato Authenticode o Azure Trusted Signing). Senza firma, Defender e SmartScreen segnalano l'installer.
- [ ] Quando l'installer è firmato, metti `PUBLISH: 'true'` nella workflow e crea un tag `vX.Y.Z`. La versione deve coincidere in `package.json`, `Cargo.toml` e `tauri.conf.json` (la CI lo controlla).

## 5. Regole da non rompere (sono anche in `CLAUDE.md`)

- L'hook non deve **mai** bloccare Claude Code: timeout breve, poi esce con 0.
- `settings.json` di Claude Code non si sovrascrive mai: backup datato, merge, diff, scrittura solo dopo conferma.
- Niente telemetria. Le chiavi stanno solo nel Credential Manager.
- Nessuna approvazione di permessi e nessuna email senza un click esplicito.
- CPU a ~0 % quando l'isola è nascosta.

## 6. Note per riprendere con Claude Code

Apri una sessione su questo repo e scrivi, per esempio: _"Leggi HANDOFF.md e CLAUDE.md, poi facciamo la sezione 4 → Identità con nome X"_. `CLAUDE.md` viene caricato in automatico e contiene già struttura e regole.
