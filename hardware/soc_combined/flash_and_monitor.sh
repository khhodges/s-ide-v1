#!/bin/bash
# flash_and_monitor.sh — ONE command on the local machine (Chromebook/Penguin):
#   download hex from droplet → flash Ti60 → capture UART banner + CALLHOME
#
# Usage:
#   bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh
#
# Requires: curl, openFPGALoader, /dev/ttyUSB2 visible (ChromeOS USB passthrough on)

set -euo pipefail

DROPLET="165.227.190.84"
HEX_PORT="8888"
HEX_URL="http://$DROPLET:$HEX_PORT/church_soc_cm.hex"
HEX_FILE="/tmp/church_soc_cm.hex"
UART="/dev/ttyUSB2"
UART_LOG="/tmp/uart_cm.log"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Church Machine — Flash & Monitor       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check USB is visible ──────────────────────────────────────────────────
if [ ! -c "$UART" ]; then
    echo "ERROR: $UART not found."
    echo "       Go to ChromeOS Settings → Linux → Manage USB devices"
    echo "       and enable the FTDI / Future Technology Devices entry."
    exit 1
fi

# ── Download hex ──────────────────────────────────────────────────────────
echo "==> [1/3] Downloading hex from droplet ..."
curl --fail -# -o "$HEX_FILE" "$HEX_URL"
ls -lh "$HEX_FILE"
echo ""

# ── Start UART capture BEFORE flash (banner fires right after Reset DONE) ─
echo "==> [2/3] Starting UART capture on $UART ..."
stty -F "$UART" 57600 raw cs8 -cstopb -parenb
rm -f "$UART_LOG"
cat "$UART" >> "$UART_LOG" &
CAT_PID=$!
echo "    Capturing to $UART_LOG (PID $CAT_PID)"
echo ""

# ── Flash ─────────────────────────────────────────────────────────────────
echo "==> [3/3] Flashing Ti60 ..."
sudo openFPGALoader -b titanium_ti60_f225_jtag --external-flash -f "$HEX_FILE"
echo ""

# ── Show UART output live ─────────────────────────────────────────────────
echo "============================================"
echo "  UART output (Ctrl+C to stop monitoring)"
echo "============================================"
echo ""
tail -f "$UART_LOG"
