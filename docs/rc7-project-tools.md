# RC7 draft · Project tools

## English

In Project settings, choose **Project Actions** to link existing workspace tasks. **Procedural Skills** contains Markdown instructions. Preview a Skill ZIP, review its files and import it. Select an assistant and enable the Skill explicitly. Replacing or restoring a package clears its assignments. Existing custom Actions retain their original behavior. Use **Preview AGENTS.md** and **Copy** to inspect or copy the current configuration.

Project export uses v2 for ordinary RC6 projects. A project with linked Actions, Skills or permission overrides uses v3. Its requested tools contain Action names and digests, Skill package names and digests with assistant positions, and proposed permission rules. Imported requests remain visible in settings. Review a matching Action, import and assign matching Skills locally, and add desired permission rules to the draft before saving. The destination owns its tool settings. v1 and v2 remain supported.

A Skill ZIP contains one folder named for its Skill, a SKILL.md file and optional references/*.md files. Each file is limited to 30,000 bytes, the expanded total to 160,000 bytes, the archive to 256 KiB and the entry count to 32. Required metadata fields are name and description. Supported optional fields are version, author and license. Preview renders the files as text. Export rebuilds the ZIP from validated Markdown. The package digest identifies file names and contents independently of compression.

## Italiano

Nelle impostazioni del progetto, **Azioni collegate al progetto** permette di associare attività già presenti nel workspace. Le **Competenze procedurali (Skills)** contengono istruzioni Markdown. Apri l’anteprima di uno ZIP, controlla i file e importalo. Seleziona l’assistente e abilita esplicitamente la Skill. Sostituire o ripristinare il pacchetto azzera le assegnazioni. Le Actions personalizzate esistenti mantengono il loro comportamento. **Visualizza AGENTS.md** mostra la configurazione corrente e **Copia** la copia negli appunti.

L’esportazione usa v2 per i progetti RC6 ordinari e v3 per un progetto con Actions collegate, Skills o regole di permesso personalizzate. v3 trasferisce nomi e impronte delle Actions e delle Skills, posizioni degli assistenti e regole proposte. Dopo l’importazione, controlla le proposte nelle impostazioni. Seleziona le Actions corrispondenti, importa e abilita localmente le Skills e aggiungi alla bozza solo le regole desiderate prima di salvarle. Restano supportati i template v1 e v2.

Uno ZIP contiene una cartella col nome della Skill, il file SKILL.md ed eventuali file references/*.md. Limiti ammessi: 30.000 byte per file, 160.000 byte complessivi dopo la decompressione, 256 KiB per lo ZIP e 32 elementi. I metadati obbligatori sono name e description. Sono facoltativi version, author e license. L’anteprima mostra il testo. L’esportazione ricostruisce lo ZIP dai file Markdown validati. L’impronta identifica nomi e contenuti dei file indipendentemente dalla compressione.

## MCP client

Use **MCP connections** in project settings to configure a trusted server. Choose a descriptive logical name suitable for sharing with template recipients. Connect, inspect the discovered tool and its accepted input fields, select an assistant and assign the tool. The assistant can then use the tool through chat. For a deterministic call, enter `/mcp <connection UUID> <tool> <JSON object>`. Each invocation uses the current project policy. A project-wide Deny blocks individual grants.

The client uses the MIT-licensed `@modelcontextprotocol/sdk` 1.32.2. Streamable HTTP uses public HTTPS, destination pinning and a session-only bearer token if supplied. A loopback HTTP server requires explicit consent. The stdio option runs a hash-verified native executable with the desktop user's operating-system privileges. Choose software you trust. The client stages the executable in a private working directory and supplies a restricted environment. Reconnect manually after restarting the app.

## Client MCP

In **Connessioni MCP**, configura un server attendibile e scegli un nome condivisibile con chi riceverà il template. Connettiti, controlla lo schema dello strumento, seleziona un assistente e assegnagli lo strumento. In chat puoi usare il comando deterministico `/mcp <UUID connessione> <strumento> <oggetto JSON>`. La regola Deny del progetto blocca anche gli strumenti assegnati.

Un eseguibile stdio viene verificato tramite SHA-256 e avviato con i privilegi del tuo utente. Seleziona solo programmi attendibili. Il token HTTPS dura per la connessione corrente. Dopo il riavvio, riconnetti il server dalle impostazioni. Il template conserva nome logico del server, strumento, impronta e posizione dell’assistente. Per eseguire la richiesta nel progetto di destinazione, configura e assegna esplicitamente lo strumento.

## Local media acceptance profile

Settings → Media Engine enables deterministic CPU processing. Inputs belong to one project and assistant. Add PNG files in settings. Download generated media, choose a typed operation, and submit its command in the assistant chat or through the Local media Action. One job runs per profile. Result publication rechecks the current permissions and settings. The profile stores at most 64 MiB of media files. Video assembly uses 12 frames per second. Inspection reports codec, dimensions and frames. The Linux profile locates FFmpeg and ffprobe under /usr/bin.

The separately enabled CPU image generator accepts one locally installed Linux x86-64 build and one distilled text-to-image model. In Settings, follow the component links, download the selected files and choose **Verify and install**. The app verifies SHA-256 before installation and again when staging the job. Generated images are square, 256 or 512 pixels, with one denoising step. The worker has a 90-second wall-clock deadline, a 4.5 GiB virtual address-space ceiling and a configurable thread limit. Available-memory checks are estimates. The model and backend remain optional.

| Component | Revision | SHA-256 |
| --- | --- | --- |
| stable-diffusion.cpp Linux CPU, Ubuntu 24.04 archive | master-901-241518b, MIT | `24fda39afa2e9299f0bfbc8b97b316d1d8f2f64dc928f315c147e50936e3c33e` |
| SDXS-512 tinySDdistilled Q8_0 | 3144d898d61492f8382ffcabec055733fc5b2a0e, model card OpenRAIL++ | `409ab23582ee074c6b9d5395784fc0741b0599fb9d138686c69087c71678eb6a` |

## Elaborazione media locale

In Impostazioni → Media Engine abilita l’elaborazione CPU, scegli l’assistente e carica i PNG. Seleziona l’operazione e incolla il comando nella chat dell’assistente. Puoi ridimensionare, affiancare o sovrapporre immagini, creare un video dalle foto, applicare una dissolvenza, unire o ricodificare video prodotti dall’app e ispezionare il risultato. Il Gateway mostra i parametri da approvare. I file sono scaricabili dalla sezione dello stesso assistente.

Per generare un’immagine su Linux x86-64, apri la sezione stable-diffusion.cpp, scarica i due componenti dalle fonti indicate, verifica e installa i file locali e abilita la generazione CPU. Il modello produce PNG quadrati da 256 o 512 pixel. Per i video, la combinazione generativa modello e hardware richiede ancora una prova reale.
