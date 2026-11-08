@AGENTS.md

## Franco's fork

This checkout is Franco's fork, and the Ardia he browses with is a Release build of it at `/Applications/Ardia.app`.
He asks for changes in chat and doesn't run anything himself. When a change is done and verified, install it for him
with `scripts/install-fork.sh` (also `ardia-instalar` on his PATH): it builds the Release app, quits his Ardia, swaps
it and reopens it. Ask him first, since it closes his browser for a moment. Here this overrides AGENTS.md's rule
against touching `/Applications/Ardia.app`.
