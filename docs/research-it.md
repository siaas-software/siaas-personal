# Fonti dell’assistente e ricerca Beta opzionale

Ogni assistente può usare **documenti locali indicizzati e siti configurati esplicitamente**, anche con modelli per chat standard. Non esiste più un selettore di modalità di ricerca esclusive. Recupero e consultazione standard non richiedono Docker o servizi Beta.

## Percorso standard delle fonti

1. Recupera i documenti locali indicizzati pertinenti. Se gli embedding non sono disponibili o non trovano corrispondenze, usa un recupero lessicale deterministico limitato all’assistente.
2. Rimuove le parole comuni inglesi/italiane dalla domanda attuale e misura la copertura dei termini significativi nei passaggi. Se almeno l’80% dei termini è presente e non servono informazioni attuali/dai siti, evita richieste web. È una regola di instradamento, **non** una verifica della correttezza o completezza semantica.
3. Altrimenti legge solo siti configurati e autorizzati, rispettando ambito Pagina/Sezione, budget pagine, dimensioni, redirect, timeout e protezioni delle reti private. Saluti e richieste solo documenti non consultano siti o motori. Non invia domanda o documenti ai siti: esegue GET limitate agli URL configurati e ai collegamenti diretti consentiti.
4. Se attivo separatamente e pronto, Ragionamento avanzato valuta le fonti raccolte. La consultazione standard non dipende dalla sua disponibilità.
5. Se le fonti non bastano, Ricerca web avanzata scopre altre fonti pubbliche **solo con consenso globale e dell’assistente**, nuovi controlli Docker e servizio sano. Se attivo, il ragionamento può rivalutare le nuove evidenze.
6. La risposta usa le fonti numerate disponibili ed esplicita avvisi e informazioni mancanti. Gli errori conservano citazioni già raccolte e conversazioni.

Il recupero locale può non trovare passaggi pertinenti. Domande ampie possono attivare la consultazione dei siti anche se i documenti contengono una risposta. Il percorso standard non avvia mai ricerche Internet arbitrarie.

## Pannello ricerca dell’assistente

URL dei siti, ambito Pagina/Sezione, pagine massime e timeout sono sempre disponibili. **Pagina** legge l’URL configurato. **Sezione** segue anche collegamenti diretti sotto la stessa origine e percorso, con un solo livello.

Le **fonti di conoscenza** sono importazioni persistenti salvate e indicizzate per l’assistente. I **siti configurati** vengono consultati su richiesta e non importati automaticamente nella sezione Knowledge. Le citazioni della conversazione possono conservare le evidenze usate; le copie di siti importate restano separatamente utilizzabili offline dopo l’indicizzazione.

Il pannello contiene **Ricerca web avanzata (Beta)**, DISATTIVATA per i nuovi assistenti. Attiva prima il servizio globale in **Impostazioni → Funzionalità sperimentali**, poi l’interruttore dell’assistente con Docker e servizio pronti. L’interruttore dell’assistente non attiva quello globale. Un consenso salvato ma temporaneamente indisponibile resta visibile e può essere disattivato; la chat usa le fonti standard. Una nuova attivazione non valida viene rifiutata dal backend senza salvarla.

## Controlli Beta globali

| Funzionalità | Percorso standard | Ragionamento avanzato (Beta) | Ricerca web avanzata (Beta) |
|---|---|---|---|
| Documenti locali e siti configurati | Sempre disponibili | Conservati | Conservati |
| Docker necessario | No | Sì | Sì |
| Consenso globale | No | Richiesto | Richiesto |
| Consenso ricerca web dell’assistente | No | Non richiesto | Richiesto |
| Valutazione con motore decisionale | No | Sì, se pronto | Solo se il ragionamento è attivo separatamente |
| Scoperta altre fonti Internet | Mai | No | Solo come ripiego |
| Impostazione iniziale | Fonti standard disponibili | DISATTIVATO | DISATTIVATA |

I servizi sono Beta indipendenti e opzionali. Richiedono Docker CLI, Compose v2 ed Engine 20.10+ accessibile con container Linux su x64/arm64. Senza prerequisiti, gli interruttori globali restano bloccati; Aggiorna stato non concede consenso. Preferenze e disponibilità restano separate. Gestione servizi, salute, tentativi e arresto in sospeso restano invariati. La scoperta avanzata usa il modello locale e può essere limitata dal supporto strumenti e dalle risorse. I siti standard funzionano anche senza modalità agente.

## Migrazione e privacy

