# Moving an existing installation to SIAAS Personal 1.0.0

SIAAS Personal starts a new release series in a new repository. The previous v1.2.0 updater still checks its original repository and will not offer v1.0.0. The version comparison is intentional: do not force a downgrade inside the old installation.

1. Close the previous desktop application and any development server using its data.
2. Back up the complete data directory while the application is closed: `%APPDATA%\SIAAS` on Windows, `~/Library/Application Support/SIAAS` on macOS, or `${XDG_CONFIG_HOME:-~/.config}/SIAAS` on Linux. Preserve any custom `--user-data-dir` directory instead if you used that option. Development runs use `SIAAS_DATA_DIR` or `~/.siaas`; these are separate from the desktop profile.
3. After the new stable release and website deployment are available, run the official [installation procedure](installation-en.md). Use the new default installation root. If setting `SIAAS_INSTALL_DIR`, choose a fresh directory; never point it at the previous installation root. No old installation is automatically deleted or overwritten.
4. Open the new **SIAAS Personal** launcher. Its application identity (`it.siaas.desktop`), profile directory (`SIAAS`), database filename and database schema remain unchanged. Projects, assistants, knowledge, conversations, settings, managed Ollama and user files therefore use the existing desktop profile. Existing external Ollama models remain in their original location.
5. Check your projects, chat history, settings and linked files before retiring the old launcher. Keep the backup and old application available. Do not run the two applications simultaneously against the same profile.

The new installation's update and rollback system manages only its own release series. Its first installation has no previous SIAAS release to roll back to. To return to the old application, close SIAAS and start the old launcher. This rebranding does not change the database schema, but future releases may; application rollback never reverses data migrations. If restoring a backup becomes necessary, restore it only with both applications closed and preserve a copy of the newer data first.

The Windows/macOS native installation and graphical launch must be checked on those operating systems. Automated database compatibility, installer fixtures and Linux checks do not establish native acceptance on every platform. A failed download, checksum or build leaves the prior installation and profile available.
