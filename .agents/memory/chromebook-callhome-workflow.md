---
name: Chromebook call-home bridge workflow
description: Confirmed working flow for firmware→BRAM→Efinity→flash→bridge on the Penguin Chromebook Linux container
---

# Chromebook Call-Home Bridge Workflow

## Confirmed working bridge command
```bash
python3 hardware/soc_combined/callhome_bridge.py \
    --port=/dev/ttyUSB2 --baud=115200 \
    --ide=https://31592a69-0a64-402e-9237-89b7ce66a127-00-1hr1bt2ealopt.kirk.replit.dev \
    --insecure
```

**Why --insecure:** The Chromebook Linux container (Debian) does not have Replit's SSL CA in its trust store. Without `--insecure`, every POST fails with `CERTIFICATE_VERIFY_FAILED`. This flag only skips cert verification — the connection is still encrypted.

**Why --baud=115200:** soc_minimal firmware uses CLOCKDIV=26 (115200 baud). The bridge defaults to 57600. Must match firmware.

## PATCH_LUMP upload (confirmed working June 2026)

CM debug UART (PATCH_LUMP) is on **ttyUSB2 at 115200 baud** — the SAME port as the
call-home bridge, NOT ttyUSB3. Stop the bridge before uploading.

Use `upload_boot.py` (in repo root) which:
1. Fetches the first 2048 words (8192 bytes) from `/api/boot-image/binary`
2. Sends PATCH_LUMP frame: `BE EF addrHi addrLo cntHi cntLo [data] [crcHi crcLo]`
3. **CRC covers the FULL frame including header bytes** (BE EF addrHi addrLo cntHi cntLo then data) — NOT data-only
4. BRAM write address is 11-bit masked (max 2048 words) — only send first 2048 words

```bash
python3 upload_boot.py   # stop the bridge first; uses /dev/ttyUSB2 @ 115200
```

After ACK: hold push button ~1 s → CM reboots with patched BRAM. PATCH_LUMP is
volatile (survives CM reset, wiped on power cycle).

## Firmware → flash sequence (strict order)

These steps must run in this exact order. Any step out of order silently bakes old code into BRAM.

1. `git pull` — get latest main.c from GitHub FIRST
2. `grep -c "CALLHOME" firmware/main.c` — must be ≥ 1 before proceeding
3. `make -C firmware clean && make -C firmware TOOLCHAIN=...` — compile
4. `strings firmware.elf | grep -c "CALLHOME"` — must be ≥ 1 (GCC merges duplicates; 1 is fine)
5. `objcopy -O binary firmware.elf firmware.raw` — extract raw binary
6. Python script → `work_syn/EfxSapphireSoc...symbol{0..3}.bin` — split into BRAM lanes
7. `cp sapphire.v.bak sapphire.v && python3 scripts/patch_sapphire_init.py sapphire.v work_syn` — inline BRAM init
8. `sed -i '/<efx:param name="infer_clk_enable"/d' church_soc.xml` (and infer_set_reset) — strip bad params
9. **Close Efinity → reopen → Compile** — MUST close+reopen; Efinity caches sapphire.v on open
10. Flash: `sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc.hex`

**Why:** Steps 2+4 verify the source is correct before wasting compile time. Steps 5+6 must happen AFTER step 3 or the BRAM gets old firmware. Step 9 is non-negotiable — Efinity ignores on-disk changes unless you close+reopen.

## Git sync gotcha: local top.v changes
The Chromebook often has local edits to `hardware/soc_minimal/top.v` (the working POR fix). 
`git pull --ff-only` aborts if this file is modified. Fix:
```bash
git stash push -m "local top.v" -- hardware/soc_minimal/top.v
git pull --ff-only
git checkout --theirs hardware/soc_minimal/top.v   # if conflict from stash pop
git add hardware/soc_minimal/top.v
git stash drop
```
The repo's top.v has the correct `por_cnt` POR fix, so `--theirs` is safe.

## Expected bridge output after successful flash
```
  CHURCH Ti60 v1.0
  UID=c0ffee0100000001
  [CALL HOME] Ti60F225  UID=c0ffee0100000001  NIA=0x00000000  boot_ok=1  FW=1.0
  [CALL HOME] ACK received from IDE — boot #NNNN
  NIA=0x00000000
  [CALL HOME] Ti60F225  ...
  [CALL HOME] ACK received from IDE — boot #NNNN+1
```
NIA heartbeat arrives every ~1 second. Boot count increments on every reset.
