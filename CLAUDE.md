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

iCloud Passwords can't start Apple's helper from this ad hoc build, so `scripts/franco/icloud-bridge` relays it
through a headless Google Chrome (`ardia-icloud-instalar`; how it works is in the script's `--help` header). Keep the
engine's `chromium-apple-passwords-host-skipped.patch` as upstream has it: the bridge uses its own host name.

The `ardia` command no longer lives in this repo: upstream moved it to `ardia-browser/plugins` (TypeScript, built
with Bun). Franco's fork of it is `~/forks/ardia-plugins` (branch `franco`): it announces the tabs a session drives
(`controlling`, the Claude mark), opens agent windows in `$ARDIA_PROFILE` (`windows.create {agent: true}`) and closes
them with the session. The app and the command must match, so `install-fork.sh` installs the command too
(`ardia-plugins-instalar`) after the app. A change to either side of that contract goes in both repos.
