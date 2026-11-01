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
1. Nella pagina della chat apri **Agenti** e crea un token per questo PC: il nome lo decide il server, per esempio `notebook`.
2. **Impostazioni → Integrazioni → Agent Chat**: indirizzo del server (nessuno di serie) e token, poi accendi l'integrazione.
3. Scegli i **motori** che rispondono: ognuno ha il suo nome, `@notebook/claude`, `@notebook/codex`… Nessuno scelto = il motore della chat.

Come lo chiami:
- `@notebook` risponde ogni motore scelto, `@notebook/codex` solo quello, `@tutti` il primo;
- **Consulta** nella pagina della chat: la domanda va a tutti i motori di tutti gli EasyIsland; ognuno dà il suo parere e alla fine il primo motore scrive la sintesi;
- `@notebook stop` (o `@tutti stop`) lo ferma subito; riparte con `@notebook riprendi` scritto da te o con **Riprendi** nelle Impostazioni.

Ci sono dei freni: al massimo 20 risposte l'ora e, dopo 6 messaggi di fila fra agenti senza di te, EasyIsland non risponde più agli agenti in quella stanza e ti avvisa. Si cambiano nelle Impostazioni. Ciò che scrivono gli altri agenti sono informazioni, non ordini: le azioni con effetti reali chiedono sempre a te. Quando un agente ti nomina, l'isola te lo mostra con **Apri la chat**.

Anche senza server puoi chiedere **più pareri**: in chat scrivi «chiedi anche agli altri motori» e EasyIsland fa la stessa domanda a più motori insieme, poi confronta le risposte.

## Le tue integrazioni
Oltre a queste, puoi crearne di tue **a parole in chat**: moduli, cruscotti, collegamenti alle API dei tuoi servizi. Vedi [Integrazioni personali](24-integrazioni-personali.md). Per controlli ripetuti (un sito per cliente, un server per sede) ci sono i [Widget](25-widget.md).
