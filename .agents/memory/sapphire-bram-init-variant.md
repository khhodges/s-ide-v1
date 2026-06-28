---
name: Sapphire BRAM init — Variant B (Efinity 2026.1 stub block)
description: Efinity 2026.1 Sapphire IP generates a stub initial begin block (4 zero assignments), NOT $readmemb. patch_sapphire_init.py must handle both variants.
---

## The Rule

Efinity 2026.1's generated `sapphire.v` does NOT use `$readmemb`. Instead it has a **stub initial block** with just one zero-assignment per lane:

```verilog
  initial begin
            ram_symbol0[0] = 8'h00;
            ram_symbol1[0] = 8'h00;
            ram_symbol2[0] = 8'h00;
            ram_symbol3[0] = 8'h00;
  end
```

The BRAM is declared as `reg [7:0] ram_symbol0 [0:8191]` — **8192 words = 32 KB**, not 131072 (the Makefile's ROM_WORDS is for the symbol file padding budget, not the actual BRAM depth).

**Why:** EFX_MAP ignores `$readmemb` entirely on Titanium. It does propagate `initial begin` literal assignments to EFX_RAM10 INIT parameters — but only if those assignments cover ALL words. The stub (only index 0) leaves indices 1-8191 at zero.

**Symptom:** UART outputs only 'C' (first byte of "CHURCH..."), then null-terminates. Byte lanes 1-3 of every BRAM word are zero → `uart_puts` sees 'C' then `'\0'` at address+1 and stops.

**Diagnosis:** `grep -h "INIT_0" work_syn/*.v | grep -v '"0{64}"' | wc -l` → prints 0 after synthesis if the stub was NOT replaced.

## How to Apply

Run `python3 scripts/patch_sapphire_init.py sapphire.v <soc_dir>` — the script now detects both Variant A ($readmemb) and Variant B (stub block) and replaces whichever is present.

**Critical:** The `.bak` file is created on the FIRST patch run. If the first run happened when sapphire.v was already patched (any variant), `.bak` contains the patched version — restoring from it won't give you a clean base. In that case, use the regex pattern directly in `patch_variant_b()` which is idempotent on already-patched files.

**Indentation:** inner assignments use 12 spaces; `initial begin` / `end` use 2 spaces. The pattern regex detects indentation dynamically from the existing `ram_symbol0[0]` line.

## Verification After Patch

```bash
# 1. Zero readmemb remain
grep -c readmemb sapphire.v   # must be 0 (or small number for non-ROM memories)

# 2. After synthesis completes — non-zero BRAM INIT
grep -h "INIT_0" work_syn/*.v | grep -v '"0\{64\}"' | wc -l  # must be > 0
```
