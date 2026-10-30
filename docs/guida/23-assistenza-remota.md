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
