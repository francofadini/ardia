@AGENTS.md

## Franco's fork

This checkout is Franco's fork, and the Ardia he browses with is a Release build of it at `/Applications/Ardia.app`.
He asks for changes in chat and doesn't run anything himself. When a change is done and verified, install it for him
with `scripts/install-fork.sh` (also `ardia-instalar` on his PATH): it builds the Release app, quits his Ardia, swaps
it and reopens it. Ask him first, since it closes his browser for a moment. Here this overrides AGENTS.md's rule
against touching `/Applications/Ardia.app`. `scripts/install-fork.sh --solo-compilar` builds the same app into
`dist/fork-local/Ardia.app` without installing it, for testing in a hidden instance.

Keeping up with upstream (`mantrakp04/ardia`) is a merge, never a rebase: `scripts/franco/sync-upstream.sh`
(`ardia-sync-upstream`) backs up main, starts the merge and lists the conflicts; after the merge commit,
`--verificar` checks the engine, installs, typechecks, builds and smoke-tests. Where upstream redid one of the
fork's changes, keep upstream's. Push and install only with Franco's OK.

The `ardia` command no longer lives in this repo: upstream moved it to `ardia-browser/plugins` (TypeScript, built
with Bun). Until the fork's CLI changes are ported there, `~/.local/bin/ardia` runs a frozen copy of the old Python
CLI (`~/forks/.sync-backups/ardia-cli-pre-sync`), which only speaks control protocol 2. The app on main since the
2026-11-21 sync requires protocol 4, so don't install main into `/Applications` until that port is done.
