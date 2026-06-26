# HARDWARE.md — Church Machine Hardware Reference

Single source of truth for every hardware-setup fact about the Efinix Ti60 F225 devkit. When one value changes, update it here — all other docs point here.

For Wukong-specific wire protocol, see § 8 below.

---

## 1. Board Identity

| Feature | Value |
|:--------|:------|
| **Device** | Efinix Titanium EFT90A |
| **Board** | Sipeed Ti60 F225 Development Kit |
| **Process** | 90 nm |
| **FPGA family** | Titanium (Efinity toolchain required; not compatible with yosys/nextpnr) |
| **Clock** | 50 MHz on-board crystal (pin B8) |
| **User LEDs** | **3** × active-HIGH (GPIOR_P_07, GPIOR_P_08, GPIOR_P_09) |
| **Button** | 1 × active-LOW USER_PB (external pull-up on board) |
| **USB bridge** | FTDI FT4232H (4-interface USB-UART/JTAG combo) |
| **BRAM** | ~220 KB (176 EFX_RAM10 blocks) |
| **Logic** | ~60 K logic elements |
| **Synthesis toolchain** | Efinity 2026.1 (headless CLI: `efx_map`, `efx_pnr`, `efx_pgm`) |

---

## 2. USB Port Map

The FT4232H enumerates four serial interfaces on the host. On Linux they appear as `/dev/ttyUSB0`–`/dev/ttyUSB3`.

| Device | FT4232H interface | Purpose | Baud |
|:-------|:-----------------|:--------|:-----|
| `/dev/ttyUSB0` | Interface 0 | FPGA JTAG (openFPGALoader) | — |
| `/dev/ttyUSB1` | Interface 1 | CPU debug JTAG (tied off in hardware) | — |
| `/dev/ttyUSB2` | Interface 2 | **Sapphire SoC UART** — CALLHOME + smoke-test target | 57,600 |
| `/dev/ttyUSB3` | Interface 3 | Church Machine debug UART — NIA trace + fault codes | 115,200 |

> **ChromeOS / Crostini note:** On ChromeOS, `/dev/ttyUSB3` is also used as the **Crostini serial console**. Do not connect the Church Machine IDE to `/dev/ttyUSB3` on a Chromebook — use `/dev/ttyUSB2` (Sapphire SoC UART) for all CALLHOME and bridge traffic.

---

## 3. LED Pin Assignments

The Ti60 F225 devkit has **exactly 3 user LEDs** (not 4). Each LED is active-HIGH.

| LED | GPIO pin | Pre-boot meaning | Post-boot |
|:----|:---------|:-----------------|:----------|
| LED0 | `GPIOR_P_07` | ON when Sapphire SoC is out of reset | CPU/MMIO |
| LED1 | `GPIOR_P_08` | ON within ~1 ms when CM boot ROM completes (sticky) | CPU/MMIO |
| LED2 | `GPIOR_P_09` | ON ~3 s after power-on when CM banner is sent; **also ON on fault** | CPU/MMIO |

### Pre-boot signal definitions (from `hardware/ti60_f225.py`)

```python
led_boot         = ~boot_complete               # LED0 ON while CM has never completed CALL
led_run          = boot_complete & ~fault & ~halted   # ON when running post-boot
led_halted_blink = halted & ~fault & heartbeat_blink  # 1 Hz blink when paused & healthy
led_fault        = fault_latched                # sticky — stays ON until power-cycle
```

### Step-by-step LED guide

| Step | LED0 | LED1 | LED2 | What it means |
|:-----|:-----|:-----|:-----|:--------------|
| Power on | 🟡 solid | ⚫ off | ⚫ off | Sapphire RISC-V starting up |
| Sapphire running, CM halted & healthy | 🟡 solid | 💫 1 Hz blink | ⚫ off | CM core live, waiting for boot image over UART |
| CALLHOME sent (~0.5 s after power-on) | 🟡 solid | 💫 1 Hz blink | 🟡 solid | `banner_ever_sent` latched — stays ON from here |
| IDE sends PATCH_LUMP frames | 🟡 solid | 💫 1 Hz blink | 🟡 solid | CM still halted, DMEM being written |
| FREE_RUN (0xBE 0xAA) sent | 🟡 solid | ⚫ brief off | 🟡 solid | CM executing 3 boot ROM instructions |
| Boot complete (`boot_complete=1`) | CPU | CPU | CPU | MMIO writes from your abstraction drive LEDs |

