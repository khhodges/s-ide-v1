# Startup.Config — Specification

_Church-Turing Meta-Machine startup configuration abstraction_

---

## 1. Background and motivation

### 1.1 Pre-baking Boot.Abstr

The Church Machine boot ROM is a 13-instruction fixed program (BOOT_ROM_WORDS)
that lives in the Boot.Abstr lump at NS slot 3.  Before Task #247 eliminated
the Boot.Abstr director, Boot.Abstr's golden token (GT) was resolved at runtime
by walking the namespace table each time the machine reset.  The design has
since moved toward **pre-baking**: placing Boot.Abstr's GT directly into the
thread c-list at image-build time so the boot sequence needs no dynamic NS
resolution.

Pre-baking is the right trade-off for firmware — it makes Boot.Abstr's first
instruction execute in one cycle from reset — but it has one consequence:
Boot.Abstr's physical address is now baked into the thread lump.  Patching
NS slot 3 at runtime no longer changes what runs at boot.

### 1.2 The flexibility gap

Before pre-baking, operators could swap the entire boot behaviour by patching
the lump at NS slot 3 (via `PATCH_LUMP`).  After pre-baking that seam is gone.
The system needs a replacement: a well-defined, patchable abstraction that
Boot.Abstr always calls immediately, and which in turn decides what the machine
actually does.

### 1.3 The solution: Startup.Config at NS slot 2

NS slot 2 has been free and null since Task #247 removed the Boot.Abstr
director.  **Startup.Config** claims that slot.  It is:

- small (one 64-word lump),
- fully patchable via `PATCH_LUMP` without touching Boot.Abstr or the thread
  lump, and
- the single authoritative place for all startup configuration.

---

## 2. NS slot layout

```
NS[0]  Boot.NS          — namespace root; holds the NS table descriptor
NS[1]  Boot.Thread      — thread lump; c-list[4] holds the Startup.Config GT
NS[2]  Startup.Config   — THIS ABSTRACTION (formerly free/null)
NS[3]  Boot.Abstr       — 13-instruction firmware; pre-baked GT in thread c-list
NS[4]  LED flash        — first user abstraction (default boot target)
NS[5]  Salvation        — security pipeline entry
NS[6]  Navana           — namespace controller
       …
```

NS slots 0–3 form the **foundational quad**.  All four must be non-null in
every valid boot image.  Startup.Config joining this quad requires bumping
`BOOT_IMAGE_FORMAT_TAG` so `validate_boot_image()` rejects images built before
this change.

---

## 3. Boot call chain

```
Power-on / Reset
    │
    ▼
Boot ROM (hardware)
    └─ Loads thread lump from NS[1]
    └─ Reads Boot.Abstr GT from thread c-list[4]   ← pre-baked
    │
    ▼
Boot.Abstr  (NS[3], 13 instructions, BOOT_ROM_WORDS)
    Instruction [5]:  LOAD  AL, CR0, CR6[4]        ← loads Startup.Config GT
    Instruction [6]:  TPERM AL, CR0, #E
    Instruction [7]:  CALL  AL, CR0, CR0            ← calls Startup.Config
    │
    ▼
Startup.Config.SelfTest()           ← ENTRY POINT after boot
    │
    ├─ PASS ──▶ Startup.Config.Execute()
    │               └─ loads NS[entry_slot] and calls it
    │                       │
    │                       ▼
    │               Configured main abstraction runs
    │
    └─ FAIL ──▶ increment fault_count
                set LED[0] to fault_count & 0x3F
                trigger PP250 restart (zero-instruction reboot)
                    └─ Boot ROM → Boot.Abstr → SelfTest() again
```

Boot.Abstr's instruction [5] reads its own c-list at index 4.  That slot must
contain the Startup.Config GT.  The implementor wires this in
`_initNamespaceTable()` when building the Boot.Abstr lump.

---

## 4. The Startup.Config lump

### 4.1 Lump size

64 words (one SLOT_SIZE allocation).

### 4.2 Permissions

```
E = 1   (callable by Boot.Abstr)
R = 0, W = 0, X = 0, L = 0, S = 0
```

### 4.3 Data region layout

The lump body contains a small structured data area immediately after any code
words.  All words are 32-bit unsigned integers stored at the physical lump
address.

