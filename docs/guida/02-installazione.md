# Installazione
> sezione: Per iniziare
> in breve: Scaricare, installare, aggiornare e disinstallare EasyIsland.

## Installare
1. Apri le [release su GitHub](https://github.com/EdoardoDevelop/easyisland/releases/latest) e scarica **EasyIsland-Windows-X.Y.Z-setup.exe**.
2. Eseguilo. L'installazione è **solo per l'utente corrente**: nessuna richiesta di amministratore.
3. L'installer non è ancora firmato con un certificato, quindi Windows SmartScreen mostra un avviso: clicca **Ulteriori informazioni → Esegui comunque**.

Al termine EasyIsland si avvia e il personaggio ti saluta. Da quel momento lo trovi nel menu Start e nell'**area di notifica** (la freccia ^ accanto all'orologio).

> **Suggerimento:** se Defender blocca l'installer è un falso positivo dei programmi non firmati: usa «Esegui comunque».

## Dove finiscono i file
| Cosa | Dove |
|---|---|
| Il programma | `%LOCALAPPDATA%\EasyIsland` |
| Il relay per gli agenti | `%LOCALAPPDATA%\EasyIsland\bin\easyisland-hook.exe` |
| Il log | `%LOCALAPPDATA%\EasyIsland\easyisland.log` |
| Impostazioni, memoria, compiti, abilità, integrazioni personali | `%APPDATA%\EasyIsland` |
| Chiavi, token, password | Gestione credenziali di Windows (mai su disco) |

## Aggiornare
All'avvio e poi una volta al giorno EasyIsland guarda se su GitHub c'è una versione nuova. Se c'è, l'isola mostra **Aggiornamento disponibile** con **Installa** e **Più tardi**:
- niente si installa senza il tuo clic;
- l'aggiornamento è **firmato** e la firma viene verificata prima di eseguirlo;
- installando, EasyIsland si chiude e si riapre da sola; impostazioni e chiavi restano.

In **Impostazioni → Generale → Aggiornamenti** vedi la versione, controlli a mano con **Controlla ora** o spegni il controllo automatico.

## Disinstallare
1. Prima, in **Impostazioni → Agenti di codice**, sulla riga di ogni agente collegato clicca **Disinstalla…**: il disinstallatore di Windows di proposito non tocca i file di configurazione degli agenti (per esempio `settings.json` di Claude Code).
2. Poi **Impostazioni di Windows → App → App installate → EasyIsland → Disinstalla**.

La cartella `%APPDATA%\EasyIsland` (memoria, compiti, abilità) resta: cancellala a mano se non ti serve più.

## Compilarlo da te
Se preferisci partire dal codice sorgente, servono Git, Node.js, Rust e i Build Tools di Visual Studio: i passi sono in [Per sviluppatori](28-sviluppo.md). Il risultato è lo stesso installer.
