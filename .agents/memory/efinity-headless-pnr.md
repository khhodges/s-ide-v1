---
name: Efinity headless PnR flow (Ti60 on DigitalOcean droplet)
description: Correct sequence and quirks for running efx_map + efx_pnr on a headless Linux server without PyQt6 or a GUI.
---

## Rule
Never use `efx_run.py` on a headless server — it requires PyQt6 and fails with `ModuleNotFoundError`. Use `efx_map --project-xml` for synthesis and `efx_pnr` directly for PnR.

**Why:** `efx_run.py` is the Efinity GUI orchestrator; it imports PyQt6 at startup unconditionally. No GUI = no PyQt6 = crash before it does any work.

## Correct sequence (headless)

1. **Synthesis** — `efx_map --project-xml <proj>.xml --max_threads 4`
   - Writes synthesised netlist to `outflow/<circuit>.netlist`
   - Writes VDB to `<SOC_DIR>/top.vdb` (named after Verilog `module top`, NOT `outflow/<circuit>.vdb`)
   - Does NOT write `outflow/<circuit>.vdb` — that only happens via `efx_run.py --flow map`

2. **Interface Designer** — `efx_run <circuit> --prj --flow interface --family Titanium -d Ti60F225`
   - (`efx_run` binary, not `efx_run.py` script)
   - Writes IO placement CSV to `<SOC_DIR>/top.res.csv` (named after top module, not `outflow/<circuit>.interface.csv`)
   - Throws `'EFINITY_USER_DIR_INI'` and `'EFXPT_HOME'` KeyErrors on headless but still writes the CSV — use `|| true` to continue

3. **Place & Route** — `efx_pnr --prj <proj>.xml --circuit <circuit> --family Titanium --device Ti60F225 --operating_conditions C3 --pack --place --route --vdb_file top.vdb --sync_file top.res.csv --work_dir work_pnr --output_dir outflow --max_threads 4`
   - `--vdb_file top.vdb` (project root, not outflow/)
   - `--sync_file top.res.csv` (project root)
   - `--max_threads 4` for placement/routing parallelism
   - EFINITY_HOME must be exported before calling efx_pnr

## Required env vars (set before any step)
```bash
export EFINITY_HOME=$HOME/efinity/2026.1
export EFINITY_USER_DIR_INI=$HOME/.efinity   # prevents KeyError in efx_run
export EFXPT_HOME=$EFINITY_HOME              # prevents KeyError in efx_run
export PATH=$EFINITY_HOME/bin:$PATH
export LD_LIBRARY_PATH=$EFINITY_HOME/lib:${LD_LIBRARY_PATH:-}
mkdir -p $EFINITY_USER_DIR_INI
```

## Timing (4-vCPU / 8 GB DigitalOcean droplet, Ti60 SoC+CM design)
- Synthesis (`efx_map`): ~2.6 hours (nearly single-threaded LUT mapping)
- PnR (`efx_pnr`): expect 30–90 min with 4 threads
- libstdc++ version warning (system v34 > bundled v32) is harmless

## Always run inside tmux
SSH connections drop if Chromebook sleeps. Always: `tmux new-session -d -s build "..."` before starting any multi-hour step.
