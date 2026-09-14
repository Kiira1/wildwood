#!/bin/zsh
set -e
project_dir="${0:A:h:h}"
url="http://127.0.0.1:4174/public/sprite-aligner.html"
log_file="/tmp/wildstat-sprite-aligner.log"
cd "$project_dir"

if /usr/bin/curl -fsS "$url" >/dev/null 2>&1; then
  /usr/bin/open "$url"
  exit 0
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js, then reopen this launcher."
  read -r "?Press Return to close."
  exit 1
fi
npm run art:align >"$log_file" 2>&1 &
server_pid=$!
cleanup() { kill "$server_pid" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

for attempt in {1..50}; do
  if /usr/bin/curl -fsS "$url" >/dev/null 2>&1; then
    /usr/bin/open "$url"
    echo "Character Studio opened. Edits refresh automatically."
    echo "Keep this window open while aligning."
    wait "$server_pid"
    exit 0
  fi
  sleep 0.1
done
echo "Could not start Character Studio. Details: $log_file"
read -r "?Press Return to close."
exit 1
