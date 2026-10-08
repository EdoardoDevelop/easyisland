# Da provare dal vivo

Funzioni verificate finora solo con i test o nell'anteprima del browser. Togli una voce quando è provata, e annota in `HANDOFF.md` ciò che non va.

- [ ] **opencode vero nell'app installata** (la prova che manca di più):
  - (a) «Segui opencode 2» acceso, con una sessione nel TUI e una in opencode Desktop. In `easyisland.log` devono comparire `opencode SessionStart`, `opencode PreToolUse`… La scheda Agenti deve aprirsi su opencode, con i pulsanti Claude Code / opencode. «Apri opencode» deve portare a Desktop o al terminale.
    - Se il registro ha le righe ma l'isola no, il problema è in `hooks.ts`.
    - Se il registro non le ha, il problema è nello stream del servizio.
    - Con `"*": "allow"` di serie opencode chiede pochi permessi: per vedere la card provare un comando fuori dalla cartella.
  - (b) Chat: Impostazioni → Chat → opencode, scegliere un modello e fare una domanda che richiede un comando. Devono comparire la card Consenti / Nega / Sempre, il testo in streaming e i passi `> ⚙`.
  - (c) Il menu dei motori nella chat vale solo per la conversazione: «Nuova chat» torna al predefinito.
- [ ] **3CX con il centralino vero:** accesso, rubrica, chiamate in uscita da ogni dispositivo, in arrivo con Rispondi/Rifiuta, Riaggancia, stato, perse, Recenti, modalità client API. L'isola deve chiudersi quando risponde un collega o quando rispondi dal telefono. Se non succede, servono le righe `3cx: call` del log.
- [ ] **Claude Code vero:**
  - esito dei test quando fallisce (output in `error` di `PostToolUseFailure`)
  - `TaskCreate`/`TaskUpdate`
  - `PermissionRequest` per ExitPlanMode
  - silenzio a fine lavoro con la sessione in primo piano
  - pulizia delle sessioni morte, anche nell'app desktop
  - «Sempre» e diff in tempo reale
  - permesso che resta su un'altra scheda
  - named pipe da un Claude Code avviato come amministratore
- [ ] **Azioni rapide:** «Programma» con `chrome`, `regedit`, un percorso tra virgolette e `%ProgramFiles%`; Salva / Annulla e ordine delle cartelle nella finestra vera.
- [ ] **Altri agenti veri:** Codex (hook, `/hooks`, Consenti/Nega), Gemini CLI, Cursor e Copilot CLI (nomi reali degli strumenti, `workspace_roots` su Windows), Claude Code nel terminale di Cursor.
- [ ] **Vassoio:** trascinamento verso Outlook, Teams ed Esplora file.
- [ ] **Outlook** con Outlook aperto; **Zammad** con un server reale; **Consumo Claude**: il messaggio di limite raggiunto non è mai comparso.
- [ ] **Selezione e suggerimenti ⚡:** Ctrl+C reale in Excel, Outlook e browser, con il ripristino degli appunti.
- [ ] **Agente e automazioni:** card Consenti/Nega in una chat vera; ogni tipo di «Quando» e «Prova ora»; proposte dalle abitudini (servono settimane con `habitsEnabled`).
- [ ] **Altri motori della chat** con chiavi vere e Ollama/LM Studio; markdown (Copia, link).
- [ ] **Appunti e Musica** (Ctrl+V, immagini da varie app, Spotify/browser), **Cattura una zona** con entrambi i motori, **calcolatrice**, **ZIP** veri.
- [ ] **Widget:** script del certificato TLS, calendario ICS reale. **«Davanti al cliente»** con Teams e assistenza remota veri.
- [ ] **Isola:** spostamento e posizione mantenuta, schermi secondari, Start aperto con «Sopra la barra», ridimensionamento.
