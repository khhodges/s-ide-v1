#!/usr/bin/env python3
"""patch_cm_map.py — Fix EFX_MAP bug where $readmemb BRAM INIT values land
in defparam but NOT in the /* verific */ comment that efx_pnr reads for
BRAM bitstream initialisation.

ROOT CAUSE
----------
EFX_MAP 2026.1 bug: EFX_RAM10 instances initialised by $readmemb store their
computed INIT_N values in separate `defparam` blocks.  efx_pnr reads BRAM init
data from the inline `/* verific ... INIT_N=256'h... */` attribute comment, not
from defparam.  $readmemb-initialised instances have NO INIT_N in that comment,
so the bitstream BRAM is all-zero.

EFX_RAM10 instances span TWO lines in map.v:
  Line A: "    EFX_RAM10 \\u_cm/dmem_bX__ID  (.WCLK(clk), ..."  (ends with ,)
  Line B: "        .RDATA({...})) /* verific ... */;"              (ends with ;)
  OR
  Line B: "        .RDATA({...}));"                               (no comment)

This script patches Line B to add/update the INIT_N entries.

USAGE
-----
  python3 hardware/soc_combined/patch_cm_map.py \\
      ~/church_project/SoC/outflow/church_soc_cm.map.v

Then re-run P&R only (no re-synthesis):
  cd ~/church_project/SoC && bash work_pnr/run_efx_pnr.sh
"""

import re
import shutil
import sys
from pathlib import Path

ZERO64 = '0' * 64

VERIFIC_ATTRS = (
    "/* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, "
    "READ_WIDTH=1, WRITE_WIDTH=1, "
    "WCLK_POLARITY=1'b1, WCLKE_POLARITY=1'b1, WE_POLARITY=2'b11, "
    "WADDREN_POLARITY=1'b1, RADDREN_POLARITY=1'b1, RST_POLARITY=1'b1, "
    "RCLK_POLARITY=1'b1, RE_POLARITY=1'b1, OUTPUT_REG=1'b0, "
    'WRITE_MODE="READ_FIRST", RESET_RAM="ASYNC", RESET_OUTREG="ASYNC"'
)


def _ival(init_map, n):
    return init_map.get(f'INIT_{n}', ZERO64)


def main(mapv_path):
    path = Path(mapv_path)
    if not path.exists():
        sys.exit(f"ERROR: {path} not found")

    print(f"Reading {path.name}  ({path.stat().st_size:,} bytes)")
    lines = path.read_text().split('\n')

    # ── 1. Collect all defparam INIT_N values for dmem_b? instances ──────────
    dp_re = re.compile(
        r"^\s*defparam\s+(\\u_cm/dmem_b\d__\S+)\s*\.(INIT_\d+)\s*"
        r"=\s*256'h([0-9a-fA-F]+)\s*;\s*$"
    )
    inits = {}  # {inst_name: {INIT_N: hex_str}}
    for line in lines:
        m = dp_re.match(line)
        if m:
            inits.setdefault(m.group(1), {})[m.group(2)] = m.group(3).lower()

    nonzero = {i: d for i, d in inits.items() if any(v.strip('0') for v in d.values())}
    print(f"dmem_b instances with defparam: {len(inits)}, non-zero INIT: {len(nonzero)}")
    if not nonzero:
        print("Nothing to patch — no non-zero defparam INIT values."); return

    # ── 2. Find a template verific attribute block (for the open attrs) ───────
    # Line B of any zero-init instance has: ")) /* verific ... INIT_0=... */;"
    # We strip the INIT_N values to get the attribute prefix.
    base_open = VERIFIC_ATTRS  # hardcoded fallback
    for line in lines:
        if ('EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10' in line
                and 'INIT_0' in line and line.rstrip().endswith(';')):
            m = re.search(r'/\* verific (.+?), INIT_0=', line)
            if m:
                base_open = f"/* verific {m.group(1)}"
                print(f"Template attrs: {base_open[:80]}...")
                break
    else:
        print("No template found — using hardcoded attribute defaults")

    # ── 3. Build index: inst_name -> line-index of Line A ─────────────────────
    inst_lineA = {}  # {inst_name: lineno}
    for i, line in enumerate(lines):
        if 'EFX_RAM10' not in line:
            continue
        for inst_name in nonzero:
            if inst_name in line:
                inst_lineA[inst_name] = i
                break

    # ── 4. Patch each non-zero instance ──────────────────────────────────────
    patched = 0

    for inst_name, init_map in sorted(nonzero.items()):
        if inst_name not in inst_lineA:
            print(f"  WARN: EFX_RAM10 line A not found for {inst_name}")
            continue

        lineA_idx = inst_lineA[inst_name]

        # Scan forward from Line A to find the terminating line (ends with ;)
        termB_idx = None
        for j in range(lineA_idx, min(lineA_idx + 20, len(lines))):
            if lines[j].rstrip().endswith(';'):
                termB_idx = j
                break

        if termB_idx is None:
            print(f"  WARN: no terminating ; found within 20 lines of {inst_name}")
            continue

        term = lines[termB_idx]
        nz = sum(1 for v in init_map.values() if v.strip('0'))
        max_n = max(int(k.split('_')[1]) for k in init_map)
        init_str = ', '.join(
            f"INIT_{n}=256'h{_ival(init_map, n)}"
            for n in range(max_n + 1)
        )

        if re.search(r"INIT_\d+=256'h", term):
            # ── Case A: update existing INIT values in the comment ────────────
            def repl(m2, _imap=init_map):
                return (f"INIT_{m2.group(1)}=256'h"
                        f"{_ival(_imap, int(m2.group(1)))}")
            new_term = re.sub(r"INIT_(\d+)=256'h[0-9a-fA-F]+", repl, term)
            if new_term != term:
                lines[termB_idx] = new_term
                patched += 1
                print(f"  UPDATED  {inst_name}  "
                      f"({max_n+1} INIT params, {nz} non-zero)")

        elif '/* verific' in term:
            # ── Case B: verific comment but no INIT — insert before */ ────────
            new_term = re.sub(r'\s*\*/', f', {init_str} */', term, count=1)
            if new_term != term:
                lines[termB_idx] = new_term
                patched += 1
                print(f"  INSERTED {inst_name}  "
                      f"({max_n+1} INIT params, {nz} non-zero)")

        else:
            # ── Case C: no verific comment — add one before the trailing ; ────
            s = term.rstrip()
            if not s.endswith(';'):
                print(f"  WARN: terminating line for {inst_name} doesn't end "
                      f"with ; — got: {s[-40:]!r}")
                continue
            body = s[:-1].rstrip()  # strip ; and trailing whitespace
            new_term = f"{body} {base_open}, {init_str} */;"
            lines[termB_idx] = new_term
            patched += 1
            print(f"  ADDED    {inst_name}  "
                  f"({max_n+1} INIT params, {nz} non-zero)")

    print(f"\n{patched} instance(s) patched")
    if patched == 0:
        print("No changes written."); return

    bak = path.with_name(path.name + '.bak')
    shutil.copy2(path, bak)
    print(f"Backup  → {bak}")
    path.write_text('\n'.join(lines))
    print(f"Written → {path}")
    print("\nRe-run P&R only (no re-synthesis):")
    print("  cd ~/church_project/SoC && bash work_pnr/run_efx_pnr.sh")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <church_soc_cm.map.v>"); sys.exit(1)
    main(sys.argv[1])
