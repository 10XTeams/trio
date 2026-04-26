#!/usr/bin/env bash
# Trio skill stopper. Kills the server recorded in runtime/trio.pid.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SKILL_DIR/runtime/trio.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "no server running (pidfile missing)"
  exit 0
fi

PID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pid"])' "$PID_FILE" 2>/dev/null || echo "")

if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "stale pidfile; cleaning up"
  rm -f "$PID_FILE"
  exit 0
fi

kill "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$PID" 2>/dev/null; then
  kill -9 "$PID" 2>/dev/null || true
fi
rm -f "$PID_FILE"
echo "stopped PID=$PID"
