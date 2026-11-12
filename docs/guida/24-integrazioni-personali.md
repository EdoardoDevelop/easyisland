# Integrazioni personali
> sezione: Collegare i servizi
> in breve: Chiedi alla chat la funzione che ti serve — un modulo, un cruscotto, un collegamento a un'API — e diventa una voce dell'isola. Senza scrivere codice.

## Crearne una
Scrivi in chat quello che ti serve, per esempio:
- «crea un'integrazione per i preventivi, con cliente, righe di prodotti con quantità e prezzo, IVA al 22 % e totale, che faccia il PDF»;
- «voglio un registro degli interventi con cliente, data, ore, tipo e note, e il totale delle ore del mese»;
- «fammi un cruscotto che legge ogni 10 minuti lo stato dei miei server dall'API di Uptime Kuma e mi avvisa se uno è giù»;
- «un pulsante che manda il modulo al mio webhook di n8n».

La chat propone campi, calcoli e azioni utili, ti chiede quello che non è chiaro e ti mostra **l'anteprima della descrizione** con **Consenti / Nega**. Confermando, l'integrazione compare nel menu dell'isola con la sua icona. Per cambiarla basta chiedere («aggiungi un campo sconto», «fai il totale in grassetto»): stessa anteprima, stessa conferma.

Quando la chat **cambia** un'integrazione, la card dice **cosa cambia**: i campi tolti (e in quante schede salvate erano compilati), i cambi di tipo, il numeratore che riparte, i campi nuovi, il modello molto più corto, le azioni tolte o con lo script cambiato. Le schede salvate restano, e la versione di prima viene copiata in `integrazioni\versioni`. Per un ritocco la chat manda solo il pezzo che cambia (un campo, il nome, il modello), non tutta la descrizione; può anche cambiare l'**id** (es. da `clienti-ddt` a `clienti`), e collegamenti, menu e Panoramica la ritrovano.

> **Importante:** un'integrazione personale è una **descrizione**: le sue azioni sono un elenco fisso. L'unica che contiene comandi è **Script**, e ti mostra sempre cosa sta per eseguire.