**Fault indicator:** If the CM faults at any stage, LED1 goes dark (`led_halted_blink` gated by `~fault_latched`) and LED2 stays ON permanently from `fault_latched` (or `banner_ever_sent`, whichever lit it first).

---

## 4. APB3 Register Map

The Sapphire SoC accesses the CM bridge at `0xF8100000` (`IO_APB_SLAVE_0_INPUT`, `CM_APB_BASE` in `firmware/main.c`). Source: `hardware/soc_combined/apb3_cm_bridge.v`.

| Offset | Name | Access | Description |
|:-------|:-----|:-------|:------------|
| `0x00` | CTRL | R/W | `[0]` = cm_pb: 1 = released (default), 0 = pressed (active-low). Hold 0 for ≥ 1 s to enter free-run. |
| `0x04` | STATUS | RO | `[0]` boot_complete · `[1]` fault_valid · `[2]` fault_latched |
| `0x08` | NIA | RO | CM next-instruction address (live program counter) |
| `0x0C` | FAULT | RO | `[4:0]` fault code |
| `0x10` | UID_LO | R/W | Lower 32 bits of 64-bit device UID (written by firmware at boot; echoed in CALLHOME) |
| `0x14` | UID_HI | R/W | Upper 32 bits of 64-bit device UID |
| `0x18` | FAULT_GT | RO | GT word0 of faulting capability (latched on fault; reads 0 on older bitstreams) |
| `0x1C` | FAULT_INSTR | RO | Instruction word at fault NIA |
| `0x20` | FAULT_CR14 | RO | Active abstraction slot at fault |
| `0x24` | FAULT_STAGE | RO | Pipeline stage: 0=Fetch 1=Decode 2=Perm 3=Lambda 4=TPERM 5=Call 6=Return 7=DataRW |

### Firmware address reference

| Symbol | Value | Used by |
|:-------|:------|:--------|
| `UART_BASE` / `UART_DATA` | `0xF8010000` | `firmware/main.c`; write = TX, read = RX |
| `UART_STATUS` | `0xF8010004` | bits[23:16] = TX avail |
| `UART_CLOCKDIV` | `0xF8010008` | 25 MHz / (8 × (div+1)) = baud rate |
| APB slave 0 (CM bridge) | `0xF8100000` | `CM_APB_BASE` in `firmware/main.c` |
| Boot ROM base | `0xF9000000` | CPU reset vector, `link.ld` |

**Baud rate:** firmware writes `CLOCKDIV = 53` → 25,000,000 / (8 × 54) = 57,870 ≈ 57,600 baud.

### Key architectural notes
- `FAULT_GT` / `FAULT_INSTR` / `FAULT_CR14` / `FAULT_STAGE` are already latched in hardware on every fault, but the current `uart_emit_callhome()` never reads them — adding ~20 lines would emit full telemetry with no FPGA changes.
- `fault_latched` (STATUS bit[2]) is sticky until hardware reset. Only way to clear without a full power-cycle is to hold CTRL=0 for ≥ 1 s. Adding a `FAULT_RST` write-1-to-clear register in `apb3_cm_bridge.v` (~10 lines Verilog) would complete hardware 3-tier fault recovery.
- NIA sampled at 10 Hz gives a free TraceEmitter with no LUMP binary.

---

## 5. Firmware Build Steps

Short-form checklist. See `hardware/soc_combined/BUILD_SOC_CM.md` for full Efinity-specific command flags and troubleshooting.

