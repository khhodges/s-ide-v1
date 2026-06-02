#!/bin/bash
# run_efx_pnr.sh — Place & Route for SoC+CM combined project
# Run from the project root (the folder containing SoC/)
# Usage: bash SoC/run_efx_pnr.sh
#
# NOTE: efx_pnr requires explicit --family/--device flags; it does NOT auto-read
# them from the project XML.  Omitting them causes an immediate SIGSEGV crash
# with "Unsupported value for family=".
#
# NOTE: The Efinity GUI is not supported on Chromebook Penguin (Debian container)
# — the splash screen crashes immediately. Use headless CLI only (this script).
#
# NOTE: Efinity 2025.2 with patch 2025.2.288.4.15 over base 2025.2.288.2.10
# crashes with the same SIGSEGV regardless of flags. Upgrade to v2026.1 full release.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"

SOC_DIR="$PROJECT_ROOT/SoC"
PROJECT="${1:-$SOC_DIR/church_soc_cm.xml}"
CIRCUIT="church_soc_cm"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

echo "==> Place & Route $PROJECT with EFX_PNR..."
echo "    EFX_PNR:  $EFX_PNR"
echo "    Project:  $PROJECT"
echo "    Family:   $FAMILY / $DEVICE / $OPCOND"
echo ""

# Source Efinity environment so efx_pnr can find its shared libraries
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

mkdir -p "$SOC_DIR/work_pnr" "$SOC_DIR/outflow"
cd "$SOC_DIR"

"$EFX_PNR" \
    --prj            "$PROJECT" \
    --circuit        "$CIRCUIT" \
    --family         "$FAMILY" \
    --device         "$DEVICE" \
    --operating_conditions "$OPCOND" \
    --pack --place --route \
    --vdb_file       "work_syn/${CIRCUIT}.vdb" \
    --use_vdb_file   "on" \
    --place_file     "outflow/${CIRCUIT}.place" \
    --route_file     "outflow/${CIRCUIT}.troutingtraces" \
    --sync_file      "outflow/${CIRCUIT}.interface.csv" \
    --optimization_level "TIMING_1" \
    --seed           "1" \
    --placer_effort_level "2" \
    --max_threads    "-1" \
    --print_critical_path "10" \
    --beneficial_skew "on" \
    --suppress_info_msgs    "off" \
    --suppress_warning_msgs "off" \
    --work_dir       "work_pnr" \
    --output_dir     "outflow" \
    --timing_analysis "on" \
    2>&1 | tee "$SOC_DIR/work_pnr/pnr.log"

echo ""
echo "==> Place & Route complete. Output in SoC/work_pnr/ and SoC/outflow/"
echo "    Bitstream: SoC/outflow/${CIRCUIT}.hex"
