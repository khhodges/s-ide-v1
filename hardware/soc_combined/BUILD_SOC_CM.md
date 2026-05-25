# BUILD_SOC_CM.md — Sapphire SoC + Church Machine Combined Bitstream

## What this builds

A combined Efinix Ti60F225 bitstream that places the Sapphire RISC-V SoC and the
Church Machine RTL side-by-side in a single Efinity project.

On power-on:
- The Sapphire SoC boots its firmware and sends `CHURCH Ti60 SoC+CM v1.1\r\n`
  over **ttyUSB2** (115200 baud, GPIOL_02 → FT4232H interface 2).
- The Church Machine streams NIA traces, fault codes, and call-home packets.
- LED0 lights when the SoC is out of reset.
- LED1 lights when the CM completes its boot sequence.
- LED2 lights if the CM raises a fault.
- LED3 shows the CM heartbeat (1 Hz blink while halted and healthy).

The SoC firmware controls the CM via an APB3 register bridge.
See **APB3 register map** below.

---

## ⚠️  Critical: how firmware gets into the bitstream on Ti60

**EFX_MAP on Efinix Titanium completely ignores `$readmemb`.**
It is treated as simulation-only regardless of where the `.bin` files are placed.

The `$readmemb` calls in `sapphire.v` do NOT embed firmware into the bitstream.
Copying symbol files to `work_syn/` does NOT help.

The correct flow is:

1. Build firmware → generates four byte-lane `.bin` symbol files.
2. **Run `scripts/patch_sapphire_init.py`** to replace the `$readmemb` calls in
   `sapphire.v` with explicit inline `initial` block assignments.
3. Set `optimize-zero-init-rom = 0` in `church_soc_cm.xml` (if EFX_MAP eliminates
   a sparse BRAM it believes is zero, the firmware never executes).
4. Synthesise → 64 EFX_RAM10 BRAM instances for system_ramA appear in `map.v`.
5. **Run `scripts/patch_mapv_init.py`** to inject firmware bytes directly into the
   `INIT_` defparam statements of those 64 instances.
6. Place & route on the patched `map.v` → bitstream → flash.

Steps 2 and 5 are performed by scripts in `scripts/`. See **Steps** below.

---

## Prerequisites

| Item | Notes |
|---|---|
| Efinity 2025.2 | Installed at `~/efinity/2025.2` |
| Efinity RISC-V IDE 2025.2 | Toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin` |
| Sapphire SoC IP | Ships with Efinity — path given in Step 1 |
| Python 3 + Amaranth | Required to generate CM RTL in Step 2 |
| `pyserial` | `pip install pyserial` — for the test step |
| `openFPGALoader` | `~/oss-cad-suite/bin/openFPGALoader` — for flashing |

---

## Steps

### Step 1 — Copy the Sapphire SoC IP files

```bash
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire.v \
   hardware/soc_combined/

cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire_define.vh \
   hardware/soc_combined/
```

> **If the path does not exist**, search for the file:
> ```bash
> find ~/efinity -name "sapphire.v" 2>/dev/null
> ```

---

### Step 2 — Generate the Church Machine RTL

```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v hardware/soc_combined/
```

---

### Step 3 — Build the SoC firmware

```bash
make -C hardware/soc_combined/firmware
```

This produces:
- `firmware/firmware.bin` — raw binary
- `firmware/firmware.hex` — plain hex
- Four byte-lane symbol files in `hardware/soc_combined/`:
  ```
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
  ```

Verify:
```bash
ls -lh hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin
# Expect four files of ~1.2 MB each (131 072 words × 9 chars/line)
```

---

### Step 4 — Patch sapphire.v (replace $readmemb with inline initial block)

EFX_MAP ignores `$readmemb` entirely. Replace each call with explicit Verilog
initial assignments so EFX_MAP creates the BRAM instances:

```bash
cd hardware/soc_combined
python3 ../../scripts/patch_sapphire_init.py \
  sapphire.v \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
```

**Re-run this step every time the firmware is rebuilt** before re-synthesising.

> **Why?** EFX_MAP's `optimize-zero-init-rom` option eliminates a BRAM that
> appears zero-initialised. Replacing `$readmemb` with inline assignments
> makes EFX_MAP produce the 64 EFX_RAM10 instances needed for system_ramA
> (even though it still does not propagate the initial values to `INIT_` params).

---

### Step 5 — Ensure optimize-zero-init-rom is off

In `hardware/soc_combined/church_soc_cm.xml`, the synthesis section must have:

```xml
<efx:param name="optimize-zero-init-rom" value="0" value_type="e_option"/>
```

Set it if needed:
```bash
grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
# If value="1", change to value="0"
```

---

### Step 6 — Synthesise

```bash
bash hardware/soc_combined/work_syn/run_efx_map.sh 2>&1 | tail -5
```

After synthesis, verify the 64 system_ramA BRAM instances are present:

```bash
grep "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
  | grep -v "u_cm" | grep -c "system_ram\|ram_sym"
# Must be > 0 (expect ~64)
```

---

### Step 7 — Patch map.v with firmware INIT_ values

EFX_MAP creates the system_ramA EFX_RAM10 instances but leaves their `INIT_`
parameters at zero. Inject the firmware bytes directly:

```bash
python3 scripts/patch_mapv_init.py \
  hardware/soc_combined/outflow/church_soc_cm.map.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
