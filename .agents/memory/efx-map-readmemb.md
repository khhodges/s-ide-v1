---
name: EFX_MAP $readmemb path resolution
description: Where Efinity EFX_MAP looks for $readmemb binary files, BRAM init bug (defparam vs verific comment), and the full patch workflow.
---

## CRITICAL: All `initial begin` and `$readmemb` forms are BROKEN for inferred CM DMEM BRAMs

Confirmed Jun 22 2026 (synthesis on borrowed 8 GB machine, EFX_MAP 2026.1):

| Form | Result |
|---|---|
| `initial begin` on `reg [31:0] dmem` | ❌ Silently dropped, INIT_0=0 |
| `initial begin` on `reg [7:0] dmem_bN` byte lanes | ❌ Silently dropped, INIT_0=0 |
| `$readmemb` absolute paths on byte-lane arrays | ❌ INIT in `defparam` only; P&R reads `verific` comments → BRAM zero |
| **Explicit EFX_RAM10 instantiation with INIT params** | ✅ Only confirmed working path |

**Why Sapphire ROM works:** Sapphire uses Efinity IP generator which produces native
EFX_RAM10 instances — not inferred BRAM. `patch_sapphire_init.py` patches inline
assignments that EFX_MAP handles correctly because they are already EFX_RAM10 instances.

**The fix: `gen_cm_dmem_direct.py`** — generates a `cm_dmem_bram` module with 64
explicit EFX_RAM10 instantiations and hardcoded `INIT_N` parameters from the boot ROM.
Synthesis correctly propagates these to the VDB/bitstream.
Requires 4+ GB RAM to synthesize the full SoC design (Chromebook has 2.8 GB, no swap).

## $readmemb specific bug (EFX_MAP 2026.1)

- `$readmemb` with ABSOLUTE PATHS: synthesis passes, INIT values computed and stored
  in `defparam \u_cm/dmem_bX__<INST> .INIT_N = 256'h...`
- BUT efx_pnr reads BRAM init from `/* verific ... INIT_N=256'h... */` inline
  attribute comments, NOT from defparam.
- $readmemb-initialised instances get NO INIT_N attrs in their verific comment.
- Zero-init instances DO get `INIT_N=256'h0...0` attrs in their verific comment.
- Result: BRAM stays zero in the bitstream despite correct defparam values.

## EFX_RAM10 instance structure for dmem byte lanes

The 4 byte-lane arrays (`reg [7:0] dmem_b0..3 [0:16383]`) are synthesized as
8 separate 1-bit-wide EFX_RAM10 instances per address bank:
- READ_WIDTH=1, WRITE_WIDTH=1
- Each instance covers 1024 addresses × 1 bit
- INIT_0..INIT_3 (4×256 = 1024 bits) cover all 1024 addresses for that bit-plane
- Instance suffix D$02, D$32, D$3f12, etc. are synthesis hash IDs, NOT address offsets

## $readmemb path rules (historical, now superseded by gen_cm_dmem_direct.py)

EFX_MAP does NOT resolve bare filenames for $readmemb.
Only ABSOLUTE PATHS work. But even with absolute paths, INIT goes to defparam only.
This entire approach is abandoned in favour of explicit EFX_RAM10 instantiation.

## Chromebook synthesis constraints

- RAM: 2.8 GB physical, no swap (swapfile=EINVAL, zram module not found in kernel 6.6.99)
- Full SoC synthesis (Sapphire + CM + all logic) peaks at ~2.6 GB RSS → OOM-killed
- Efinity 2025.2 cannot parse 2026.1 project XML format
- Only Efinity 2026.1 works, only on a machine with 4+ GB RAM
- Solution: DigitalOcean 8 GB droplet ($0.08/hr, destroy after push)

## Flash issue (openFPGALoader on Chromebook)

openFPGALoader fails with "Read ID failed" / flash ID `097f0000` when writing to
SPI flash on this Ti60 board. spiOverJtag loads fine but SPI flash doesn't respond.
Workaround: Use Efinity Programmer GUI in **"JTAG to SPI Active Flash"** mode with
the `.hex` file (NOT SRAM mode which takes `.bit` and is lost on power-cycle).

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --insecure`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- UART CLOCKDIV=53 must be written before first uart_puts
- Project XML (church_soc_cm.xml) uses relative paths — run scripts from hardware/soc_combined/