Le impostazioni versione 2 conservano URL e limiti e aggiungono `advancedWebResearch` per assistente. Le vecchie configurazioni `sites` mantengono la consultazione autorizzata. Le vecchie `web` conservano i siti ma migrano con scoperta dell’assistente **DISATTIVATA**, con un avviso per il nuovo consenso. Le vecchie `documents` con URL salvati inattivi li conservano ma richiedono **Consenti consultazione dei siti configurati** prima della prima richiesta. La migrazione non usa la rete. Progetti, conoscenza, modelli, messaggi, fonti, avvisi e conversazioni non vengono eliminati.

Le query di scoperta usano **solo la domanda attuale**, mai testo generato da passaggi locali, istruzioni, titoli o cronologia. Controlli prudenti saltano domande con contesto privato, identificativi o frasi locali copiate rilevati, mostrando un avviso. Non è anonimizzazione garantita: evita domande riservate quando attivi la scoperta Internet. Documenti e cronologia non vengono allegati alle richieste di ricerca. Restano protezioni SSRF, budget query/pagine e inferenza locale.

## Prerequisiti Docker e risoluzione problemi

- Windows: installa [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), completa la configurazione WSL 2 / virtualizzazione supportata, seleziona container Linux e avvia Desktop.
- macOS: installa [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) per Intel o Apple silicon e avvialo.
- Linux: installa [Docker Engine](https://docs.docker.com/engine/install/) e [Compose v2](https://docs.docker.com/compose/install/linux/), avvia il daemon e consenti l’accesso al tuo utente secondo le regole di sicurezza locali.

Verifica da un nuovo terminale:

```bash
docker --version
docker compose version
docker info
```

Poi usa Impostazioni → Funzionalità sperimentali → Aggiorna stato e attiva esplicitamente la funzione desiderata. La configurazione non installa Docker né avvia il daemon. Se i controlli restano indisponibili, verifica PATH, permessi, accesso Engine, container Linux, architettura e versione. Errori del servizio possono invece dipendere da download falliti, porte occupate, risorse insufficienti o Ollama non disponibile. Controlla stato della ricerca e log locale; riprova dopo la correzione.

Per la diagnosi avanzata dalla cartella sorgente/versione:

```bash
npm run research:status
npm run research:setup -- reasoning
npm run research:setup -- web
npm run research:start -- reasoning
npm run research:start -- web
npm run research:stop -- reasoning
npm run research:stop -- web
```

Ogni comando di modifica richiede un servizio esplicito. Questi comandi preparano/arrestano servizi, **non** concedono consenso e non cambiano gli interruttori. Preferisci i controlli nell’app. Con installazione gestita usa `runtime.node` e `runtime.npm` di `current.json`, con `--prefix <radice-installazione>/versions/<folder>` prima di `run`: non servono Node.js/npm globali o modifiche a nvm. La radice predefinita è `%LOCALAPPDATA%/SIAAS Personal Source` su Windows e `~/.local/share/siaas-personal-source` su macOS/Linux; rispetta un eventuale `SIAAS_INSTALL_DIR` personalizzato.

L’implementazione riusa il container Laya per il ragionamento e l’adattatore Node locale Morphic con il servizio Docker SearXNG per la ricerca web. Conserva così l’accesso a Ollama limitato a loopback senza cambiarne l’ascolto. I nomi dei motori sono dettagli tecnici, non etichette principali nell’interfaccia.

## Tecnologie originali e licenze

Ragionamento avanzato usa il pacchetto Python Laya Apache-2.0 e un checkpoint multilingue scaricato al primo utilizzo. Ricerca web avanzata usa l'adattamento SIAAS del ricercatore Morphic Apache-2.0 e il servizio di ricerca SearXNG separato in Docker. Nessuna delle due funzioni serve per chat standard, documenti locali o consultazione dei siti configurati. La licenza MIT di SIAAS non sostituisce quelle originali. Consulta [Open Source e tecnologie di terze parti](https://siaas.vercel.app/open-source/it) e gli [avvisi sulle terze parti](../THIRD_PARTY_NOTICES.md) per autori, revisioni, testi delle licenze e attribuzioni.


## Limiti della verifica

Test unitari e integrazione API/SQLite compilata usano Docker, siti, Ollama e servizi avanzati simulati. Ciclo di vita Docker reale, idratazione browser e prove native Windows/macOS/modelli restano nella fase Astra separata. Nessuna distribuzione o release viene eseguita.

Verifica licenze (19 ottobre 2026): Laya **0.4.6** e l’adattamento Morphic basato su **62e0816b019c5543ccc280c40ec1f020d5af4669** sono Apache-2.0; SIAAS Personal resta MIT. Il wheel e la revisione verificati non contengono un NOTICE upstream. I download dei modelli non fissano una revisione: verificare il singolo artefatto prima della redistribuzione. Consulta il [registro di verifica](https://github.com/siaas-software/siaas-personal/blob/main/docs/license-verification.md).