```

Verify non-zero INIT_ values now exist for system_ramA:
```bash
grep -A 50 "EFX_RAM10.*ram_sym" \
  hardware/soc_combined/outflow/church_soc_cm.map.v | \
  grep "INIT_" | grep -v "= 256'h0000" | head -5
# Must show non-zero hex values
```

> **Note:** `scripts/patch_mapv_init.py` is the next script to be written.
> See **Troubleshooting** for current status.

---

### Step 8 — Place & Route

```bash
bash hardware/soc_combined/work_pnr/run_efx_pnr.sh 2>&1 | tail -5
```

---

### Step 9 — Generate bitstream

```bash
~/efinity/2025.2/bin/efx_pgm \
  --project church_soc_cm \
  --device Ti60F225 \
  --family Titanium \
  --active \
  --bit_width 1 \
  --spi_low_power_mode on \
  --io_weak_pullup on \
  --oscillator_clock_divider DIV8 \
  --enable_roms smart \
  2>&1 | tail -5

ls -lh hardware/soc_combined/outflow/church_soc_cm.hex
```

---

### Step 10 — Flash and test

```bash
sudo ~/oss-cad-suite/bin/openFPGALoader \
  -b titanium_ti60_f225_jtag \
  -f hardware/soc_combined/outflow/church_soc_cm.hex

sleep 5 && python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose
```

---

## FT4232H port layout

| Device | FT4232H interface | Purpose |
|---|---|---|
| ttyUSB0 | Interface 0 | FPGA JTAG |
| ttyUSB1 | Interface 1 | CPU debug JTAG (tied off in hardware) |
| ttyUSB2 | Interface 2 | **Sapphire SoC UART** (smoke-test target) |
| ttyUSB3 | Interface 3 | Church Machine debug UART |

---

## Firmware addresses (from BSP `soc.h`)

| Symbol | Value | Used by |
|---|---|---|
| `SYSTEM_UART_0_IO_CTRL` | `0xF8010000` | `firmware/main.c` `UART_BASE` |
| APB slave 0 (CM bridge) | `0xF0040000` | `firmware/main.c` `CM_APB_BASE` |
| Boot ROM base | `0xF9000000` | CPU reset vector, `link.ld` |

> `sapphire_define.vh` does **not** contain address constants — addresses come
> from the BSP `soc.h`, not from any Verilog header.

---

## APB3 register map

The SoC accesses the CM bridge at `0xF0040000`.

| Offset | Name   | Access | Description |
|---|---|---|---|
| 0x00 | CTRL   | R/W | `[0]` = cm_pb: 1=released (default), 0=pressed (active-low). Hold 0 for ≥ 1 s to enter free-run. |
| 0x04 | STATUS | RO  | `[0]` boot_complete · `[1]` fault_valid · `[2]` fault_latched |
| 0x08 | NIA    | RO  | CM next-instruction address |
| 0x0C | FAULT  | RO  | `[4:0]` fault code |
| 0x10 | UID_LO | R/W | Lower 32 bits of 64-bit device UID |
| 0x14 | UID_HI | R/W | Upper 32 bits of 64-bit device UID |

---

## Per-board UID

```bash
# Board #1 (default)
make -C hardware/soc_combined/firmware

# Board #2
make -C hardware/soc_combined/firmware \
    CFLAGS="-DBOARD_UID_HI=0xC0FFEE01 -DBOARD_UID_LO=0x00000002"
```

---

## Troubleshooting

**UART silent — 0 bytes received**

Most likely cause: firmware is not in the bitstream. Check in order:

1. Did Step 4 (patch_sapphire_init.py) run successfully?
   ```bash
   grep -c "ram_symbol0\[" hardware/soc_combined/sapphire.v
   # Must be >> 2 (hundreds of assignments, not just 2 behavioural accesses)
   ```

2. Is optimize-zero-init-rom set to 0?
   ```bash
   grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
   # Must show value="0"
   ```

3. After synthesis, do the 64 system_ramA EFX_RAM10 instances exist?
   ```bash
   grep "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
     | grep -v "u_cm" | grep -c "system_ram\|ram_sym"
   # Must be > 0
   ```

4. Do those instances have non-zero INIT_ values?
   ```bash
   grep -A 50 "EFX_RAM10.*ram_sym" \
     hardware/soc_combined/outflow/church_soc_cm.map.v | \
     grep "INIT_" | grep -v "= 256'h0000" | head -3
   # Must show non-zero hex — if empty, Step 7 (patch_mapv_init.py) is needed
   ```

**`work_pgm/run_efx_pgm.sh` not found**
→ Use `~/efinity/2025.2/bin/efx_pgm` directly (see Step 9 above).

**`openFPGALoader` not found**
→ Use full path: `sudo ~/oss-cad-suite/bin/openFPGALoader`

**LED1 never lights (CM boot_complete stays 0)**
→ CM RTL issue. Confirm `church_ti60_f225.v` was generated without errors.

**LED2 lights immediately (CM fault at startup)**
→ Boot ROM or namespace issue. Re-generate the Verilog.

---

## Resource utilisation

The Ti60F225 has ~60K logic elements and ~220 KB BRAM (176 EFX_RAM10 blocks).
The combined SoC+CM design uses ~180 EFX_RAM10 blocks (CPU caches, register file,
CM token store, system_ramA). Check utilisation after synthesis:

```bash
python scripts/check_ti60_utilisation.py --missing-ok
```
