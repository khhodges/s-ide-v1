# outflow/

This directory holds the verified master bitstream artifacts for the Ti60F225
`soc_combined` build.

## Tracked files (Git LFS)

| File | Description |
|---|---|
| `church_soc_cm.hex` | SPI flash hex — verified 2026-06-15, CALLHOME telemetry confirmed, v2.0 firmware, 9 abstractions in NS manifest |
| `church_soc_cm.bit` | Raw bitstream (companion to .hex) |

Both files are tracked via Git LFS (see `.gitattributes` at the repo root).

## How to regenerate

See `../BUILD_SOC_CM.md` — the full verified headless build sequence (Steps 1–9).

After any firmware change:
1. `make -C hardware/soc_combined/firmware`
2. `bash hardware/soc_combined/scripts/prep_syn.sh`
3. `python3 scripts/patch_sapphire_init.py hardware/soc_combined/sapphire.v <symbol0..3>.bin`
4. Re-synthesise → P&R → efx_run pgm → flash

## Verification checklist (2026-06-15 build)

- [x] CALLHOME telemetry received by IDE
- [x] Firmware version: v2.0
- [x] 9 abstractions present in NS manifest
- [x] LED0 ON (SoC out of reset)
- [x] LED1 ON (CM boot complete)
- [x] LED2 toggling (CM alive, no fault latched)
- [x] ttyUSB2 @ 57600 baud: banner received
- [x] ttyUSB3 @ 115200 baud: NIA stream active
