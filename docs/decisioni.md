# Decisioni prese

Da controllare prima di proporre o fare una funzione. Una richiesta che va contro una di queste si fa solo dopo averne parlato con Edoardo.

- **Integrazione o widget:** un servizio o programma che c'è una volta sola è un'integrazione. I widget sono solo controlli ripetibili.
- **Cursor e Copilot CLI solo in osservazione:** sui loro hook di permesso una risposta illeggibile o un errore bloccano lo strumento. L'isola non deve mai poter bloccare un agente.
- **Vassoio temporaneo:** si svuota a ogni avvio, di proposito. Restano solo i file che l'utente fissa con la puntina (deciso il 9 ottobre 2026).
- **Esclusi per ora:**
  - widget "Oggi"
  - rubrica clienti
  - timer d'intervento
  - GitHub rinnovato
  - funzioni nuove dai progetti simili (timer, avvisi di sistema, sostituzione dei riquadri di volume e luminosità, gioco del personaggio)
  - più sub-agenti in parallelo
  - consumo a 30 giorni
- **Limiti del piano Claude:** solo dalla `statusLine` di Claude Code (terminale, VS Code), nella card Consumo (9 ottobre 2026). L'app desktop di Claude non la esegue e Anthropic non pubblica i limiti in token: niente altre fonti.
- **Integrazioni:** si tengono tutte (deciso il 9 ottobre 2026).
- **Rimandato:** il personaggio (guardaroba, personaggio sul desktop, balla con la musica, nuovi personaggi). Le animazioni continue vanno contro la regola sulla CPU. Il cielo del Meteo sopra la testa è stato fatto l'8 ottobre 2026: si muove solo con pioggia o neve e mai a isola ritirata.
- **Identità:** nome EasyIsland, identifier `it.edoardo.easyisland` (da non cambiare più). Degli asset di Coucou non resta nulla, solo il codice MIT. EasyTech è ispirato a un logo aziendale: va verificato prima di distribuire.
- **Non supportati:** il nuovo Outlook (`olk.exe`, niente COM); Teams via API locale (le riunioni si riconoscono da microfono e webcam); i connettori di claude.ai in `claude -p`; la verifica in due passaggi di 3CX.
