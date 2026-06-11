---
name: Efinity 2026.1 illegal synthesis parameters
description: efx_map 2026.1 rejects options that were valid in earlier versions — full confirmed list, must be stripped from church_soc.xml before every compile
---

**Illegal options in Efinity 2026.1 efx_map** (cause EFX-0002 and abort).
All confirmed by running against a real Ti60 project (church_soc.xml):

| XML param name        | Status in 2026.1                         |
|-----------------------|------------------------------------------|
| `infer_clk_enable`    | Renamed → `--infer-clk-enable`           |
| `infer_set_reset`     | Renamed → `--infer-sync-set-reset`       |
| `calc_mcw`            | Removed entirely                         |
| `split_input_buf`     | Removed entirely                         |
| `no_fanout_override`  | Removed entirely                         |
| `get_names_method`    | Removed entirely                         |
| `logic_opting`        | Removed entirely                         |
| `pack_lut_into_ram`   | Removed entirely                         |
| `cpe_ins_register`    | Removed entirely                         |
| `use_cpe_for_const_0` | Removed entirely                         |
| `use_cpe_for_const_1` | Removed entirely                         |
| `fanout_limit`        | Renamed → `--fanout-limit` (hyphens)     |

**Problem:** Efinity GUI rewrites `church_soc.xml` with these stale options on every project open/save, so they return even after manual removal.

**Fix:** `hardware/soc_combined/run_efx_map.sh` strips all 11 with sed before invoking efx_map. No manual intervention needed — just use the script.

**Why:** Parameter names changed between Efinity versions. The project XML carries old names from an earlier version. The complete list above was extracted by running `grep 'efx:param name' church_soc.xml` and cross-referencing against the 2026.1 efx_map --help output.
