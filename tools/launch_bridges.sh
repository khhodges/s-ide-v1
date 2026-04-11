#!/bin/bash
#
# Launch N bridge instances for N detected USB serial ports.
# Each bridge gets its own HTTP port (starting at 8766).
#
# Usage:
#   ./tools/launch_bridges.sh [--ide=URL]
#
# Examples:
#   ./tools/launch_bridges.sh
#   ./tools/launch_bridges.sh --ide=https://your-ide-server.example.com
#

set -e

IDE_FLAG=""
for arg in "$@"; do
    if [[ "$arg" == --ide=* ]]; then
        IDE_FLAG="$arg"
    fi
done

PORTS=()
for p in /dev/ttyUSB*; do
    [ -e "$p" ] && PORTS+=("$p")
done
for p in /dev/ttyACM*; do
    [ -e "$p" ] && PORTS+=("$p")
done

if [ ${#PORTS[@]} -eq 0 ]; then
    echo "No USB serial ports found (/dev/ttyUSB* or /dev/ttyACM*)."
    echo "Connect Tang Nano 20K boards and try again."
    exit 1
fi

echo "Church Machine Multi-Bridge Launcher"
echo "====================================="
echo "Found ${#PORTS[@]} serial port(s):"
echo ""

BASE_HTTP_PORT=8766
PIDS=()

for i in "${!PORTS[@]}"; do
    PORT="${PORTS[$i]}"
    HTTP_PORT=$((BASE_HTTP_PORT + i))
    echo "  Bridge $i: $PORT -> HTTP :$HTTP_PORT"
done
echo ""

cleanup() {
    echo ""
    echo "Shutting down all bridges..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo "All bridges stopped."
}
trap cleanup EXIT INT TERM

for i in "${!PORTS[@]}"; do
    PORT="${PORTS[$i]}"
    HTTP_PORT=$((BASE_HTTP_PORT + i))
    echo "Starting bridge $i: $PORT @ 115200 -> HTTP :$HTTP_PORT"
    python3 server/local_bridge.py "$PORT" 115200 "$HTTP_PORT" $IDE_FLAG &
    PIDS+=($!)
    sleep 0.5
done

echo ""
echo "All ${#PORTS[@]} bridge(s) running. Press Ctrl+C to stop all."
echo ""

wait
