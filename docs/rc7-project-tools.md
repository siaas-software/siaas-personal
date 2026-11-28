# RC7 draft · Project tools

## English

In Project settings, choose **Project Actions** to link existing workspace tasks. **Procedural Skills** contains Markdown instructions. Preview a Skill ZIP, review its files and import it. Select an assistant and enable the Skill explicitly. Replacing or restoring a package clears its assignments. Existing custom Actions retain their original behavior. Use **Preview AGENTS.md** and **Copy** to inspect or copy the current configuration.

Project export uses v2 for ordinary RC6 projects. A project with linked Actions, Skills or permission overrides uses v3. Its requested tools contain Action names and digests, Skill package names and digests with assistant positions, and proposed permission rules. Imported requests remain visible in settings. Review a matching Action, import and assign matching Skills locally, and add desired permission rules to the draft before saving. The destination owns its tool settings. v1 and v2 remain supported.

A Skill ZIP contains one folder named for its Skill, a SKILL.md file and optional references/*.md files. Each file is limited to 30,000 bytes, the expanded total to 160,000 bytes, the archive to 256 KiB and the entry count to 32. Required metadata fields are name and description. Supported optional fields are version, author and license. Preview renders the files as text. Export rebuilds the ZIP from validated Markdown. The package digest identifies file names and contents independently of compression.

## Italiano

Nelle impostazioni del progetto, **Azioni collegate al progetto** permette di associare attività già presenti nel workspace. Le **Competenze procedurali (Skills)** contengono istruzioni Markdown. Apri l’anteprima di uno ZIP, controlla i file e importalo. Seleziona l’assistente e abilita esplicitamente la Skill. Sostituire o ripristinare il pacchetto azzera le assegnazioni. Le Actions personalizzate esistenti mantengono il loro comportamento. **Visualizza AGENTS.md** mostra la configurazione corrente e **Copia** la copia negli appunti.

L’esportazione usa v2 per i progetti RC6 ordinari e v3 per un progetto con Actions collegate, Skills o regole di permesso personalizzate. v3 trasferisce nomi e impronte delle Actions e delle Skills, posizioni degli assistenti e regole proposte. Dopo l’importazione, controlla le proposte nelle impostazioni. Seleziona le Actions corrispondenti, importa e abilita localmente le Skills e aggiungi alla bozza solo le regole desiderate prima di salvarle. Restano supportati i template v1 e v2.

Uno ZIP contiene una cartella col nome della Skill, il file SKILL.md ed eventuali file references/*.md. Limiti ammessi: 30.000 byte per file, 160.000 byte complessivi dopo la decompressione, 256 KiB per lo ZIP e 32 elementi. I metadati obbligatori sono name e description. Sono facoltativi version, author e license. L’anteprima mostra il testo. L’esportazione ricostruisce lo ZIP dai file Markdown validati. L’impronta identifica nomi e contenuti dei file indipendentemente dalla compressione.
