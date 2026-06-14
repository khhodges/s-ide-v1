#!/usr/bin/env python3
"""patch_cm_bram.py — Fix CM BRAM initialisation in church_ti60_f225.v for Efinix EFX_MAP.

EFX_MAP ignores Verilog `initial begin` blocks when inferring BRAM content,
so the Church Machine namespace/boot-ROM comes up all-zeros after synthesis.
The CM then reads 0x00000000 at every address, NIA stays stuck at 0x00000000,
and the Sapphire SoC firmware fires the HUNG watchdog every 3 seconds.

This script:
  1. Extracts the dmem[2047:0] initial values from church_ti60_f225.v.
  2. Writes them to <project_dir>/work_syn/church_dmem.mem (8-char hex, one
     32-bit word per line, MSB first — $readmemh format).
  3. Replaces the 2050-line `initial begin ... end` block with a single
     $readmemh("<absolute_path>/work_syn/church_dmem.mem", dmem) line.
     EFX_MAP resolves $readmemh correctly when given an absolute path.

Usage (run on the machine where Efinity synthesis will run):
    python3 patch_cm_bram.py [PROJECT_DIR]

  PROJECT_DIR — absolute path to the soc_combined directory that contains
                church_ti60_f225.v.  Defaults to the directory that contains
                this script.

Example (Chromebook):
    python3 ~/church_project/SoC/church-machine/hardware/soc_combined/patch_cm_bram.py \\
            ~/church_project/SoC/church-machine/hardware/soc_combined

Run BEFORE opening Efinity and clicking Compile/Synthesis.
Re-run whenever church_ti60_f225.v is regenerated (python hardware/gen_verilog.py).
"""
import sys
import os
import re

def main():
    if len(sys.argv) > 1:
        project_dir = os.path.abspath(sys.argv[1])
    else:
        project_dir = os.path.dirname(os.path.abspath(__file__))

    verilog_path = os.path.join(project_dir, "church_ti60_f225.v")
    work_syn_dir = os.path.join(project_dir, "work_syn")
    mem_path     = os.path.join(work_syn_dir, "church_dmem.mem")

    if not os.path.isfile(verilog_path):
        print(f"ERROR: not found: {verilog_path}")
        print("       Run this script from (or pass) the soc_combined directory.")
        sys.exit(1)

    print(f"Reading {verilog_path} ...")
    with open(verilog_path) as f:
        src = f.read()

    init_pat = re.compile(
        r'(  initial begin\n(?:    dmem\[\d+\] = 32\'d\d+;\n)+  end)',
        re.MULTILINE,
    )
    m = init_pat.search(src)
    if not m:
        if "$readmemh" in src and "church_dmem.mem" in src:
            print("church_ti60_f225.v is already patched — nothing to do.")
            print(f"Verify mem file exists: {mem_path}")
            sys.exit(0)
        print("ERROR: could not locate dmem initial begin block.")
        print("       Was church_ti60_f225.v regenerated without --initial-begin?")
        sys.exit(1)

    block = m.group(1)
    entry_count = block.count("dmem[")
    print(f"  Found dmem initial block: {entry_count} entries ({block.count(chr(10))+1} lines)")

    DEPTH = 2048
    vals = {}
    for line in block.split("\n"):
        lm = re.match(r"\s+dmem\[(\d+)\] = 32'd(\d+);", line)
        if lm:
            vals[int(lm.group(1))] = int(lm.group(2))

    nonzero = sum(1 for v in vals.values() if v != 0)
    print(f"  Non-zero entries: {nonzero} / {DEPTH}")

    words = [vals.get(i, 0) for i in range(DEPTH)]

    os.makedirs(work_syn_dir, exist_ok=True)
    with open(mem_path, "w") as f:
        for w in words:
            f.write(f"{w:08x}\n")
    print(f"  Written: {mem_path}  ({DEPTH} lines)")

    readmem_line = f'  initial $readmemh("{mem_path}", dmem);'
    patched = src.replace(block, readmem_line, 1)
    if patched == src:
        print("ERROR: replacement failed — block text not found verbatim.")
        sys.exit(1)

    with open(verilog_path, "w") as f:
        f.write(patched)

    print(f"  Patched: {verilog_path}")
    print(f"    Replaced {block.count(chr(10))+1}-line initial block with:")
    print(f"    {readmem_line.strip()}")
    print()
    print("Done. Now run Efinity synthesis (Compile in the GUI, or run_efx_map.sh).")
    print("EFX_MAP will pick up the .mem file and the Church Machine namespace")
    print("BRAM will be correctly initialised — CM should advance past NIA=0x0.")

if __name__ == "__main__":
    main()