| Word offset | Name            | Default | Description |
|-------------|-----------------|---------|-------------|
| 0           | `entry_slot`    | 3       | NS slot of the main abstraction called by Execute. Default 3 (Boot.Abstr re-entrant — effectively calls the same slot for demonstration). Production systems set this to the application entry slot (e.g. 4 = LED flash, 5 = Salvation). |
| 1           | `config_version`| *const* | Must equal `STARTUP_CONFIG_VERSION` (defined in `boot_image.py` and mirrored in `system_abstractions.js`). A mismatch causes SelfTest to fail with `VERSION_MISMATCH`. |
| 2           | `flags`         | 0       | Reserved; must be zero. |
| 3           | `fault_count`   | 0       | Incremented by SelfTest on each failed boot attempt. Reflected in LED[0]. Reset to 0 by the `Reset` method. |
| 4–63        | `params[0–59]`  | 0       | User-defined startup parameters. Read/written by `ReadParam` / `WriteParam`. |

---

## 5. Methods

Startup.Config exposes 9 methods.  Boot.Abstr calls `SelfTest` by index;
all other methods are available to privileged callers holding the
Startup.Config GT with E-permission.

DR conventions follow the standard Church Machine calling convention:
- **DR0** — return value / status word (0 = ok, non-zero = error code)
- **DR1** — first input argument
- **DR2** — second input argument (where needed)

| # | Method        | DR1 in        | DR2 in  | DR0 out              | Semantics |
|---|---------------|---------------|---------|----------------------|-----------|
| 0 | `SelfTest`    | —             | —       | 0=pass, fault code   | Run all pre-flight checks (see §6). On pass, tail-call `Execute`. On fail, increment `fault_count`, drive LED[0], trigger PP250 restart. |
| 1 | `Execute`     | —             | —       | (never returns normally) | Load the abstraction at `entry_slot`, give it E-permission, and CALL it. On return, propagates DR0. |
| 2 | `GetEntry`    | —             | —       | entry_slot (u32)     | Return `data[0]` (the currently configured entry NS slot). |
| 3 | `SetEntry`    | slot (u32)    | —       | 0=ok, 1=out of range | Validate `slot` is in `[0, NS_TABLE_SIZE)` and that NS[slot] is non-null, then write it to `data[0]`. Takes effect on the next call to `Execute` or the next restart. |
| 4 | `ReadParam`   | key (u32)     | —       | value (u32) or 0xFFFFFFFF on range error | Return `data[4 + key]`. Returns 0xFFFFFFFF if key ≥ 60. |
| 5 | `WriteParam`  | key (u32)     | value (u32) | 0=ok, 1=out of range | Write `value` to `data[4 + key]`. Returns 1 if key ≥ 60. |
| 6 | `Validate`    | —             | —       | status bitmask (u32) | Check mandatory NS slots. Bit N is set if NS[N] is non-null. Mandatory slots are 0, 1, 2, 3; bits for optional slots are set if present. A return value of `0b1111` (0xF) means the foundational quad is complete. |
| 7 | `Version`     | —             | —       | version word (u32)   | Return `STARTUP_CONFIG_VERSION`. Callers can detect a schema incompatibility before calling SelfTest. |
| 8 | `Reset`       | —             | —       | 0=ok                 | Restore factory defaults: set `entry_slot` to 3, `flags` to 0, `fault_count` to 0. Params (words 4–63) are also zeroed. Does not clear the LED — a subsequent successful SelfTest clears LED[0]. |

---

## 6. SelfTest checks

SelfTest runs the following checks in order.  The first failure stops the
sequence, increments `fault_count`, and triggers a restart.

| # | Check | Failure code |
|---|-------|--------------|
| 1 | `data[1]` (config_version) == `STARTUP_CONFIG_VERSION` | `VERSION_MISMATCH` |
| 2 | `data[2]` (flags) == 0 | `BAD_FLAGS` |
| 3 | `data[0]` (entry_slot) is in `[0, NS_TABLE_SIZE)` | `ENTRY_OOB` |
| 4 | NS[entry_slot] is non-null | `ENTRY_NULL` |
| 5 | NS[0] non-null (Boot.NS present) | `NS0_MISSING` |
| 6 | NS[1] non-null (Boot.Thread present) | `NS1_MISSING` |
| 7 | NS[3] non-null (Boot.Abstr present) | `NS3_MISSING` |

On **all checks passing**: LED[0] is cleared (set to 0), and `Execute` is
called as a tail-call.

On **any failure**: `fault_count` (data[3]) is incremented, LED[0] is set to
`min(fault_count, 0x3F)` (clamped to 6 bits for the 6-LED display), and the
PP250 restart convention is triggered (the zero-instruction word at address
0xFA causes the simulator / hardware to reboot).

---

## 7. LED[0] as the FAULT indicator

LED[0] (the lowest-order LED bit, `ledBits & 0x01`) is reserved by
Startup.Config as the fault indicator.

