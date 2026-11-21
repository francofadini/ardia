#!/bin/bash
# Brings Franco's fork up to date with the original (remote upstream = mantrakp04/ardia) by merging, never rebasing:
# main is published on origin, and the fork's own commits stay as they are.
#
#   scripts/franco/sync-upstream.sh            fetch, back up main, start the merge and list the conflicts
#   scripts/franco/sync-upstream.sh --verificar after the merge commit: engine, installs, typecheck, Release build and a
#                                               hidden smoke test (touches nothing installed)
#
# Step 1 stops with the merge open when there are conflicts. Resolve them keeping upstream's version wherever upstream
# redid one of the fork's changes, commit, then run --verificar. Pushing to origin and ardia-instalar need Franco's OK.
# The commits only the fork has: git log --oneline upstream/main..main
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd -P)"
cd "$repo"
say() { printf '\n== %s\n' "$*"; }
die() { echo "sync-upstream: $*" >&2; exit 1; }

merge_step() {
  [ "$(git branch --show-current)" = main ] || die "estás en $(git branch --show-current), no en main"
  [ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] || die "ya hay un merge abierto: resolvelo o abortalo (git merge --abort)"
  local dirty
  dirty="$(git status --porcelain --untracked-files=no)"
  [ -z "$dirty" ] || die "hay cambios sin commitear; guardalos antes (git diff > archivo.patch):
$dirty"
  say "Trayendo upstream y origin"
  git fetch --quiet upstream
  git fetch --quiet origin
  local ours theirs backup
  ours="$(git rev-list --count upstream/main..main)"
  theirs="$(git rev-list --count main..upstream/main)"
  echo "main tiene $ours commits propios; upstream tiene $theirs nuevos."
  [ "$theirs" != 0 ] || { echo "Ya está al día."; exit 0; }
  backup="backup/pre-sync-$(date +%Y-%m-%d-%H%M)"
  git branch "$backup" main
  echo "Respaldo de main: rama $backup"
  say "Cambios propios (los que hay que conservar)"
  git log --oneline upstream/main..main
  say "Merge"
  if git merge --no-ff --no-commit upstream/main >/tmp/sync-upstream-merge.log 2>&1; then
    echo "Sin conflictos. Revisá y commiteá: git commit (mensaje: Merge upstream/main ...), después --verificar."
  else
    echo "Conflictos:"
    git status --short | awk '$1 ~ /^(UU|AA|DU|UD|AU|UA|DD)$/'
    echo
    echo "Resolvelos (si upstream rehízo algo propio, quedate con lo suyo), commiteá y corré --verificar."
    echo "Log completo: /tmp/sync-upstream-merge.log"
  fi
}

engine_step() {
  say "Motor"
  local fetch="packages/ardiacore/scripts/fetch-engine.sh"
  if "$fetch" >/tmp/sync-upstream-engine.log 2>&1; then
    echo "Hay motor publicado para este commit: $(tail -1 /tmp/sync-upstream-engine.log)"
    return
  fi
  if grep -q "no prebuilt engine" /tmp/sync-upstream-engine.log; then
    local nearest_tag nearest_commit changed mac
    nearest_tag="$(grep -o 'engine-[0-9a-f]\{12\}' /tmp/sync-upstream-engine.log | head -1)"
    nearest_commit="$(git log --format=%H upstream/main -- $(engine/engine-key.sh --paths) | while read -r c; do
      [ "engine-$(engine/engine-key.sh "$c" | cut -c1-12)" = "$nearest_tag" ] && { echo "$c"; break; }; done)"
    [ -n "$nearest_commit" ] || die "no encontré el commit de $nearest_tag; mirá docs/engine-build.md"
    changed="$(git diff --name-only "$nearest_commit" HEAD -- $(engine/engine-key.sh --paths))"
    mac="$(echo "$changed" | grep -vE '^engine/ardiacore-linux/|/tests?/|\.md$' || true)"
    if [ -n "$mac" ]; then
      echo "Upstream cambió el motor de macOS después de $nearest_tag y todavía no lo publicó:"
      echo "$mac"
      die "esperá a que upstream publique el motor (sale con su próxima release) o compilalo (docs/engine-build.md)"
    fi
    echo "Lo que cambió desde $nearest_tag es solo de Linux o de tests: uso ese motor."
    "$fetch" --nearest | tail -1
    return
  fi
  cat /tmp/sync-upstream-engine.log >&2
  die "fetch-engine falló"
}

verify_step() {
  [ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] || die "el merge sigue abierto: commitealo primero"
  engine_step
  say "Dependencias"
  scripts/agent/locked pod --wait 600 -- pnpm install --frozen-lockfile | tail -2
  scripts/agent/locked pod --wait 600 -- sh -c 'cd apps/browser/macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install' | tail -2
  say "Typecheck"
  pnpm -C apps/browser run typecheck
  say "Build Release (sin instalar)"
  scripts/install-fork.sh --solo-compilar | tail -2
  say "Prueba en una instancia oculta"
  local data
  data="$(mktemp -d /tmp/sync-upstream-XXXX)/data"
  mkdir -p "$data"
  : > "$data/perf-probe"
  scripts/agent/ac launch dist/fork-local/Ardia.app --data "$data"
  scripts/agent/ac eval "$data" 'return ac.actions.openUrls(["https://example.com/"])' --timeout 10000 >/dev/null
  local title=""
  for _ in $(seq 1 30); do
    title="$(scripts/agent/ac page "$data" example.com 'document.title' 2>/dev/null || true)"
    if [ -n "$title" ] && [ "$title" != "no page for example.com" ]; then break; fi
    sleep 1
  done
  scripts/agent/ac quit "$data" >/dev/null
  [ -n "$title" ] && [ "$title" != "no page for example.com" ] || die "la instancia de prueba no cargó example.com (log: $data/app.out.log)"
  ls "$data/crashes" | grep -q . && die "la instancia de prueba dejó crashes en $data/crashes"
  echo "Abrió y cargó una página: \"$title\"."
  say "Listo para pedirle OK a Franco"
  echo "1. git push origin main"
  echo "2. ardia-instalar (cierra y reabre su Ardia)"
  echo "Antes: correr pnpm -C apps/browser test (tarda) y revisar que el comando ardia siga andando con la app nueva."
}

case "${1:-}" in
  "") merge_step ;;
  --verificar) verify_step ;;
  -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0" ;;
  *) die "uso: scripts/franco/sync-upstream.sh [--verificar]" ;;
esac
