#!/bin/zsh

set -u
set -o pipefail
unsetopt BG_NICE

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

PROJECT_DIR="${0:A:h:h}"
LOCAL_URL="http://127.0.0.1:8000/"
# Keep this aligned with the local guest save used for testing.
DATABASE_NAME="wildwood-balance-local"

fail() {
  print ""
  print "FAILED: $1"
  print ""
  read -r "reply?Press Return to close."
  exit 1
}

SPACETIME_BIN="$(command -v spacetime 2>/dev/null || true)"
NPM_BIN="$(command -v npm 2>/dev/null || true)"

[[ -n "$SPACETIME_BIN" ]] || fail "SpacetimeDB CLI not found. Install it, then reopen this file."
[[ -n "$NPM_BIN" ]] || fail "npm not found. Install Node.js, then reopen this file."
[[ -f "$PROJECT_DIR/package.json" ]] || fail "Could not find WildStat package.json above the launchers folder."

cd "$PROJECT_DIR" || fail "Could not open the WildStat folder."
clear
print "WILDSTAT LOCAL TEST"
print "Folder: $PROJECT_DIR"
print ""

if [[ "${1:-}" == "--check" ]]; then
  print "Launcher check passed."
  print "Database: $DATABASE_NAME (local)"
  print "SpacetimeDB: $SPACETIME_BIN"
  print "npm: $NPM_BIN"
  exit 0
fi

if "$SPACETIME_BIN" server ping http://127.0.0.1:3000 >/dev/null 2>&1; then
  print "Database: already running"
else
  print "Database: opening second Terminal window"
  /usr/bin/open -a Terminal "$PROJECT_DIR/scripts/run-local-database.command" \
    || fail "Could not open the database Terminal window."

  database_ready=false
  for attempt in {1..120}; do
    if "$SPACETIME_BIN" server ping http://127.0.0.1:3000 >/dev/null 2>&1; then
      database_ready=true
      break
    fi
    sleep 0.5
  done
  [[ "$database_ready" == true ]] || fail "Local database did not start within 60 seconds. Check its Terminal window."
  print "Database: ready"
fi

if /usr/bin/curl --silent --fail --max-time 2 "${LOCAL_URL}__wildstat_dev" 2>/dev/null \
  | /usr/bin/grep -q 'wildstat-local-dev'; then
  print "Live development: already running"
  /usr/bin/open "$LOCAL_URL"
  exit 0
fi

if [[ ! -d node_modules ]]; then
  print "Dependencies: installing"
  "$NPM_BIN" ci || fail "npm ci failed."
fi

print "Live development: starting"
print "CSS changes apply in place; code changes rebuild and refresh this tab."
print "Server changes publish only to your local database without deleting saves."
print "Keep this terminal and the database window open while editing."
print ""
export SPACETIME_BIN
exec "$NPM_BIN" run dev:local -- --open
