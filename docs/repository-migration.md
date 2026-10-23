# SIAAS repository migration

SIAAS Personal starts a new Git history in `siaas-software/siaas-personal`. The initial snapshot contains the verified stable application, documentation, assets, installers, MIT license, and third-party notices. Historical commits and infrastructure pull requests were not imported.

The public template catalog is maintained in `siaas-software/siaas-templates`. The application pins its catalog snapshot to commit `100cc3f2974c37489bb85add87555c3bb2f63c9e`; refresh it using the documented template synchronization command.

## Protected workflow

`main` is the default stable branch and `develop` is the integration branch. Both require pull requests, resolved review conversations, and protection against force pushes and deletion. No bypass actors, additional reviewers, or status checks are configured. Version tags matching `v*` cannot be updated or deleted after creation. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for feature, release, and hotfix routing.

GitHub Actions workflows are retained only as disabled reference files. Validation and release preparation are manual.

## Installation transition

The new version sequence begins at v1.0.0. Existing installations associated with the previous repository do not automatically switch repositories or downgrade. Follow the [migration guide](migration-en.md) for backup and separate installation. Application identity and the local data profile remain compatible.
