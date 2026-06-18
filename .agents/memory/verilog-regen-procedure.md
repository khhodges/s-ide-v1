---
name: Verilog/RTLIL regeneration procedure
description: How to regenerate all build artifacts after an Amaranth source change; which files are actively-synthesised vs. legacy-frozen.
---

## Commands (run from workspace root)

```bash
python3 -m hardware.gen_verilog           # build/church_core.v + build/church_tang_nano_20k.v
python3 -m hardware.gen_verilog --iot     # build/church_core_iot.v + build/church_tang_nano_20k_iot.v
python3 -m hardware.gen_verilog --ti60    # build/church_ti60_f225.v
python3 -m hardware.gen_verilog verilog   # verilog/church_core.v + verilog/church_tang_nano_20k.v (check-stale-cr7 targets)
python3 -m hardware.gen_rtlil             # build/church_tang_nano_20k.il
python3 -m hardware.gen_rtlil --ti60 build   # build/church_ti60_f225.il (also regenerates build/church_ti60_f225.v via Yosys)
python3 -m hardware.gen_rtlil --wukong build # build/church_wukong_xc7a100t.il + .v
```

After regenerating, run:
```bash
node scripts/build_selftest_lump.js      # if assembler encoding changed
python3 -m pytest tests/lump/test_lump_consistency.py -v
```

## Verification signal (ECO-001B)

Any freshly-generated file should have `drx_val_reg` and `eff_off` signals:
```bash
grep -c "drx_val_reg\|eff_off" build/church_core.v   # expect 16+
```

## Actively-synthesised targets (must regenerate after core changes)

| File | Command |
|---|---|
| build/church_core.v | gen_verilog (default) |
| build/church_tang_nano_20k.v | gen_verilog (default) |
| build/church_core_iot.v | gen_verilog --iot |
| build/church_tang_nano_20k_iot.v | gen_verilog --iot |
| build/church_ti60_f225.v | gen_verilog --ti60 |
| build/church_tang_nano_20k.il | gen_rtlil |
| build/church_ti60_f225.il | gen_rtlil --ti60 |
| build/church_wukong_xc7a100t.v/.il | gen_rtlil --wukong |
| verilog/church_core.v | gen_verilog verilog |
| verilog/church_tang_nano_20k.v | gen_verilog verilog |

## Legacy-frozen (no gen script; reference church_machine/ legacy module)

- build/church_top.v
- build/church_pico_ice.v
- build/church_tang_nano_9k.v / .il

**Why:** These reference `church_machine/top.py` and `church_machine/pico_ice.py` — a legacy tree. No gen_verilog/gen_rtlil target exists for them; leave as-is.

## Builder tab visibility trap

`#builderViewTab-lump-resident` (and lump-thread, lump-ns) ship with `style="display:none;"` in index.html. `switchBuilderViewTab()` shows/hides the PANEL div, but never touches the tab BUTTON visibility. If the button is hidden, e2e tests that `waitFor({state:'visible'})` on it will time out (40 s each). Fix: remove the inline style from the button in index.html.
