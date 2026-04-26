#!/usr/bin/env bash
# Trio skill launcher. Usage: launch.sh <cwd>
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: launch.sh <cwd>" >&2
  exit 2
fi

CWD=$(cd "$1" && pwd)
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SKILL_DIR/runtime/trio.pid"
LOG_FILE="$SKILL_DIR/runtime/trio.log"
PORT=8765
URL="http://127.0.0.1:$PORT/?v=$(date +%s)"

mkdir -p "$SKILL_DIR/runtime"

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

open_browser() {
  # Open the URL as a regular tab in the user's Chrome (or default browser).
  # No kiosk, no --app, no dedicated profile — just a browser tab.
  if open -a "Google Chrome" "$URL" >/dev/null 2>&1; then
    :
  else
    open "$URL"
  fi
}

# Reuse existing server if pid + cwd match.
if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pid"])' "$PID_FILE" 2>/dev/null || echo "")
  EXISTING_CWD=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cwd"])' "$PID_FILE" 2>/dev/null || echo "")
  if alive "$EXISTING_PID"; then
    if [ "$EXISTING_CWD" = "$CWD" ]; then
      open_browser
      echo "already running URL=$URL PID=$EXISTING_PID CWD=$CWD"
      exit 0
    else
      echo "warning: server running with different CWD ($EXISTING_CWD); restarting for $CWD" >&2
      "$SKILL_DIR/stop.sh" || true
    fi
  else
    rm -f "$PID_FILE"
  fi
fi

# Check port is free.
if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $PORT already in use by another process (not Trio). Free it or change PORT in launch.sh." >&2
  exit 3
fi

# Check python3.
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found on PATH. Install via 'brew install python' or equivalent." >&2
  exit 4
fi

# Start server.
nohup python3 "$SKILL_DIR/server.py" --cwd "$CWD" --port "$PORT" >> "$LOG_FILE" 2>&1 &
PID=$!

# Persist pidfile.
python3 -c '
import json, sys
json.dump({"pid": int(sys.argv[1]), "port": int(sys.argv[2]), "cwd": sys.argv[3]}, open(sys.argv[4], "w"))
' "$PID" "$PORT" "$CWD" "$PID_FILE"

# Wait for server readiness (up to 2s).
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then
  echo "error: server failed to start within 2s. See $LOG_FILE." >&2
  kill "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 5
fi

open_browser
echo "URL=$URL PID=$PID CWD=$CWD"
