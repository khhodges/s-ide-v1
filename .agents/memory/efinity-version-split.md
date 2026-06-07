---
name: Efinity version split for SoC build
description: EFX_MAP requires 2025.2; EFX_PNR requires 2026.1 — they cannot be swapped
---

# Efinity Version Split — Ti60 SoC+CM Build

## The Rule
On the Penguin (`~/church_project/SoC/`), synthesis and PnR require **different** Efinity versions:

| Step | Command | Version | Why |
|---|---|---|---|
| Synthesis | `EFINITY_HOME=~/efinity/2025.2 bash run_efx_map.sh` | **2025.2** | 2026.1 EFX_MAP crashes with SIGSEGV on this project |
| Place & Route | `bash run_efx_pnr.sh` (default) | **2026.1** | 2025.2 EFX_PNR crashes with SIGSEGV; noted in script comments |
| Hex gen + flash | `./run_efx_pgm.sh` (default) | **2026.1** | designed for 2026.1 |
| Flash | `sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex` | n/a | binary is at `/usr/bin/openFPGALoader` — not oss-cad-suite |

**Why:** EFX_MAP 2026.1 has a segfault bug triggered by this project's XML/Verilog. EFX_PNR 2025.2 has a separate segfault bug. Full 2026.1 release fixes the PnR crash but not the synthesis crash.

## Full Build Sequence (on Penguin from ~/church_project/SoC/)

```bash
unexpand --first-only -t 8 Makefile > /tmp/mk && mv /tmp/mk Makefile
unexpand --first-only -t 8 firmware/Makefile > /tmp/mk && mv /tmp/mk firmware/Makefile
make firmware
python3 scripts/patch_sapphire_init.py sapphire.v \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0,1,2,3}.bin
EFINITY_HOME=~/efinity/2025.2 bash run_efx_map.sh
bash run_efx_pnr.sh
./run_efx_pgm.sh
sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

Note: The two Makefiles use spaces instead of TABs (Replit editor converts them). The `unexpand` step fixes this before `make`. Alternatively, fix Makefiles in Replit and transfer them.
