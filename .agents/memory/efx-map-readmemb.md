---
name: EFX_MAP $readmemb and system_ramA on Ti60
description: Definitive findings on how Efinix Efinity EFX_MAP handles Sapphire SoC firmware embedding on Titanium Ti60F225 — $readmemb is simulation-only, optimize-zero-init-rom eliminates the BRAM, inline initial block keeps the BRAM alive but does not populate INIT_ values.
---

## Hard facts confirmed by testing (May 2026)

### Primitive name
The Titanium Ti60F225 BRAM primitive is **`EFX_RAM10`** (10Kbit), NOT `EFX_RAM_5K`.
Each instance has `INIT_0` … `INIT_N` defparam statements, each 256 bits wide.

### $readmemb is completely ignored by EFX_MAP
EFX_MAP on Titanium treats `$readmemb` as simulation-only, regardless of:
- Where the .bin files are placed (project root, work_syn/, anywhere)
- File naming (exact match to the $readmemb string)
- Efinity version (confirmed in 2025.2)

**Why:** This is a fundamental Titanium EFX_MAP limitation, not a path issue.
BUILD_SOC_CM.md previously said "copy symbol files to work_syn/" — that is WRONG.

### optimize-zero-init-rom=1 eliminates system_ramA entirely
Because $readmemb is ignored, the system_ramA behavioral memory appears
zero-initialised to EFX_MAP. With `optimize-zero-init-rom=1` (the default),
EFX_MAP eliminates the entire BRAM and hard-wires reads to 0. Result: zero
EFX_RAM10 instances for system_ramA in map.v; CPU fetches 0x00000000 and hangs.

### Inline initial block: keeps BRAM alive, but INIT_ values stay zero
After replacing $readmemb with explicit `mem[i] = 8'hXX;` assignments in
sapphire.v (scripts/patch_sapphire_init.py) AND setting optimize-zero-init-rom=0:
- system_ramA now appears as **64 EFX_RAM10 instances** in map.v ✓
- BUT the INIT_ parameters for those instances are still all-zero ✗
- EFX_MAP keeps the BRAM alive but does not propagate initial block values to INIT_
- UART still produces 0 bytes — firmware still not executing

### Definitive fix: post-process map.v to inject INIT_ values
The only confirmed-working path is to directly write non-zero INIT_ parameter
values into the 64 system_ramA EFX_RAM10 defparam statements in map.v, then
re-run P&R and bitstream generation. This bypasses EFX_MAP entirely for BRAM init.

**How to apply:**
1. Synthesise with inline initial block + optimize-zero-init-rom=0 (produces the 64 instances)
2. Run `scripts/patch_mapv_init.py` (to be written) to inject firmware bytes into INIT_ defparams
3. Run P&R on patched map.v → bitstream → flash

### Other confirmed facts
- sapphire_define.vh has NO address defines (it is nearly empty)
- UART address is 0xF8010000 (from BSP soc.h) — CORRECT in firmware/main.c
- UART clock divider 26 is correct for 25 MHz / 8 / 115200 - 1 ≈ 26.1
- jtagCtrl_* ports in sapphire.v are tied to constants in top.v — JTAG is disabled
- ttyUSB2 = Sapphire SoC UART (GPIOL_02), ttyUSB3 = CM debug UART
