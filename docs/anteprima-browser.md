# Anteprima nel browser: tutte le query string

Con `npm run dev` l'app gira nel browser, all'indirizzo `http://localhost:1420/`, senza Rust. L'URL decide la scena, la lingua, il tema e qualsiasi impostazione che sia un valore semplice. I parametri senza valore vanno scritti da soli: `?scene=chat&terminal&pane`.

Dove si leggono:
- `src/main.ts`: parametri generali e sovrascrittura delle impostazioni;
- `dev/scenes.ts`: le scene;
- `src/core/i18n.ts`: `lang`;
- `src/settings/main.ts` e `src/memory/main.ts`: le loro pagine.

**Se aggiungi una scena o un parametro, aggiorna questo file.**

## Parametri generali dell'isola (`index.html`)

| Query | Effetto |
|---|---|
| `scene=<nome>` | prepara una scena (vedi sotto); funziona solo con il server di sviluppo |
| `lang=en` / `lang=it` | lingua dell'interfaccia (vale per ogni pagina) |
| `ui=classic` | il look originale (`theme.style`) |
| `scheme=light` / `scheme=auto` | modo chiaro o automatico (`theme.scheme`; scuro se assente) |
| `character=<id>` | il personaggio (`theme.character`, per esempio `drop`) |
| `bg=dark` / `bg=<colore CSS>` | fondo della pagina (`#` va scritto `%23`: `bg=%23ffffff`) |

## Impostazioni dall'URL

Ogni chiave di `Settings` (`src/core/state.ts`) presente in `DEFAULT_SETTINGS` si può sovrascrivere dall'URL. La conversione segue il tipo del valore di serie:
- **numero**: `iconSize=32`;
- **sì/no**: `true` oppure `false`, e qualsiasi altro valore vale `false`;
- **elenco**: valori separati da virgola, e vuoto vuol dire elenco vuoto (`activeIntegrations=` spegne tutte le integrazioni);
- **testo**: il valore così com'è.

Le chiavi che non sono in `DEFAULT_SETTINGS` vengono ignorate. Lo stesso vale, in pratica, per quelle che contengono un oggetto, perché il valore diventerebbe un testo. Tutte queste chiavi si preparano solo nelle scene.

Nel browser, `hooksInstalled` parte da `true`, così la card di Claude Code è visibile.

### Generali e lingua

