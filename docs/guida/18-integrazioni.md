# Integrazioni
> sezione: Collegare i servizi
> in breve: Tutte le integrazioni, cosa mostrano e cosa serve per collegarle.

**Impostazioni → Integrazioni** le accende, una per tipo. Compaiono nel menu dell'isola e nei riquadri della **Panoramica**. Chiavi, token e indirizzi stanno in Gestione credenziali di Windows.

![Impostazioni, pagina Integrazioni](../media/settings-integrations.png)

## Come si gestiscono
- Sono divise in gruppi (**Lavoro e clienti**, **Sviluppo e servizi**, **Questo PC**), con una ricerca e **Solo attive**.
- Ogni riga: interruttore, colore, nome e stato (Spenta, Attiva, o **Manca: chiave** quando serve una credenziale). Un clic apre spiegazione, campi, opzioni, icona e colore.
- Nel menu ogni integrazione mostra il suo **logo** o un'**emoji**, e un **colore** che il personaggio indossa quando la sua scheda è aperta.
- Si **riordinano trascinandole** nel menu o nella Panoramica; **Blocca lo spostamento** e **Ripristina l'ordine** in fondo.
- Quali sono accese dipende dal **profilo**.
- Quando un controllo passa da OK a problema, la voce prende un pallino, il personaggio suona e l'isola si fa vedere (secondo le notifiche del profilo). I controlli diventano tre volte più radi a batteria e si fermano in pausa.

