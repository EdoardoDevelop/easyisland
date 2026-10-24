# Widget
> sezione: Collegare i servizi
> in breve: Controlli ripetibili senza codice: siti, certificati, domini, server, porte, servizi, calendari, API.

**Impostazioni → Widget** aggiunge controlli che puoi ripetere quante volte vuoi (un sito per cliente, un server per sede…). A differenza delle integrazioni, che sono una per servizio, i widget sono **sonde**.

| Tipo | Cosa controlla |
|---|---|
| **Calendario** | I prossimi appuntamenti da un link ICS (Google Calendar, Outlook.com, iCloud), senza login; avvisa qualche minuto prima. Il link è segreto e sta in Gestione credenziali |
| **Scadenza domini** | I giorni alla scadenza di uno o più domini (RDAP, o WHOIS per registri come `.it`) |
| **Sito web** | Che un indirizzo risponda (2xx/3xx o lo stato che indichi) e in quanto tempo |
| **Certificato HTTPS** | I giorni alla scadenza: arancione sotto i 30, rosso sotto i 7 o se scaduto |
| **Ping** | Che un host risponda (senza diritti di amministratore) |
| **Porta TCP** | Che una porta sia aperta (es. 3389, 22, 443) |
| **Servizio Windows** | Che un servizio locale sia in esecuzione (es. `Spooler`) |
| **API JSON** | Qualsiasi API: i campi da mostrare (percorso tipo `data.items[0].stato`) e una regola di avviso (es. `aperti > 10`); le intestazioni segrete in Gestione credenziali |

- **▶** prova un widget subito.
- Quando un controllo passa da OK a problema: pallino nel menu, suono, isola che si fa vedere (secondo le notifiche del profilo). Un errore nuovo si mostra solo se si ripete dopo 15 secondi, e dopo uno standby i controlli aspettano che la rete torni.
- Più radi a batteria, fermi in pausa.
- I widget appartengono al profilo e possono avviare un'[automazione](14-automazioni.md).

> **Suggerimento:** per un servizio unico con più dati (un'API con elenchi, avvisi e azioni) è meglio un'[integrazione personale](22-integrazioni-personali.md) con una fonte di dati.