![Un'integrazione personale](../media/custom.png)

## Cosa può avere
### Campi
Testo, testo lungo, numero, **importo**, data, casella, scelta e scelta multipla, email, telefono, link, **file** (dal Vassoio o dal PC, e lo vedi nella scheda: immagini, PDF, testi e Word, audio e video con il lettore; se chiedi alla chat «solo file audio» o «solo mp3 e wav», il Vassoio e la finestra di Windows mostrano solo quelli), **tabella di righe** (con colonne anche calcolate), **calcolato** (una formula), **numerazione** automatica (es. `N-2026-0001`), **collegamento** a un'altra integrazione.
- **Collegamento con ricerca**: scrivi una parte di qualunque dato (nome, città, partita IVA…) e sopra il modulo compaiono le schede dell'altra integrazione che lo contengono (il campo prende il nome della scheda scelta); ne scegli una con il mouse o con frecce e <kbd>Invio</kbd>, e **gli altri campi si compilano da soli** (es. scegliendo il cliente da «Clienti» si riempiono indirizzo e partita IVA; scegliendo un servizio da «Listino» la riga prende descrizione e prezzo). Vale per qualsiasi elenco: clienti, fornitori, articoli, servizi, mezzi. Funziona anche come colonna di una tabella. Con **ricorda**, un nome nuovo scritto a mano viene aggiunto all'altra integrazione quando salvi la scheda, insieme ai dati compilati. Basta chiederlo alla chat: «quando scelgo il cliente compila indirizzo e P.IVA, e ricorda i clienti nuovi».
- **Scelte prese da un servizio**: una scelta può riempirsi da sola con i dati di un servizio collegato all'integrazione, per esempio i motori e le voci di un servizio di sintesi vocale, sempre aggiornati. Scrivi per cercare tra le scelte; una seconda scelta può dipendere dalla prima (le voci del motore scelto) e si svuota quando cambi la prima. Scegliendo, altri campi si compilano (es. il prezzo). Se il servizio non risponde il valore salvato resta e puoi scriverlo a mano.
- **Compare solo se**: un campo visibile solo quando una formula è vera (es. «IBAN» solo se pagamento = Bonifico).
- **Totale nell'elenco**: sommato o contato nella lista delle schede.

### Formule
Un linguaggio semplice, in italiano o in inglese: `+ - * / %`, confronti, `e` / `o` / `non`, `se(condizione; sì; no)`, `somma(quantita*prezzo)` sulle righe, `media`, `conta`, `arrotonda`, `min`, `max`, date (`oggi()`, `giorni(da; a)`, `piugiorni(data; 30)`, `anno`, `mese`), testo (`maiuscolo`, `unisci`, `contiene`, `lunghezza`). Numeri all'italiana (`0,22`). Mai codice eseguito.

### Modello del documento
Un documento in Markdown con i `{{campi}}`, le righe ripetute (`{{#righe}} … {{/righe}}`) e la data. **Documento** lo produce in **HTML stampabile**, in **PDF** (A4) o in Markdown, nel Vassoio.

**Dove salvare e come chiamare il file** lo dici alla chat, quando crei l'integrazione o dopo: «salva i PDF in `C:\Documenti\DDT`», «chiama il file numero e cliente», «nell'elenco mostra numero e cliente». Puoi usare più campi insieme, come `{{numero}} {{cliente}}`. Il documento va sempre nel Vassoio e in più nella cartella scelta, senza mai sovrascrivere: se il nome esiste già diventa `nome (2).pdf`. I caratteri che Windows non accetta nei nomi di file vengono tolti, e `/` diventa `-`.

Il modello può essere anche **HTML vero**, con la tua grafica: basta che cominci con un tag come `<!doctype html>`, `<style>` o `<div>`. I valori dei campi sono sempre protetti e script e link pericolosi vengono tolti.

**Anteprima**: il link sotto i pulsanti apre il documento con i dati che hai scritto, **senza salvare la scheda né usare un numero** (il numeratore mostra quello che avrebbe la prossima). La chat può fare lo stesso per provare un modello prima di dirti che è pronto.

**Stessa grafica per più integrazioni**: chiedi alla chat che il registro «usi il modello dei DDT»; logo e immagini (`{{file:logo.png}}`) si cercano nella cartella dell'integrazione, poi in quella da cui prende il modello, poi in `integrazioni\_comune`, dove puoi mettere il logo una volta per tutte.

- `{{data|lunga}}`: la data per esteso, «7 novembre 2026».
- `{{importo|it}}`: il numero con la virgola, «1.234,5».
- `{{#se vettore}}…{{/se}}`: il testo solo se il campo è pieno (vale anche una formula).
- `{{^vettore}}…{{/vettore}}`: il testo solo se il campo è vuoto.
- `{{file:logo.png}}`: nei modelli HTML, un'immagine messa in `%APPDATA%\EasyIsland\integrazioni\<id>\`.

### Azioni (i pulsanti)
| Azione | Cosa fa |
|---|---|
| **Salva** | Salva la scheda (elenco con ricerca, apri, duplica, elimina) |
| **Documento** | Il modello compilato, nel Vassoio |
| **Copia** | Il testo negli appunti |
| **Chiedi all'AI** | Una domanda alla chat con i campi |
| **Compila con l'AI** | Incolli una mail o un testo e l'AI riempie i campi |
| **Link** | Apre un indirizzo con i campi |
| **Azione rapida** | Esegue una tua azione; se è uno script riceve i dati della scheda |
| **Script** | Esegue comandi PowerShell o del Prompt: te li mostra e aspetta «Esegui» ogni volta. I dati della scheda sono nel file JSON indicato dalla variabile `EASYISLAND_SCHEDA`: in PowerShell leggilo con `Get-Content -Raw -Encoding UTF8`, o le lettere accentate si rovinano. Le chiavi dell'integrazione arrivano come variabili `EASYISLAND_SECRET_NOME`, senza scriverle nei comandi |
| **Notion** | Aggiunge la scheda a un database |
| **Esporta CSV** | Tutte le schede, per Excel |
| **Chiamata a un servizio** | GET/POST/PUT/PATCH/DELETE all'API di un tuo servizio, con i campi nel corpo; la risposta può riempire i campi e comparire in un messaggio. Se il servizio risponde con un **file** (una voce in mp3, un'immagine, un PDF) lo ascolti o lo vedi nella scheda e lo salvi; con una cartella e un nome scelti si salva da solo, senza mai sovrascrivere |
| **Compito** | Avvia un [compito](14-compiti.md) con i campi nell'obiettivo |
| **Avviso** | Un avviso nell'isola |
| **Sequenza** | Più azioni in fila (es. salva, poi chiama il servizio, poi fai il documento) |

### Fonti di dati: i cruscotti
Una **fonte** legge un servizio ogni N minuti (o quando apri la scheda) e mostra **valori** ed **elenchi**. Un **avviso** è una formula su ogni elemento: quando è vera, l'isola ti avvisa, una volta sola per elemento, e la prima riga va nella Panoramica. Un'integrazione può essere anche **solo un cruscotto**, senza modulo.

![Un cruscotto](../media/custom-dati.png)

### Chiavi
Le chiavi e i token dei servizi si scrivono come `{{secret:nome}}` e si inseriscono in **Impostazioni → Integrazioni → Create da te**: vanno in Gestione credenziali, le legge solo EasyIsland al momento della chiamata e **né l'isola né la chat le vedono mai**.

## Dalla chat e dai compiti
La chat e i compiti possono **leggere le schede**, **aggiungerne** (con Consenti / Nega), **leggere le fonti** e **chiamare le azioni** delle tue integrazioni: «quanti preventivi ho fatto a ottobre?», «registra un intervento di 2 ore per Rossi», «controlla i server e dimmi se c'è qualcosa».

## Gestirle
**Impostazioni → Integrazioni → Create da te**: accendi o spegni nel menu, modifica la descrizione JSON, inserisci le chiavi, elimina. I file stanno in `%APPDATA%\EasyIsland\integrazioni` (descrizione e schede, leggibili): se cambi a mano una descrizione, l'isola la rilegge da sola.

## Limiti, di proposito
- **Niente codice**: un'azione fa solo quello che il suo tipo prevede.
- Le chiamate vanno **solo ai servizi scritti nella descrizione** che hai approvato.
- **Nessun dato «spinto» dai servizi** (webhook in arrivo), perché servirebbe una porta aperta sul PC: si usa una fonte letta ogni N minuti.
- Funziona con il PC acceso.