```
[ ] Step 1  Copy Sapphire SoC IP files into hardware/soc_combined/
[ ] Step 2  Generate Church Machine RTL: python hardware/gen_verilog.py --ti60
[ ] Step 3  Build firmware: make -C hardware/soc_combined/firmware
[ ] Step 4  *** MANDATORY: python3 scripts/patch_sapphire_init.py sapphire.v symbol{0..3}.bin
            Must re-run on EVERY firmware change before re-synthesising.
[ ] Step 5  Verify: grep optimize-zero-init-rom church_soc_cm.xml  →  must show value="0"
[ ] Step 5b Copy symbol files: bash hardware/soc_combined/scripts/prep_syn.sh
[ ] Step 6  Synthesise: bash hardware/soc_combined/run_efx_map.sh
            *** CHECK: all 4 BRAM lanes must show non-zero INIT_0 in outflow/church_soc_cm.map.v
[ ] Step 7  Place & Route: bash hardware/soc_combined/run_efx_pnr.sh
[ ] Step 8  Generate hex: bash hardware/soc_combined/run_efx_pgm.sh
[ ] Step 9  Flash: sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

**Two steps that cannot be skipped:**
1. **`patch_sapphire_init.py` (Step 4)** — without it, EFX_MAP embeds zeroed BRAM; the UART is silent and the board boot-loops.
2. **INIT_0 check after synthesis (Step 6)** — confirms firmware is actually baked in before spending 5+ minutes on P&R.

For firmware-only rebuilds (no RTL changes), skip Steps 1–2. See `BUILD_SOC_CM.md § Rebuild-from-firmware-change checklist` for the condensed command sequence.

---

## 6. Callhome Bridge

### Basic invocation

```bash
python3 ~/callhome_bridge.py \
  --port=/dev/ttyUSB2 \
  --baud=57600 \
  --ide=https://<your-replit-url>
```

Replace `/dev/ttyUSB2` with your actual port (see § 2 for the port map).

> **`--insecure` flag:** When the IDE is running on a local development server (HTTP, not HTTPS), pass `--insecure` to suppress TLS certificate errors:
> ```bash
> python3 ~/callhome_bridge.py --port=/dev/ttyUSB2 --baud=57600 \
>   --ide=http://localhost:5000 --insecure
> ```

### What you should see

```
Church Machine FPGA Bridge (HTTP)
  Serial : /dev/ttyUSB2 @ 57600 baud
  HTTP   : http://0.0.0.0:8766
  ChromeOS bridge URL: http://localhost:8766
  IDE Server: https://...replit.dev

Press Ctrl+C to stop.

💡 NIA stream: bridge will forward all UART output to the IDE stream panel.

  [bridge] Pre-fetched device UID from IDE: c0ffee0100000001
  [bridge] Drain thread started — forwarding UART to IDE server.
