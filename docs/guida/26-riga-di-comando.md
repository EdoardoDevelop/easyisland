# Riga di comando e script
> sezione: Riferimento
> in breve: Messaggi sull'isola da qualsiasi script, il relay degli hook e gli altri strumenti che si collegano.

## Messaggi dagli script
Qualsiasi script, attività pianificata, flusso n8n o programma può mostrare un messaggio sull'isola:

```powershell
& "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" notify "Backup" "Completato in 4 minuti" --stato ok
```

| Opzione | Significato |
|---|---|
| `--stato` | `ok`, `avviso`, `errore` o `info` (colore e suono) |
| `--apri https://…` | Aggiunge un pulsante con un link |
| `--help` | L'aiuto |

Esce con **0** se il messaggio è arrivato e con **2** se EasyIsland non è in esecuzione, quindi uno script non resta mai bloccato. Valgono le regole di notifica del profilo. In **Impostazioni → Notifiche** c'è il comando pronto da copiare e **Prova**.

## Aprire le Impostazioni
```powershell
& "$env:LOCALAPPDATA\EasyIsland\easyisland.exe" --settings
```

## Il relay degli agenti
`easyisland-hook.exe` è il ponte tra gli agenti e l'app. Gli agenti lo chiamano con il nome dell'evento e il JSON dell'evento sull'input standard (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`…). Ha 300 ms per raggiungere l'app ed esce con 0 se non ci riesce.

### Un tuo strumento in Agenti
Qualsiasi programma può comparire nella scheda Agenti mandando gli stessi eventi degli hook di Claude Code con un campo in più:

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "bot-42",
  "cwd": "C:\\progetti\\report",
  "easyisland_agent": { "id": "mio-bot", "name": "Il mio bot", "color": "#22C55E" }
}
```

```powershell
$json | & "$env:LOCALAPPDATA\EasyIsland\bin\easyisland-hook.exe" SessionStart
```

## Il server MCP di EasyIsland
`easyisland-hook.exe mcp` è un server MCP (stdio) con gli strumenti di EasyIsland. La chat lo usa da sola; per Claude Code fuori dall'app si aggiunge da **Impostazioni → Agenti di codice → Strumenti di EasyIsland in Claude Code** (equivale a `claude mcp add --scope user easyisland -- …\easyisland-hook.exe mcp`). Fuori dall'app ha in più `show_card` (una card con pulsanti che aspetta la tua scelta) e `add_to_tray`.

## Il log
`%LOCALAPPDATA%\EasyIsland\easyisland.log`: avvio, eventi degli hook, decisioni sui permessi, tempi dei turni della chat e degli strumenti, problemi dei controlli. Resta sul tuo PC.
