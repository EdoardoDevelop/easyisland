# Notch Buddy — integrazioni

> **Nota:** questo documento è stato scritto per l'app macOS originale (socket Unix, Portachiavi, AppleScript, ScreenCaptureKit). Su Windows il relay è `coucou-hook.exe` collegato via named pipe (`\\.\pipe\coucou-<sid>`), le chiavi stanno in Gestione credenziali di Windows e le sezioni §4 (aggancio a una finestra), §6 (Mail) e §7 (permessi macOS) non si applicano. Vedi `README.md` e il codice in `src-tauri/` e `hook/`.

Regola d'oro: **verificare la documentazione ufficiale al momento di implementare**. I formati qui sotto sono il piano, non una garanzia. Fonti da rileggere:
- Hook di Claude Code: https://code.claude.com/docs/en/hooks
- API Claude (Messages, strumento di ricerca web, modelli): https://docs.claude.com/en/api/overview
- API pubblica di n8n: `{URL dell'istanza}/api/v1/docs` (playground dell'istanza)

---

## 1. Claude Code (sessioni dell'utente)

### Architettura
```
claude (terminale, VS Code, app Claude)
  └─ hook "command" ─► nb-hook (piccolo eseguibile Swift, fornito con l'app)
                         └─ socket Unix ─► Notch Buddy.app
                         ◄─ decisione (per PermissionRequest)
```
- `nb-hook`: target separato nel progetto, copiato in `~/Library/Application Support/NotchBuddy/bin/nb-hook` al primo avvio.
- Socket: `~/Library/Application Support/NotchBuddy/nb.sock`.
- `nb-hook <Evento>` legge il JSON dell'hook da stdin, aggiunge il contesto del terminale (`TERM_PROGRAM`, `ITERM_SESSION_ID`, `TERM_SESSION_ID`, `__CFBundleIdentifier`, il tty trovato risalendo i processi padre, `cwd`) e lo invia all'app.
- **Se l'app non risponde entro 300 ms, `nb-hook` esce con codice 0 senza scrivere nulla**: Claude Code prosegue normalmente. Mai un blocco.

### Eventi da collegare e stato del personaggio
| Hook | Effetto nell'app |
|---|---|
| `SessionStart` | crea l'attività (nome = cartella), stato `idle` |
| `UserPromptSubmit` | stato `thinking`, riga dello scorrimento = inizio del prompt |
| `PreToolUse` | stato `working`, riga = strumento + destinazione («Modifica Invoice.swift», «Esegue npm test») |
| `PostToolUse` / `PostToolUseFailure` | aggiorna la riga; un fallimento resta `working` |
| `PermissionRequest` | avviso `approval` (vedi sotto) |
| `Notification` | secondo il tipo: attesa di input → `question` se c'è una domanda, altrimenti niente; limite d'uso → `ratelimit` |
| `Stop` | stato `finished` → vista `finished` per 5,2 s, riepilogo = ultima frase utile della risposta, se disponibile |
| `StopFailure` (se presente nella documentazione) | avviso `error` |
| `SubagentStart` / `SubagentStop` | mostrare «+ sub-agente» nello scorrimento |
| `SessionEnd` | rimuove l'attività |

Verificare nella documentazione l'elenco esatto degli eventi e i loro campi.

### Approvare dall'isola
- Su `PermissionRequest`, `nb-hook` **attende** la decisione dell'app (predefinito 110 s, regolabile) poi scrive su stdout il JSON di decisione dell'hook (secondo la documentazione attuale: `hookSpecificOutput` con `decision.behavior` = `allow` o `deny`). Timeout dell'hook in settings.json: decisione + 10 s.
- Nessuna risposta entro il tempo, o app chiusa → nessun output, il terminale mostra la sua solita richiesta. Se l'utente risponde nel terminale, l'app rimuove l'avviso al successivo evento della sessione.
- È stato segnalato un bug per cui `deny` veniva ignorato su `PermissionRequest` (issue GitHub anthropics/claude-code #19298). **Testare allow e deny**; se deny non funziona, spostare la decisione su `PreToolUse` (`permissionDecision`) per gli strumenti interessati.
- «Consenti sempre»: se la documentazione permette di restituire una regola di permesso persistente, usarla. Altrimenti l'app tiene una propria lista (progetto + strumento + schema del comando) e da lì in poi risponde `allow` in automatico. Lista visibile ed eliminabile nelle impostazioni.
- Scorciatoie Y / N quando la vista `approval` è aperta.

### Rispondere alle domande
- Se Claude usa lo strumento di domanda (`AskUserQuestion`), intercettarlo in `PreToolUse` e mostrare le opzioni nella vista `question`.
- Verificare nella documentazione se un hook può fornire la risposta. Se sì: clic su un'opzione = risposta. **Se no**: la vista mostra la domanda e un pulsante «Rispondi nel terminale» che porta alla sessione. Niente pressioni di tasti simulate.

### Saltare al terminale
| Contesto rilevato | Azione |
|---|---|
| `TERM_PROGRAM=Apple_Terminal` + tty | AppleScript su Terminal: selezionare la scheda con il `tty` corrispondente, attivarla |
| `TERM_PROGRAM=iTerm.app` + `ITERM_SESSION_ID` | AppleScript su iTerm: selezionare la sessione, attivarla |
| `TERM_PROGRAM=vscode` | aprire la cartella `cwd` in VS Code o Cursor (secondo `__CFBundleIdentifier`) |
| Ghostty, Warp, altro | attivare l'app |
| niente (app Claude) | attivare l'app Claude |
La prima volta chiede il permesso di Automazione (è normale).

### Installazione degli hook: procedura obbligatoria
1. Leggere `~/.claude/settings.json` (crearlo se non esiste).
2. Copiarlo in `~/.claude/settings.json.bak-AAAAMMGG-HHMM`.
3. **Unire**: aggiungere gli hook di Notch Buddy senza toccare quelli esistenti. Percorso di `nb-hook` tra virgolette (contiene uno spazio).
4. Mostrare il diff all'utente, attendere la conferma, scrivere.
5. Pulsante «Disinstalla hook» nelle impostazioni che rimuove solo le voci di Notch Buddy.

---

## 2. n8n (workflow dell'utente)

- Impostazioni: URL dell'istanza e chiave API di n8n (Portachiavi). La chiave si crea in n8n: Settings → n8n API.
- È il computer a contattare n8n, non il contrario: **polling** ogni 5 s dell'API pubblica:
  - nomi dei workflow: `GET /api/v1/workflows` (cache di 10 min);
  - esecuzioni recenti: `GET /api/v1/executions` con filtri di stato e `limit`.
- Corrispondenze:
  - esecuzione in corso → attività `working` (se l'API espone le esecuzioni in corso; altrimenti n8n compare solo per errori e successi, ed è accettabile);
  - nuova esecuzione in errore → avviso `error`, dettaglio = nodo fallito + messaggio (`GET /api/v1/executions/{id}?includeData=true`);
  - successo → mini-personaggio `finished` per 3 s in compact, **senza** aprire l'isola (sarebbe troppo rumore), salvo impostazione contraria.
- Pulsanti:
  - «Riprova» → endpoint di retry dell'API pubblica (verificarne esistenza e percorso nel playground dell'istanza). Se non esiste: aprire l'esecuzione in n8n.
  - «Apri in n8n» → aprire `{URL}/workflow/{workflowId}/executions/{executionId}` nel browser predefinito.
- Impostazione «workflow seguiti»: tutti per impostazione predefinita, lista con caselle di spunta.

---

## 3. File rilasciati

- Trascina e rilascia nativo sul pannello (tipi `fileURL`). Copiare i file in `~/Library/Application Support/NotchBuddy/inbox/` (è la fase `uploading`). Su Windows: `%LOCALAPPDATA%\Coucou\inbox\`.
- Vista `choose`:
  - **Fai una domanda** → vista `prompt` con una pillola del file. Invio all'API Claude (§5): PDF come blocco `document`, immagini come blocco `image`, testo e codice (≤ 200 KB) come testo. Altri tipi: messaggio «Non so leggere questo formato, ma posso inviarlo per email.»
  - **Invia per email** → vista `mail` (§6).
- Svuotare l'inbox dopo 7 giorni.

---

## 4. Agganciare il personaggio a una finestra

1. Al rilascio, trovare la finestra sotto il punto: `CGWindowListCopyWindowInfo(.optionOnScreenOnly)`, prima finestra di livello 0 che non sia la nostra e che contenga il punto. Recuperare app, titolo, riquadro.
2. Mostrare l'**alone**: un pannello trasparente, non cliccabile, posato sul riquadro della finestra. Bordo conico arcobaleno di 3 pt che ruota in 3 s (`#FF6B5B → #F7B32B → #2DD4A7 → #38BDF8 → #A78BFA → #F472B6`), velo multicolore in modalità multiply che respira (vedi `.attach` nel prototipo), dissolvenza in entrata di 600 ms. Suono `attach`, emote Occhiolino.
3. Contesto inviato a Claude:
   - cattura della finestra con ScreenCaptureKit (`SCScreenshotManager`), ridimensionata a 1568 px di larghezza massima;
   - se è Safari, Chrome, Arc o Brave: URL e titolo della scheda attiva via AppleScript.
4. Vista `prompt` con la pillola «Safari, escale.fr» (app + dominio), focus sul campo.
5. L'alone resta durante `searching` e sparisce quando compare il risultato o quando l'isola si chiude.

Permessi: Registrazione dello schermo (cattura) e Automazione (browser). Se negati: si continua senza cattura o senza URL, e lo si dice in una riga nella vista.

---

## 5. API Claude (ricerca)

- `POST https://api.anthropic.com/v1/messages`, intestazioni `x-api-key`, `anthropic-version`, `content-type: application/json` (versioni da verificare nella documentazione).
- Modello predefinito: regolabile nelle impostazioni. Verificare l'elenco dei modelli disponibili nella documentazione.
- Strumento di ricerca web lato server dell'API: l'identificativo di tipo aggiornato è nella documentazione; `max_uses` 5.
- Prompt di sistema: rispondere in breve, per la visualizzazione nell'isola, in formato JSON rigoroso:
  ```json
  { "title": "…", "items": [ { "label": "…", "detail": "…", "url": "…" } ], "note": "…" }
  ```
  Al massimo 3 elementi. Se il JSON non è valido: mostrare il testo grezzo (massimo 3 righe) nella vista `result`.
- Contenuto del messaggio dell'utente: cattura (blocco image) + «URL: … / Titolo: … / Richiesta: …», oppure file (§3) + richiesta, oppure solo la richiesta (scheda Chiedi).
- Durante la chiamata: stato `searching`, vista `searching`, testo scintillante. Risposta: stato `finished`, vista `result`, emote Fiero, suono `finish`.
- Pulsanti del risultato: «Apri» (primo link), «Copia» (testo), «Chiudi».
- Errore di rete o chiave non valida: stato `error`, vista `note` con il motivo in una frase e «Apri le impostazioni per controllare la chiave».
- Microfono (pulsante del campo): dettatura `SFSpeechRecognizer`, sul dispositivo se possibile. Facoltativo (M9). Se il permesso viene negato, nascondere il pulsante.

---

## 6. Email (app Mail del Mac)

- Vista `mail`: A (obbligatorio, con validazione dell'indirizzo), Oggetto (precompilato: nome del file), Messaggio (facoltativo, una riga).
- Invio solo al clic su «Invia», via AppleScript (`NSAppleScript`) su Mail:
  ```applescript
  tell application "Mail"
    set m to make new outgoing message with properties {subject:"…", content:"…", visible:false}
    tell m
      make new to recipient at end of to recipients with properties {address:"…"}
      make new attachment with properties {file name:(POSIX file "…")} at after the last paragraph of content
    end tell
    delay 1
    send m
  end tell
  ```
  Il `delay` lascia a Mail il tempo di registrare l'allegato (comportamento noto). `Info.plist`: `NSAppleEventsUsageDescription`.
- Successo: vista `note` «Email inviata a …», emote Occhiolino, suono `send`. Fallimento: stato `error` con il motivo.

---

## 7. Permessi macOS richiesti (riepilogo)

| Permesso | Perché | Quando |
|---|---|---|
| Automazione → Mail | inviare le email | primo invio |
| Automazione → Terminal / iTerm / browser | saltare alla scheda giusta, leggere l'URL | primo utilizzo |
| Registrazione dello schermo | catturare la finestra agganciata | primo aggancio |
| Microfono + Riconoscimento vocale (facoltativo) | dettatura | primo clic sul microfono |

Nessun permesso di Accessibilità necessario.
