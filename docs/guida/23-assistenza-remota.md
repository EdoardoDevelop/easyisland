# Assistenza remota
> sezione: Collegare i servizi
> in breve: Accesso remoto con WinRM e SSH per lavorare sul PC di un cliente con la chat, e Remote Desktop Manager.

## Accesso remoto
Un collegamento **temporaneo** al PC di un cliente, Windows o Linux, per farci lavorare la chat.

### Collegarsi
Nella scheda **Accesso remoto**: **WinRM** o **SSH**, indirizzo, porta, utente, password; per WinRM anche «HTTPS (5986)» e «Aggiungi a TrustedHosts». Una **guida passo passo** spiega come preparare il PC del cliente. **Avvia connessione** prova il collegamento.

- La **password** resta solo nella memoria di EasyIsland finché la connessione è aperta; il campo si svuota subito. Niente viene salvato.
- **WinRM** usa Windows PowerShell; **SSH** l'`ssh.exe` di Windows (OpenSSH).

### Con la chat
Con una connessione aperta, nella testata della chat compaiono **🔌** e il nome del PC (anche **Collega alla chat** nella scheda). Da lì la chat esegue **comandi sul PC del cliente**, uno alla volta (PowerShell su Windows, sh su Linux), **ognuno con Consenti / Nega** e il comando intero nella chat. Esempi: «perché lo spooler non parte?», «quanto spazio c'è sui dischi?», «controlla gli ultimi errori nel registro eventi».

### Chiudere
**Chiudi connessione**: la chat si scollega, la password viene dimenticata, l'indirizzo esce da TrustedHosts (con la conferma di Windows), WinRM torna spento se lo era.

Gli errori comuni (TrustedHosts, accesso negato, PC che non risponde, connessione rifiutata, OpenSSH vecchio) diventano messaggi chiari con cosa fare.

## Remote Desktop Manager
Se usi **Remote Desktop Manager** di Devolutions, l'integrazione lo porta nell'isola. **RDM resta il programma che si collega**: EasyIsland trova la connessione e chiede a RDM di aprirla, modificarla o cercarla. Non legge mai una password.
- **Elenco delle connessioni** dal modulo ufficiale `Devolutions.PowerShell` (serve PowerShell 7.2 o più): la stessa origine dati di RDM, anche **Devolutions Server** e **Hub** con i vault dell'utente. Viene tenuto **cifrato** sul PC per l'uso offline e si aggiorna con **Sincronizza**.
- **Ricerca** per nome, cartella o host, dalla scheda e dal campo in alto dell'isola; un clic apre la sessione in RDM.
- **Senza modulo**: la ricerca si apre dentro RDM, e ci si collega a un indirizzo senza salvarlo (RDP o SSH).
- In Impostazioni vedi lo stato di RDM, di PowerShell 7 e del modulo, con i comandi da copiare per installarli (EasyIsland non li esegue mai).
- **Nella chat**: «cerca il server di Rossi» trova connessioni, cartelle e credenziali (mai le password); «aprilo» chiede **Consenti / Nega** prima di aprire la connessione in RDM.

### Devolutions Cloud
Se le tue voci stanno in un vault di **Devolutions Cloud** (o Hub) che il modulo di RDM non vede, collega EasyIsland con un'**Application identity**:
1. In Devolutions Cloud: **Administration → Application identities → Add** (un nome per PC, es. «EasyIsland-PC-lavoro»). Lascia *Is enabled*, non spuntare *Is administrator*. Per il vault personale spunta **Can access user vaults**; per un vault condiviso dai all'identità i permessi sul vault.
2. Copia **Application Key** e **Application Secret** (il Secret si vede una volta sola).
3. In **Impostazioni → Remote Desktop Manager** scegli «Devolutions Cloud: Usato», incolla l'indirizzo del workspace (quello nella barra del browser), Key e Secret, premi **Prova** e poi **Sincronizza**.

Da quel momento la scheda RDM mostra **solo Devolutions Cloud** (non più l'elenco letto con il modulo): in alto la ricerca, sotto le cartelle dei vault con connessioni, credenziali e liste password, che scorrono dentro la scheda.
- **Clic su una voce**: sotto l'elenco (o di lato, se la scheda è larga) compare tutto ciò che la riguarda: tipo, cartella, host o indirizzo, **utente**, dominio, **password**, descrizione, le righe di una lista password. La password è nascosta: **👁** la mostra per 30 secondi, **Copia** la mette negli appunti.
- **Copia password** la mette negli **appunti**, fuori dalla cronologia di Windows e dagli Appunti di EasyIsland, e li **svuota dopo 30 secondi** (se nel frattempo non hai copiato altro). La password non compare mai a schermo né nella chat.
- **+ Credenziale** e **+ Lista password da questa cartella** (unisce le credenziali della cartella in una voce «Lista Password»): prima un'**anteprima**, poi **Conferma e crea**; EasyIsland rilegge la voce e ti dice se utenti e password tornano. Non elimina mai nulla.
- **Cliente**: collega un cliente di Zammad o 3CX alla sua cartella. Dal pulsante RDM di un ticket o di una chiamata di quel cliente la scheda si apre direttamente lì.

**Dalla chat** puoi fare le stesse cose: «che credenziali ci sono nella cartella di Rossi?», «dettagli della Lista Password», «unisci le password della cartella Server in una Lista Password» (prima l'anteprima, poi **Consenti**), «crea in CLIENTE la credenziale Firewall, utente admin». Per una credenziale con password si apre la **finestra di Windows** per le credenziali: la scrivi due volte e va direttamente nel vault, senza passare dalla chat. Le password non arrivano mai al motore della chat.

Le chiavi stanno in Gestione credenziali di Windows; l'elenco delle voci (senza password) è cifrato per il tuo utente su questo PC. Usa un'identità diversa per ogni PC: rigenerare il Secret scollega l'altro.
