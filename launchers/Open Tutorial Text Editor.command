#!/bin/zsh
set -e
setopt NO_BG_NICE

project_dir="${0:A:h:h}"
port="4175"
url="http://127.0.0.1:${port}/"
log_file="/tmp/wildstat-tutorial-editor.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
cd "$project_dir"

if [[ "${1:-}" == "--check" ]]; then
  [[ -f "scripts/tutorial-editor-server.mjs" ]]
  [[ -f "tools/tutorial-editor/index.html" ]]
  [[ -x "node_modules/.bin/tsx" ]]
  echo "WildStat Tutorial Text Editor launcher check passed."
  exit 0
fi

if /usr/bin/curl -fsS "$url" >/dev/null 2>&1; then
  /usr/bin/open "$url"
  echo "WildStat Tutorial Text Editor opened in your browser."
  exit 0
fi

node_bin="$(command -v node 2>/dev/null || true)"
npm_bin="$(command -v npm 2>/dev/null || true)"
if [[ -z "$node_bin" || -z "$npm_bin" ]]; then
  echo "Node.js and npm are required. Install Node.js, then open this file again."
  read -r "reply?Press Return to close."
  exit 1
fi

if [[ ! -x "node_modules/.bin/tsx" ]]; then
  echo "Installing the project tools for first use…"
  "$npm_bin" install
fi

nohup "$node_bin" scripts/tutorial-editor-server.mjs >"$log_file" 2>&1 </dev/null &
server_pid=$!
disown

for attempt in {1..50}; do
  if /usr/bin/curl -fsS "$url" >/dev/null 2>&1; then
    /usr/bin/open "$url"
    echo "WildStat Tutorial Text Editor opened."
    echo "Save writes directly to the repository."
    echo "You can close this Terminal window; the local editor service will stay available."
    exit 0
  fi
  sleep 0.1
done

echo "Could not start the map editor. Details: $log_file"
tail -30 "$log_file" 2>/dev/null || true
kill "$server_pid" >/dev/null 2>&1 || true
read -r "reply?Press Return to close."
exit 1
