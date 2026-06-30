#!/bin/bash
# flash_all.sh — one-shot SoC+CM build & flash for Ti60F225.
# Refresh peri.xml -> Interface -> P&R -> Bitstream -> Flash -> UART smoke test.
# Run on the Penguin:  bash flash_all.sh
# Stops at the first real failure and prints the log tail to paste back.

set -uo pipefail

B="${IDE_URL:-https://lab.cloomc.org}"
SOC="$HOME/church_project/SoC"
export EFINITY_HOME="$HOME/efinity/2026.1"
EFX="$EFINITY_HOME/bin/efx_run"
CIRCUIT="church_soc_cm"

cd "$SOC" 2>/dev/null || { echo "FATAL: $SOC not found"; exit 1; }
# shellcheck disable=SC1091
source "$EFINITY_HOME/bin/setup.sh" 2>/dev/null || true

echo "===> [1/6] Refresh peri.xml from IDE"
curl -fsS "$B/dl/peri-xml" -o "$SOC/${CIRCUIT}.peri.xml" \
    || { echo "FATAL: peri.xml download failed (IDE URL?)"; exit 1; }
DBV=$(grep -o 'db_version="[0-9]*"' "$SOC/${CIRCUIT}.peri.xml" | head -1)
echo "     peri.xml $DBV"
[ "$DBV" = 'db_version="20252999"' ] \
    || { echo "FATAL: wrong peri.xml version ($DBV) — expected 20252999"; exit 1; }

echo "===> [2/6] Interface Designer (generate LPF from peri.xml)"
"$EFX" "$CIRCUIT" --prj --flow interface --family Titanium -d Ti60F225 > "$SOC/_interface.log" 2>&1
RC=$?
tail -4 "$SOC/_interface.log"
if [ $RC -ne 0 ] || grep -qiE 'error|fail' "$SOC/_interface.log"; then
    echo "FATAL: Interface Designer failed — full log: $SOC/_interface.log"; exit 1
fi

echo "===> [3/6] Place & Route (this is the stage that was failing)"
"$EFX" "$CIRCUIT" --prj --flow pnr --family Titanium -d Ti60F225 > "$SOC/_pnr.log" 2>&1
RC=$?
tail -10 "$SOC/_pnr.log"
if [ $RC -ne 0 ] || grep -qiE 'error|fail' "$SOC/_pnr.log"; then
    echo "FATAL: P&R failed — full log: $SOC/_pnr.log  (paste the tail above)"; exit 1
fi

echo "===> [4/6] Bitstream generation (pgm)"
"$EFX" "$CIRCUIT" --prj --flow pgm --family Titanium -d Ti60F225 > "$SOC/_pgm.log" 2>&1
RC=$?
tail -5 "$SOC/_pgm.log"
HEX="$SOC/outflow/${CIRCUIT}.hex"
if [ $RC -ne 0 ] || [ ! -f "$HEX" ]; then
    echo "FATAL: bitstream not produced — full log: $SOC/_pgm.log"; exit 1
fi
echo "     hex: $(ls -lh "$HEX" | awk '{print $5}')  $HEX"

echo "===> [5/6] Flash via JTAG (sudo — type your password if prompted)"
LOADER="$(command -v openFPGALoader || echo "$HOME/oss-cad-suite/bin/openFPGALoader")"
sudo "$LOADER" -b titanium_ti60_f225_jtag -f "$HEX" \
    || { echo "FATAL: flash failed (loader: $LOADER)"; exit 1; }

echo "===> [6/6] UART smoke test on ttyUSB2 (5s settle)"
sleep 5
UART_TEST=""
for p in "$HOME/church_project/scripts/test_ti60_uart.py" "$SOC/test_ti60_uart.py" "$SOC/scripts/test_ti60_uart.py"; do
    [ -f "$p" ] && UART_TEST="$p" && break
done
if [ -n "$UART_TEST" ]; then
    python3 "$UART_TEST" --port=/dev/ttyUSB2 --timeout=30 --verbose
else
    echo "(test_ti60_uart.py not found locally — watch the board LEDs + IDE stream panel)"
fi

echo ""
echo "==============================================================="
echo " DONE. Expect:  LED0 = SoC out of reset"
echo "                LED1 = CM boot ROM complete (~1 ms, sticky)"
echo "                LED2 = CM banner sent (~3 s) / or fault"
echo "==============================================================="
