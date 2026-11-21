#!/bin/bash
# Builds Franco's fork as a Release app and swaps it into /Applications/Ardia.app.
#
#   scripts/install-fork.sh                  build, quit Ardia, replace it and reopen it
#   scripts/install-fork.sh --solo-compilar  build only, into dist/fork-local/Ardia.app (touches nothing installed)
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd -P)"
dist="$repo/dist/fork-local"
build_only=0
case "${1:-}" in
  "") ;;
  --solo-compilar) build_only=1 ;;
  -h | --help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
  *) echo "uso: scripts/install-fork.sh [--solo-compilar]" >&2; exit 2 ;;
esac
fetch="$repo/packages/ardiacore/scripts/fetch-engine.sh"
if ! framework="$("$fetch" 2>/dev/null | tail -1)" || [ ! -d "$framework" ]; then
  framework="$("$fetch" --nearest | tail -1)"
fi
[ -d "$framework" ] || { echo "ardia-instalar: no encontré el motor (packages/ardiacore/scripts/fetch-engine.sh)" >&2; exit 1; }
rm -rf "$dist"; mkdir -p "$dist"
echo "Compilando Ardia (unos minutos)..."
"$repo/scripts/release/archive.sh" "$dist" "$framework" "$repo/apps/browser/build-release-fork" adhoc AC_UPDATE_CHANNEL=stable
app="$dist/Ardia.app"
ditto "$dist/Ardia.xcarchive/Products/Applications/Ardia.app" "$app"
/usr/libexec/PlistBuddy -c 'Delete :SUFeedURL' -c 'Set :SUEnableAutomaticChecks false' -c 'Set :SUAutomaticallyUpdate false' "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
if [ "$build_only" = 1 ]; then
  echo "Compilada sin instalar: $app"
  exit 0
fi
running() { pgrep -f '^/Applications/Ardia.app/Contents/MacOS/Ardia$' >/dev/null; }
was_running=0
if running; then
  was_running=1
  osascript -e 'tell application "/Applications/Ardia.app" to quit'
  for _ in $(seq 1 60); do running || break; sleep 0.5; done
  if running; then echo "ardia-instalar: Ardia no se cerró; cerrala y corré de nuevo" >&2; exit 1; fi
fi
rm -rf /Applications/Ardia.app
ditto "$app" /Applications/Ardia.app
rm -rf "$dist"
if [ "$was_running" = 1 ]; then open /Applications/Ardia.app; fi
echo "Listo: Ardia instalada desde $(git -C "$repo" rev-parse --short HEAD)."
echo "Si el import de Dia vuelve a fallar: tccutil reset AppleEvents com.ardia.browser"
