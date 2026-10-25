# Installazione, runtime gestito e aggiornamenti

SIAAS Personal funziona localmente con Electron e Ollama. L’installer distribuito non richiede account, API AI a pagamento, Node.js globale, npm o Git e non modifica NVM. Gli sviluppatori possono continuare a usare il proprio Node.js con `npm ci` e `npm run desktop:dev`.

## Requisiti e disponibilità

Serve un desktop Windows, macOS o Linux a 64 bit (x64 o arm64), connessione Internet per l’installazione e i modelli, memoria e spazio adeguati; considera almeno 10 GB liberi come punto di partenza. Linux richiede le librerie di Electron e una sessione grafica; le dipendenze native possono richiedere gli strumenti di compilazione del sistema. Le protezioni macOS restano attive. Gli script non aggirano TLS, Gatekeeper o le policy di PowerShell.

Il bootstrap non richiede Node.js preinstallato. Windows usa PowerShell 5.1+ e gli strumenti archivio di Windows. macOS/Linux richiedono Bash, curl, tar, unzip e sha256sum o shasum. L’uso normale non richiede Docker. Ragionamento avanzato (Beta) e Ricerca web avanzata (Beta) sono opzionali e indipendenti, entrambi disattivati per impostazione predefinita; attivarli richiede Docker Engine 20.10+ (container Linux, x64/arm64), Compose v2 e consenso esplicito in Impostazioni → Funzionalità sperimentali. Ricerca web avanzata richiede anche il consenso per assistente; documenti e siti configurati condividono il percorso standard senza Docker. Vedi la guida alla ricerca.


## Installazioni esistenti

Per la precedente v1.2.0 segui la [procedura di migrazione](migration-it.md). La nuova v1.0.0 usa una cartella di installazione separata e conserva il profilo dati desktop esistente.

## Windows

