# Microsoft: Outlook, Teams, To Do
> sezione: Collegare i servizi
> in breve: Posta e calendario, riunioni Teams, attività di To Do e l'account Microsoft.

## Outlook
L'integrazione **Outlook** mostra le **mail non lette** e gli **appuntamenti di oggi e domani**, e avvisa qualche minuto prima di una riunione.
- Di serie legge **Outlook classico già aperto** (non lo avvia mai). Il nuovo Outlook non ha questa possibilità.
- Con l'**account Microsoft** (sotto) usa invece Microsoft Graph, anche senza Outlook aperto, con mittente e oggetto delle ultime mail.

## Teams
Senza nessun account:
- **Teams aperto** e **in riunione** si capiscono da Windows (microfono o webcam in uso);
- comandi della riunione nella card e **accanto al personaggio chiuso**: **Microfono**, **Video**, **Alza la mano**, **Esci** (le scorciatoie di Teams);
- **Partecipa dal link copiato**: copia un link di riunione Teams e un clic ti fa entrare;
- **automazioni** quando una riunione inizia o finisce.

Con l'account Microsoft: il tuo **stato** e le **riunioni online** di oggi e domani con **Partecipa**.

## Microsoft To Do
Gli strumenti della chat leggono e scrivono le tue attività di **To Do** attraverso **Outlook classico** (che deve essere aperto): «cosa ho da fare questa settimana?», «aggiungi chiamare Rossi domani alle 10 nella lista Clienti», «segna fatta la fattura di Bianchi». Aggiungere e cambiare chiedono Consenti / Nega. Le modifiche arrivano in To Do con la sincronizzazione di Outlook.

## Account Microsoft (API)
Nelle righe di Outlook e Teams, il blocco **Account Microsoft (API)** collega il tuo account di lavoro con **Microsoft Graph**:
1. registra un'applicazione in **Microsoft Entra** (ID applicazione pubblico, nessun segreto);
2. metti ID applicazione e tenant e clicca **Accedi**: si apre la pagina di accesso di Microsoft.

Permessi delegati **solo in lettura**: profilo, posta, calendario, presenza. Se la tua azienda richiede l'approvazione dell'amministratore, chiedila al tuo IT. Le chiamate vanno solo a `login.microsoftonline.com` e `graph.microsoft.com`, e solo dopo l'accesso.
