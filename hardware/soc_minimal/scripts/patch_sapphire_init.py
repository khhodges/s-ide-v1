#!/usr/bin/env python3
"""
hardware/soc_minimal/scripts/patch_sapphire_init.py

Replace firmware BRAM initialisation in sapphire.v so that EFX_MAP (Titanium)
bakes the firmware into on-chip BRAM.

Handles two sapphire.v variants produced by different Efinity IP versions:

  Variant A — $readmemb (older IP):
    $readmemb("/path/.../symbol0.bin", ram_symbol0);

  Variant B — stub initial block (newer IP, e.g. 2026.1):
    initial begin
                ram_symbol0[0] = 8'h00;
                ram_symbol1[0] = 8'h00;
                ram_symbol2[0] = 8'h00;
                ram_symbol3[0] = 8'h00;
    end

In Variant B, EFX_MAP ignores $readmemb entirely; the only way to get firmware
into ROM is to emit explicit ram_symbolN[i] = 8'hXX; assignments covering all
BRAM words inside the initial block.

Usage (run from hardware/soc_combined/ or hardware/soc_minimal/):
  python3 scripts/patch_sapphire_init.py sapphire.v <dir_with_bin_files>

  sapphire.v          -- Sapphire SoC RTL (modified in-place; .bak kept)
  dir_with_bin_files  -- directory containing the four symbol .bin files

Verification after patching:
  grep -c readmemb sapphire.v   # 0 (or small number for non-ROM memories)
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


def load_bin(path, max_entries=None):
    """Read a $readmemb-format file: one binary-string per line → list of ints."""
    values = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                values.append(int(line, 2))
                if max_entries is not None and len(values) >= max_entries:
                    break
    return values


def detect_bram_depth(src):
    """
    Parse the ram_symbol0 reg declaration to find BRAM depth.
    e.g.  reg [7:0] ram_symbol0 [0:8191];  → 8192
    Returns None if not found (caller uses len(symbol_file)).
    """
    m = re.search(r'reg\s+\[7:0\]\s+ram_symbol0\s+\[0:(\d+)\]', src)
    if m:
        return int(m.group(1)) + 1
    return None


def make_assignments(ram_name, values, indent):
    """Return Verilog assignment lines for one byte lane."""
    return [f"{indent}{ram_name}[{i}] = 8'h{v:02X};\n" for i, v in enumerate(values)]


def patch_variant_a(src, sym_values):
    """Replace $readmemb calls with inline assignments (4-space indent)."""
    total_replaced = 0
    for fname, ram_name, values in zip(BIN_NAMES, RAM_NAMES, sym_values):
        pattern = (r'\$readmemb\("[^"]*' + re.escape(fname) +
                   r'"\s*,\s*' + re.escape(ram_name) + r'\s*\)\s*;')
        assignments = "".join(make_assignments(ram_name, values, "    ")).rstrip("\n")
        new_src, n = re.subn(pattern, assignments, src)
        if n:
            print(f"  Replaced $readmemb {ram_name} → {len(values)} assignments")
            total_replaced += n
            src = new_src
        else:
            print(f"  WARNING: $readmemb pattern for {ram_name} not found")
    return src, total_replaced


def patch_variant_b(src, sym_values, bram_depth):
    """
    Replace the stub initial block produced by Efinity 2026.1 IP.

    The stub looks like (exact indentation preserved):
      initial begin
                ram_symbol0[0] = 8'h00;
                ram_symbol1[0] = 8'h00;
                ram_symbol2[0] = 8'h00;
                ram_symbol3[0] = 8'h00;
      end

    We detect the indentation dynamically by searching for the first
    ram_symbol0[0] assignment line.
    """
    # Find the indentation used for these assignments
    m = re.search(r'([ \t]+)ram_symbol0\[0\]\s*=\s*8\'h[0-9A-Fa-f]+;', src)
    if not m:
        return src, 0
    indent = m.group(1)

    # Build the pattern that matches the entire stub block.
    # Allow any hex value (not just 00) so the script is idempotent on re-runs
    # where only a few indices were set previously.
    stub_pattern = (
        r'([ \t]*)initial begin\n'
        r'(?:[ \t]+ram_symbol\d+\[\d+\]\s*=\s*8\'h[0-9A-Fa-f]{2};\n)+'
        r'\1end\n'
    )

    # Build 4 SEPARATE initial blocks — one per lane so Efinity can recognise
    # each reg array + its own initial block as a single-port BRAM and infer
    # EFX_BRAM with non-zero INIT values.  A single combined block containing
    # all four arrays is NOT recognised as BRAM init by EFX_MAP 2026.1 and
    # causes the tool to synthesise the arrays as 262K flip-flops instead.
    outer_indent = "  "   # two spaces — matches "  initial begin" / "  end"
    new_blocks = ""
    for idx, ram_name in enumerate(RAM_NAMES):
        vals = sym_values[idx][:bram_depth]
        vals += [0] * (bram_depth - len(vals))
        assignments = "".join(make_assignments(ram_name, vals, indent))
        new_blocks += f"{outer_indent}initial begin\n{assignments}{outer_indent}end\n"

    new_src, n = re.subn(stub_pattern, new_blocks, src)
    if n:
        total_assignments = len(RAM_NAMES) * bram_depth
        print(f"  Replaced stub initial block → 4 separate blocks, "
              f"{total_assignments} assignments ({bram_depth} words × {len(RAM_NAMES)} lanes)")
        return new_src, n
    return src, 0


def patch(sapphire_v, work_syn_dir):
    # ------------------------------------------------------------------ #
    # Load symbol .bin files                                               #
    # ------------------------------------------------------------------ #
    sym_values = []
    for fname in BIN_NAMES:
        fpath = os.path.join(work_syn_dir, fname)
        if not os.path.exists(fpath):
            print(f"ERROR: {fpath} not found.")
            print("Run the firmware Makefile first to generate the symbol .bin files.")
            sys.exit(1)
        values = load_bin(fpath)
        print(f"  Loaded {fname}: {len(values)} entries")
        sym_values.append(values)

    # ------------------------------------------------------------------ #
    # Read sapphire.v and make backup                                      #
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
    # Detect BRAM depth from reg declaration                               #
    # ------------------------------------------------------------------ #
    bram_depth = detect_bram_depth(src)
    if bram_depth:
        print(f"  Detected BRAM depth: {bram_depth} words ({bram_depth * 4 // 1024} KB)")
    else:
        bram_depth = min(len(sym_values[0]), 131072)
        print(f"  Could not detect BRAM depth from reg declaration; "
              f"using symbol file length: {bram_depth}")

    # ------------------------------------------------------------------ #
    # Try Variant A: $readmemb replacement                                 #
    # ------------------------------------------------------------------ #
    new_src, total_replaced = patch_variant_a(src, sym_values)
    if total_replaced:
        src = new_src
    else:
        # ---------------------------------------------------------------- #
        # Try Variant B: stub initial begin block (Efinity 2026.1 IP)      #
        # ---------------------------------------------------------------- #
        print("  No $readmemb found — trying stub initial-block replacement (Variant B)")
        new_src, total_replaced = patch_variant_b(src, sym_values, bram_depth)
        if total_replaced:
            src = new_src
        else:
            print("\nERROR: Could not find any patchable BRAM init pattern.")
            print("Expected either:")
            print("  $readmemb(\"...\", ram_symbolN);")
            print("  OR a stub initial begin block with ram_symbol0[0] = 8'hXX;")
            print("Check sapphire.v manually.")
            sys.exit(1)

    # ------------------------------------------------------------------ #
    # Write patched file                                                   #
    # ------------------------------------------------------------------ #
    with open(sapphire_v, "w") as f:
        f.write(src)

    remaining = src.count("$readmemb")
    print(f"\nDone — {total_replaced} pattern(s) replaced.")
    if remaining:
        print(f"WARNING: {remaining} $readmemb call(s) still remain "
              "(other memories — review manually).")
    else:
        print("Confirmed: 0 $readmemb calls remain in sapphire.v.")
    print("\nNext: source ~/efinity/2026.1/bin/setup.sh, then run efx_map.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: python3 {sys.argv[0]} <sapphire.v> <dir_with_bin_files>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2])