```

The bridge is working if the prompt **does not** return immediately. If it returns immediately, paste the full output for diagnosis.

For ChromeOS-specific setup (Crostini port forwarding, OSS CAD Suite install, ttyUSB3 console warning), see `docs/bridge-setup-chromeos.md`.

---

## 7. Known Traps

| Trap | Detail |
|:-----|:-------|
| **ttyUSB3 = Crostini console on ChromeOS** | On a Chromebook, `/dev/ttyUSB3` is claimed by the Crostini serial console — connecting the IDE to it will produce garbage or nothing. Always use `/dev/ttyUSB2` (Sapphire SoC UART) for CALLHOME and bridge traffic. |
| **INIT_0 all-zero = `patch_sapphire_init.py` was skipped** | If all four BRAM lanes show `INIT_0 = 0` after synthesis, the firmware was not patched into `sapphire.v` before synthesis. Re-run Step 4 then re-synthesise. Symptom: UART silent, or boot loops at NIA=0x00000000 repeating. |
| **`--insecure` required for local IDE** | The callhome bridge uses HTTPS by default. When pointing at an HTTP development server, omit `--insecure` and the bridge will refuse the connection with a TLS error. |
| **`jtagCtrl_reset` must be tied to `1'b1`** | VexRiscv treats `jtagCtrl_reset = 0` as "JTAG TAP held in reset", which propagates into `io_systemReset` and keeps it HIGH permanently. Result: LED0 stays OFF and UART is silent even though the CM runs. Always tie `.jtagCtrl_reset(1'b1)` in `top.v` when JTAG is disabled. |
| **The Ti60 F225 has exactly 3 user LEDs** | Some older docs show a 4-LED table — that reflects an earlier revision. The physical board (GPIOR_P_07/08/09) has 3 LEDs. See § 3 for the authoritative assignments. |
| **Sapphire UART CLOCKDIV resets to 0x00** | The Sapphire SoC UART resets `CLOCKDIV` to `0x00` (not 53) on power-up. Firmware **must** write `CLOCKDIV = 53` before the first `uart_puts` call, or the UART runs at 25 MHz / 8 = 3.125 Mbaud and produces silence on any standard terminal. |

---

## 8. Wukong Ethernet Protocol

The QMTECH Wukong XC7A100T communicates with the IDE server over Ethernet
using UDP (no TCP, no TLS — capability security is the CM model).  This
section defines the wire format for the two frame types.

**Port:** 5900 (both directions — board sends from an ephemeral src port;
server listens on 5900 and replies to the board's source address).

**Byte order:** big-endian (network byte order) for all multi-byte integer
fields.

**Identity rule:** abstractions are identified by their Pet-Name GT token
in every frame field.  NS slot numbers are NEVER used as identifiers in the
wire protocol.  The Ethernet abstraction that sends the callhome frame is
identified by token `0x00003300`, not by any slot number.

---

### Frame A — Wukong Callhome Broadcast (board → IDE server)

Sent by the Locator abstraction after Ethernet link comes up.  Addressed
to UDP broadcast (255.255.255.255) so the IDE server receives it on any
interface without requiring a configured server IP.

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110001  (identifies this as a Wukong callhome)
4       4      Sender token = 0x00003300  (Ethernet abstraction Pet-Name GT)
8       4      CM version word (u32)  — upper 16 bits: major, lower 16: minor
12      6      Board MAC address (6 octets, as presented by the RGMII MAC)
18      2      Pad = 0x0000
20      4      Link-up uptime (u32, seconds since power-on)
24      2      Request count N (u16) — number of lump tokens being requested
26      N×4    Requested lump tokens (each u32) — tokens the Locator needs served
```

Minimum frame length: 26 bytes (N = 0, no requests).

#### Notes

- The server must look up each requested token in its lump store (LUMP
  files registered in the manifest) and reply with a Frame B for each
  token it can satisfy.
- The CM version field allows the server to gate lump delivery by
  compatibility.
- Unknown tokens in the request list are silently skipped — the board
  retries on the next callhome cycle.

---

### Frame B — Lump-Serve Response (IDE server → board)

Sent by the IDE server in reply to each requested lump token in Frame A.
Addressed to the source (host, port) of the callhome broadcast.

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110002  (identifies this as a lump-serve response)
4       4      Lump token (u32) — Pet-Name GT token of the lump being served
8       4      Word count W (u32) — number of 32-bit LUMP words that follow
12      W×4    LUMP data words (each u32, big-endian)
```

Minimum frame length: 12 bytes (W = 0 signals "token not found").

#### Notes

- The Locator verifies the token field against the token it requested.  A
  response with an unexpected token is discarded.
- LUMP words are the raw 32-bit words of the LUMP binary (header + body),
  exactly as stored in the LUMP file.
- After receiving all words, the Locator calls `Mint.Install()` to install
  the lump, then `NSWrite.Promote()` to make the NS entry Live.

---

### Protocol Flow

```
Board (Locator)                        IDE server (WukongUdpListener)
──────────────────────────────         ──────────────────────────────
power-on: Ethernet.Status() → poll
link up detected
send Frame A (broadcast, N=2)     ──►  parse_callhome_frame()
  requests = [token_A, token_B]         log to _callhome_log
                                         for each known token:
                                ◄──      send Frame B (token_A, words)
                                ◄──      send Frame B (token_B, words)
receive Frame B (token_A)
  Mint.Install(words)
  NSWrite.Promote()
receive Frame B (token_B)
  Mint.Install(words)
  NSWrite.Promote()
... (repeat for subsequent lazy-load requests)
```

---

## Ti60 F225 Call-Home Protocol

The Ti60 F225 uses a UART-based call-home protocol via the Sapphire SoC.
See `docs/cloomc-foundation.md` for the full description of the Ti60 boot
sequence and `server/app.py` (`/api/device/register` and
`/api/device/callhome`) for the server-side handler.
