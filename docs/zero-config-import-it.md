# Importazione Excel e CSV

Carica il file nella Knowledge dell'assistente e fai una domanda in Chat. Per
fogli rettangolari con intestazioni e tipi riconoscibili non servono nome del
dataset, mapping, identificatori o JSON. La scheda mostra «Ready for analysis»,
numero di fogli, righe, colonne, avvisi e anteprima. I dati restano locali.

Con `budgets.csv` degli esempi, chiedi «Quanto ho previsto per il cibo a ottobre?».
Il risultato atteso è **35 EUR**, con fonte e operazioni. L'interpretazione della
domanda richiede un modello Ollama locale; il calcolo è deterministico. La
qualità del planner reale non è certificata dai test con modello simulato.

Se il file è ambiguo, viene richiesto solo il chiarimento necessario: riga delle
intestazioni, ordine giorno/mese o mese/giorno, mantenimento di una colonna come
testo, consenso all'uso di risultati di formule salvati. Le formule senza valori
memorizzati e gli errori Excel richiedono di correggere il file e ricaricarlo.
Valori mancanti non diventano zero; i duplicati non vengono eliminati. Le valute
restano separate, anche se nello stesso foglio ce ne sono più di una.

«Connect related files» propone campi con nomi e valori compatibili. Conferma
soltanto se rappresentano la stessa entità: un'etichetta uguale non dimostra una
relazione. I file restano analizzabili singolarmente senza creare collegamenti.

«Advanced Settings» conserva nomi, intestazioni, tipi, partizioni valuta/unità,
relazioni, cardinalità, formule, Query editor, piani JSON e download dei risultati
con evidenze. Numeri in formati locali ambigui devono essere normalizzati nel file
oppure mantenuti come testo; non viene inventata una conversione.

Una modifica del file collegato richiede l'aggiornamento della fonte. Gli ID dei
fogli rimangono stabili, ma i collegamenti vengono invalidati e l'interpretazione
viene ricontrollata. Nessuna installazione Python, Docker o database server è
richiesta. Le domande generali, ad esempio «Quanto fa 2 + 2?», non richiedono dati
nella Knowledge.
