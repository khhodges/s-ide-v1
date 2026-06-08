---
name: Efinity clkin GPIO duplicate net = unassigned core pin
description: Ti60/Titanium PnR "Unassigned Core Pins=1 / Missing Interface Pins=1" caused by naming the clk net on BOTH the clkin GPIO and the clkmux ROUTE0
---

# Symptom
`efx_run --flow pnr` FAILs with, in `outflow/<proj>.route.rpt.xml`:
- `Unassigned Core Pins severity="error" value="1"`
- `Missing Interface Pins severity="info" value="1"`

map PASS, interface PASS, pnr FAIL. The orphan pin name is NEVER printed in any text
log (.log/.out/.rpt) — only the count appears in route.rpt.xml. Don't waste turns
grepping logs for the name; it isn't there.

# Root cause
In `peri.xml`, the external-clock input net gets named **twice**:
- clk `comp_gpio` `input_config name="clk"` with `conn_type="clkin"` → creates a *direct*
  GPIO→fabric input core pin named `clk`.
- `clkmux` (e.g. CLKMUX_L) `ROUTE0 name="clk"` → creates the *real* global clock net `clk`.

With `conn_type="clkin"` the GPIO feeds the fabric ONLY through the clkmux (link is
`clkmux_buf_name="CLKMUX_L"`). The netlist's `clk` port consumes the clkmux ROUTE0 net
(that's why timing still reports a valid clock). The GPIO's own direct-input `clk` core
pin has no consumer → the 1 unassigned core pin. The GPIO not being used as a normal data
pin → the 1 (info) missing interface pin.

# Fix
Blank the GPIO input net name; let ONLY the clkmux name the fabric net.
In the clkin `comp_gpio`'s `input_config`, set `name=""` (keep `conn_type="clkin"` and
`clkmux_buf_name="CLKMUX_L"`). Then re-run interface + pnr (map unaffected — netlist
unchanged):
```
efx_run <proj> --prj --flow interface && efx_run <proj> --prj --flow pnr
```

**Why:** a clkin GPIO and its clkmux ROUTE0 must not both carry the same net name, or PnR
sees two drivers/an orphaned direct-input core pin and refuses to route.
**How to apply:** any Titanium external-clock-through-clkmux setup. Check this FIRST when
PnR reports exactly 1 unassigned core pin + 1 missing interface pin and the netlist has no
hard blocks (grep map.v for EFX_PLL/EFX_OSC/EFX_JTAG — if none, it's the clk/clkmux dup).
