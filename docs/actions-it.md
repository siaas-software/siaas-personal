# Actions in SIAAS Personal

Le Actions sono istruzioni Markdown riutilizzabili che spiegano all'assistente come svolgere un compito. Non sono plugin eseguibili, script, agenti indipendenti o nuove capacità. Usano modello locale, conoscenza, ricerca e permessi già disponibili nell'assistente.

## Dove si trovano

Apri **Actions** nella navigazione principale, tra **Projects** e **Templates**. Questi nomi, come **Actions**, **Models**
e **Knowledge**, sono etichette fisse dell’interfaccia e restano in inglese.

- **Actions integrate**: Mind map, Report, Flashcards e Quiz. Sono pronte all'uso, di sola lettura e non eliminabili. Restano disponibili con gli aggiornamenti.
- **Le mie Actions**: le istruzioni create su questo computer. Sono disponibili negli assistenti, ma ogni utilizzo accede solo alla conoscenza e ai permessi dell'assistente selezionato.

Con **Visualizza istruzioni Markdown** puoi leggere il testo effettivamente fornito al modello. Tutte le Actions Markdown hanno la stessa icona a forma di fulmine e si distinguono per nome.

## Creare un'Action

1. Premi **Aggiungi Action** e scegli un nome univoco, fino a 80 caratteri. Maiuscole e minuscole non distinguono due nomi; non puoi riutilizzare un nome integrato.
2. Prima di creare o modificare, apri **Actions → menu con tre puntini accanto al titolo → Models**. Seleziona un solo modello locale per la chat già installato. La scelta globale del Builder resta su questo PC anche dopo il riavvio e non cambia i modelli degli assistenti. Se Ollama è spento, se il modello salvato è stato disinstallato o se non è disponibile, creazione/modifica/salvataggio sono bloccati. Avvia Ollama o installa un modello nelle Impostazioni, poi torna in **Models** e riprova.
3. Descrivi il compito e il risultato desiderato, anche in italiano. Per esempio: «Aiutami a creare un'Action che trasformi gli appunti delle lezioni in una breve guida di ripasso». Il builder può fare una domanda mirata se mancano informazioni essenziali.
4. Leggi l'**Anteprima Markdown**. Le istruzioni vengono generate in inglese, anche se conversi in un'altra lingua. Puoi chiedere ulteriori modifiche nella stessa chat.
5. Premi **Conferma e salva Action**. La sola anteprima non salva nulla. **Annulla** chiude la bozza senza modificare i dati salvati.

Il builder serve esclusivamente a creare o migliorare Actions. «Che tempo farà domani?» è una domanda generica; «Crea un'Action che riassuma le informazioni meteo che fornisco» è pertinente. Le richieste fuori ambito vengono reindirizzate e quelle che richiedono capacità non disponibili vengono rifiutate. Il builder non esegue le istruzioni generate, non installa strumenti e non esegue comandi.

La classificazione dell'ambito, la validazione delle risposte strutturate e una revisione separata del modello aiutano a rispettare questi limiti. Non garantiscono però una comprensione perfetta: i modelli possono sbagliare. Controlla sempre il contenuto prima di salvarlo.

Puoi interrompere la generazione. Una risposta incompleta, non valida, non in inglese o incompatibile non riceve un'anteprima salvabile. In caso di errore puoi riprovare o scegliere un altro modello locale. Le conversazioni del builder sono temporanee: un riavvio invalida le anteprime non salvate, ma conserva tutte le Actions già salvate.

## Modificare o eliminare

Apri le istruzioni di un'Action personalizzata e premi **Modifica con AI**. Il builder riceve la definizione attuale: descrivi cosa vuoi cambiare. Controlla l'anteprima aggiornata e conferma per sostituire la versione salvata. Annullando, l'originale rimane invariato. Se un'altra modifica è intervenuta nel frattempo, riapri l'Action e riprova.

Premi **Elimina**, poi **Conferma eliminazione** per rimuovere un'Action personalizzata. Le conversazioni già esistenti e i relativi risultati restano disponibili. Le Actions integrate non hanno comandi di modifica o eliminazione; anche il server rifiuta queste operazioni.

## Utilizzo nella chat

La colonna delle scorciatoie mostra, nell'ordine:

1. **Data Cell**, attualmente denominata **Tabella dati**, con la sua icona a tabella.
2. Un separatore.
3. Le Actions Markdown integrate.
4. Le Actions personalizzate.

Un clic sull'Action invia subito una richiesta. Se hai già scritto un messaggio, le istruzioni si applicano a quel testo e il campo si svuota. Se il campo è vuoto, l'Action usa la conoscenza e il contesto pertinente dell'assistente, come le vecchie scorciatoie. Il messaggio salvato indica l'Action selezionata. In caso di errore il testo viene ripristinato: per riprovare con l'Action, selezionala di nuovo. I successivi messaggi normali non riapplicano automaticamente il suo Markdown.

Modello, istruzioni permanenti, documenti, siti configurati, ricerca e permessi restano invariati. Le istruzioni dell'Action valgono solo per quella richiesta e sono subordinate alle restrizioni dell'assistente. Non concedono accesso alla shell, nuove integrazioni o nuove operazioni. I risultati delle conversazioni rimangono nel contesto, ma il corpo delle istruzioni dell'Action non viene reinserito nei turni successivi.

**Data Cell / Tabella dati** resta una funzione nativa della chat: conserva la modale originale, l'icona e il comportamento. Descrivi argomento, colonne e filtri nella modale; la tabella comparirà in chat. Non compare nella pagina Actions e non è modificabile come Action Markdown. Come prima, l'invio dalla modale conserva un eventuale testo già scritto separatamente nel campo della chat.

## Salvataggio e compatibilità

Le Actions personalizzate vengono conservate nel database locale esistente `siaas.sqlite`, tabella `actions`: identificatore UUID stabile, nome, Markdown effettivo, classificazione e date di creazione/modifica. La directory è quella già utilizzata dall'app Electron tramite `SIAAS_DATA_DIR`; in un ambiente locale configurato manualmente, il valore predefinito è `~/.siaas`. Aggiornamenti e backup esistenti includono il database e conservano le Actions. Non servono account, servizi cloud o le vecchie directory Skills.

Le definizioni integrate sono incluse nell'applicazione. La migrazione aggiunge una tabella senza riscrivere progetti, template, assistenti o conversazioni; mantiene la versione 4 del database per permettere alle versioni precedenti di ignorare la nuova tabella senza eliminarla.

| Scorciatoia precedente | Risultato |
| --- | --- |
| Mind map | Action integrata: mappa testuale con concetto centrale, rami e sottoargomenti |
| Report | Action integrata: report in chat con sintesi, risultati, evidenze e conclusioni |
| Flashcards | Action integrata: dieci schede numerate con domanda e risposta |
| Quiz | Action integrata: cinque domande, quattro opzioni e soluzioni separate con spiegazioni |
| Data table / Data Cell | Eccezione nativa: modale e icona originali, disponibile solo in chat |

Le Actions migrate conservano uso delle fonti e del contesto, citazioni, trattamento delle fonti come dati, dichiarazione delle informazioni mancanti e risposta predefinita in inglese salvo richiesta diversa. Per Report resta disponibile lo strumento preesistente per report scaricabili quando richiesto esplicitamente e consentito dal modello: non viene aggiunto alcuno strumento.