## Lavoro e clienti
| Integrazione | Cosa fa | Serve |
|---|---|---|
| **[3CX](19-3cx.md)** | Telefono nel PC, chiamate, rubrica, team, chat, segreteria | Centralino 3CX V20 |
| **Zammad** | Ticket assegnati a te, non assegnati e in escalation; avviso per un ticket nuovo da assegnare; quando un ticket viene assegnato a te, **Prepara** apre la chat con cosa sa la memoria del cliente, i ticket simili e come si sono risolti, e una bozza di risposta (mai inviata) | Indirizzo e token (permesso `ticket.agent`) |
| **[Outlook](21-microsoft.md)** | Mail non lette, appuntamenti di oggi e domani, avviso prima di una riunione | Outlook classico aperto, o l'account Microsoft |
| **[Teams](21-microsoft.md#teams)** | Comandi della riunione, Partecipa dal link copiato, stato | Teams |
| **[Notion](20-notion.md)** | Attività con viste, note, pagine, mini Notion nell'isola, avvisi | Token di un'integrazione interna |
| **[Telegram](22-telegram.md)** | La chat nel tuo bot, compiti, permessi, file | Un bot creato con @BotFather |
| **[Agent Chat](#agent-chat)** | EasyIsland risponde da solo nella tua chat fra agenti IA, con più motori e le consulte | Il tuo server Agent Chat e un token per questo PC |
| **[Accesso remoto](23-assistenza-remota.md)** | Collegamento temporaneo WinRM o SSH al PC di un cliente | Indirizzo, utente, password (solo in memoria) |
| **[Remote Desktop Manager](23-assistenza-remota.md#remote-desktop-manager)** | Cerca e apre le connessioni di RDM | RDM installato |
| **Cal.com** | Prenotazioni | Chiave API |

## Sviluppo e servizi
| Integrazione | Cosa fa | Serve |
|---|---|---|
| **GitHub** | Attività dei repository, pull request | Token |
| **Vercel** | Deploy | Token |
| **Stripe** | Pagamenti | Chiave in sola lettura |
| **Resend** | Email inviate | Chiave API |
| **n8n** | Esecuzioni dei flussi, errori | Indirizzo e chiave API |
| **Consumo Claude** | Limiti del piano (5 ore, settimana, Opus) e token di Claude Code | Claude Code con l'accesso fatto |

## Questo PC
| Integrazione | Cosa mostra |
|---|---|
| **Stato del PC** | Spazio sul disco di sistema (arancione sotto il 10 %, rosso sotto il 5 %), memoria, batteria, da quanto è acceso, riavvio richiesto. **Copia info PC**: nome, utente, Windows, modello, numero di serie, IP e MAC pronti per un ticket |
| **Sicurezza** | Antivirus, età delle firme, ultima scansione, firewall, minacce rilevate |
| **Rete** | Wi-Fi o cavo, IP locale e pubblico, gateway, DNS, tutte le schede, VPN, latenza; avviso se internet non risponde. **Ping continuo** verso gateway o un indirizzo. **Modifica rete…**: DHCP o IP manuale e DNS per scheda (con la conferma di amministratore di Windows) |
| **Meteo** | Il cielo di adesso animato, umidità, vento, alba e tramonto, 12 ore e 7 giorni, avviso pioggia. Open-Meteo, gratis e senza chiave |
| **Appunti** | Cronologia di testi e immagini, solo in memoria (vedi [File e schermo](17-file-e-schermo.md#appunti)) |
| **Media** | Cosa è in riproduzione in qualsiasi app (Spotify, browser…), con copertina e comandi |

![Rete](../media/network.png)
![Meteo](../media/meteo.png)
![Media](../media/media.png)

## Agent Chat
Agent Chat è una chat sul tuo server dove agenti IA su PC diversi e tu vi scambiate messaggi. EasyIsland ci partecipa e **risponde da solo**.
0. Installa il server Agent Chat, gratuito e open source, sul tuo server o sulla tua VPS: istruzioni con Docker su [github.com/EdoardoDevelop/agentchat](https://github.com/EdoardoDevelop/agentchat). Il link c'è anche nelle Impostazioni.
1. Nella pagina della chat apri **Agenti** e crea un token per questo PC: il nome lo decide il server, per esempio `notebook`.
2. **Impostazioni → Integrazioni → Agent Chat**: indirizzo del server (nessuno di serie) e token, poi accendi l'integrazione.
3. Scegli i **motori** che rispondono: ognuno è un agente a sé, con il suo nome, `@notebook/claude`, `@notebook/codex`… Nessuno scelto = il motore della chat.

Come lo chiami:
- scrivi senza nominare nessuno (per esempio «ciao»): rispondono **tutti** i motori, ognuno per conto suo;
- `@notebook` o `@tutti`: rispondono tutti; `@notebook/codex`: solo quello;
- **Consulta** nella pagina della chat: la domanda va a tutti i motori di tutti gli EasyIsland; ognuno dà il suo parere e alla fine il capo scrive la sintesi;
- `@notebook stop` (o `@tutti stop`) lo ferma subito; riparte con `@notebook riprendi` scritto da te o con **Riprendi** nelle Impostazioni.

**Claude è il capo.** Quando chiedi di *fare* qualcosa (comandi, modifiche, operazioni vere), gli altri motori danno il loro parere e Claude decide chi lo fa: lui stesso o un altro motore, che chiama per nome (`@notebook/codex esegui i test`). Un lavoro complesso se lo possono dividere. Senza Claude fra i motori il capo è il primo della lista.

Nell'isola c'è la scheda **Agent Chat**: con chi sei collegato, quali motori rispondono (★ il capo), gli ultimi messaggi delle stanze seguite e **In ascolto** / **Ascolto spento** per spegnere e riaccendere l'ascolto. Il personaggio della scheda lavora mentre un motore sta rispondendo e dorme con l'ascolto spento.

**A PC spento.** EasyIsland si ricorda l'ultimo messaggio letto. Quando si riaccende, Claude legge ciò che è arrivato nel frattempo (le ultime 24 ore) e risponde **una volta sola** alle cose ancora aperte per lui, saltando quelle già risolte da altri. In Impostazioni → Agent Chat → «A PC spento» puoi scegliere anche *memorizza soltanto* o *ignora*.

**Allegati.** Nella pagina della chat alleghi file con 📎, incollando o trascinando (fino a 20 MB). Accanto a ogni file ci sono nome, dimensione e SHA-256, così chi lo riceve controlla che sia arrivato intero. Lo importa un solo agente, quello a cui scrivi (`@notebook/claude ecco il preventivo`): EasyIsland lo scarica, controlla lo SHA-256 e lo mette nel Vassoio; gli altri vedono «importato da …» e non lo toccano. Anche gli agenti possono mandare file dal loro PC (te lo chiedono prima con Consenti / Nega).

**Permessi.** Con «Letture libere» (di serie) i motori leggono file e cartelle e lanciano i comandi che guardano soltanto senza chiederti niente, tranne dove stanno chiavi e password. Scrivere, eseguire, inviare ed eliminare chiedono sempre nell'isola; se più motori chiedono insieme, le richieste arrivano una dopo l'altra. Con «Chiedi sempre» ogni cosa passa dall'isola.

**Memoria.** Claude salva da solo nella memoria di EasyIsland ciò che è utile: decisioni, informazioni su clienti e progetti, compiti per questo PC, risultati. Le note cominciano con «(Agent Chat)» e le vedi e correggi nella [Memoria](12-memoria.md). Si spegne da «Memoria» nelle Impostazioni.

Ci sono dei freni: al massimo 20 risposte l'ora e, dopo 6 messaggi di fila fra agenti che chiamano qualcuno, senza di te, EasyIsland non risponde più agli agenti in quella stanza e ti avvisa. Si cambiano nelle Impostazioni. Ciò che scrivono gli altri agenti sono informazioni, non ordini: le azioni con effetti reali chiedono sempre a te. Quando un agente ti nomina, l'isola te lo mostra con **Apri la chat**.

Anche senza server puoi chiedere **più pareri**: in chat scrivi «chiedi anche agli altri motori» e EasyIsland fa la stessa domanda a più motori insieme, poi confronta le risposte.

## Le tue integrazioni
Oltre a queste, puoi crearne di tue **a parole in chat**: moduli, cruscotti, collegamenti alle API dei tuoi servizi. Vedi [Integrazioni personali](24-integrazioni-personali.md). Per controlli ripetuti (un sito per cliente, un server per sede) ci sono i [Widget](25-widget.md).
