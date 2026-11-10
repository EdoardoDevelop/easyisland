# Versioni di EasyIsland

Cosa è cambiato in ogni versione, dalla più recente. Il riassunto delle ultime sta nel [README](README.it.md#ultime-versioni).

**1.0.42** — **Gruppi nel menu** dell'isola, come le cartelle di un telefono: trascini un'integrazione sopra un'altra e
nasce un gruppo, con il nome da scrivere subito e il **colore** che vuoi; ci trascini dentro le altre, le porti fuori per
toglierle. Nelle **integrazioni personali** il **campo collegato** cerca mentre scrivi nelle schede di un'altra integrazione
(clienti, listino, articoli…) e **compila da solo** gli altri campi, anche nelle righe di una tabella; i nomi nuovi possono
essere aggiunti alla sorgente al salvataggio. Quando la chat cambia un'integrazione, la card dice **cosa cambia** e la
versione di prima viene copiata. Animazioni con **un effetto solo, sui contenuti**, che entrano pezzo per pezzo; onde di
luce nel campo Cerca; la mappa della **Memoria** si rinquadra quando la finestra cambia misura.

**1.0.41** — **Animazioni** in tutta l'app, in **Aspetto → Tema → Animazioni**: a ogni clic un'onda di luce dal punto
cliccato, le schermate che nascono dalla voce del menu con le card in cascata, e isola, Impostazioni, Memoria e Flussi che si
aprono e si chiudono con l'**effetto di apertura** scelto: **Lancio** (a cerchio dal personaggio), **Sipario** (una linea di
luce) o **Particelle**. Ricche di serie; anche Sobrie o Spente, e con «Riduci animazioni» di Windows diventano Sobrie.