Esamina [install.ps1](https://siaas.vercel.app/install.ps1), poi esegui in PowerShell normale:

```powershell
irm https://siaas.vercel.app/install.ps1 | iex
```

Lo script legge il manifest pubblico per `win32/x64` o `win32/arm64`, ne verifica schema e URL, scarica ZIP dei sorgenti e runtime ufficiale Node.js, controlla dimensione e SHA-256. Il checksum del runtime viene confrontato anche con `SHASUMS256.txt` ufficiale. Il collegamento nel menu Start usa un percorso esplicito del runtime gestito.

## macOS e Linux

Esamina [install.sh](https://siaas.vercel.app/install.sh), poi:

```bash
curl -fsSL https://siaas.vercel.app/install.sh -o install-siaas.sh
bash install-siaas.sh
```

Lo script rileva sistema e architettura, verifica gli archivi, compila l’app e crea un collegamento in `~/Applications` su macOS o `~/.local/share/applications` su Linux. Non forzare l’esecuzione di binari incompatibili.

## Node.js gestito dall’applicazione

La distribuzione usa **Node.js 24.22.0 LTS**, registrato in `runtime.json` e nella specifica di ogni release. Il packaging desktop richiede il supporto Zstandard di Node 24. Gli archivi ufficiali coprono Windows/macOS/Linux x64 e arm64. Runtime e build Linux x64 sono stati verificati in questo ambiente; Windows, macOS e arm64 richiedono ancora prove native.

Cartelle predefinite:

- Windows: `%LOCALAPPDATA%/SIAAS Personal Source`
- macOS/Linux: `~/.local/share/siaas-personal-source`
- Personalizzazione opzionale: `SIAAS_INSTALL_DIR` con percorso assoluto

I runtime si trovano in `runtimes/node-v<VERSION>-<PLATFORM>-<ARCH>`. `current.json` associa ogni versione al suo runtime; l’avvio ne verifica hash e versione. Anche il server distribuito usa Node privato. I processi di compilazione usano percorsi espliciti e un PATH temporaneo. PATH dell’utente, Node globale, NVM e modelli esistenti non vengono modificati.

## Aggiornamento, rollback e riparazione

Usa **Impostazioni → Aggiornamenti dell’applicazione**. L’app chiede conferma prima di chiudersi e registra l’aggiornamento in `update.log` nella cartella d’installazione. La nuova versione viene compilata e verificata prima dell’attivazione. Vengono conservate versione corrente e precedente con i relativi runtime; le vecchie cartelle note vengono eliminate dopo un’attivazione riuscita. I file sconosciuti vengono conservati. Ogni release mantiene il proprio gestore d’installazione.

Gli script `scripts/update.ps1` / `scripts/update.sh` usano il runtime gestito; `scripts/rollback.ps1` / `scripts/rollback.sh` ripristinano la coppia app/runtime precedente. `scripts/uninstall.*` rimuove il collegamento conservando versioni e dati. Il rollback non annulla le migrazioni del database: esegui un backup dei dati importanti prima di aggiornare.

Le installazioni precedenti senza metadati del runtime gestito non possono essere verificate dal nuovo gestore. Riesegui il nuovo installer senza cancellare il workspace. Il rollback gestito rifiuta una versione precedente priva di metadati del runtime. Se il runtime manca, è corrotto o incompatibile, l’avvio si ferma con istruzioni: chiudi l’app, rinomina la cartella del runtime danneggiato e riesegui l’installer ufficiale. Non modificare Node globale o NVM.

## Distribuzione e risoluzione dei problemi

Il manifest risolve l’ultima GitHub Release stabile pubblica senza autenticazione. Richiede due asset con digest SHA-256 validi forniti da GitHub:

- `SIAAS-Personal-<VERSION>-source.zip`, con i file del repository alla radice
- `SIAAS-Personal-<VERSION>-install.json`, con `schemaVersion: 1`, `version` e `nodeVersion`

Il manutentore li crea localmente con `npm run release:source` da sorgenti già committati. Il comando non pubblica nulla. Versione del pacchetto, manifest e runtime devono corrispondere. Pubblicare una release richiede un’autorizzazione separata.

- **Nessuna release pubblica stabile:** verifica visibilità e presenza dei due asset. Gli archivi automatici di GitHub non sostituiscono questi asset verificati.
- **Installer service not configured:** errore del precedente sito/proxy. Il codice verificato usa i metadati pubblici delle release. Controlla di usare lo script ufficiale corrente e leggi l’errore dell’endpoint; non aggiungere token privati e non disabilitare le verifiche.
- **Errore di rete:** verifica accesso a GitHub, release-assets.githubusercontent.com, nodejs.org e registry npm. Un errore durante preparazione/compilazione conserva l’installazione precedente.
- **Checksum o schema non valido:** interrompi e riprova dall’endpoint ufficiale; non disabilitare i controlli.
- **Errore di compilazione:** consulta terminale o `update.log`, spazio libero e dipendenze di sistema; conserva installazione e dati.

Il sito conserva `SITE_LAUNCH_STATUS=prelaunch`, blocco dell’indicizzazione e sitemap vuota. Dopo il collegamento autorizzato del nuovo repository, Vercel esegue i deploy dei commit su `main`. Il deploy non modifica le restrizioni di indicizzazione del prelaunch.

## Avvio, antivirus e file bloccati

Avvia **SIAAS Personal** dal menu Start di Windows (`%APPDATA%/Microsoft/Windows/Start Menu/Programs/SIAAS Personal.cmd`), da `~/Applications/SIAAS Personal.command` su macOS o dal menu applicazioni Linux (`~/.local/share/applications/siaas-personal.desktop`). Se manca il collegamento, controlla il log e riesegui l’installer verificato per ripararlo; non cancellare i dati.

Gli errori `EPERM` / `EACCES` durante la pulizia npm o la preparazione di una versione possono dipendere da processi aperti, permessi o blocchi dell’antivirus. Chiudi SIAAS e i processi che usano la cartella, verifica eventi dell’antivirus e spazio libero, quindi riprova. Per file verificati bloccati segui la procedura di eccezione approvata dall’amministratore, senza disattivare globalmente l’antivirus. Una preparazione fallita deve conservare la versione corrente. Esegui un backup del profilo dati Electron prima degli aggiornamenti: il rollback non annulla modifiche a dati o schema.
