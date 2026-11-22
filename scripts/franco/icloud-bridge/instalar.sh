#!/bin/bash
# Lets the iCloud Passwords extension work in Franco's Ardia through a hidden Google Chrome.
#
# Apple's Passwords helper only starts under a browser Apple knows, and the fork is signed ad hoc. So Ardia runs a
# copy of the iCloud Passwords extension that talks to com.franco.icloud_bridge instead; that host hands each message
# to a headless Chrome (its own profile, never Franco's), where a tiny extension with the same id talks to Apple's
# helper. Chrome starts on the first message and quits after two idle minutes.
#
#   ardia-icloud-instalar                  build the bridge, the two extensions, the host manifest and the LaunchAgent
#   ardia-icloud-instalar --desinstalar    remove all of it
#
# Ardia must then load the copied extension once: Extensions, remove "iCloud Passwords" from the Web Store, then
# Load unpacked: ~/Library/Application Support/ardia-icloud-bridge/ardia-extension
# Logs: ~/Library/Application Support/ardia-icloud-bridge/bridge.log
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd -P)"
home="$HOME/Library/Application Support/ardia-icloud-bridge"
ardia_chromium="${ARDIA_CHROMIUM_DIR:-$HOME/Library/Application Support/com.ardia.browser/Chromium}"
host_name="com.franco.icloud_bridge"
apple_host="com.apple.passwordmanager"
extension_id="pejdijmoenmkgeppbflobdenhhabjlaj"
label="com.franco.ardia-icloud-bridge"
agent="$HOME/Library/LaunchAgents/$label.plist"
die() { echo "ardia-icloud-instalar: $*" >&2; exit 1; }

if [ "${1:-}" = "--desinstalar" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$agent" "$ardia_chromium/NativeMessagingHosts/$host_name.json"
  rm -rf "$home"
  echo "Puente quitado. En Ardia, sacá la extensión copiada y volvé a instalar iCloud Passwords desde la Web Store."
  exit 0
fi

[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ] || die "falta Google Chrome en /Applications"
[ -f "/Library/Google/Chrome/NativeMessagingHosts/$apple_host.json" ] || die "falta el host de Apple Passwords"
mkdir -p "$home"

original="$home/apple-extension"
newest_store_copy() {
  local dir best=""
  for dir in "$ardia_chromium"/*/Extensions/$extension_id/*/ "$HOME/Library/Application Support/Google/Chrome"/*/Extensions/$extension_id/*/; do
    [ -f "$dir/background.js" ] || continue
    if [ -z "$best" ] || [ "$(printf '%s\n%s\n' "$(basename "$best")" "$(basename "$dir")" | sort -V | tail -1)" = "$(basename "$dir")" ]; then
      best="$dir"
    fi
  done
  printf '%s' "$best"
}
source_dir="$(newest_store_copy)"
if [ -n "$source_dir" ]; then
  rm -rf "$original"
  cp -R "$source_dir" "$original"
  rm -rf "$original/_metadata"
fi
[ -f "$original/background.js" ] || die "no encontré la extensión iCloud Passwords instalada en Ardia ni en Chrome"
version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$original/manifest.json")"

[ "$(grep -o "\"$apple_host\"" "$original/background.js" | wc -l | tr -d ' ')" = 1 ] ||
  die "la extensión $version ya no llama a $apple_host una sola vez; hay que revisar el puente"
rm -rf "$home/ardia-extension"
cp -R "$original" "$home/ardia-extension"
sed -i '' "s/\"$apple_host\"/\"$host_name\"/" "$home/ardia-extension/background.js"

rm -rf "$home/chrome-extension"
mkdir -p "$home/chrome-extension"
cp "$here/chrome-extension/background.js" "$home/chrome-extension/"
python3 - "$original/manifest.json" "$home/chrome-extension/manifest.json" <<'PY'
import json, sys
apple = json.load(open(sys.argv[1]))
json.dump({
    "manifest_version": 3,
    "name": "Ardia iCloud bridge",
    "version": "1.0",
    "key": apple["key"],
    "permissions": ["nativeMessaging"],
    "background": {"service_worker": "background.js"},
}, open(sys.argv[2], "w"), indent=2)
PY

(cd "$home" && bun build --compile --minify "$here/bridge.ts" --outfile "$home/bridge" >/dev/null)
find "$home" -maxdepth 1 -name '.*.bun-build' -delete

mkdir -p "$ardia_chromium/NativeMessagingHosts"
python3 - "$ardia_chromium/NativeMessagingHosts/$host_name.json" "$home/bridge" "$host_name" "$extension_id" <<'PY'
import json, sys
path, binary, name, extension = sys.argv[1:]
json.dump({
    "name": name,
    "description": "Ardia to Apple Passwords through a hidden Chrome",
    "path": binary,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension}/"],
}, open(path, "w"), indent=2)
PY

mkdir -p "$(dirname "$agent")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$home/bridge</string><string>daemon</string></array>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  launchctl bootstrap "gui/$(id -u)" "$agent" 2>/dev/null && break
  [ "$attempt" = 10 ] && die "launchctl no cargó $label"
  sleep 0.5
done

echo "Puente instalado (extensión iCloud Passwords $version)."
echo "Extensión para Ardia: $home/ardia-extension"