**1.0.40** — La cronologia della chat non si riempie più delle sessioni avviate da EasyIsland stesso: **Claude Code fuori
da EasyIsland** mostra solo quelle aperte da te nel terminale o in Claude Desktop (prima comparivano a decine, col titolo
«[Istruzioni dell'utente per questa chat…», e non si potevano eliminare).

**1.0.39** — **File e schermo riordinata**: Vassoio, Cartella di lavoro, Raccolta e Registra in sezioni uguali, la Raccolta vuota
in una riga. Il menu **⋯ della Cartella di lavoro** si apre come quello del Vassoio (prima finiva dentro la tessera e in griglia
allungava la fila) e **Sposta nel Cestino…** chiede conferma sopra l'elenco. In griglia sulla tessera c'è solo ⋯. Nel Vassoio
**Fissa nel Vassoio** / **Togli la puntina**, con la puntina visibile sul file.

**1.0.38** — **Un aspetto solo per tutte le finestre**, dopo una revisione di design: isola, Memoria, Anteprima e Flussi con i colori di
Windows 11, in scuro e in chiaro. La **Memoria** è leggibile anche con centinaia di nodi (i nomi non si sovrappongono più, il grafo si apre
adattato alla finestra), ha la barra su una riga con «Manutenzione» e i `[[link]]` cliccabili; legge anche **la memoria di Claude Code**, in
sola lettura, senza doppioni e con la data di ogni nota. In alto l'isola dice **il problema in corso**, mai «Tutto tranquillo.» sopra un
errore; il contenuto delle card parte dall'alto; le card delle integrazioni hanno un solo stile; il **Vassoio** tiene due azioni e il resto
nel menu ⋯. Agent Chat dice quando un **token è nel campo sbagliato**, e il registro non scrive più token o chiavi.

**1.0.37** — **L'isola non si blocca più** quando una chat nomina un percorso di rete che non risponde (es. la cartella
condivisa di un server spento): i percorsi si controllano fuori dall'interfaccia e un server di rete ha al massimo un secondo e mezzo.
La finestra della **Memoria** si apre ingrandita; il disegno della **chat vuota** si muove anche nella chat in finestra.

**1.0.36** — **Un terminale vero nella chat.** Il **Terminale** è la console di Windows (PowerShell 7 se c'è) disegnata come in
Terminale di Windows: colori, Tab, frecce e cronologia, **Ctrl+C** per fermare un comando (copia se c'è una selezione), **Ctrl+V** per
incollare, editor, password e domande interattive di `npm` e `git`; si adatta al pannello e segue la chat nella sua finestra. Il disegno
della **chat vuota** riparte da solo dopo un momento in cui la chat non si vedeva.

**1.0.35** — **Chat «a schede», più curata e più accessibile.** Le schede sono l'aspetto unico della chat, con **opacità delle card**
regolabile e misure comuni per spazi, raggi e testo; la **finestra staccata** ha il suo margine e segue tema e colore dell'isola, le barre
di scorrimento compaiono solo sotto il mouse e l'**Anteprima** è chiara nel modo chiaro. **Ezzy**, il logo animato di EasyIsland, è fra i
personaggi. Una **chat vuota** mostra un disegno tenue e lento (Ezzy, un'isola che gira, un mare di puntini, stelle, aurora, rete; in
Aspetto → Chat) e sotto le tue **ultime tre conversazioni** da riprendere con un clic. Le risposte si leggono quanto le domande, le icone
della testata sono disegnate, il titolo è corto e i percorsi diventano il nome del file. Accessibilità: testi con **contrasto** sufficiente
in scuro e in chiaro, controlli di almeno **24 px**, un **anello del focus** da tastiera e **annunci per i lettori di schermo** quando
arriva una risposta, serve un permesso o un agente finisce. Il **terminale** della chat si apre nel pannello a destra come l'Anteprima
(sotto di lei se è aperta) e la **chat in finestra** si apre ingrandita.

**1.0.34** — **La chat fa tutto quello che fa Claude Desktop, e di più.** Con Claude Code le conversazioni riaperte dalla cronologia
**riprendono la loro sessione** con tutto il contesto, e così Modifica, Rigenera e Dirama, che ripartono da quel punto. L'**anello del
contesto** c'è sempre, anche dopo i lavori in background e riaprendo una chat; **/compatta** riassume la conversazione con ogni motore.
Il pulsante delle modalità passa fra **Consenti / Nega**, **Accetta modifiche**, **Piano** e **Automatica**, e «Sempre» vale per tutta
la conversazione. Nel menu «/» ci sono i **comandi di Claude Code**, le tue skill e i plugin; nel menu del motore **modello** e **fast mode**
per la conversazione. Sotto ogni passo si apre il suo **esito**, i **sotto-agenti** mostrano i loro passi, la **lista delle attività** resta
in vista, e un messaggio scritto mentre Claude lavora **entra subito** nel suo lavoro. **⟲ File** riporta i file com'erano prima di una
domanda, anche dopo un riavvio. Nella cronologia anche le **sessioni del terminale e di Desktop**. Per i progetti: **copia separata**
(worktree), **pull request** con i controlli e «Correggi», **commenti sulle righe** delle modifiche, un **terminale** PowerShell tuo e i
**lavori a parte** che Claude può proporre. Meno token: PDF senza intestazioni ripetute, risultati lunghi senza file, sotto-agenti su
Sonnet. Niente più domande perse se un turno si interrompe, **password mascherate** su disco, note doppie rifiutate.

**1.0.33** — **Integrazioni personali più complete**, tutte e non solo i DDT: **modelli HTML** veri con i valori sempre protetti, date per
esteso, numeri all'italiana, condizioni e risorse come il logo. Gli a capo non rompono più le tabelle. **PDF A4** diretto da una scheda,
salvato nel Vassoio e in una cartella. Dalla chat scegli **dove salvare** e **come chiamare il file**, anche con più campi, e come si leggono le schede nell'elenco. Un pulsante può lanciare uno **script** con conferma e i dati della scheda arrivano anche alle azioni
rapide. Gli agenti possono **creare e modificare le azioni rapide**, e un `.json` cambiato a mano si vede senza riavviare.
Nella scheda **Agent Chat** c'è **In esecuzione**: sul PC dove un motore lavora vedi cosa fa, passo per passo. I motori lavorano nella cartella del progetto, continuano la conversazione per un'ora, leggono interi i
messaggi a cui rispondono e non fanno due volte lo stesso lavoro.

**1.0.32** — **La memoria nel campo in alto**: la ricerca guarda tutto ciò che c'è nella Mappa, note e altro PC compresi, e se trova
qualcosa si apre una **costellazione** animata con il nodo e i suoi vicini. Frecce e clic la spostano, **Invio** apre una chat nuova che
parte da quel nodo. La chat legge prima la **scheda** di una pagina invece del testo intero, sa dire **come sono collegate** due pagine e
segna i legami **dedotti**.

**1.0.31** — **Chat rifatta nei dettagli**: campo su due righe con progetto, motore e modi vicini al testo, **Nuovo** e **Cerca**
affiancati, cronologia con il solo titolo e i dati nel suggerimento, branch git del progetto e **anello del contesto** con Claude.
**Icone animate** al passaggio del mouse e al clic, graffetta classica. All'avvio il logo sparisce pulito e il personaggio appare in
dissolvenza. Niente più bagliori nelle schede, chat a finestra senza cornice, Anteprima con molte schede sempre raggiungibili.

**1.0.30** — **Multi agent con una voce sola**: mentre i motori lavorano vedi i passi, poi arriva una sola risposta già
rivista, con **✓ Controllato** sotto. Il testo del revisore e i nomi dei motori non entrano più nella risposta: solo un errore
grave la fa riscrivere, e a controllare è per primo un motore che può aprire file e dati.

**1.0.29** — **Mappa della memoria**: fra due pagine restano solo i collegamenti scritti, un nome in comune nel testo non
le lega più. **Agent Chat**: se un motore non può rispondere (per esempio login scaduto) ora lo dice in chat con il motivo
e chiudendo l'incarico, e chiamando il PC per nome subentra l'altro motore.

**1.0.28** — **Multi agent nella chat**: in Impostazioni → Chat scegli i motori e accendi il pulsante nella conversazione.
Il motore della chat guida e ti risponde, gli altri fanno pezzi del lavoro in sola lettura e vedi una riga per ognuno. Prima
della risposta un motore di un'altra marca **controlla il lavoro** senza sapere chi l'ha fatto e guardando file e git:
chi guida valuta i rilievi e corregge, e sotto la risposta trovi **✓ Controllato da…** o ciò che resta da guardare.

**1.0.27** — **La riga che si scrive non taglia più**: del ragionamento mostra solo frasi intere, finisce sempre ciò che
ha iniziato e non cancella più lettera per lettera: il testo nuovo parte da riga vuota. Se arrivano più passi insieme
mostra l'ultimo, gli altri restano nell'elenco.

**1.0.26** — **La chat lavora come uno strumento vero**: risposte piene, non più pensate per una finestrella; il testo
arriva **parola per parola**; con **Progetto…** ogni conversazione lavora nella sua cartella e legge regole e git del
progetto, e nella barra laterale le conversazioni si **raggruppano per progetto**, con «+» per iniziarne una lì. Mentre
l'agente lavora, l'attività in corso **si scrive da sola** col cursore; i passi sono più leggeri e a risposta finita si
raccolgono in «N passi». **Ferma** è neutro e diventa rosso al passaggio del mouse; nuove icone di microfono e invio.

**1.0.25** — **Ferma e «Invia subito»** non perdono più la conversazione: anche se fermi la prima risposta,
il messaggio dopo continua la stessa sessione. **Agent Chat con Jeeves**: il PC dice al server cosa sa fare
(integrazioni, motori, cartelle), così il coordinatore affida gli incarichi al PC giusto; le risposte a un incarico
restano nel suo thread.

**1.0.24** — **Agent Chat con la mappa**: la chat è divisa in argomenti (le tue richieste, chi ci lavora,
fatto, aperto o bloccato) e ogni agente la riceve oltre agli ultimi messaggi, così sa cosa si è già deciso; nella
scheda, **Argomenti** li elenca e un clic mostra i messaggi di quell'argomento. **Consiglio IA** sui ticket di
Zammad: si apre la chat con ticket, cliente e ticket simili, la risposta resta come consiglio del ticket e si
aggiorna quando arrivano messaggi nuovi, con lo storico. **RDM con Devolutions Cloud** solo dal cloud, con un
pannello per ogni voce: utente, password nascosta con l'occhio e Copia. Il **campo in alto** trova anche le
voci e le cartelle di RDM (aperte nella scheda) e i contatti 3CX. Nelle risposte della chat **file e cartelle
sono cliccabili**: Anteprima, Apri, Scarica, Apri percorso. Il **controllo della memoria** propone le correzioni
con una casella e un commento ciascuna. La rete neurale della mappa si anima anche col mouse fermo.

**1.0.23** — **Zammad nell'isola**: la scheda mostra le tue viste con i conteggi, apre il ticket con
tutti i messaggi e ti fa cambiare stato (con il promemoria se è in attesa), proprietario e priorità,
scrivere una nota interna o rispondere al cliente via email. **Devolutions Cloud** nella scheda RDM:
vault e cartelle, «Copia password» negli appunti (svuotati dopo 30 secondi), nuove credenziali e
Liste Password con anteprima e conferma, il cliente di Zammad o 3CX collegato alla sua cartella; anche
dalla chat, con la password chiesta solo nella finestra di Windows. La **mappa della memoria** ha sei
viste nuove (Galassia, Rete neurale, Bolle, Raggiera, Fiume, Da dove arriva) in un menu, i gruppi a
colori, i filtri e «Come è collegato a…»; «Collega con l'IA» controlla i collegamenti stimati e tiene
solo quelli giusti. Nella **chat** scrivi mentre risponde: i messaggi vanno in coda, con **Invia
subito**. **Font** di titoli e testo da scegliere in Aspetto, anche per la barra fissa. **Agent Chat**
dice chi sta lavorando e a cosa, e ci scrivi dall'isola con il tuo nome. Un clic sul personaggio con
l'isola aperta dietro un'altra finestra la riporta **in primo piano** invece di chiuderla.

**1.0.22** — **Chat e integrazioni in una finestra**: trascina la voce del menu fuori dall'isola, o premi
la freccia in alto, e la chat o la scheda di un'integrazione diventa una finestra di Windows da spostare
e allargare, con la barra delle applicazioni e Alt+Tab; lo stesso pulsante la rimette nell'isola.
L'**Anteprima** resta accanto alla chat anche nella finestra. La chat ha la **barra delle
conversazioni** a sinistra (<kbd>Ctrl</kbd>+<kbd>B</kbd>), con il bordo da trascinare per allargarla,
e tiene **più conversazioni aperte insieme**, ognuna con il suo motore e il suo Ferma. La finestra
**Memoria** mostra la memoria di questo PC, quella di un altro PC condivisa con Agent Chat, o tutte e
due insieme.

**1.0.21** — **Agent Chat davvero autonoma**: con «Autonomi» i motori fanno tutto da soli, anche
cancellare, senza chiederti niente; chi vuole le domande in chat per eliminare e inviare la sceglie nelle
Impostazioni. Uno **script lanciato in background** non resta più senza risposta: quando finisce il
motore si riprende da solo e il risultato arriva in chat. La pagina della chat torna a collegarsi.

**1.0.20** — **Agent Chat che lavora una volta sola**: a un messaggio senza nomi risponde **un solo**
motore in tutta la chat, quello del primo PC che lo **prende in carico**, subito anche se l'altro PC è
spento; così niente lavoro doppio e i motori gratuiti non consumano messaggi per niente. Dai un **nome**
a ogni motore nelle Impostazioni (`@lia` invece di `@casa/claude`) e vedi **turni e token** di oggi per
motore. Nella pagina della chat la **riga dei nomi** sopra il campo e un pallino per **chi è acceso**.
**Memoria condivisa fra due PC**: per esempio a casa la memoria di lavoro, separata dalla tua; se non
trova niente chiede al PC di lavoro acceso, e le note di lavoro dette a casa ci arrivano anche a PC
spento. I motori sono **autonomi**: ciò che elimina, invia o cambia il sistema lo chiedono in chat con
«sì/no codice». **Allegati** con nome, dimensione e SHA-256, mandati anche dai motori; «fermo» e
«fermi» li fermano davvero.

**1.0.19** — **Agent Chat più autonoma**: quando scrivi senza nominare nessuno rispondono tutti i
motori, ognuno per conto suo. **Claude è il capo**: quando c'è da fare qualcosa decide chi lo fa e lo
affida per nome agli altri motori. A **PC spento** EasyIsland si ricorda dove era rimasto: alla
riaccensione Claude legge ciò che è arrivato e risponde una volta sola a ciò che è ancora aperto. Ciò
che è utile (decisioni, clienti, progetti, compiti) finisce da solo nella **Memoria**. Nell'isola c'è la
scheda **Agent Chat** con lo stato, gli ultimi messaggi e l'ascolto da spegnere o riaccendere; nelle
Impostazioni il link per installare il server, ora open source.

**1.0.18** — **Agent Chat**: EasyIsland partecipa alla tua chat fra agenti IA (un server tuo, indirizzo e
token personale in Impostazioni → Integrazioni) e **risponde da solo** quando lo chiamano con @nome. Più
motori sullo stesso EasyIsland, ognuno con il suo nome (`@notebook/claude`, `@notebook/codex`): `@notebook`
li chiama tutti. La **consulta** fa la stessa domanda a tutti i motori di tutti gli EasyIsland e il primo
scrive la sintesi. Freni contro i giri fra agenti: «@nome stop», un tetto di risposte all'ora e uno
di messaggi di fila fra agenti senza di te; l'isola ti avvisa quando un agente ti nomina. Anche senza
server, in chat «chiedi anche agli altri motori» fa la stessa domanda a più motori insieme e ne confronta
le risposte.

**1.0.17** — **Parla**: <kbd>Win</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> accende il microfono, a una pausa la
domanda va alla chat e la risposta si sente dagli altoparlanti. **Telegram risponde a voce** ai vocali
(OpenAI o Google AI), e un vocale che comincia con «ricorda» va nella memoria. **Ricorda questo**: il
testo selezionato, «ricordati che…» nel campo in alto o `/ricorda` su Telegram finiscono nella memoria
con la loro provenienza; «Ricorda» anche nel menu sul testo e in Riquadra e chiedi, **Annota** dopo una
chiamata 3CX, pagine proposte da ticket chiusi e mail importanti, impegni e riepilogo della settimana.
**Prepara** un ticket Zammad assegnato a te: la chat con la pagina del cliente, i ticket simili e una
bozza di risposta. **Continua in Claude Desktop** dalla chat con Claude Code, con i messaggi scritti lì
che tornano nell'isola. Notizie: l'aspetto (elenco, miniature, schede) si sceglie nella scheda.

**1.0.16** — **Barra fissa** più viva: il personaggio cresce sotto il mouse e la barra si gonfia
attorno a lui; un clic su un elemento apre la sua scheda in una **piccola isola sotto di lui**, alta
quanto il contenuto, che si chiude con un clic fuori; ombra leggera della barra; clic destro sulla barra
per il menu di EasyIsland con «Personalizza la barra…». **Aspetto della barra** a scelta (fascia o
isolette, opacità, sfocatura, margini, testo, nascondi da sola) ed elementi nuovi: processore, memoria,
disco, scheda video con grafico, lingua, cestino, aggiornamenti, musica, meteo, progetti di VS Code e il
**titolo della finestra** con nome e icona del programma. Un clic sul titolo apre il **menu del
programma** in primo piano: le sue voci con le scorciatoie (per i programmi classici tutte, sottomenu
compresi), il menu della finestra con le voci di Chrome ed Edge e le tue azioni rapide per quel
programma. **Logo animato** di EasyIsland: si disegna da solo nel saluto all'avvio e può stare
nell'isola e nella barra al posto del personaggio. **La giornata di oggi e di domani**: riassunto
dell'IA nel Buongiorno e nella Fine giornata, su Telegram all'ora scelta, nel campo in alto e come azione
rapida. **Permessi per livelli**: «Sempre» per le azioni che si possono annullare, anche da Telegram, e
**Cosa ho fatto** con Annulla. Il campo in alto **cerca ovunque**: memoria, conversazioni passate e
ticket Zammad. Notizie da Google e Bing insieme, senza doppioni.

**1.0.15** — **Allegati nella chat**: stanno dentro il campo, sopra il testo, e ce ne possono essere
più d'uno (fino a 20), anche **cartelle intere**: 📎 accanto al microfono o `@file` e `@cartella`
aprono la finestra di Windows a scelta multipla, Ctrl+V prende tutti i file e le cartelle copiati e un
rilascio sull'isola li allega tutti. Di una cartella il motore riceve il percorso e l'elenco dei file.
**Notizie**: la scheda c'è sempre nel menu dell'isola e si spegne in Impostazioni; gli argomenti si
scelgono da soli dalla memoria una volta al giorno (un motore tiene solo quelli da notizie: mai persone,
clienti o il tuo nome) e ognuno ha il suo interruttore; fonte **Google News o Bing News** (con la foto
dell'articolo e una riga di riassunto); aspetto della scheda a scelta tra **elenco, miniature e schede**;
la lista scorre quando le notizie sono tante.

**1.0.14** — **Notizie** (Impostazioni → Notizie): EasyIsland propone gli argomenti di cui parla la tua
memoria (mai persone e clienti) e, per quelli che segui, cerca su Google News ogni 4 ore, nella lingua
dell'app, filtrando sul PC le parole da evitare, le notizie già viste e la stessa storia ripresa da
altri giornali. Le trovi nella voce **Notizie** dell'isola, in un riquadro in fondo alla Panoramica, nel
Buongiorno del mattino, su Telegram con `/notizie` e come elemento della barra fissa. Su ogni notizia
**Di più** (più notizie sull'argomento e subito altre sulla stessa storia), **Salva** nella memoria e
**Non mi interessa**: dopo qualche «non mi interessa» l'isola chiede se smettere di seguire l'argomento.
Corretto: «L'isola si apre» era nascosta e ignorata con la barra fissa; ora vale anche lì. Nella guida
il pulsante della lingua porta sempre alla pagina giusta.

**1.0.13** — **Widget della barra** (Impostazioni → Aspetto → Barra fissa): «+ Aggiungi» apre un catalogo
per gruppi con orologio e data, volume, microfono, luminosità, batteria, velocità della rete e menu di
spegnimento, oltre a integrazioni, widget, striscia e azioni rapide; gli elementi di sistema si possono
aggiungere più volte (due orologi con fusi diversi). In «Opzioni» scegli il formato con i segnaposto, un
secondo testo che compare con un clic, il suggerimento e cosa fanno clic, clic centrale, clic destro e
rotella. Un clic apre la **card nell'isola**, subito sotto la barra: il calendario del mese con gli altri
fusi e i prossimi appuntamenti, i cursori di volume, microfono e luminosità, batteria e rete. Il menu di
spegnimento chiede sempre conferma prima di sospendere, riavviare o spegnere. Coucou non è più citato.

**1.0.12** — La **barra fissa** torna al suo posto da sola quando spegni e riaccendi il monitor, lo cambi
o cambi risoluzione o scala: prima restava della misura vecchia o staccata dal bordo e bisognava
spegnerla e riaccenderla. Vale anche quando Explorer si riavvia.

**1.0.11** — **Barra fissa** (Impostazioni → Aspetto → Barra fissa): una fascia in alto o in basso che
Windows tiene libera come la barra delle applicazioni, con il personaggio all'inizio, al centro o alla
fine, le integrazioni, i widget, le azioni rapide e la striscia dei permessi scelti da te, «…» per ciò
che non ci sta, sfondo come l'isola, trasparente o a colore e **altezza** a scelta (personaggio, icone e
testi si adattano); un clic apre l'isola subito sotto. Il **personaggio vive in una finestra sua**: a
riposo si muove sempre con animazioni leggere e compare con una dissolvenza; a isola aperta resta solo
quello nel menu. La pagina **Aspetto** è divisa in sei **schede** (Tema, Personaggio, Posizione, Barra
fissa, Isola chiusa, Isola aperta) e accanto a ogni voce c'è una **miniatura** dell'isola che mostra cosa
cambia; in Personaggio il personaggio scelto si muove, in Posizione l'angolo si sceglie anche con un clic.
Corretto: «Aggancia ai bordi» spento non aveva effetto in alto al centro.

**1.0.10** — **Rinominare le conversazioni** della cronologia della chat: ✎ accanto a 📌, o doppio clic
sul titolo; Invio salva, Esc annulla, un titolo vuoto torna alla prima domanda. La ricerca nella
cronologia trova anche il titolo nuovo.

**1.0.9** — **Anteprima**: file e pagine web in un browser vero, **dentro l'isola** in un pannello a
destra della chat (largo quanto trascini il bordo, chiuso e riaperto dal pulsante della chat) o in una
finestra separata, a scelta in Impostazioni → Chat; zoom **Adatta / 100% / Originale**, misure da
telefono e tablet, chiaro e scuro, console e modifiche dei file evidenziate. La chat **vede la pagina**
(elementi con un riferimento), clicca e scrive con Consenti / Nega, aspetta che la pagina sia pronta e
legge le richieste fallite. I **passi della chat** dicono a parole cosa sta facendo, anche su Telegram.
I **permessi della chat** compaiono dentro la conversazione con Nega / Sempre / Consenti, anche con
«Permessi e chiamate» spento. Memoria: riassunti e alias delle pagine e una ricerca che segue i legami
forti. Il README e la homepage sono prima in inglese (italiano in `README.it.md` e `/it/`). Corretto:
con l'Anteprima aperta l'isola non si ridimensionava più e l'angolo non seguiva il mouse.

**1.0.8** — **Logo nuovo**: un fumetto con il bordo ad arcobaleno, l'interno scuro e due occhi
bianchi, leggibile anche a 16 px; lo stesso disegno fa da logo nell'isola. **Jarvis Sfera** è il personaggio predefinito
di una nuova installazione. README con indice e schermate nuove; la storia delle versioni sta in
[CHANGELOG.md](CHANGELOG.md).

**1.0.7** — **Flussi**: le automazioni diventano flussi e si costruiscono in una finestra dedicata
(Impostazioni → Flussi → Modifica): il flusso dall'alto in basso, blocchi da **trascinare** o da aggiungere
con il «+», un pannello con i dati da inserire con un clic, modelli pronti e «Descrivilo a parole» (lo
prepara la chat). Blocchi nuovi: **Agente** (lavora con gli strumenti di EasyIsland e il flusso ne aspetta
il risultato, anche con risposte in campi), **Scelta** con regole o decisa dal modello, **Per ogni**
elemento di un elenco, **Domanda** anche su Telegram. Ogni passo può **riprovare** e avere una strada in
caso di errore; un riavvio a metà non rifà le azioni già fatte; **Esecuzioni** con l'esito di ogni passo e
«Riprendi da qui». Pagina unica **Flussi** con i compiti. La Memoria e i Flussi aperti dalle Impostazioni
ora vengono davanti. README e sito presentano EasyIsland come agente personale.

**1.0.6** — **Modalità chiara, scura o automatica** per entrambi gli stili (Impostazioni → Aspetto →
Tema), anche per la finestra delle Impostazioni; Automatica segue Windows. Pagina **Aspetto** riordinata
in cinque sezioni (Tema, Personaggio, Posizione, Isola chiusa, Isola aperta). **Jarvis Plasma**: un globo
al plasma blu e viola, con filamenti che cambiano di continuo; Jarvis Sfera con colori più accesi.
**Memoria**: un **motore per la memoria** a scelta, anche gratuito, crea da solo le pagine degli
argomenti e le relazioni (solo aggiunte, pulsante «Collega con l'IA» e dopo il riordino serale), un
grafo più collegato e il **Grafo 3D** da girare col mouse.

**1.0.5** — **Jarvis**: nuovo personaggio, l'interfaccia di un assistente con un nucleo luminoso e
anelli sempre in movimento, ritmo e colori per ogni stato, un satellite per ogni agente al lavoro e i
secondi sull'anello esterno. **Jarvis Sfera**: la stessa idea come sfera di punti che ondeggia come un
suono. Con Jarvis il meteo è un segno piccolo nell'angolo. Corretto: chiudere l'isola dall'anteprima
nella barra delle applicazioni la faceva sparire finché non si riavviava EasyIsland.

**1.0.4** — **Raccolta**: selezioni del testo in qualsiasi app (anche nome e prezzo sul sito di un
fornitore) e con `Ctrl+Alt+Shift+R` finisce in «File e schermo» con la sua fonte, pagina compresa da
Chrome ed Edge; anche una zona dello schermo da Riquadra e chiedi. Le dai un nome e i campi da ricavare,
e «Chiedi alla chat» passa tutto insieme. **Mappa della memoria** a un clic dall'isola. Corretto: la
mappa diceva «memoria vuota» e la Mappa concettuale si fermava con certe pagine.

**1.0.3** — **Logo o meteo al posto del personaggio** (Impostazioni → Aspetto → «Nell'isola»): il
logo di EasyIsland, il tuo PNG o il meteo, come immagini ferme senza animazioni. **Oltre 150 icone**
per le azioni rapide e **icona automatica**: la favicon del sito per un link, l'icona del programma
per un programma. **Riquadra e chiedi** al posto di Cerchia e chiedi: si trascina un riquadro. Un file
trascinato sull'isola a riposo la apre. Corretto: le Impostazioni saltavano in alto cambiando una
select o un interruttore; l'alone colorato in basso non si vedeva con il tema Windows 11.

**1.0.2** — **L'isola come un'app** (Impostazioni → Isola): aperta ha l'icona nella barra delle
applicazioni e in Alt+Tab, con riduci a icona e schermo intero; chiusa sparisce, e si apre dall'icona
fissata, che col tasto destro offre le azioni rapide. **Resta aperta** quando la apri tu. Testo
dell'isola aperta più grande. **Cartella di lavoro** in griglia o elenco, per nome o data, con icone per
tipo di file e **anteprime delle immagini** (anche nel Vassoio). **Backup completo** con memoria, chat,
compiti e abilità. Telegram uguale in ogni profilo; le Impostazioni si aprono su Generale e non saltano
in alto. Corretto: l'isola dietro una finestra tornava sopra passandoci col mouse.

**1.0.1** — **Telegram anche a PC spento**: i messaggi scritti al bot mentre EasyIsland era spento
si elaborano alla riaccensione, in ordine, sapendo quando li hai scritti. **L'isola passa dietro** le
finestre che le vengono sopra (come la scelta della cartella di lavoro) senza chiudersi, e torna
davanti con un clic o quando serve. **Automazioni più complete**: passi «Aspetta» e «Chiedi prima di
continuare», stop dopo un errore, e dalle abitudini solo routine intere (inizio giornata con profilo,
programmi e punto della giornata), mai «apro un programma a un'ora».

**1.0.0** — **Secondo cervello e guida.** La memoria ha **pagine collegate** su clienti, persone,
progetti e concetti (`[[Titolo]]`, con le relazioni), una cartella **da-leggere** da cui l'agente
impara e scrive le pagine con la fonte, un **controllo** che propone come sistemarla (archivia, non
cancella) e scritture sicure che non toccano ciò che hai cambiato a mano. La **finestra Memoria**
(Impostazioni → Chat → Memoria → Mappa) la mostra come **grafo**, **mappa mentale**, **mappa
concettuale** e **timeline**, con ricerca e file trascinabili. Le **integrazioni personali** si
creano a parole in chat: moduli con formule, documenti, cruscotti di dati letti dai tuoi servizi
con avvisi, chiamate alle loro API con chiavi in Gestione credenziali. E una **[guida
completa](https://edoardodevelop.github.io/easyisland/guida/)** sul sito, linkata in fondo al
menu delle Impostazioni.

**0.9.9** — **EasyIsland diventa un agente**. **Compiti**: gli dai un obiettivo e lo porta avanti
da solo con un piano, i passi e il risultato, subito, a un'ora, ogni giorno, ogni settimana o ogni
N minuti; lo vedi lavorare nella scheda Agenti e ti chiede quando serve. Ogni compito ha il suo
motore e può farsi aiutare da altri motori. **Abilità**: procedure tue in file .md che la chat e i
compiti seguono quando servono, anche come comandi `/nome`. **Battito**: un controllo periodico di
ciò che scrivi in `BATTITO.md`, che ti avvisa solo se c'è qualcosa. **Riordino della memoria** ogni
sera, con le note che approvi tu. Permessi e domande dei compiti anche su Telegram.

**0.9.8** — **Aspetto Windows 11**, ora predefinito: isola e Impostazioni grigie come le finestre
di Windows, con il colore d'accento che hai scelto in Windows, interruttori, campi e pulsanti
come quelli del sistema, icone a linea al posto delle emoji e ogni impostazione su una riga con la
spiegazione sotto. I loghi grandi nei riquadri della Panoramica e i colori delle integrazioni
restano. L'aspetto di prima c'è ancora: Impostazioni → Aspetto → Tema → Stile → Classico.

**0.9.7** — **Chat più comoda**: campo su più righe che non perde la bozza, file incollati o
trascinati a conversazione avviata, Copia / Modifica / ↻ Rigenera / ⑂ Dirama sotto i messaggi,
comandi con `/` (anche le tue azioni rapide), menu `@` per allegare appunti, una finestra o un file
del Vassoio, modelli con `{{campi}}`, **Assistenti** con motore e istruzioni, 🎤 dettatura, cronologia
con ricerca e 📌, Esporta in Markdown, Istruzioni per profilo e `/riprendi` su Telegram. **Memoria**
in file .md: note che la chat ricorda in ogni conversazione e diario giorno per giorno, senza
consumare token. WebView2 usa molto meno RAM con l'isola ritirata.

**0.9.6** — **Accesso remoto**: un collegamento al volo al PC di un cliente con WinRM o SSH
(Windows e Linux), senza salvare niente; con 🔌 la chat ci lavora, ogni comando con Consenti /
Nega; guida passo passo per preparare il PC e pulizia alla chiusura. Le righe di **Notion** si
eliminano anche dalla chat, dopo il tuo sì (finiscono nel cestino di Notion).

**0.9.5** — **Hook in ogni shell**: senza Git Bash, Claude Code esegue gli hook con
PowerShell e il comando di prima lo fermava a ogni strumento; ora va in Git Bash, PowerShell e cmd
(Impostazioni → Agenti → Aggiorna). **Microsoft To Do** dalla chat, tramite Outlook classico:
leggere, aggiungere, cambiare e segnare fatte le attività. L'**isola aperta** si porta su un altro
schermo e ci resta.

**0.9.4** — **Chat più veloce**: Claude Code resta acceso tra i messaggi della stessa
conversazione; le righe di Notion arrivano in una tabella compatta con le categorie per nome e i
totali già fatti; la chat impara **ricette** con l'uso e alle domande simili va dritta agli
strumenti giusti (Impostazioni → Chat → Ricette). Mentre lavora mostra anche il suo ragionamento,
nell'isola e su Telegram. «Quanto ho speso a ottobre»: da 29 a 12 secondi.

**0.9.3** — **Notion per tutti i motori**: la chat legge e aggiunge righe con il collegamento
di EasyIsland, che controlla i valori prima di scrivere (niente più pagine vuote). Gli
**strumenti di EasyIsland** arrivano anche ad **Antigravity** e a **Claude con chiave API**.
**⇄ Seconda opinione**: un altro motore rivede l'ultima risposta, nell'isola e su Telegram.
**/oggi** e **/domani** su Telegram: il punto della giornata.

**0.9.2** — **Ferma** nella chat e su Telegram (■ al posto di Invia, ⏹ Ferma e /stop): la
risposta si interrompe e il motore si chiude. **Mappa di Notion per la chat**: la struttura del
tuo Notion resta sul PC, cifrata, e la chat non deve più cercarla a ogni conversazione.

**0.9.1** — **Remote Desktop Manager con Devolutions Hub**: l'elenco legge anche il
vault utente (prima restava vuoto) e apre la connessione nel suo vault. L'elenco resta
su questo PC, cifrato per il tuo utente Windows, e si aggiorna solo con **Sincronizza**:
RDM non va avviato quando non serve; un pallino dice se è aperto.

**0.9.0** — **Antigravity** di Google come Claude Code e opencode: le sue sessioni
(CLI `agy`, IDE e app) nell'isola con passi, diff e **Consenti / Nega** su comandi e
strumenti MCP, e come **motore della chat** con i suoi strumenti, anche da Telegram;
le istruzioni di installazione sono nelle Impostazioni. Nella chat con Antigravity i
passi compaiono mentre lavora, e se mancano gli hook ti dice come averli.

**0.8.9** — **Mini Notion** nella scheda Notion: le pagine scelte come riquadri si
aprono nell'isola e si vedono come in Notion (titoli, elenchi, caselle, toggle, callout,
codice, immagini) e si modificano lì, con «/» per i tipi di blocco; i database in
Tabella, Bacheca (trascini le schede), Elenco e Galleria, anche le viste collegate.
**Vocali da Telegram** trascritti con Gemini, OpenAI o OpenRouter, con il modello per
l'audio scelto a parte. **«Automatica» in Telegram** (chiede solo per le cancellazioni),
**impostazioni cambiabili dagli agenti**, **«Permessi e chiamate»** che possono non aprire
l'isola, voci delle Impostazioni di chat e agenti più chiare.

**0.8.8** — **Telegram**: la chat di EasyIsland nel tuo bot (creato con @BotFather),
collegato una volta con un codice e solo alla tua chat. Scegli motore e modello da lì
(`/motore`, `/modello`), con la modalità terminale Consenti / Nega arrivano come
pulsanti, foto e file vanno nel Vassoio e i file che la chat mette nel Vassoio ti
arrivano su Telegram (`/vassoio`). **Cartella di lavoro**: una cartella del PC in
«File e schermo», con sottocartelle, Rinomina, Sposta, Nel Vassoio, Cestino e
trascinamento; dal Vassoio ci sposti i file; la chat la legge e ci sposta i file,
Telegram la apre con `/cartella`. **opencode** ha ora gli strumenti di EasyIsland come
Claude (Vassoio, app, avvisi, azioni rapide, automazioni).

**0.8.7** — **Registra**: una conversazione (microfono e audio del PC) o lo schermo con
l'audio, oppure **una sola finestra** scelta da un elenco o trascinandoci il personaggio,
solo con Windows; punto rosso con Stop accanto al personaggio e alla fine Nel Vassoio,
Apri, Mostra nella cartella. Nella barra di ricerca **Cerca con Google** (`Alt+Invio`).
Loghi di **Teams** e **Remote Desktop Manager**, alone colorato in basso in tutte le
schede, un clic su una scheda mentre scrivi nella ricerca la chiude e la svuota. Con
**⚡ Automatica** nella chat opencode usa gli strumenti dei connettori (Notion e gli
altri) senza chiedere, tranne quelli che cancellano o inviano. Documentazione in
inglese: [README.md](README.md) e [docs/en/](docs/en/).

**0.8.6** — **Microsoft Teams**: riunione in corso riconosciuta da microfono e webcam, Microfono,
Video, Alza la mano, Condividi ed Esci nella card e accanto al personaggio chiuso, «Partecipa
dal link copiato», automazioni all'inizio e alla fine di una riunione. **Account Microsoft
(API)**, da provare: con l'accesso Outlook legge posta e calendario da Microsoft 365 (anche il
nuovo Outlook) e Teams mostra stato e riunioni con «Partecipa». **Barra dell'app in uso** tutta
personalizzabile: solo le tue azioni, azioni **Tasti** (scorciatoie e testo nel programma in
uso), domande su tutto il testo della finestra, solo icona o solo testo, «Solo nella barra».

**0.8.5** — **Barra dell'app in uso** accanto al personaggio chiuso, come una Touch Bar: le
tue azioni rapide legate al programma che stai usando («Nella barra con») e i suggerimenti ⚡
per Outlook, Excel, Word e il browser. **Menu col clic destro** nell'isola al posto di quello
del browser: Apri, Aggiorna ora e «Impostazioni» di un'integrazione (le Impostazioni si
aprono proprio lì), Esegui e Modifica su un'azione, Copia e Chiedi alla chat sul testo.
**Panoramica** con i loghi grandi e sbiaditi nell'angolo dei riquadri.

**0.8.4** — **Automazioni con più contesto**: nuovi «quando» (download finito, chiamata
3CX, agente che ha finito o aspetta un permesso, server di sviluppo, programma in primo
piano, rientro dopo una pausa) con un filtro («solo i .pdf», un cliente, un progetto); più
condizioni insieme («tra le 9 e le 18», «non in riunione», «Excel aperto», «a batteria»…);
«al massimo ogni N minuti» o «una volta al giorno»; i dati dell'evento nei passi
(`{file}`, `{chiamante}`, `{progetto}`…) e il passo «Chiedi alla chat». Le **Impostazioni**
restano sopra l'isola. **Notion**: viste delle attività, avvisi delle scadenze e dei
commenti, attività nel riepilogo del mattino, configurazione rapida. **Remote Desktop
Manager** (in prova). Impostazioni → Integrazioni a gruppi.

**0.8.3** — **Modalità terminale** della chat (Impostazioni → Chat): esegue comandi, modifica
file e usa tutti i tuoi server MCP, plugin e skill come Claude Code o opencode da terminale,
nella cartella che scegli; ogni comando chiede Consenti / Nega, con «Sempre». Con tutti i
motori: quelli senza strumenti passano da opencode. **⚡ Automatica** nella chat: per una
conversazione le operazioni normali vanno da sole, quelle delicate chiedono ancora.
**Notion** rifatto: attività con la spunta, nota veloce, pagine scelte, ricerca e pagine
che si aprono nell'app. I server MCP dei plugin di Claude Code sono tra i connettori.

**0.8.2** — **Sostituisci** tiene grassetti, link e paragrafi del testo originale (Word,
Outlook, Gmail), con il pulsante «Senza formattazione» per incollare il solo testo.
**Riquadra e chiedi → Nel Vassoio** apre l'isola sul Vassoio, con la zona appena aggiunta
evidenziata e «Chiedi» e «Copia» a portata di clic. **Musica** diventa **Media**: musica,
video e podcast.

**0.8.1** — Rete: la scheda da modificare si sceglie con pulsanti (il menu a tendina non
funzionava) e il ping continuo ha un pulsante per il gateway di ogni scheda.

**0.8.0** — **logo nuovo**: tre pillole a «E», la forma dell'isola, dal viola
all'azzurro. **Rete** più completa: tutte le schede con i loro IP, gateway e DNS, un
**ping continuo** in un terminale (gateway, 8.8.8.8 o un indirizzo a scelta) e
**Modifica rete…** per passare una scheda da DHCP a indirizzo manuale e cambiare i DNS,
con la conferma da amministratore di Windows. **Musica** con la copertina sullo sfondo
della scheda; contenuti delle schede centrati; le Impostazioni si aprono subito nella
loro finestra. In **3CX** la scheda Rubrica. Con la sola app desktop di Claude, i
**limiti del piano** non restano più fermi: quando l'accesso di Claude Code scade,
EasyIsland lo fa rinnovare a Claude Code stesso, senza finestre e senza consumare il piano.

<p align="center">
<img src="screenshots/network.png" width="420" alt="Rete: schede, gateway, DNS e ping continuo">
<img src="screenshots/media.png" width="420" alt="Musica: la copertina sullo sfondo della scheda">
</p>

**0.7.9** — **proposte al momento giusto**: l'isola nota cosa succede sul PC e propone
il passo dopo con un clic. Un **download finito** ha Apri, Mostra nella cartella e le
tue azioni sui file; un **errore copiato** (stack trace, traceback, porta occupata) ha
«Spiega e correggi», e per una porta occupata dice quale programma la tiene; un
**server di sviluppo** appena partito (`npm run dev`, vite, uvicorn…) si apre nel
browser; una **password o una chiave copiata** sparisce dagli appunti dopo 30 secondi.
Il **riepilogo del giorno**, al mattino e a fine giornata: tempo degli agenti,
repository con modifiche non salvate e pull request in attesa. E gli **strumenti di
EasyIsland in Claude Code**, nel terminale o in VS Code: card con pulsanti nell'isola,
avvisi e file nel Vassoio. Tutto si spegne nelle Impostazioni. In più, l'isola non si
blocca più per un dato inatteso e le impostazioni sono al sicuro da un salvataggio
interrotto.

<p align="center">
<img src="screenshots/moment-error.png" width="420" alt="Errore copiato: porta 3000 occupata da node.exe, con Spiega e correggi">
<img src="screenshots/daily.png" width="420" alt="Riepilogo del mattino: tempo degli agenti, repository con modifiche non salvate, pull request">
</p>

**0.7.8** — **isola nuova**: a sinistra un menu con il personaggio in cima, poi
**Panoramica** (tutte le integrazioni a riquadri), Agenti, Chat, Azioni, **File e
schermo** e le tue integrazioni; in alto il fumetto del personaggio e un solo campo
per cercare, avviare o chiedere alla chat. A isola chiusa, accanto al personaggio, le
**risposte rapide**: Nega / Consenti sui permessi, Rispondi / Rifiuta e Riaggancia sulle
chiamate 3CX, senza aprire l'isola (a destra, a sinistra o spente). Il **Meteo** ha una
card nuova con il cielo di adesso animato, le prossime 12 ore e 7 giorni. Il personaggio
torna al suo colore anche se interrompi l'agente, e l'angolo dell'isola non fa più scatti.

<p align="center">
<img src="screenshots/overview.png" width="640" alt="La Panoramica: menu a sinistra con il personaggio, integrazioni a riquadri con il loro stato">
</p>

**0.7.7** — **Riquadra e chiedi** al posto di «Cattura una zona»: con `Ctrl+Alt+Shift+S`
lo schermo si ferma, riquadri una zona e accanto scrivi la domanda per la chat,
oppure usi le tue azioni rapide, ne copi l'immagine o il **testo** (riconosciuto da
Windows) o la tieni nel Vassoio. Con **3CX** il personaggio **non sparisce più durante
una chiamata** e la suoneria predefinita suona davvero; ogni integrazione ha il suo
**colore**, scelto in Impostazioni, che il personaggio indossa con la sua scheda aperta.

**0.7.6** — i **limiti del piano Claude** non si spacciano più per attuali: se non
arrivano da più di 15 minuti (l'accesso di Claude Code scade e l'app desktop di Claude
non lo rinnova) diventano grigi, e il suggerimento dice da quanto e perché. Appena Claude
Code rinnova l'accesso tornano in un minuto, e **«Aggiorna»** nella card Consumo li chiede
subito.

**0.7.5** — **3CX direttamente nel PC**: scegliendo «Questo PC» tra i dispositivi,
EasyIsland diventa il telefono del tuo interno, con muto, tastierino e una **suoneria**
generata o scelta da te (MP3, WAV, OGG, M4A), silenziabile dalla scheda. La scheda 3CX
è ridisegnata come un telefono, con tastierino a sinistra e chiamate a destra. Corretti
due problemi di avvio: l'app che si chiudeva **dopo un aggiornamento** e quella che non
partiva **nelle prime ore dopo un riavvio** del PC.

**0.7.4** — piccole correzioni all'isola: chiusa, il personaggio torna al **suo colore**
invece di tenere quello della scheda aperta; trascinando il personaggio della chat su una
finestra l'isola **non si chiude** più; con molte integrazioni come schede l'isola aperta
**si allarga** quanto serve perché ci stiano tutte.

**0.7.3** — **i limiti del piano Claude sempre aggiornati**: la card Consumo li chiede
ad Anthropic con l'accesso già fatto in Claude Code, quindi arrivano anche usando solo
l'app desktop di Claude (5 ore, settimana e settimana Opus), e compaiono in alto
nell'isola («5h 12% 7g 83%»), con un clic per aprire la card. Le card dei **permessi**
dicono quanto tempo manca prima che la richiesta torni al terminale. La copia della
selezione e «Sostituisci» rimettono negli appunti anche **immagini e file** copiati prima.

**0.7.2** — **una finestra come contesto della chat**: nella scheda Chat trascini il
personaggio su una finestra di un'altra app (Chrome, Outlook, Excel…) e la chat la
riceve con la sua immagine, il nome dell'app e il titolo. Mentre lo porti il personaggio
segue il mouse e cambia faccia: sorpreso quando lo sollevi, contento sopra una finestra
che può allegare, cuori quando la lasci. Nel chip la miniatura, con la ✕ per toglierla.
Era una funzione di Coucou sul Mac che mancava.

**0.7.1** — **3CX** molto più completo (con l'accesso «Interno e password»): il **Team**
con lo stato dei colleghi in tempo reale, da chiamare, a cui scrivere o a cui rispondere
al posto loro quando squilla; la **Chat** con colleghi, gruppi e conversazioni esterne,
con avviso, non letti e «sta scrivendo»; la **Segreteria** con la trascrizione;
**In coda / Fuori coda**; **Trasferisci** e **Devia** sulle chiamate. Il **cielo del
Meteo** è in grande, dietro il personaggio. Nel README, l'immagine di tutti i personaggi.

**0.7.0** — personaggi rifatti e più vivi: la **Fiamma** ondeggia e tremola di continuo
(solo a isola visibile), il **Geco** ha il bordo più fine e le pupille che arrivano fino al
bordo dell'occhio guardando il mouse; **Roccia**, **Magma** e **Pietra** sono tre
sassolini con grandi occhi neri (il muschio, la lava, il germoglio) e **Foglia** è una
foglia lucida con le venature.

**0.6.9** — **sei nuovi personaggi**, tutti disegnati nel codice: il **Geco**, con
grandi occhi ambrati le cui pupille seguono lo sguardo e una palpebra che scende quando
sbatte; la **Fiamma**, una fiammella rossa, arancione e gialla con le scintille; e
quattro gelatine lucide, **Magma** (crepe di lava), **Pietra** (blocchi d'ardesia e
cristalli), **Roccia** (guscio di piastre) e **Foglia** (corona di foglie). Si
scelgono in Impostazioni → Aspetto e hanno tutte le espressioni degli altri.

**0.6.8** — un **menu sul testo selezionato** in qualunque app, browser compresi:
`Win+Alt+A` mostra le tue azioni rapide (con icone e cartelle) e quelle impostate su
«lo sostituisce» riscrivono la selezione con un'**anteprima prima/dopo**, incollando
solo dopo «Sostituisci»; nelle Azioni rapide una scelta sola, «Lavora su», e un
pulsante per partire con Riscrivi, Correggi, Più formale e In inglese; le **reazioni
del personaggio** si scelgono per ogni situazione (per esempio la Rete del notebook
può restare tranquilla); l'isola non salta più scrivendo in «Continua» né aprendosi
con il contenuto che scorre.

**0.6.7** — la card «finito» mostra la risposta in markdown e ha **«Continua»**: scrivi
il prossimo messaggio e arriva alla sessione (nel terminale parte subito, in VS Code
resta da premere Invio, con opencode passa dal suo servizio); **«Chiedi a questa
sessione»** interroga una copia in sola lettura; la card del permesso si può
rimandare con **«Più tardi»** o Esc; **«Sempre»** c'è sempre (senza proposta di
Claude Code vale per la sessione); con il **📌** l'isola diventa una finestra
normale, con l'icona nella barra delle applicazioni.

**0.6.6** — il **saluto all'avvio** si fa al centro dello schermo (oppure dove sta il
personaggio, o si spegne); `Ctrl+Space` **chiude** anche l'isola; **Claude Code
compare solo se i suoi hook sono installati**, così chi usa solo opencode vede solo
opencode (interruttore **Collega opencode**); dopo lo **standby** niente falsi
«Nessuna connessione»; nella card della sessione i passi non si sovrappongono più.

**0.6.5** — una **cartella trascinata sull'isola** (o il personaggio lasciato su una
cartella di Esplora file o del desktop) mette il suo percorso nella chat; **clic
destro sul personaggio** per il menu dell'area di notifica; il **saluto all'avvio** è
solo il personaggio con le sue particelle, senza isola; `Ctrl+Space` apre la
Panoramica; l'isola staccata dai bordi ha tutti gli angoli arrotondati.

**0.6.4** — Goccia è il personaggio predefinito; **cronologia delle chat** (l'orologio
in alto nella chat riapre una conversazione e la continua); l'isola aperta si
allarga **fino ai bordi dello schermo**; **«L'isola si apre»** dove sta il
personaggio oppure in alto, al centro o in basso; gli ultimi testi tradotti in inglese.

<img src="screenshots/chat-history.png" width="640" alt="La cronologia delle chat: tre conversazioni di prima, con data, motore e numero di domande">

| Versione | Data | Novità |
|---|---|---|
| **1.0.8** | 26 ott 2026 | Logo nuovo, Jarvis Sfera predefinito, README con indice e storia in CHANGELOG.md |
| **1.0.7** | 26 ott 2026 | Flussi: finestra con blocchi da trascinare, agenti, scelte, «per ogni», domande su Telegram, esecuzioni |
| **1.0.6** | 25 ott 2026 | Modalità chiara/scura/automatica, Aspetto riordinato, Jarvis Plasma, motore per la memoria, Grafo 3D |
| **1.0.5** | 25 ott 2026 | Personaggi Jarvis e Jarvis Sfera, isola che non sparisce chiudendola dalla barra delle applicazioni |
| **1.0.4** | 25 ott 2026 | Raccolta (testo e zone con la loro fonte, da passare alla chat), mappa della memoria dall'isola |
| **1.0.3** | 25 ott 2026 | Logo o meteo al posto del personaggio, oltre 150 icone e icona automatica per le azioni, Riquadra e chiedi |
| **1.0.2** | 24 ott 2026 | L'isola come un'app, Resta aperta, cartella di lavoro in griglia con anteprime, backup completo |
| **1.0.1** | 24 ott 2026 | Telegram anche a PC spento, l'isola che passa dietro le finestre, automazioni con Aspetta e Chiedi |
| **1.0.0** | 24 ott 2026 | Secondo cervello e finestra Memoria, integrazioni personali create dalla chat, guida completa sul sito |
| **0.9.9** | 23 ott 2026 | EasyIsland agente: Compiti con piano e più motori, Abilità, Battito, riordino della memoria, compiti su Telegram |
| **0.9.8** | 22 ott 2026 | Aspetto Windows 11 predefinito (grigio, colore d'accento di Windows, icone a linea), il Classico resta come stile |
| **0.9.7** | 22 ott 2026 | Chat più comoda (Modifica, Rigenera, Dirama, comandi /, menu @, Assistenti, dettatura) e memoria in .md, meno RAM |
| **0.9.6** | 21 ott 2026 | Accesso remoto con WinRM e SSH per l'assistenza, righe di Notion eliminabili dalla chat |
| 0.9.5 | 20 ott 2026 | Hook in ogni shell (senza Git Bash), Microsoft To Do, isola aperta su un altro schermo |
| 0.9.4 | 20 ott 2026 | Chat più veloce: Claude Code acceso, Notion compatto con i totali, ricette, ragionamento visibile |
| 0.9.3 | 19 ott 2026 | Notion per tutti i motori, strumenti in Antigravity e Claude API, Seconda opinione, /oggi e /domani |
| 0.9.2 | 19 ott 2026 | Ferma nella chat e su Telegram, mappa di Notion per la chat |
| 0.9.1 | 18 ott 2026 | Remote Desktop Manager con l'Hub: vault utente, elenco offline cifrato, Sincronizza |
| 0.9.0 | 18 ott 2026 | Antigravity di Google: sessioni nell'isola con Consenti / Nega e motore della chat, con le istruzioni di installazione |
| 0.8.9 | 18 ott 2026 | Mini Notion nella scheda (pagine e database visti e modificati nell'isola), vocali da Telegram, «Automatica» in Telegram, impostazioni dagli agenti, «Permessi e chiamate» |
| 0.8.8 | 17 ott 2026 | Telegram (chat, motore e modello da lì, Consenti / Nega, file nei due sensi), cartella di lavoro in «File e schermo», nella chat e in Telegram, strumenti di EasyIsland anche per opencode |
| 0.8.7 | 17 ott 2026 | Registra (conversazione, schermo o una finestra), Cerca con Google, loghi di Teams e RDM, alone in tutte le schede, ricerca che si chiude al cambio di scheda, ⚡ Automatica con gli strumenti dei connettori, documentazione in inglese |
| 0.8.6 | 16 ott 2026 | Microsoft Teams (riunioni, comandi, Partecipa), Account Microsoft con le API per Outlook e Teams (da provare), barra dell'app in uso personalizzabile con azioni Tasti |
| 0.8.5 | 16 ott 2026 | Barra dell'app in uso accanto al personaggio chiuso, menu col clic destro nell'isola con le Impostazioni aperte sulla voce, Panoramica con i loghi grandi |
| 0.8.4 | 15 ott 2026 | Automazioni con nuovi eventi, filtri, più condizioni, ripetizioni e dati dell'evento nei passi; Impostazioni sopra l'isola; Notion con viste e avvisi; Remote Desktop Manager in prova; Integrazioni a gruppi |
| 0.8.3 | 15 ott 2026 | Modalità terminale della chat per tutti i motori, ⚡ Automatica, Notion con attività, note e pagine scelte che si aprono nell'app, connettori dai plugin di Claude Code |
| 0.8.2 | 14 ott 2026 | Sostituisci con la formattazione dell'originale o senza, Vassoio dopo Riquadra e chiedi con la zona nuova evidenziata, Media al posto di Musica |
| 0.8.1 | 14 ott 2026 | Rete: scelta della scheda con pulsanti, un ping per il gateway di ogni scheda |
| 0.8.0 | 14 ott 2026 | Logo nuovo, Rete con tutte le schede, ping continuo e impostazioni della scheda, copertina della Musica, schede centrate, Impostazioni in finestra, Rubrica di 3CX, rinnovo dell'accesso di Claude Code per i limiti del piano |
| 0.7.9 | 14 ott 2026 | Proposte al momento giusto (download, errore copiato, server di sviluppo, chiavi tolte dagli appunti), riepilogo del giorno, strumenti di EasyIsland in Claude Code, isola e impostazioni più stabili |
| 0.7.8 | 13 ott 2026 | Isola nuova con menu a sinistra e Panoramica, risposte rapide a isola chiusa, card del Meteo animata, personaggio che torna al suo colore, angolo senza scatti |
| 0.7.7 | 13 ott 2026 | Riquadra e chiedi con OCR, personaggio visibile durante le chiamate 3CX, suoneria predefinita, colore delle integrazioni |
| 0.7.6 | 13 ott 2026 | Limiti del piano vecchi in grigio con il motivo, «Aggiorna» del Consumo che chiede subito |
| 0.7.5 | 12 ott 2026 | 3CX «Questo PC» con suoneria e scheda da telefono, avvio corretto dopo aggiornamenti e riavvii |
| 0.7.4 | 12 ott 2026 | Personaggio col suo colore a isola chiusa, isola aperta durante il trascinamento nella chat, schede che allargano l'isola |
| 0.7.3 | 12 ott 2026 | Limiti del piano chiesti ad Anthropic e mostrati nell'isola, tempo rimasto sui permessi, appunti rimessi per intero |
| 0.7.2 | 11 ott 2026 | Il personaggio della chat trascinato su una finestra la allega come contesto, con faccia che cambia mentre lo porti |
| 0.7.1 | 11 ott 2026 | 3CX: team, chat, segreteria, code, trasferimento e deviazione; cielo del Meteo grande dietro il personaggio |
| 0.7.0 | 11 ott 2026 | Fiamma animata, Geco con sguardo fino all'orbita, Roccia, Magma, Pietra e Foglia ridisegnati |
| 0.6.9 | 11 ott 2026 | Sei nuovi personaggi: Geco, Fiamma, Magma, Pietra, Roccia e Foglia |
| 0.6.8 | 11 ott 2026 | Menu sul testo selezionato con `Win+Alt+A`, «Sostituisci» con anteprima, «Lavora su» nelle azioni rapide, reazioni del personaggio per situazione, niente salti d'altezza dell'isola |
| 0.6.7 | 10 ott 2026 | Risposta in markdown e «Continua» sulla card «finito», «Chiedi a questa sessione», «Più tardi» sul permesso, «Sempre» di sessione, 📌 come finestra normale |
| 0.6.6 | 10 ott 2026 | Saluto al centro dello schermo (o spento), `Ctrl+Space` apre e chiude, Claude Code solo con i suoi hook, niente falsi errori di rete dopo lo standby, passi della sessione senza sovrapposizioni |
| 0.6.5 | 9 ott 2026 | Cartella trascinata nella chat, menu col clic destro sul personaggio, saluto senza isola, `Ctrl+Space` sulla Panoramica, angoli arrotondati dell'isola staccata |
| 0.6.4 | 9 ott 2026 | Goccia predefinita, cronologia delle chat, isola fino ai bordi dello schermo, posizione dell'isola aperta |
| 0.6.3 | 9 ott 2026 | Interfaccia in inglese, `Ctrl+Space` per aprire l'isola, riepilogo settimanale degli agenti, limiti del piano Pro/Max, prezzi dei modelli |
| 0.6.2 | 9 ott 2026 | Barra di ricerca (integrazioni, azioni, programmi), file fissati nel Vassoio, azioni ⚡ senza selezione, «Chiedi alla chat» |
| 0.6.1 | 9 ott 2026 | Card «finito» da qualsiasi programma, cielo del Meteo sul personaggio, appunti lunghi nella card |
| 0.6.0 | 8 ott 2026 | opencode 2 come motore della chat e come agente, scheda Agenti per tutti gli agenti, pagine Chat e Agenti separate |
| 0.5.9 | 7 ott 2026 | Isola aperta ridimensionabile, loghi dei servizi, Panoramica riordinabile, cartelle delle azioni ⚡ |
| 0.5.8 | 6 ott 2026 | Vassoio dei file, consumo di Claude, Cursor e Copilot CLI, piano dell'agente e avvisi di rischio sui permessi |
| 0.5.7 | 5 ott 2026 | Azioni sul testo selezionato, Outlook senza PowerShell, registro delle chiamate 3CX |
| 0.5.6 | 5 ott 2026 | Chat con l'abbonamento: spiegato cosa serve (Claude Code da riga di comando) |
| 0.5.5 | 4 ott 2026 | Altri motori della chat e altri agenti, markdown nelle risposte, **Sempre** sui permessi, modifiche ai file in tempo reale |
| 0.5.4 | 4 ott 2026 | README completo e nuove schermate |
| 0.5.3 | 4 ott 2026 | Integrazione 3CX, isola aperta spostabile |
| 0.5.2 | 4 ott 2026 | Pillole e schede riordinabili trascinandole |
| 0.5.1 | 4 ott 2026 | Scorciatoie registrate premendo i tasti, Cattura una zona, immagini negli Appunti |
| 0.5.0 | 4 ott 2026 | Proposte di automazioni dalle tue abitudini |
| 0.3.0 | 4 ott 2026 | Automazioni, Claude che usa il PC dalla chat, calcolatrice, ZIP, schede delle integrazioni |
| 0.2.0 | 2 ott 2026 | Prima versione pubblica, aggiornamenti automatici |
