---
name: Ti60 SoC UART clockDivider
description: Sapphire SoC UART baud config, clock architecture, and working firmware pattern for Ti60F225
---

## Clock Architecture (Ti60F225 Devkit) — CONFIRMED WORKING

The Ti60F225 devkit has THREE oscillators (from devkit UG v2.6 Table 1):

| Oscillator | Pin | PLL |
|---|---|---|
| **25 MHz** | **GPIOL_P_18_PLLIN0** | **PLL_TL0** |
| 33.3333 MHz | GPIOL_P_00_PLLIN0 | PLL_BL0 |
| 74.25 MHz | GPIOT_P_17_PLLIN1 | PLL_TR0 |

**GPIOL_P_18 is a PLL INPUT pin — it CANNOT drive CLKMUX directly.**
Any attempt to route GPIOL_P_18 through CLKMUX_T, CLKMUX_L, or any CLKMUX
always produces PCR_*_EN=DISABLE. The Interface Designer silently ignores it
because it's not a clock-capable GPIO pin.

**The correct (confirmed working) clock chain:**
```
25 MHz → GPIOL_P_18_PLLIN0 → PLL_TL0 (×20, pre_div=1, post_div=1, out_div=10)
       → 50 MHz top.clk
       → Sapphire SoC internal PLL (×4)
       → ~200 MHz CPU clock
```

**CONFIRMED:** With CLOCKDIV=53, UART output appears at **460800 baud** —
proving CPU ≈ 200 MHz:  200_000_000 / (8 × 54) = 462_963 ≈ 460_800.

**peri.xml must have `<efxpt:pll_info>` with PLL_TL0 configured** — not a GPIO
clock, not OSC_0. The `<efxpt:pll_info/>` (empty) peri.xml is the root cause of
all clock failures.

**Why:** GPIOL_P_18 is labeled `_PLLIN0` in the device architecture — it's wired
directly to PLL_TL0's reference input, not to the global clock multiplexer.

## UART CLOCKDIV rule

The Sapphire SoC UART `clockDivider` register resets to **0x00** on power-up.
Firmware **must** write `UART_CLOCKDIV = 53` before the first `uart_puts()` call.

```c
#define UART_CLOCKDIV  (*(volatile uint32_t *)(0xF8010000UL + 0x08))
```

Baud rate formula: `baudRate = ClkIn / (8 × (clockDivider + 1))`

CPU clock is ~200 MHz (25 MHz → PLL_TL0 ×20/÷10 → 50 MHz → SoC PLL ×4 → 200 MHz):
```
clockDivider = 53  →  actual baud = 200_000_000 / (8 × 54) ≈ 462_963 ≈ 460_800
```

**Without CLOCKDIV=53 write:** UART runs at reset default — silence or garbage.

## Efinity build flow — CONFIRMED WORKING sequence (Penguin)

```bash
export EFINITY_HOME=/home/sipantichijk/efinity/2026.1
export PYTHONHOME=$EFINITY_HOME
export EFINITY_USER_DIR_INI=/home/sipantichijk/.local/share/efinity/user_dir.ini
export EFXPT_HOME=$EFINITY_HOME/pt

cd ~/church_project/SoC

# 1. Interface (validates PLL/IO config)
$EFINITY_HOME/bin/efx_run -f interface church_soc_cm.xml 2>&1 | tail -5
# → interface : PASS

# 2. Synthesis
$EFINITY_HOME/bin/efx_run -f map church_soc_cm.xml 2>&1 | tail -5
# → map : PASS

# 3. Place & Route — must use efx_pnr directly with interface.csv, NOT efx_run -f pnr
#    efx_run -f pnr silently fails because it passes church_soc_cm.peri.xml as
#    --sync_file and efx_pnr's parser rejects the compact-XML format as 119 errors.
source $EFINITY_HOME/bin/setup.sh 2>/dev/null
/home/sipantichijk/efinity/2026.1/bin/efx_pnr \
  --circuit church_soc_cm --family Titanium --device Ti60F225 \
  --operating_conditions C3 \
  --vdb_file outflow/church_soc_cm.vdb --use_vdb_file on \
  --prj church_soc_cm.xml \
  --output_dir outflow --work_dir work_pnr \
  --place_file outflow/church_soc_cm.place \
  --route_file outflow/church_soc_cm.route \
  --sdc_file church_soc_cm.sdc \
  --sync_file outflow/church_soc_cm.interface.csv \
  2>&1 | tail -5
# Runs ~3 min; ends with "Finished writing bitstream file work_pnr/church_soc_cm.lbf"

# 4. Bitstream — unset env vars first
unset EFINITY_HOME PYTHONHOME EFINITY_USER_DIR_INI EFXPT_HOME
/home/sipantichijk/efinity/2026.1/bin/efx_run -f pgm church_soc_cm.xml 2>&1 | tail -5
# → pgm : PASS
```

## SDC must be referenced by absolute path in church_soc_cm.xml

```xml
<efx:sdc_file name="/home/sipantichijk/church_project/SoC/church_soc_cm.sdc" />
```

Relative path ("church_soc_cm.sdc") is silently ignored — pnr falls back to 1 ns default
constraint and reports timing failure even though the design meets 20 ns easily.

## Flash and UART check

```bash
# Flash FPGA config
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex

# UART — baud is 460800 (CPU ~200 MHz, CLOCKDIV=53)
stty -F /dev/ttyUSB2 460800 raw && timeout 10 cat /dev/ttyUSB2
# Expected output: NIA=0x00000000 + CALLHOME JSON with boot_ok:1
```

## soc.hex SPI boot bootloader constraint: USER_SOFTWARE_SIZE = 252 bytes

The stock soc.hex bootloader copies exactly **252 bytes** from SPI data flash
(at offset 0x380000) into BRAM before jumping to 0xF9000000. Any firmware bytes
beyond offset 252 are **not copied** — old BRAM content remains.

**Symptom:** Firmware using string literals beyond byte 252 outputs garbled data.

## BRAM layout

```
0xF9000000 — BRAM start (8 KB confirmed working)
0xF9002000 — BRAM end / stack top (_stack_top in link.ld)
0xF8010000 — UART_BASE (UART_DATA +0, UART_STATUS +4, UART_CLOCKDIV +8)
0xF8100000 — CM APB3 bridge
```
