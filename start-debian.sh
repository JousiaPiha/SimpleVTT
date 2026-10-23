#!/usr/bin/env bash
# Run from any directory. KDE launches this in a terminal for prompts and logs.
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$ROOT"

server_pid=''
finish() {
  local status=$?
  if [[ -n "$server_pid" ]]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if ((status != 0)) && [[ -t 0 ]]; then
    read -r -p 'Startup failed. Press Enter to close… ' || true
  fi
}
trap finish EXIT
trap 'exit 0' INT TERM HUP
fail() { printf '\n%s\n' "$*" >&2; exit 1; }

for tool in node npm curl flock xdg-open; do
  command -v "$tool" >/dev/null || fail "Missing $tool. See the Debian launcher instructions in README.md."
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' \
  || fail 'SimpleVTT requires Node.js 22.13 or newer.'

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/simple-vtt"
CONFIG_FILE="$CONFIG_DIR/launcher.conf"
mkdir -p -- "$CONFIG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  (umask 077; cat > "$CONFIG_FILE" <<'CONFIG'
# Trusted Bash configuration, loaded by start-debian.sh.
# Uncomment to allow players on your LAN to connect:
# export HOST=0.0.0.0
# export PORT=3000
# export DATA_DIR=/path/to/your/data
CONFIG
  )
fi
# This is a local, user-owned shell configuration, never downloaded content.
source "$CONFIG_FILE"
export HOST="${HOST:-127.0.0.1}" PORT="${PORT:-3000}"
export DATA_DIR="${DATA_DIR:-$ROOT/data}"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((10#$PORT >= 1 && 10#$PORT <= 65535)) \
  || fail 'PORT must be an integer from 1 to 65535.'
PORT=$((10#$PORT))
browser_host="$HOST"
case "$HOST" in
  0.0.0.0) browser_host=127.0.0.1 ;;
  ::) browser_host='[::1]' ;;
  *:*) browser_host="[$HOST]" ;;
esac
URL="http://$browser_host:$PORT/admin"

# General desktop-entry string escaping happens before Exec argument quoting.
desktop_string() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}
desktop_argument() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\$/\\\$}
  value=${value//\`/\\\`}
  value=${value//%/%%}
  printf '"%s"' "$(desktop_string "$value")"
}
APPLICATIONS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$APPLICATIONS/simple-vtt.desktop"
if [[ ! -e "$DESKTOP_FILE" ]]; then
  mkdir -p -- "$APPLICATIONS"
  # Preserve the Node/npm PATH used during setup (also supports nvm installations).
  {
    printf '[Desktop Entry]\nType=Application\nName=SimpleVTT\n'
    printf 'Comment=Run your tabletop presentation server\n'
    printf 'Exec=/usr/bin/env %s /bin/bash %s\n' \
      "$(desktop_argument "PATH=$PATH")" "$(desktop_argument "$ROOT/start-debian.sh")"
    printf 'Icon=%s\n' "$(desktop_string "$ROOT/public/simple-vtt.svg")"
    printf 'Terminal=true\nCategories=Game;\nStartupNotify=false\n'
  } > "$DESKTOP_FILE"
  chmod 644 "$DESKTOP_FILE"
  for refresh in kbuildsycoca6 kbuildsycoca5; do
    if command -v "$refresh" >/dev/null; then
      "$refresh" --noincremental >/dev/null 2>&1 || true
      break
    fi
  done
  printf 'Created the SimpleVTT application-menu entry.\n'
fi

open_browser() {
  # Do not let browser processes inherit the server lock or password.
  env -u ADMIN_PASSWORD xdg-open "$URL" 9>&- >/dev/null 2>&1 \
    || printf 'Open this address in your browser: %s\n' "$URL"
}
ready() { curl --noproxy '*' --silent --fail --max-time 1 "$URL" >/dev/null 2>&1; }

mkdir -p -- "$DATA_DIR"
exec 9>"$DATA_DIR/.launcher.lock"
if ! flock -n 9; then
  printf 'SimpleVTT is already starting or running. Waiting for %s…\n' "$URL"
  for ((attempt=0; attempt<60; attempt++)); do
    if ready; then open_browser; exit 0; fi
    sleep 1
  done
  fail 'The existing launcher is not ready. Check its terminal before trying again.'
fi

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  [[ -t 0 ]] || fail "Run ./start-debian.sh in a terminal once to set your password. Configuration: $CONFIG_FILE"
  while true; do
    read -r -s -p 'Choose an admin password (at least 12 characters): ' ADMIN_PASSWORD
    printf '\n'
    [[ ${#ADMIN_PASSWORD} -ge 12 ]] || { printf 'Please use at least 12 characters.\n'; continue; }
    read -r -s -p 'Repeat the password: ' confirmation
    printf '\n'
    [[ "$ADMIN_PASSWORD" == "$confirmation" ]] && break
    printf 'Passwords did not match.\n'
  done
  chmod 600 "$CONFIG_FILE"
  printf '\nexport ADMIN_PASSWORD=%q\n' "$ADMIN_PASSWORD" >> "$CONFIG_FILE"
  unset confirmation
  printf 'Password saved in %s (readable only by your user).\n' "$CONFIG_FILE"
fi
[[ ${#ADMIN_PASSWORD} -ge 12 ]] || fail "ADMIN_PASSWORD must contain at least 12 characters. Check $CONFIG_FILE"
export ADMIN_PASSWORD

if [[ ! -d node_modules ]]; then
  printf 'Installing dependencies for the first launch (internet required)…\n'
  npm ci 9>&-
fi
if [[ ! -f dist/server/index.js || ! -f dist/client/index.html ]]; then
  printf 'Building SimpleVTT…\n'
  npm run build 9>&-
fi

# Refuse an occupied port instead of opening an unrelated service in the browser.
node --input-type=module -e '
  import net from "node:net";
  const probe = net.createServer();
  probe.once("error", (error) => { console.error(`Cannot start SimpleVTT: ${error.message}`); process.exit(1); });
  probe.listen(Number(process.env.PORT), process.env.HOST, () => probe.close());
' 9>&-
printf '\nStarting SimpleVTT: %s\nKeep this terminal open. Press Ctrl+C to stop the server.\n' "$URL"
node dist/server/index.js 9>&- &
server_pid=$!
for ((attempt=0; attempt<60; attempt++)); do
  # Check the child before opening a browser, including when another server owns the port.
  sleep 0.5
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    fail 'The server stopped before it was ready.'
  fi
  if ready; then
    open_browser
    wait "$server_pid"
    exit 0
  fi
done
fail 'The server did not become ready. Check the server messages above.'
