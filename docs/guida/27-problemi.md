# Problemi e soluzioni
> sezione: Riferimento
> in breve: Le domande e i problemi più comuni, con cosa fare.

## Installazione e avvio
| Problema | Soluzione |
|---|---|
| SmartScreen o Defender bloccano l'installer | È l'avviso dei programmi non firmati: **Ulteriori informazioni → Esegui comunque** |
| Il personaggio non compare | Guarda nell'area di notifica (^ accanto all'orologio); controlla che non sia in **Pausa**, che lo schermo intero non lo nasconda e che «davanti al cliente» non sia attivo; leggi il log |
| Non trovo le Impostazioni | Icona nell'area di notifica → Impostazioni…, oppure `easyisland.exe --settings` |
| Il personaggio va dietro la barra | Cliccando la barra o aprendo Start può succedere: torna davanti al cambio di finestra |

## Agenti
| Problema | Soluzione |
|---|---|
| Le sessioni di Claude Code non arrivano | Impostazioni → Agenti di codice → Installa…, poi apri una **nuova** sessione |
| Codex non manda niente | Dopo l'installazione apri `/hooks` in Codex e approva gli hook di EasyIsland |
| opencode non compare | Con opencode 2 accendi **Collega opencode**; con la 1.x riavvia opencode dopo l'installazione |
| Il permesso non arriva all'isola | EasyIsland ha un tempo limite: se non risponde, l'agente lo chiede nel terminale. Controlla la Pausa e le notifiche del profilo |

## Chat
| Problema | Soluzione |
|---|---|
| «Abbonamento Claude» rosso | Serve Claude Code da riga di comando con il login: `irm https://claude.ai/install.ps1 \| iex`, poi `claude` e accedi; poi **Ricontrolla** |
| «Accesso scaduto» | EasyIsland prova a rinnovarlo da sola; altrimenti apri `claude` e rifai l'accesso |
| Un connettore MCP non si vede | Deve essere configurato per l'utente (`--scope user`) e scelto nel profilo; quelli di claude.ai non sono disponibili |
| La chat non usa gli strumenti | Impostazioni → Chat → **Può usare il PC** acceso, e un motore con strumenti (abbonamento, chiave Anthropic, opencode, Antigravity) |
| Risposte lente | Il log scrive i secondi di ogni turno e strumento: guarda lì cosa pesa |

## Chiavi e integrazioni
| Problema | Soluzione |
|---|---|
| Una chiave «non si salva» | Gestione credenziali di Windows è piena (spesso di token in cache di altre app): elimina le voci inutili da Pannello di controllo → Gestione credenziali → Credenziali generiche |
| «Manca: chiave» | L'integrazione ha bisogno di una credenziale: apri la sua riga e inseriscila |
| Outlook non legge niente | Serve Outlook **classico** aperto, oppure l'account Microsoft |
| 3CX non si collega | Controlla indirizzo con la porta, interno e password del web client; la verifica in due passaggi non è supportata |
| Notion risponde 403 | L'integrazione di Notion deve poter leggere, aggiornare e inserire, ed essere aggiunta alle pagine e ai database |
| Telegram non risponde | Funziona solo con il PC acceso e la chat collegata con `/start <codice>` |

## Memoria e compiti
| Problema | Soluzione |
|---|---|
| La finestra Memoria è vuota | La memoria si riempie usando la chat, con `/ricorda` e con i file in `da-leggere`; la cronologia deve essere accesa |
| Un compito è in pausa | Ha raggiunto i turni o i minuti massimi, o aspetta una risposta: riprendilo o rispondi |
| Il Battito non parte | Con `BATTITO.md` vuoto non parte di proposito |

## Il log
`%LOCALAPPDATA%\EasyIsland\easyisland.log` racconta cosa è successo: è la prima cosa da guardare, e da allegare a una segnalazione su [GitHub](https://github.com/EdoardoDevelop/easyisland/issues).