| LED[0] value | Meaning |
|---|---|
| 0 | Last SelfTest passed — system is healthy |
| 1 | One failed boot attempt |
| 2 | Two failed boot attempts |
| N | N failed boot attempts (clamped to 0x3F = 63) |

The fault_count is persistent across restarts (it lives in the config data
region, which is part of the lump and survives PP250 resets).  `Reset()` is
the only way to clear it programmatically.

Bits 1–5 of `ledBits` retain their existing boot-progress semantics (set by
B:00–B:04 as before).  Startup.Config only touches bit 0.

---

## 8. Patching Startup.Config at runtime

To replace Startup.Config without a full reflash:

1. Build a new 64-word lump body with the desired method table and data region.
2. Call `PATCH_LUMP` with the Startup.Config GT and the new lump body.
3. On the next reset (or the next PP250 restart), Boot.Abstr loads the GT from
   thread c-list[4] and calls the new lump.

Constraints:
- The patched lump must respond to method index 0 (`SelfTest`).
- `data[1]` must contain `STARTUP_CONFIG_VERSION` unless the replacement
  SelfTest is version-agnostic.
- The lump size must remain ≤ 64 words (one SLOT_SIZE allocation).

Patching Boot.Abstr (NS[3]) or the thread lump (NS[1]) is **not** required.
That is the whole point of this abstraction.

---

## 9. Capability comparison table

| Capability | Before pre-baking | After pre-baking + Startup.Config |
|---|---|---|
| Change what runs at boot | Patch NS[3] (Boot.Abstr) | `SetEntry(slot)` — no reflash |
| Change startup parameters | No mechanism | `WriteParam(key, value)` |
| Inspect startup health | Only at API level before boot | `Validate()` callable at runtime |
| Count failed boot attempts | No mechanism | `fault_count` in data region; read via `ReadParam(3)` |
| Replace entire startup logic | Patch NS[3] | `PATCH_LUMP` on NS[2] |
| Replace Boot.Abstr firmware | Patch NS[3] | **Not possible** — pre-baked; requires reflash |
| Know schema version | No mechanism | `Version()` |
| Recover from corrupt config | No mechanism | `Reset()` restores factory defaults |

---

## 10. Version constant

```
STARTUP_CONFIG_VERSION = 0x00000001
```

This word is written to `data[1]` when the lump is built.  SelfTest compares
it against the compiled-in constant and faults with `VERSION_MISMATCH` if they
differ.  Increment this value whenever the data region layout (§4.3) changes
in a backward-incompatible way.

---

## 11. Implementation notes for Task #396

The following files must be changed to implement this specification.

### simulator/system_abstractions.js

Add `_bindStartupConfig()` called from `_bindAll()`.  Register 9 methods at
NS slot 2 via `this.registry.bindMethod(2, name, fn)`.  Keep a module-local
`startupConfigState` object with fields mirroring the data region:
`entry_slot`, `config_version`, `flags`, `fault_count`, `params[60]`.

`SelfTest` runs the 7 checks from §6 in order.  On pass it calls `Execute`.
On fail it increments `fault_count`, sets `sim.ledBits &= ~1` then
`sim.ledBits |= (Math.min(state.fault_count, 63) & 1)` for LED[0], then calls
`sim.fault('SELF_TEST', …)` to trigger the reboot path.

`Execute` calls `sim.abstractionRegistry.dispatchMethod(state.entry_slot, …)`
or equivalent.

`Validate` reads the simulator NS table (`sim.memory[sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS]`) for slots 0–3 and returns a bitmask.

### server/boot_image.py

Replace `None` at index 2 in `DEFAULT_ABSTRACTION_CATALOG` with:

```python
("Startup.Config", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
```

In `generate_boot_image()`, allocate a 64-word lump for slot 2.  Write the
data region header: word 0 = 3 (entry_slot), word 1 = STARTUP_CONFIG_VERSION,
word 2 = 0 (flags), word 3 = 0 (fault_count), words 4–63 = 0 (params).
Update `_MANDATORY_NS_SLOTS` to include slot 2.  Bump `BOOT_IMAGE_FORMAT_TAG`.

### simulator/simulator.js

In `_initNamespaceTable()`, remove the free/null early-exit for slot 2.
Build a real NS entry for Startup.Config using the same pattern as other
foundational slots.  Set `nsLabels[2] = 'Startup.Config'`.  Confirm
Boot.Abstr's c-list index 4 is set to the Startup.Config GT after building
the Boot.Abstr lump region.

### tests/test_startup_config.py

One test per method (9 tests), one fault-path test, and one integration test.
See Task #396 plan for full list.
