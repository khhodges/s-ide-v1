#!/usr/bin/env bash
# scripts/check_sapphire_patch_fresh.sh
#
# Pre-synthesis mtime guard: verifies that patch_sapphire_init.py has been
# run since the last firmware source change.
#
# If any firmware .c or .h file is newer than sapphire.v, the patched Verilog
# is stale — EFX_MAP will embed old (or zeroed) firmware bytes.  This guard
# catches that before wasting 4+ minutes on synthesis.
#
# Usage:
#   bash scripts/check_sapphire_patch_fresh.sh <sapphire.v> <firmware-dir>
#
# Arguments:
#   sapphire.v     — path to the patched sapphire.v (must exist)
#   firmware-dir   — directory containing firmware source files (.c / .h)
#
# Exit codes:
#   0   — sapphire.v is newer than all firmware sources (patch is fresh)
#   1   — one or more firmware sources are newer than sapphire.v (stale patch)
#   2   — usage error or missing arguments

set -uo pipefail

SAPPHIRE_V="${1:-}"
FIRMWARE_DIR="${2:-}"

if [ -z "$SAPPHIRE_V" ] || [ -z "$FIRMWARE_DIR" ]; then
    echo "Usage: $0 <sapphire.v> <firmware-dir>" >&2
    exit 2
fi

if [ ! -f "$SAPPHIRE_V" ]; then
    echo "ERROR: sapphire.v not found: $SAPPHIRE_V" >&2
    exit 2
fi

if [ ! -d "$FIRMWARE_DIR" ]; then
    echo "ERROR: firmware directory not found: $FIRMWARE_DIR" >&2
    exit 2
fi

STALE_FILES=()

while IFS= read -r -d '' src; do
    if [ "$src" -nt "$SAPPHIRE_V" ]; then
        STALE_FILES+=("$src")
    fi
done < <(find "$FIRMWARE_DIR" -maxdepth 1 \( -name "*.c" -o -name "*.h" \) -print0 2>/dev/null)

if [ "${#STALE_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: sapphire.v patch is stale"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  The following firmware source file(s) are newer than sapphire.v:"
    for f in "${STALE_FILES[@]}"; do
        echo "    $f"
    done
    echo ""
    echo "  If you synthesise now, EFX_MAP will embed stale or zeroed firmware"
    echo "  bytes and the board will not boot."
    echo ""
    echo "  Run: python3 scripts/patch_sapphire_init.py"
    echo ""
    exit 1
fi

echo "  [patch-guard] sapphire.v is up-to-date (newer than all firmware sources)"
exit 0
