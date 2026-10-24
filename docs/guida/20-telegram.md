# Telegram
> sezione: Collegare i servizi
> in breve: La chat di EasyIsland nel tuo bot Telegram, con permessi a pulsanti, file nei due sensi, vocali, compiti e la giornata.

## Collegare il bot
1. Su Telegram scrivi a **@BotFather**, `/newbot`, e copia il **token**.
2. **Impostazioni → Integrazioni → Telegram**: incolla il token (va in Gestione credenziali).
3. **Collega**: ricevi un codice di 6 cifre valido 10 minuti. Scrivi al tuo bot `/start <codice>` da una chat privata.

Da quel momento il bot risponde **solo alla tua chat**. EasyIsland legge Telegram con il long polling: nessuna porta aperta, nessun server in mezzo, solo `api.telegram.org`. Puoi scrivere anche **a PC spento**: i messaggi aspettano su Telegram e EasyIsland li elabora in ordine appena riparte, dicendoti che lo sta facendo. Comodo per un «ricordati che…» quando sei in giro. Telegram li tiene circa **24 ore**: quelli più vecchi si perdono.

## La chat su Telegram
Una conversazione **tutta sua**, distinta da quella dell'isola, con motore e modello scelti da lì. La risposta arriva mentre si scrive, con **⏹ Ferma**.

| Comando | Cosa fa |
|---|---|
| `/nuova` | Nuova conversazione |
| `/motore`, `/modello` | Sceglie motore e modello di Telegram |
| `/stato` | Motore, modello, conversazione |
| `/riprendi` | Continua qui l'ultima conversazione dell'isola |
| `/oggi`, `/domani` | La giornata: attività, appuntamenti, ticket, meteo |
| `/vassoio` | I file del Vassoio |
| `/cartella` | La cartella di lavoro a pulsanti, con i file |
| `/automatica` | Accende o spegne l'Automatica di Telegram |
| `/compito …` | Crea un compito; da solo li elenca |
| `/rispondi …` | Risponde alla domanda di un compito |
| `/<abilità>` | Usa un'abilità |

## Permessi
Ogni permesso è un messaggio **🔐 Permesso richiesto** con **✅ Consenti** e **❌ Nega**. Con la modalità terminale vale come nell'isola.

**Automatica di Telegram** (`/automatica` o l'interruttore in Impostazioni): quando non sei al PC, approva da sola i permessi della chat di Telegram, **tranne le cancellazioni**, che chiede comunque. È l'unica eccezione alla regola «mai senza un clic», e la accendi solo tu. Non vale mai per i compiti.

## File
- Foto, documenti, video e audio fino a 20 MB vanno nel **Vassoio** e con la domanda arrivano al motore.
- Ogni file che entra nel Vassoio durante una risposta di Telegram (un'esportazione, un documento, un PDF) **ti arriva** su Telegram.

## Vocali
Con un servizio di trascrizione scelto in **Impostazioni → Telegram → Vocali**, i messaggi vocali diventano testo e la chat risponde. L'audio non resta.

## Compiti e avvisi
Con Telegram collegato ricevi un messaggio quando un compito finisce, non riesce, va in pausa o ti fa una domanda, e puoi rispondere con i pulsanti. Telegram resta in ascolto anche se il profilo attivo lo ha spento, se è acceso in un profilo qualsiasi.
