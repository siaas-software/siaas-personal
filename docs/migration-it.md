# Passaggio di un'installazione esistente a SIAAS Personal 1.0.0

SIAAS Personal avvia una nuova serie di release in un nuovo repository. L'updater della precedente v1.2.0 continua a controllare il repository originale e non propone v1.0.0. Non forzare un downgrade nella vecchia installazione.

1. Chiudi la precedente applicazione e gli eventuali server di sviluppo che usano i suoi dati.
2. Con l'app chiusa, copia per sicurezza l'intera cartella dati: `%APPDATA%\SIAAS` su Windows, `~/Library/Application Support/SIAAS` su macOS oppure `${XDG_CONFIG_HOME:-~/.config}/SIAAS` su Linux. Se usavi `--user-data-dir`, conserva la cartella personalizzata. Le esecuzioni di sviluppo usano `SIAAS_DATA_DIR` o `~/.siaas`, separati dal profilo desktop.
3. Quando la nuova release stabile e il sito aggiornato sono disponibili, segui la [procedura di installazione](installation-it.md). Usa la nuova cartella predefinita. Se imposti `SIAAS_INSTALL_DIR`, scegli una cartella nuova, mai quella della vecchia installazione. Nessuna installazione precedente viene eliminata o sovrascritta automaticamente.
4. Avvia il nuovo collegamento **SIAAS Personal**. Identificativo applicazione (`it.siaas.desktop`), cartella del profilo (`SIAAS`), nome del database e schema restano invariati. Progetti, assistenti, conoscenza, conversazioni, impostazioni, Ollama gestito e file dell'utente continuano quindi a usare il profilo desktop esistente. I modelli di un Ollama esterno restano nella loro posizione originale.
5. Controlla progetti, chat, impostazioni e file collegati prima di abbandonare il vecchio collegamento. Conserva backup e vecchia applicazione. Non avviare entrambe sullo stesso profilo contemporaneamente.

Aggiornamento e rollback della nuova installazione gestiscono solo la nuova serie di release. La prima installazione non dispone ancora di una release SIAAS precedente. Per tornare alla vecchia app, chiudi SIAAS e usa il vecchio collegamento. Questa modifica del nome non cambia lo schema del database; release future potrebbero farlo. Il rollback dell'app non annulla le migrazioni dei dati. Ripristina un eventuale backup solo con entrambe le app chiuse e dopo aver conservato una copia dei dati più recenti.

Installazione nativa e avvio grafico su Windows/macOS richiedono una verifica sui rispettivi sistemi. Test automatici del database, simulazioni degli installer e verifiche Linux non provano il funzionamento nativo su ogni piattaforma. Errori di download, checksum o build lasciano disponibili installazione e profilo precedenti.
