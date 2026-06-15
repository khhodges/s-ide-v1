#!/usr/bin/env bash
# hardware/soc_combined/scripts/prep_syn.sh
#
# Copy the four Sapphire BRAM symbol .bin files from the project root into
# work_syn/ so that EFX_MAP can locate them via $readmemb (simulation path).
#
# NOTE: EFX_MAP on Efinix Titanium ignores $readmemb regardless of where the
# files are placed.  The actual firmware embedding is done by
# scripts/patch_sapphire_init.py, which converts $readmemb calls to explicit
# Verilog initial-block assignments.  This script is provided for reference
# and for Efinity versions that do read the symbol files during synthesis.
#
# MUST re-run prep_syn.sh (and then patch_sapphire_init.py) after every
# firmware rebuild before re-synthesising.
#
# Usage (from repo root or hardware/soc_combined/):
#   bash hardware/soc_combined/scripts/prep_syn.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_SYN="$SOC_DIR/work_syn"

SYMS=(
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"
)

echo "prep_syn.sh: copying BRAM symbol files to $WORK_SYN"

if [ ! -d "$WORK_SYN" ]; then
    echo "ERROR: work_syn/ does not exist at $WORK_SYN" >&2
    echo "  Run synthesis at least once to create the work_syn/ directory." >&2
    exit 1
fi

ERRORS=0
for sym in "${SYMS[@]}"; do
    SRC="$SOC_DIR/$sym"
    DST="$WORK_SYN/$sym"

    if [ ! -f "$SRC" ]; then
        echo "ERROR: missing source file: $SRC" >&2
        echo "  Run 'make -C hardware/soc_combined/firmware' to generate it." >&2
        ERRORS=$((ERRORS + 1))
        continue
    fi

    SIZE=$(wc -c < "$SRC")
    if [ "$SIZE" -eq 0 ]; then
        echo "ERROR: symbol file is empty (0 bytes): $SRC" >&2
        echo "  The firmware build may have failed — check firmware/firmware.bin." >&2
        ERRORS=$((ERRORS + 1))
        continue
    fi

    cp "$SRC" "$DST"
    echo "  OK  $sym  ($SIZE bytes)"
done

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo "ERROR: $ERRORS symbol file(s) were missing or empty. Aborting." >&2
    exit 1
fi

echo ""
echo "All 4 symbol files copied to work_syn/."
echo ""
echo "Next: run patch_sapphire_init.py to embed firmware into sapphire.v,"
echo "then synthesise with run_efx_map.sh."
echo ""
echo "  python3 scripts/patch_sapphire_init.py \\"
echo "    hardware/soc_combined/sapphire.v \\"
echo "    hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \\"
echo "    hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \\"
echo "    hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \\"
echo "    hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"
