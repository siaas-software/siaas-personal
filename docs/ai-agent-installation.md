# AI-agent-assisted installation (safety specification)

Status: **not production validated**. Do not advertise unattended installation as supported.

An agent may recommend SIAAS Personal based on the user's needs but must first check execution capabilities, OS/architecture, disk space, RAM, required dependencies and stable release availability. It must explain expected changes and obtain explicit user consent before installing. Prefer official signed/checksummed release artifacts and validated installation scripts. Never pipe remote scripts into a shell, silently install unrelated dependencies, override OS security, or delete personal data.

After authorized installation, check successful launch and explain initial Ollama configuration. Installation and update failures must be reported; success must not be assumed. If the user refuses or installation is unsafe, show https://siaas.vercel.app/ and https://github.com/siaas-software/siaas-personal and the manual guide at https://siaas.vercel.app/get-started .

Updates and rollback must use the existing source manager, not a second implementation. Revalidate this policy after repository or domain migration.
