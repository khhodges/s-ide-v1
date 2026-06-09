#!/usr/bin/env python3
"""
hardware/soc_minimal/scripts/patch_sapphire_init.py

Replace $readmemb calls in sapphire.v with inline initial-block assignments
so that EFX_MAP (Titanium) bakes the firmware into BRAM.

Background
----------
EFX_MAP on Titanium treats $readmemb as simulation-only and ignores it
entirely, regardless of where the .bin files are placed.  The only way to
get firmware into on-chip ROM at synthesis time is to emit explicit
  ram_symbolN[i] = 8'hXX;
assignments inside the initial block.  Efinity 2026.1 then propagates those
values to the INIT_ parameters of the EFX_RAM10 primitives.

Usage (run from hardware/soc_minimal/)
--------------------------------------
  python3 scripts/patch_sapphire_init.py sapphire.v work_syn

  sapphire.v  -- Sapphire SoC RTL (modified in-place; a .bak copy is kept)
  work_syn    -- directory containing the four symbol .bin files:
                   EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbolN.bin

Verification
------------
After patching, confirm no $readmemb remains:
  grep -c readmemb sapphire.v   # must print 0

The patched sapphire.v is then passed to Efinity 2026.1 synthesis:
  source ~/efinity/2026.1/bin/setup.sh
  (Clean All → Compile in the Efinity GUI, or efx_map/efx_pnr/efx_pgm via CLI)
"""

import re
import os
import sys
import shutil


BIN_NAMES = [
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin",
]

RAM_NAMES = [
    "ram_symbol0",
    "ram_symbol1",
    "ram_symbol2",
    "ram_symbol3",
]


def load_bin(path):
    """Read a $readmemb-format file: one binary-string per line → list of ints."""
    values = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                values.append(int(line, 2))
    return values


def make_inline_assignments(ram_name, values):
    """Return a list of Verilog assignment strings for one byte lane."""
    lines = []
    for i, v in enumerate(values):
        lines.append(f"    {ram_name}[{i}] = 8'h{v:02X};")
    return lines


def patch(sapphire_v, work_syn_dir):
    # ------------------------------------------------------------------ #
    # Load symbol .bin files                                               #
    # ------------------------------------------------------------------ #
    sym_values = []
    for fname in BIN_NAMES:
        fpath = os.path.join(work_syn_dir, fname)
        if not os.path.exists(fpath):
            print(f"ERROR: {fpath} not found.")
            print("Run the firmware split script first (see BUILD_SOC.md Step 3).")
            sys.exit(1)
        values = load_bin(fpath)
        print(f"  Loaded {fname}: {len(values)} entries")
        sym_values.append(values)

    # ------------------------------------------------------------------ #
    # Read sapphire.v                                                       #
    # ------------------------------------------------------------------ #
    bak = sapphire_v + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(sapphire_v, bak)
        print(f"  Backup: {bak}")
    else:
        print(f"  Backup already exists: {bak} (not overwritten)")

    with open(sapphire_v) as f:
        src = f.read()

    # ------------------------------------------------------------------ #
    # Replace each $readmemb with inline assignments                        #
    # The regex handles absolute paths in the string literal:              #
    #   $readmemb("/any/path/EfxSapphireSoc...symbol0.bin", ram_symbol0)  #
    # ------------------------------------------------------------------ #
    total_replaced = 0
    for fname, ram_name, values in zip(BIN_NAMES, RAM_NAMES, sym_values):
        pattern = r'\$readmemb\("[^"]*' + re.escape(fname) + r'"\s*,\s*' + re.escape(ram_name) + r'\s*\)\s*;'
        assignments = make_inline_assignments(ram_name, values)
        replacement = "\n".join(assignments)

        new_src, n = re.subn(pattern, replacement, src)
        if n == 0:
            print(f"  WARNING: $readmemb pattern for {ram_name} not found — "
                  "check the filename in sapphire.v matches exactly.")
        else:
            print(f"  Replaced $readmemb {ram_name} → {len(assignments)} assignments")
            total_replaced += n
            src = new_src

    if total_replaced == 0:
        print("\nERROR: No $readmemb calls were replaced.")
        print("Check that sapphire.v contains $readmemb with the expected filenames.")
        sys.exit(1)

    # ------------------------------------------------------------------ #
    # Write patched file                                                    #
    # ------------------------------------------------------------------ #
    with open(sapphire_v, "w") as f:
        f.write(src)

    remaining = src.count("$readmemb")
    print(f"\nDone — {total_replaced} $readmemb call(s) replaced.")
    if remaining:
        print(f"WARNING: {remaining} $readmemb call(s) still remain (other memories — review manually).")
    else:
        print("Confirmed: 0 $readmemb calls remain in sapphire.v.")
    print("\nNext: source ~/efinity/2026.1/bin/setup.sh, then Clean All → Compile in Efinity.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: python3 {sys.argv[0]} <sapphire.v> <work_syn_dir>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2])
