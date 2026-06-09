#!/usr/bin/env bash
# hardware/soc_minimal/build_and_patch.sh
#
# One-shot firmware rebuild + BRAM patch for the Sapphire SoC.
# Run from hardware/soc_minimal/ AFTER closing Efinity.
# Then open Efinity, close+reopen the project, and run Compile.
#
# Usage:
#   cd hardware/soc_minimal
#   bash build_and_patch.sh [TOOLCHAIN_DIR]
#
# Default TOOLCHAIN: ~/efinity/efinity-riscv-ide-2025.2/toolchain/bin

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TOOLCHAIN="${1:-$HOME/efinity/efinity-riscv-ide-2025.2/toolchain/bin}"
CC="$TOOLCHAIN/riscv-none-embed-gcc"
OBJCOPY="$TOOLCHAIN/riscv-none-embed-objcopy"

echo "=== Church Machine Ti60 — firmware build + BRAM patch ==="
echo "  Toolchain : $TOOLCHAIN"
echo "  Directory : $SCRIPT_DIR"
echo ""

# ── Step 1: verify toolchain ─────────────────────────────────────────────────
if [ ! -x "$CC" ]; then
    echo "ERROR: compiler not found: $CC"
    echo "  Pass the toolchain directory as first argument."
    exit 1
fi
echo "  [1/6] Toolchain OK: $($CC --version | head -1)"

# ── Step 2: clean build ───────────────────────────────────────────────────────
echo "  [2/6] Building firmware..."
make -C firmware clean
make -C firmware TOOLCHAIN="$TOOLCHAIN"
echo "        firmware.elf built"

# ── Step 3: flat binary ───────────────────────────────────────────────────────
echo "  [3/6] Generating firmware.raw..."
"$OBJCOPY" -O binary firmware/firmware.elf firmware/firmware.raw
RAWSIZE=$(wc -c < firmware/firmware.raw)
echo "        firmware.raw: $RAWSIZE bytes"

# ── Step 4: split into byte lanes ────────────────────────────────────────────
echo "  [4/6] Splitting into BRAM symbol files..."
python3 scripts/split_firmware.py firmware/firmware.raw work_syn/

# ── Step 5: patch sapphire.v ──────────────────────────────────────────────────
echo "  [5/6] Patching sapphire.v..."
if [ ! -f sapphire.v.bak ]; then
    echo "ERROR: sapphire.v.bak not found."
    echo "  Create it with: cp sapphire.v sapphire.v.bak"
    exit 1
fi
cp sapphire.v.bak sapphire.v
python3 scripts/patch_sapphire_init.py sapphire.v work_syn/
echo "        sapphire.v patched"

# ── Step 6: strip bad Efinity XML params ─────────────────────────────────────
echo "  [6/6] Stripping unsupported Efinity XML params..."
if [ -f church_soc.xml ]; then
    sed -i '/<efx:param name="infer_set_reset"/d; /<efx:param name="infer_clk_enable"/d' church_soc.xml
    echo "        church_soc.xml cleaned"
else
    echo "        church_soc.xml not found — skipping (OK if stashed)"
fi

echo ""
echo "=== DONE — now in Efinity: ==="
echo "  1. Close the project"
echo "  2. Re-open church_soc.xml"
echo "  3. Click Compile"
echo "  4. Flash: sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc.hex"