| Chiave | Valori | Di serie |
|---|---|---|
| `language` | `it`, `en`, `""` (quella di Windows) | `""` (per l'anteprima usa `lang`) |
| `soundEnabled` | `true`/`false` | `true` |
| `soundVolume` | 0–1 | `0.12` |
| `autoCloseInterval` | secondi | `15` |
| `absenceInterval` | secondi | `180` |
| `autostart` | `true`/`false` | `false` |
| `updateCheck` | `true`/`false` | `true` |
| `schemaVersion` | numero | `2` (non toccare) |
| `screen` | `primary`, `cursor`, `monitor:<nome>` | `primary` |

### Posizione e forma dell'isola

| Chiave | Valori | Di serie |
|---|---|---|
| `anchorV` | `top`, `middle`, `bottom` | `top` |
| `anchorH` | `left`, `center`, `right` | `center` |
| `offsetX`, `offsetY` | px dalla posizione di partenza | `0` |
| `glueEdges` | `true`/`false` | `true` |
| `overTaskbar` | `true`/`false` | `false` |
| `islandWidth` | px | `640` |
| `islandHeight` | px; `0` = l'altezza di ogni vista | `0` |
| `islandPlace` | `character`, `top`, `center`, `bottom` | `character` |
| `islandApp` | `true`/`false` | `false` |
| `stayOpenByUser` | `true`/`false` | `false` |
| `closeButton` | `true`/`false` | `true` |
| `followCursorCompact` | `true`/`false` | `false` |
| `quietFullscreen` | `true`/`false` | `true` |

### Isola chiusa, passaggio del mouse e striscia

| Chiave | Valori | Di serie |
|---|---|---|
| `iconStyle` | `character`, `dot`, `none` | `character` |
| `iconSize` | px | `24` |
| `hoverStyle` | `icon`, `bar` | `icon` |
| `hoverSize` | px | `40` |
| `openDelay` | secondi; `0` = solo al clic | `0.6` |
| `revealDuration` | secondi | `8` |
| `compactStrip` | `right`, `left`, `off` | `right` |
| `appBar` | `true`/`false` | `true` |
| `appBarLook` | `both`, `icon`, `text` | `both` |
| `appBarMax` | numero | `6` |
| `appBarName` | `true`/`false` | `true` |

### Barra fissa

Nel browser la fascia non si disegna: la disegna la finestra del personaggio solo dentro Tauri (`characterMode` in `island.ts`). `fixedBar=top|bottom` sposta soltanto l'isola contro il bordo, nella posizione indicata da `fixedBarSlot`; le card degli elementi di sistema si vedono con `?scene=barcard`.

| Chiave | Valori | Di serie |
|---|---|---|
| `fixedBar` | `""`, `top`, `bottom` | `""` |
| `fixedBarSlot` | `start`, `center`, `end` | `center` |
| `fixedBarItems` | elenco di elementi (vedi `BarItem` in `state.ts`) | vuoto |
| `fixedBarBackground` | `""`, `transparent`, `#rrggbb` (`%23rrggbb`) | `""` |
| `fixedBarHeight` | px; `0` = automatica | `0` |

### Isola aperta, menu e intestazione

| Chiave | Valori | Di serie |
|---|---|---|
| `searchBar` | `true`/`false` | `true` |
| `menuCharacter` | `large`, `medium`, `small` | `large` |
| `characterBubble` | `true`/`false` | `true` |
| `integrationTabs` | elenco di id di integrazione | vuoto |
| `pillOrder`, `tabOrder` | elenco di id | vuoto |
| `lockOrder` | `true`/`false` | `false` |
| `contextActions` | `true`/`false` | `true` |
| `greeting` | `true`/`false` | `true` |
| `greetingPlace` | `center`, `character` | `center` |

### Notifiche e «Davanti al cliente»

| Chiave | Valori | Di serie |
|---|---|---|
| `notify` | `all`, `alerts`, `permissions` | `all` |
| `presenceMeeting` | `true`/`false` | `true` |
| `presenceRemote` | `true`/`false` | `true` |
| `presenceApps` | elenco di eseguibili | vuoto |
| `presenceMode` | `hide`, `silent` | `hide` |
| `momentDownloads`, `momentErrors`, `momentServers` | `true`/`false` | `true` |
| `clearSecrets` | `true`/`false` | `true` |

### Chat e motori

| Chiave | Valori | Di serie |
|---|---|---|
| `chatEngine` | `subscription`, `api`, `opencode`, `antigravity`, `openrouter`, `openai`, `gemini`, `ollama`, `lmstudio` | `subscription` |
| `model` | modello Claude per la chiave API | `claude-opus-5-5` |
| `cliModel` | alias per Claude Code; `""` = quello di serie | `""` |
| `chatHistory` | `true`/`false` | `true` |
| `agentTools` | `true`/`false` | `true` |
| `chatTerminal` | `true`/`false` | `false` |
| `chatFolder` | percorso; `""` = la cartella dell'utente | `""` |
| `chatPreview` | `true`/`false` | `true` |
| `previewDocked` | `true`/`false` | `false` |
| `previewWidth` | px; `0` = la solita | `0` |
| `chatInstructions` | testo | `""` |
| `opencodeWatch` | `true`/`false` | `false` |
| `memoryEngine` | `""` o id di un motore | `""` |
| `tasksEngine` | `""` (quello della chat) o id di un motore | `""` |
| `tasksMaxTurns` | numero | `12` |
| `tasksMaxMinutes` | minuti | `30` |

### Agenti di codice e riepiloghi

| Chiave | Valori | Di serie |
|---|---|---|
| `hooksInstalled` | `true`/`false` | `true` nel browser |
| `weeklyRecap` | `true`/`false` | `true` |
| `dailyRecap` | `both`, `morning`, `evening`, `off` | `both` |
| `eveningHour` | 12–23 | `18` |
| `dailyAi` | `""`, `memory`, `chat` o id di un motore | `""` |
| `dailyTelegram` | `true`/`false` | `false` |

### Integrazioni, profili e abitudini

| Chiave | Valori | Di serie |
|---|---|---|
| `activeIntegrations` | elenco di id (`integration_media`, `integration_weather`, `integration_claude_usage`…; vedi `src/integrations/`) | `integration_resend,integration_n8n,integration_vercel,integration_github` |
| `activeProfile` | id di un profilo | `""` |
| `autoProfile` | `true`/`false` | `false` |
| `habitsEnabled` | `true`/`false` | `false` |
| `habitsExcluded` | elenco di eseguibili | vuoto |

### Scorciatoie

Si scrivono come nelle Impostazioni, per esempio `hotkeyOpen=Ctrl%2BSpace`, perché il `+` nell'URL va scritto `%2B`. `""` le spegne.

| Chiave | Di serie |
|---|---|
| `hotkeyOpen` | `Ctrl+Space` |
| `hotkeyAsk` | `Ctrl+Alt+K` |
| `hotkeyClipboard` | `Ctrl+Alt+H` |
| `hotkeyScreenshot` | `Ctrl+Alt+Shift+S` |
| `hotkeyPending` | `Ctrl+Alt+Shift+P` |
| `hotkeySession` | `Ctrl+Alt+Shift+T` |
| `hotkeyNextPill` | `""` |
| `hotkeyMute` | `""` |
| `hotkeySelectionMenu` | `Win+Alt+A` |
| `hotkeyCollect` | `Ctrl+Alt+Shift+R` |

### Non impostabili dall'URL

Queste chiavi contengono oggetti, o elenchi di oggetti, oppure non hanno un valore di serie in `DEFAULT_SETTINGS`. Si preparano nelle scene.

| Chiave | Tipo di valore |
|---|---|
| `theme` | oggetto; dall'URL solo con `character`, `ui` e `scheme` |
| `integrationConfig` | oggetto con le opzioni di meteo, 3CX, Notion e RDM |
| `integrationTabIcons`, `integrationColors` | oggetto |
| `reactions` | oggetto |
| `suggestionsSnoozed` | oggetto |
| `actions`, `widgets`, `mcpServers`, `profiles`, `automations`, `chatAssistants`, `suggestionsDismissed` | elenchi di oggetti |
| `news`, `fixedBarLook`, `engineModels`, `engineUrls` | oggetti senza valore di serie |
| `alertsOpen`, `toolsAllowed` | senza valore di serie |

## Scene (`?scene=<nome>`)

| Scena | Cosa mostra | Parametri in più |
|---|---|---|
| `greeting` | il saluto all'avvio | — |
| `compact` | la barra compatta | da usare con `hoverStyle=bar&revealDuration=0` |
| `strip` | la striscia dell'isola chiusa | `strip=approval\|call\|live\|work\|app`; con `compactStrip=left` sta a sinistra |
| `overview` | la panoramica | `news`, con `look=thumbs\|cards` e `many` |
| `files` | il Vassoio | `fresh`: una zona appena aggiunta |
| `approval` | il permesso con il tempo rimasto | — |
| `chat` | la chat | `terminal` (modalità terminale), `auto` (⚡ Automatica accesa), `pane`, `remote` (`linked` per il PC remoto collegato), `second`, `long`, `history`, `window` (finestra allegata), `pick` (personaggio trascinato su una finestra) |
| `clipboard` | gli appunti | `long` |
| `media` | la musica | `long`, `nocover`, `summary` |
| `recorder` | il registratore | `live`: registra da 83 s |
| `remote` | Accesso remoto | `guide`, `live`, `linked`, `error` |
| `teams` | Teams | `call` |
| `threecx` | 3CX | — |
| `capture` | il velo di «Riquadra e chiedi» (`window.capture` dice cosa ha chiesto a Rust) | — |
| `network` | la rete (con `activeIntegrations=integration_network`) | `form`: le impostazioni della scheda di rete aperte |
| `notion` | Notion | `views`, `noinbox` |
| `rdm` | RDM | `q=<ricerca>`, `nolist` |
| `usage` | il consumo del piano | `stale`: numeri vecchi di 7 ore |
| `meteo` | il meteo | `sky=rain\|sun\|moon\|sun-cloud\|moon-cloud\|cloud\|fog\|snow\|storm`, `night`, `idle` |
| `actions` | le azioni rapide | — |
| `finished` | la card «ha finito» con «Continua» | va bene con `islandHeight=440` |
| `rewrite` | la card di «Sostituisci» | `loading`, `changed`, `plain`, `lost` |
| `suggestion` | una proposta dalle abitudini | — |
| `drop` | il rilascio di un file | — |
| `diff` | le modifiche di Claude Code, dal gestore vero degli hook | — |
| `agents` | Codex e Gemini CLI come li manda il relay | — |
| `agenti` | la scheda Agenti | `claude`: l'altro pulsante |
| `custom` | un'integrazione personale | `dati` |
| `compiti` | i Compiti | `ask` |
| `moment` | una proposta al momento giusto | `moment=download\|recording\|…` |
| `daily` | Buongiorno / Fine giornata | `evening`, `news`, `ai` (con il riassunto dell'IA), `ai=ask` (con «Chiedi il riassunto all'IA») |
| `search` | il campo in alto con risultati di memoria, conversazioni e Zammad inventati | `q=<testo>` (di serie `rossi`) |
| `done` | «Cosa ho fatto» su un registro inventato | `alone`: la card di un'azione fatta senza chiedere, con Annulla |
| `news` | le notizie | `ask`, `look=thumbs\|cards`, `many` |
| `barcard` | le card della barra fissa | `card=clock\|volume\|mic\|brightness\|battery\|net` |
| `recap` | il riepilogo settimanale | — |
| `stop` | una sessione finita con un messaggio lungo in markdown, dal gestore vero | — |
| `permission` | non è una schermata: un PermissionRequest vero mentre l'isola mostra un'altra scheda, per controllare che la card compaia, resti e torni | — |
| `fuzz` | eventi casuali per il collaudo | `seed=<n>` (di serie 7), `steps=<n>` (di serie 600) |

Le scene scrivono `scene ready` nel titolo quando sono pronte (lo aspetta `scripts/screenshots.mjs`) ed espongono `window.island` e `window.State` nella console.

## Altre pagine

| Pagina | Query |
|---|---|
| `settings.html` | `page=generale\|aspetto\|notifiche\|chat\|claude\|azioni\|compiti\|integrazioni\|widget\|notizie\|backup`; `tab=tema\|personaggio\|posizione\|barra\|chiusa\|aperta` (solo in `page=aspetto`); `lang`, `ui=classic`, `scheme=light\|auto` |
| `memoria.html` | `tab=timeline\|graph\|graph3d\|mind\|concept`, `select=<id del nodo>` |
| `anteprima.html` | `tab=<numero>` (di serie 2) |
| `dev/character-preview.html` | `character=<id>` |
| `dev/greeting-preview.html` | `character=<id>` (di serie `drop`) |
| `dev/upload-preview.html` | `character=<id>`, `azioni=<numero>` (di serie 2) |
| `flussi.html`, `personaggio.html`, `dev/characters.html`, `dev/sounds-preview.html` | solo `lang` |

## Esempi

- `/?scene=daily&evening&ai&scheme=light`
- `/?scene=meteo&activeIntegrations=integration_weather&sky=snow&night`
- `/?scene=chat&terminal&auto&lang=en`
- `/?anchorV=bottom&anchorH=left&iconSize=32&hoverStyle=bar`
- `/settings.html?page=aspetto&tab=barra&lang=en`
- `/?scene=fuzz&seed=3&steps=3000`
