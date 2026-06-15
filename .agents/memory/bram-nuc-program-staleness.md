---
name: BRAM NUC_PROGRAM staleness trap
description: church_ti60_f225.v BRAM becomes stale whenever boot_rom.py NUC_PROGRAM changes — requires a surgical patch or full Verilog regeneration.
---

## The rule

Any time `hardware/boot_rom.py` is edited (NUC_PROGRAM, BOOT_PROGRAM, or any
LUMP assembled into BRAM), `hardware/soc_combined/church_ti60_f225.v` **must**
be regenerated or its `initial begin` block must be patched.

**Why:** The Verilog BRAM `initial begin` block is generated at Amaranth
elaboration time. It does not auto-update when Python source changes.
Stale BRAM silently produces the wrong boot behavior on hardware.

**How to apply:**

*Option A — surgical patch (no Amaranth/Yosys toolchain needed):*
```python
# on Replit: run the inline patcher script (equivalent to what was done on
# 2026-06-15). It reads the correct BRAM words from boot_rom.py and updates
# only the changed dmem[] entries in the initial begin block.
python3 -c "
import sys, re
sys.path.insert(0, '.')
from hardware.boot_rom import _NUC_PADDED
# ... (see the full script from the 2026-06-15 session)
"
```

*Option B — full regeneration (requires Amaranth + Yosys):*
```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v hardware/soc_combined/
```

*Always follow with — on the Chromebook before Efinity synthesis:*
```bash
python3 hardware/soc_combined/patch_cm_bram.py hardware/soc_combined
```
`patch_cm_bram.py` converts the `initial begin` block to `$readmemh`
(EFX_MAP ignores `initial begin` but correctly processes `$readmemh`).

## NIA offset vs LUMP layout — CRITICAL

The NIA the APB3 bridge reports is a **byte offset from the LUMP base**.  The
LUMP base for Boot.Abstr is at `dmem[255]` = byte `0x3FC`.

**Old layout (pre-"Update embedded program" commit) — what the Chromebook's
church_dmem.mem currently contains:**

| Region         | dmem[]       | NIA offset |
|:---------------|:-------------|:-----------|
| LUMP header    | 255          | 0x000      |
| Embedded c-list (89 words) | 256–344 | 0x004–0x164 |
| NUC code word 0 | 345         | 0x168      |
| NUC inner delay (word 11) | 356 | **0x194** |
| NUC last word (word 16)   | 361 | 0x1A8      |

**New layout (post-"Update embedded program" commit, current Replit repo):**

| Region         | dmem[]       | NIA offset |
|:---------------|:-------------|:-----------|
| LUMP header    | 255          | 0x000      |
| NUC code word 0 | 256         | 0x004      |
| NUC inner delay (word 11) | 267 | **0x030** |
| NUC last word (word 16)   | 272 | 0x044      |

**Why this matters for the firmware hung-watchdog:**
`NUC_CODE_START` / `NUC_CODE_END` in `main.c` must match the layout that is
actually in `church_dmem.mem` on the Chromebook.  If the stale old layout is
used, the inner delay loop at NIA=0x194 fires HUNG every 3 s (LED never blinks)
because 0x194 > old `NUC_CODE_END=0x44`.

Current firmware `v2.1` sets `NUC_CODE_START=0x160` / `NUC_CODE_END=0x1B0`
to match the **old layout**.  Once `church_dmem.mem` is rebuilt from the
current initial begin (new layout), update both constants: `0x000` / `0x044`.

## Diagnostic signature

If BRAM is stale or the NUC_CODE range is wrong, the firmware CALLHOME shows:
- `boot_ok:1` (CM hardware boot did complete)
- NIA stuck at one value for 3 consecutive 1-s samples (HUNG fires)
- If NIA=0x194: old-layout BRAM, NUC_CODE_END too small (update to 0x1B0)
- If NIA=0x02C or 0x030: new-layout BRAM, NUC_CODE_END=0x44 is correct
