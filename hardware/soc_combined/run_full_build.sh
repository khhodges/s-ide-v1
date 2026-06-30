#!/bin/bash
# run_full_build.sh — One-command full build: firmware → MAP → PNR → PGM
#
# Usage:
#   bash ~/church-machine/hardware/soc_combined/run_full_build.sh
#
# What this does (in order, encoding every hard-won lesson):
#
#   1. Builds Sapphire firmware (make -C firmware)          [always fresh]
#   2. MAP: patch_cm_bram.py → efx_run --flow map           [CM DMEM via $readmemb]
#   3. PNR: gen_sapphire_symbol_bins.py → patch_mapv_init.py → efx_pnr
#                                                           [Sapphire BRAM injected]
#   4. PGM: efx_run --flow pgm                              [.hex for flash]
#
# Lessons encoded here so they are never forgotten:
#   - EFX_MAP silently ignores 'initial begin' on inferred arrays.
#     patch_cm_bram.py converts CM DMEM to $readmemb before MAP.
#   - EFX_MAP also silently ignores $readmemb on Sapphire system_ramA.
#     patch_mapv_init.py injects firmware bytes into INIT_ in map.v before PNR.
#   - Firmware MUST be rebuilt before gen_sapphire_symbol_bins.py runs or
#     the Sapphire BRAM gets stale code.
#   - EFINITY_USER_DIR_INI / EFXPT_HOME / EFXPGM_HOME must be exported or
#     efx_run_pgm.py throws a bare KeyError and aborts.
#   - run_efx_map.sh strips banned XML params (infer_clk_enable etc.) automatically.
#   - PNR sync file is outflow/<circuit>.interface.csv NOT top.res.csv.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_HOME="$EFINITY"
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
export EFXPT_HOME="${EFXPT_HOME:-$EFINITY}"
export EFXPGM_HOME="${EFXPGM_HOME:-$EFINITY}"
mkdir -p "$EFINITY_USER_DIR_INI"

START_TIME=$(date +%s)
echo "========================================"
echo "  Church Machine Full Build"
echo "  $(date)"
echo "========================================"
echo ""

# ── Step 1: Firmware ──────────────────────────────────────────────────────
echo "==> [1/4] Building Sapphire firmware (clean rebuild) ..."
make -C "$SCRIPT_DIR/firmware" clean all
echo "    Done."
echo ""

# ── Step 2: MAP (includes patch_cm_bram.py) ───────────────────────────────
echo "==> [2/4] MAP (synthesis) — this takes ~45 minutes ..."
bash "$SCRIPT_DIR/run_efx_map.sh"
echo ""

# ── Step 3: PNR (includes gen_symbol_bins + patch_mapv_init) ─────────────
echo "==> [3/4] PNR (place & route) — this takes ~30 minutes ..."
bash "$SCRIPT_DIR/run_efx_pnr.sh"
echo ""

# ── Step 4: PGM ──────────────────────────────────────────────────────────
echo "==> [4/4] PGM (bitstream generation) ..."
bash "$SCRIPT_DIR/run_efx_pgm.sh"
echo ""

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
MINS=$(( ELAPSED / 60 ))
SECS=$(( ELAPSED % 60 ))

echo "========================================"
echo "  FULL BUILD COMPLETE in ${MINS}m ${SECS}s"
echo "========================================"
echo ""
echo "  Hex: $SCRIPT_DIR/outflow/church_soc_cm.hex"
echo ""
echo "Flash:"
echo "  Download: curl -O http://$(hostname -I | awk '{print $1}'):8888/church_soc_cm.hex"
echo "  Flash:    sudo openFPGALoader -b titanium_ti60_f225_jtag --external-flash -f church_soc_cm.hex"
echo ""
echo "Monitor UART after flash:"
echo "  stty -F /dev/ttyUSB2 57600 raw && cat /dev/ttyUSB2"
echo ""
