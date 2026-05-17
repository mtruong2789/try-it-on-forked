#!/usr/bin/env bash
# start.sh — launch backend + frontend together
# Usage: ./start.sh
# Stop:  Ctrl-C  (kills both processes)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Backend ────────────────────────────────────────────────────────────────────
BACKEND_DIR="$ROOT/my-agent"
VENV_ACTIVATE="$BACKEND_DIR/.venv/bin/activate"

if [ ! -f "$VENV_ACTIVATE" ]; then
  echo "❌  No virtualenv found at $VENV_ACTIVATE"
  echo "    Run:  cd my-agent && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

echo "▶  Starting backend on http://localhost:8000"
(
  source "$VENV_ACTIVATE"
  cd "$BACKEND_DIR"
  uvicorn server:app --reload --port 8000
) &
BACKEND_PID=$!

# ── Frontend ───────────────────────────────────────────────────────────────────
FRONTEND_DIR="$ROOT/try-on-react"

echo "▶  Starting frontend on http://localhost:5173"
(
  cd "$FRONTEND_DIR"
  npm run dev
) &
FRONTEND_PID=$!

# ── Cleanup on Ctrl-C ─────────────────────────────────────────────────────────
trap 'echo ""; echo "Stopping..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; wait' INT TERM

echo ""
echo "Both servers running. Press Ctrl-C to stop."
wait
