# End-to-End Hardware Integration Runbook

**Purpose:** Step-by-step guide for validating the complete callhome → lump push → board reboot loop on a physical Ti60 F225 devkit. Each leg has a known status so you start exactly where you left off.

**Status legend:** ✅ Verified on hardware · ⚠️ Believed working, not recently re-tested · ❌ Known gap — implementation present but untested end-to-end

---

## Quick reference

| Leg | Summary | Status |
|:----|:--------|:-------|
| [Leg 1](#leg-1--flash-bitstream) | Flash bitstream to board | ✅ |
| [Leg 2](#leg-2--soc-boot-banner-over-ttyusb2) | SoC boot banner over ttyUSB2 | ✅ |
| [Leg 3](#leg-3--callhome-json-received-by-bridge) | CALLHOME JSON received by bridge | ✅ |
| [Leg 4](#leg-4--ide-server-acknowledges-callhome) | IDE server acknowledges callhome | ✅ |
| [Leg 5](#leg-5--ide-pushes-pending-lump-via-patch_lump-frame) | IDE pushes pending lump via PATCH_LUMP | ⚠️ |
| [Leg 6](#leg-6--board-reboots-and-runs-new-abstraction) | Board reboots and runs new abstraction | ❌ |

See [Known Traps](#known-traps) for common failure causes discovered during hardware sessions.

---

## Leg 1 — Flash bitstream

**Status: ✅ Verified**

### Prerequisites

- Efinity 2026.1 installed at `~/efinity/2026.1`
- Efinity RISC-V IDE 2025.2 toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin`
- `oss-cad-suite` present at `~/oss-cad-suite/bin/openFPGALoader`
- Board connected via USB; FT4232H enumerates as `/dev/ttyUSB0`–`/dev/ttyUSB3`

### Command

```bash
# Option A — one-command build + flash (preferred):
cd ~/church-machine
make bitstream-flash

# Option B — use pre-built hex (if Efinity is not available locally):
curl -O https://<your-ide-url>/dl/ti60-hex
sudo ~/oss-cad-suite/bin/openFPGALoader \
  -b titanium_ti60_f225_jtag \
  -f church_ti60_f225.hex
```

### Expected output

```
...
[SUCCESS] Bitstream programmed successfully.
```

The board power-cycles immediately after flashing. LED0 comes on within ~2 s.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `openFPGALoader: no device found` | Wrong board flag — verify `-b titanium_ti60_f225_jtag`; try `sudo` |
| Flash completes but board is dead | Hex is stale — re-run `make bitstream` then re-flash |
| `BRAM INIT_0 = 0x00000000` after synth | `patch_sapphire_init.py` was skipped — see `hardware/soc_combined/BUILD_SOC_CM.md` Step 4 |
| `optimize-zero-init-rom = 1` in XML | Run `sed -i 's/value="1"/value="0"/' hardware/soc_combined/church_soc_cm.xml` then re-synth |

---

## Leg 2 — SoC boot banner over ttyUSB2

**Status: ✅ Verified**

### Prerequisites

- Leg 1 complete (board flashed and powered)
- `pyserial` installed: `pip install pyserial`
- On ChromeOS: do **not** use ttyUSB3 — it is the Crostini console (see [Known Traps](#known-traps))

### Command

```bash
python3 scripts/test_ti60_uart.py --port=/dev/ttyUSB2 --timeout=30 --verbose
```

Or manually with `screen` or `minicom`:

```bash
screen /dev/ttyUSB2 57600
# Press power button on board if already connected; or power-cycle
```

### Expected output

```
CHURCH Ti60 SoC+CM v2.0
UID=c0ffee0100000001
CALLHOME {"device_uid":"c0ffee0100000001","fw_major":2,"fw_minor":0,...}
```

The banner arrives within ~3 s of power-on. LED2 goes solid once the banner is sent.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| No output at all on ttyUSB2 | Firmware not embedded — `INIT_0` was all-zero; re-run Leg 1 with `patch_sapphire_init.py` |
| Garbled output (random bytes) | Wrong baud rate — must be **57600** (CLOCKDIV=53, 25 MHz clock) |
| `Permission denied: /dev/ttyUSB2` | Add user to `dialout` group: `sudo usermod -aG dialout $USER` then log out/in |
| Port opens but instantly closes | Another app holds the port (minicom, screen, bridge); kill it first |
| `jtagCtrl_reset` trap | LED0 stays OFF, UART silent — `jtagCtrl_reset` must be tied to `1'b1` in `top.v` (see [Known Traps](#known-traps)) |

---

## Leg 3 — CALLHOME JSON received by bridge

**Status: ✅ Verified**

### Prerequisites

- Leg 2 complete (board emitting CALLHOME over ttyUSB2)
- Bridge script downloaded from the IDE: `/dl/callhome-bridge` or copied from `scripts/callhome_bridge.py`
- Python 3 + `pyserial` + `requests` installed on the host machine

### Command

```bash
python3 ~/callhome_bridge.py \
  --port=/dev/ttyUSB2 \
  --baud=57600 \
  --ide=https://<your-replit-url>
```

For a local dev server (HTTP):

```bash
python3 ~/callhome_bridge.py \
  --port=/dev/ttyUSB2 \
  --baud=57600 \
  --ide=http://localhost:5000 \
  --insecure
```

### Expected output

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
  [bridge] → POST /api/device/call-home  200 OK
```

The bridge is working if it **does not** return immediately. A prompt that returns instantly means a startup error — paste the full output for diagnosis.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `TLS handshake error` or `SSL error` | Add `--insecure` flag when using a local HTTP server |
| `Connection refused` to IDE | IDE server is not running; check Flask workflow status |
| `Serial port not found` | Wrong port; run `ls /dev/ttyUSB*` and confirm the board is plugged in |
| Bridge returns immediately | Import error or missing dependency — run `pip install pyserial requests` |
| No `→ POST` line appearing | Board is not sending CALLHOME; go back to Leg 2 |

---

## Leg 4 — IDE server acknowledges callhome

**Status: ✅ Verified**

### Prerequisites

- Leg 3 complete (bridge running and forwarding)
- IDE server running (Flask `server/app.py`)

### Command

You can verify the endpoint without hardware using the health-check script:

```bash
python3 scripts/check_runbook_status.py --dry-run
```

Or manually:

```bash
curl -s -X POST https://<your-ide-url>/api/device/call-home \
  -H "Content-Type: application/json" \
  -d '{"device_uid":"test-runbook-001","fw_major":2,"fw_minor":0,"board_type":1}' \
  | python3 -m json.tool
```

### Expected output

```json
{
  "ok": true,
  "uid": "test-runbook-001",
  "registered": true,
  "pending_lump": null
}
```

The server also logs the event and updates the Devices tab in the IDE.

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `{"ok": false, "error": "missing device_uid"}` | Payload missing `device_uid` field |
| HTTP 500 | Database error — check server logs (`/tmp/logs/`) |
| HTTP 404 | Wrong URL or IDE server not running |
| `"registered": false` | First-time registration — normal; second call will show `true` |

---

## Leg 5 — IDE pushes pending lump via PATCH_LUMP frame

**Status: ⚠️ Believed working, not recently tested end-to-end**

The server-side pending-lump API exists at `GET /api/device/<uid>/pending-lump`. The bridge is expected to poll this endpoint and write PATCH_LUMP frames over the serial port. End-to-end validation on real hardware is pending.

### Prerequisites

- Leg 4 complete (callhome acknowledged)
- A lump queued for the device via the IDE (Builder → Deploy → select device → push)

### Command

Check the pending-lump API:

```bash
# Replace <uid> with your board's device UID (from the Devices tab or Leg 2 banner)
curl -s https://<your-ide-url>/api/device/<uid>/pending-lump | python3 -m json.tool
```

When a lump is queued, response will be:

```json
{
  "ok": true,
  "pending": true,
  "token": "c0ffee01",
  "lump_words": [...]
}
```

The bridge polls this endpoint (default interval: 5 s) and writes PATCH_LUMP frames to the serial port when `pending == true`.

Expected UART output on the board side (ttyUSB2):

```
PATCH_LUMP token=c0ffee01 words=64
ACK OK
```

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| `"pending": false` always | No lump queued — use Builder → Deploy → push lump to device |
| Bridge does not write PATCH_LUMP | Confirm bridge version supports `--pending-poll`; may need `--enable-push` flag |
| `ACK FAIL crc=...` on board | Framing error; restart bridge and retry |
| No UART response from board after PATCH_LUMP | Board firmware does not yet handle PATCH_LUMP; this is a known gap |

---

## Leg 6 — Board reboots and runs new abstraction

**Status: ❌ Known gap — end-to-end reboot-and-run not yet validated**

After a successful PATCH_LUMP sequence, the firmware should write FREE_RUN bytes (`0xBE 0xAA`) to the APB3 CTRL register to release the Church Machine and execute the newly-loaded abstraction. This leg has not been validated on real hardware.

### Prerequisites

- Leg 5 complete (PATCH_LUMP accepted and ACK'd by board)

### Expected sequence

1. Firmware receives all PATCH_LUMP frames → writes lump words into CM DMEM via APB3 NIA/CTRL registers
2. Firmware writes `FREE_RUN` command → releases CM core
3. CM executes boot ROM → loads lump from DMEM → calls first method
4. LED pattern changes to match the new abstraction's MMIO writes

### Expected UART output

```
FREE_RUN sent
BOOT_COMPLETE
NIA=0x0001 (first instruction of new abstraction)
```

### Failure modes

| Symptom | Diagnosis |
|:--------|:----------|
| LEDs do not change after PATCH_LUMP | FREE_RUN not sent — firmware may not be wired to send it after PATCH_LUMP |
| CM faults immediately | Lump CRC or bounds check failed — verify lump consistency gate passed |
| NIA stuck at 0x00000000 | Boot ROM not starting — check APB3 CTRL = 1 (CM released) |
| LED2 solid after FREE_RUN | `fault_latched` set — read APB3 FAULT register for fault code |

---

## Known Traps

Discoveries made during real hardware sessions that are easy to miss:

| Trap | Detail |
|:-----|:-------|
| **ttyUSB3 = Crostini console on ChromeOS** | On a Chromebook, `/dev/ttyUSB3` is claimed by the Crostini serial console. Connecting the bridge to ttyUSB3 produces garbage or nothing. Always use `/dev/ttyUSB2` (Sapphire SoC UART) for CALLHOME and bridge traffic. |
| **ttyUSB2 = SoC UART at 57600, not 115200** | ttyUSB2 runs at 57600 baud (`CLOCKDIV=53`, 25 MHz clock, 8× divider). Opening at 115200 produces garbled output. ttyUSB3 is the CM debug UART at 115200. |
| **INIT_0 all-zero = `patch_sapphire_init.py` was skipped** | If all four BRAM lanes show `INIT_0 = 0x00000000` after synthesis, the firmware patch was not applied. Re-run `scripts/patch_sapphire_init.py` then re-synthesise. Symptom: UART silent, or NIA=0x00000000 looping. |
| **`--insecure` required for local IDE** | The callhome bridge uses HTTPS by default. When pointing at an HTTP development server, pass `--insecure` or the bridge refuses with a TLS error. |
| **`jtagCtrl_reset` polarity** | VexRiscv treats `jtagCtrl_reset=0` as "JTAG TAP in reset", which propagates into `io_systemReset` and keeps it HIGH permanently. Result: LED0 stays OFF and UART is silent even though the FPGA is programmed. Always tie `.jtagCtrl_reset(1'b1)` in `top.v`. |
| **Sapphire UART `CLOCKDIV` resets to 0x00** | On every power-on, `CLOCKDIV` resets to 0x00 (not 53). Firmware **must** write `CLOCKDIV = 53` before the first `uart_puts` call. Without it the UART runs at 25 MHz/8 = 3.125 Mbaud and produces silence. |
| **Ti60 F225 has exactly 3 user LEDs** | Some older docs describe 4 LEDs. The physical board (GPIOR_P_07/08/09) has exactly 3. See `docs/HARDWARE.md § 3` for the authoritative assignments. |
| **`make` must run after `git pull`** | The callhome bridge firmware and scripts may have changed. Always rebuild with `make -C hardware/soc_combined/firmware` after pulling upstream changes, even if you only changed `.c` files. |

---

## Related documents

- **`docs/HARDWARE.md`** — Authoritative USB port map, LED assignments, APB3 register table, firmware build steps
- **`hardware/soc_combined/BUILD_SOC_CM.md`** — Full Efinity synthesis workflow with troubleshooting
- **`scripts/check_runbook_status.py`** — Server-side health check (no hardware needed)
- **`server/app.py`** routes: `/api/device/call-home`, `/api/device/<uid>/pending-lump`
