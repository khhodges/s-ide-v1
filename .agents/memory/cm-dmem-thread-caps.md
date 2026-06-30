---
name: CM DMEM Thread.caps[0] boot fix
description: DMEM word 125 must be 0x4A000004 for CM to boot; how patch_cm_bram.py fits in the MAP flow
---

## The rule

`hardware/ti60_f225.py` must set `dmem_init[125] = 0x4A000004` after building `dmem_init`.

**Why:** DMEM word 125 = Thread.caps[0] = the capability the CM uses to call NUC_PROGRAM (Salvation) at boot. Without it the very first ELOADCALL faults with NULL_CAP and the firmware triggers a system reset, truncating the callhome JSON at `"fault_code":`.

**Value breakdown:** `0x4A000004` = E-GT (GT_TYPE_INFORM), permission mask E, NS slot 4 (Salvation/NUC_PROGRAM), seq 0.

**How to apply:** Any time `hardware/ti60_f225.py` or `hardware/boot_rom.py` is changed, verify this line is present:
```python
dmem_init[125] = 0x4A000004
```
Then regenerate Verilog: `python3 -m hardware.gen_verilog --ti60` and copy to `hardware/soc_combined/church_ti60_f225.v`.

## DMEM address geometry

- Thread lump base: DMEM byte `0x100` = DMEM word 64
- Thread.caps zone offset: byte +244 = word +61 from base → DMEM word **125**
- `dmem_init` layout: `ns_init` (256 words) + `clist_init` (64 words) + zeros to 16384
- DMEM word 511 = SlideRule lump header (already set)

## patch_cm_bram.py — required before every MAP run

EFX_MAP silently ignores `initial begin` blocks on inferred arrays. The only way to get non-zero DMEM init into the bitstream is via `$readmemb` (ASCII 0/1 bit files in `work_syn/`).

`patch_cm_bram.py` (in `hardware/soc_combined/`):
1. Reads the `initial begin … dmem[N] = 32'dX; … end` block from `church_ti60_f225.v`
2. Rewrites the file to use four byte-lane `$readmemb` declarations
3. Writes `cm_dmem_b0.bin` … `cm_dmem_b3.bin` into `work_syn/`

**`run_efx_map.sh` now calls it automatically** (Step 0, before `efx_run.py`). Do not bypass this step.

## Verification after flash

UART should show `CHURCH Ti60 SoC+CM v2.4` then a complete callhome JSON ending with `"lump_done":"OK"` (not truncated at `"fault_code":`).
