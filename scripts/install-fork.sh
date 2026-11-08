#!/bin/bash
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd -P)"
dist="$repo/dist/fork-local"
engine_tree="$(git -C "$repo" rev-parse HEAD:engine | cut -c1-12)"
framework="$repo/apps/browser/build-ardiacore/prebuilt/$engine_tree/Chromium Framework.framework"
[ -d "$framework" ] || { echo "ardia-instalar: falta el motor $engine_tree en apps/browser/build-ardiacore/prebuilt" >&2; exit 1; }
rm -rf "$dist"; mkdir -p "$dist"
echo "Compilando Ardia (unos minutos)..."
"$repo/scripts/release/archive.sh" "$dist" "$framework" "$repo/apps/browser/build-release-fork" adhoc AC_UPDATE_CHANNEL=stable
app="$dist/Ardia.app"
ditto "$dist/Ardia.xcarchive/Products/Applications/Ardia.app" "$app"
/usr/libexec/PlistBuddy -c 'Delete :SUFeedURL' -c 'Set :SUEnableAutomaticChecks false' -c 'Set :SUAutomaticallyUpdate false' "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
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
