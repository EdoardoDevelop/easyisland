# Motori AI
> sezione: Intelligenza artificiale
> in breve: Quale motore scegliere, come configurarlo e cosa sa fare ognuno.

In **Impostazioni → Chat e motori AI** ogni motore ha la sua **card**: se è pronto o cosa manca (chiave, modello, login), come si paga, cosa sa fare e il modello scelto. Un clic su una card apre sotto chiave, modello e opzioni di quel motore; **Usa come predefinito** lo rende il motore della chat (la card ha l'etichetta verde **Predefinito**). Dal nome del modello in alto a destra nella chat ne scegli un altro solo per quella conversazione: il menu mostra solo i motori pronti.

## Confronto
| Motore | Costo | Strumenti di EasyIsland | Note |
|---|---|---|---|
| **Abbonamento Claude** (tramite Claude Code) | Il tuo piano Pro/Max | Sì | Il predefinito. Ricerca web, connettori MCP, modalità terminale |
| **Chiave API Anthropic** | A consumo | Sì | Ricerca web e strumenti di EasyIsland |
| **opencode** | Gratuito (Zen) o del fornitore | Sì | Modelli gratuiti, locali o dei fornitori collegati, con comandi e file |
| **Antigravity** (Google) | Il tuo account Google | Sì | Con i suoi strumenti |
| **OpenRouter** | A consumo | Con la modalità terminale (interna) | Una chiave per centinaia di modelli |
| **OpenAI** | A consumo | Con la modalità terminale | |
| **Gemini** (Google AI Studio) | A consumo / gratuito | Con la modalità terminale | |
| **Modello sul PC** | Gratis, dentro EasyIsland | Con la modalità terminale (serve la scheda grafica) | Nulla esce dal PC, niente da installare |
| **Ollama**, **LM Studio** | Gratis, sul tuo PC | Con la modalità terminale (interna) | Nulla esce dalla rete |

## Abbonamento Claude
EasyIsland usa **Claude Code installato sul PC** (nascosto, senza finestre) con il tuo piano Pro o Max: nessuna chiave e nessun costo extra, ma le domande contano nei limiti del piano. Claude Code resta acceso tra un messaggio e l'altro, così le risposte partono in fretta.

> **Importante:** serve **Claude Code da riga di comando** con il login fatto. L'app desktop di Claude da sola non basta (il suo Claude Code usa il login dell'app, che gli altri programmi non possono usare). Una volta sola:
>
> 1. in PowerShell: `irm https://claude.ai/install.ps1 | iex`
> 2. chiudi e riapri PowerShell, scrivi `claude` e accedi con il tuo account;
> 3. in Impostazioni → Chat premi **Ricontrolla**: il pallino diventa verde.

Senza modalità terminale, Claude Code lavora in una cartella vuota con solo ricerca web, lettura di pagine web e lettura dei file che rilasci, più gli strumenti di EasyIsland e i connettori che scegli.

### Connettori MCP
**Impostazioni → Chat → Connettori** (solo con l'abbonamento): la chat può usare i server MCP che hai configurato in Claude Code per l'utente (`claude mcp add --scope user …`) e quelli dei plugin di Claude Code attivi, scegliendo quali **profilo per profilo**. Con «chiedi conferma» (predefinito) ogni operazione compare nella chat, sotto l'ultimo passo, con **Consenti / Nega**; spegnila solo per i connettori di sola lettura. EasyIsland legge solo i nomi dei server, mai la loro configurazione. I connettori di claude.ai non sono disponibili in questo modo.

## Chiavi API
Per Anthropic, OpenRouter, OpenAI e Gemini: la chiave va nel suo campo e finisce in **Gestione credenziali di Windows**. Il modello si sceglie dall'elenco con **Carica modelli** (con il prezzo, quando il fornitore lo dice). La risposta compare mentre arriva; il ragionamento dei modelli che lo mostrano resta nascosto.

## opencode
Serve **opencode 2** sul PC. EasyIsland avvia un server privato di opencode solo mentre chatti e lo spegne dopo 10 minuti. Il modello si scrive come `fornitore/modello` (**Carica modelli**); le chiavi dei fornitori restano in opencode (`opencode auth login`). Il modello può eseguire comandi, leggere e modificare file e cercare sul web: ogni comando, modifica o accesso al web chiede **Consenti / Nega** (**Sempre** solo per i comandi che leggono soltanto); se non rispondi è un no.

> **Attenzione:** con i modelli gratuiti online i dati possono essere usati per addestrare il modello: niente dati dei clienti. Per quelli usa un modello locale.

## Antigravity
Installi la CLI con `irm https://antigravity.google/cli/install.ps1 | iex`, poi scrivi `agy` e accedi con Google. Con gli hook di Antigravity installati, i suoi comandi chiedono Consenti / Nega nell'isola.

Come con Claude, dal menu del motore scegli il **modello** (quelli del tuo account Antigravity) e l'**impegno** per quella conversazione; il pulsante della modalità passa da **Manuale** ad **Accetta modifiche**, **Piano** e **Automatica** (come la sua modalità Turbo: nessuna domanda sui comandi). In **Piano** Antigravity prepara il piano e te lo mostra in una card: **Procedi** per farlo lavorare, **Continua a pianificare** per cambiarlo.

## Modello sul PC
Un modello di intelligenza artificiale che gira **dentro EasyIsland**, senza programmi da installare e senza che niente esca dal PC. Nella card **Modello sul PC**:
- in alto EasyIsland dice che **scheda grafica** hai e quanta memoria ha; il modello adatto al tuo PC ha l'etichetta **Consigliato per questo PC**, quelli troppo grandi o lenti lo dicono;
- **Scarica** prende il modello (e, la prima volta, il motore llama.cpp, 37 MB); ogni file viene controllato prima dell'uso. Puoi anche usare un file **GGUF** che hai già;
- **Prova la velocità** dice quanti token al secondo scrive e se lavora sulla scheda grafica (da 15 in su la chat è scorrevole);
- **Scheda grafica**: acceso, il modello lavora sulla scheda (NVIDIA, AMD o Intel); spento, solo sul processore;
- **Risposte dalla memoria**: quando EasyIsland risponde dalla memoria, il modello scrive la risposta con le righe trovate; le righe restano sotto, e se il modello nomina qualcosa che non c'è si vedono solo le righe.

Il modello si avvia quando serve e si spegne da solo dopo 5 minuti senza domande, liberando memoria e scheda grafica. Con la **modalità terminale** esegue comandi e modifica file da solo, dopo il tuo permesso, senza altri programmi, se sta sulla scheda grafica.

## Ollama e LM Studio
Con la **modalità terminale**, come il Modello sul PC e OpenRouter, usano il terminale interno di EasyIsland: comandi e file dopo il tuo permesso, senza opencode. Serve un modello che sappia usare gli strumenti.
Modelli sul tuo PC o su un altro della rete: nessuna chiave, solo l'indirizzo (vuoto = quello predefinito).

## Più motori insieme
- **Seconda opinione** sotto ogni risposta: un altro motore fa da revisore.
- Nei **compiti** scegli un motore per compito e dei **motori aiutanti** a cui delegare pezzi del lavoro (vedi [Compiti](14-compiti.md)).
- Le **abilità** possono indicare il motore che preferiscono.
- **Telegram** ha il suo motore e il suo modello, scelti con `/motore` e `/modello`.
