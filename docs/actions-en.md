# Actions in SIAAS Personal

Actions are reusable Markdown instructions that tell an assistant how to approach a task. They are not executable plugins, scripts, independent agents, or new capabilities. They use the assistant's existing local model, knowledge, research settings and permissions.

## Find your Actions

Open **Actions** in the main navigation, between **Projects** and **Templates**.

- **Built-in Actions** contains Mind map, Report, Flashcards and Quiz. These are ready to use, read-only and cannot be deleted. Updates continue to include them.
- **My Actions** contains the instructions you create on this computer. They are available to all your assistants; selecting one only uses the current assistant's knowledge and permissions.

Choose **View Markdown instructions** to inspect the actual instructions supplied to the model. Every Markdown Action uses the same lightning icon. Names distinguish them.

## Create an Action

1. Choose **Add Action** and enter a unique name (up to 80 characters). Names are compared without case differences; you cannot reuse a built-in name.
2. Before creating or editing, open **Actions → ellipsis menu next to the title → Models**. Select one installed local chat model. The global Builder choice is saved on this PC across restarts and never changes assistant models. If Ollama is stopped, the saved model has been uninstalled, or it is unavailable, creating/editing/saving is blocked. Start Ollama or install a model in Settings, then return to **Models** and retry.
3. Describe the task and the result you want, in your own language. For example: “Help me create an Action that turns my lesson notes into a short revision guide.” The builder may ask a focused question about missing requirements.
4. Review the **Markdown preview**. Instructions are generated in English, even when your conversation is in Italian or another language. Ask for refinements in the same builder chat.
5. Choose **Confirm and save Action**. A preview alone does not create an Action. **Cancel** closes the draft without changing saved data.

The builder only creates or improves Actions. “What is the weather tomorrow?” is a general question; “Create an Action that summarizes weather information I provide” is an Action request. The builder redirects unrelated requests and rejects unsupported requirements. It cannot run generated instructions, install tools or execute commands. Scope classification, structured response validation and a separate model review help enforce this boundary, but language models can make mistakes; these checks do not guarantee perfect semantic enforcement. Review the instructions before saving.

Generation can be stopped. Invalid, incomplete, non-English or incompatible model output cannot receive a valid save preview. Error messages let you retry or choose another local model. Unsaved builder conversations are temporary; restarting the application invalidates their save previews. Saved Actions remain available.

## Edit or delete a custom Action

Open its Markdown instructions and choose **Edit with AI**. The current definition is supplied to the builder; describe only the changes you want. Review the new preview and confirm to replace the saved definition. Cancelling preserves the original. Concurrent/stale edits are rejected: reopen the Action and try again.

Choose **Delete**, then **Confirm delete** to remove a custom Action. Existing conversations and their results remain intact. Built-in Actions have neither editing nor deletion controls and the server rejects those operations too.

## Use an Action in chat

The chat shortcut column has this order:

1. **Data Cell**, currently labelled **Data table** (table icon).
2. A divider.
3. Built-in Markdown Actions.
4. Your custom Markdown Actions.

Clicking an Action sends one request immediately. If you have typed a message, the Action applies to that message and clears the input. If the input is empty, it applies to the assistant's knowledge and relevant conversation context, as the former shortcuts did. The saved user message identifies the selected Action. A failed send restores the input; retry an Action by selecting it again. Subsequent normal messages do not automatically reapply its Markdown.

The selected assistant's model, configuration, knowledge, website sources, research settings and tool permissions remain unchanged. Action instructions are lower-priority user preferences for that invocation. They cannot grant shell access, add integrations, or authorize new operations. Existing conversation results remain context, so a model may refer to them; the Action's instruction body is not replayed in later turns.

**Data Cell / Data table** stays a native chat feature with its original modal and table icon. Describe the columns, subject and filters in the modal; the table appears in chat. It does not appear in global Actions and is not editable as Markdown. As before, its modal submission leaves any separately typed chat draft untouched.

## Local storage and migration

Custom definitions and metadata are stored in the existing `siaas.sqlite` database, in the `actions` table. Its JSON body contains the stable UUID, display name, exact Markdown, classification and creation/update timestamps. The data directory is `SIAAS_DATA_DIR` (set by Electron to its existing user-data directory), or `~/.siaas` in a manually configured local runtime. No authentication, cloud storage or separate legacy Skills directory is used. Application updates preserve this user-data database and its existing backup mechanism includes Actions.

Built-in Markdown is bundled with the application in `src/lib/actions.ts`, using the original task text in `src/lib/shortcuts.ts` as the migration source. No user project, template, assistant or conversation migration rewrites are needed. The table is added without changing database version 4, allowing older versions to ignore it without dropping it.

| Existing shortcut | New representation | Behavior retained |
| --- | --- | --- |
| Mind map (`mindmap`) | `builtin:mindmap` | Central concept, branches and subtopics as a nested Markdown list |
| Report (`report`) | `builtin:report` | In-chat executive summary, findings, evidence and conclusions |
| Flashcards (`flashcards`) | `builtin:flashcards` | Ten numbered question-and-answer cards |
| Quiz (`quiz`) | `builtin:quiz` | Five questions, four options each and a separate explained answer key |
| Data table (`table`) / Data Cell | Native chat-only exception | Original modal, details limit, `Table2` icon and Markdown table prompt |

All four migrated Actions retain knowledge/context use, source citation, source-as-data handling, missing-evidence disclosure and the original default English output instruction. Report retains existing optional downloadable report tooling when explicitly requested and permitted by the assistant's model; no new tool is introduced.
