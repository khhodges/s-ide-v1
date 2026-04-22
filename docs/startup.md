# Startup.Config — Specification

_Church-Turing Meta-Machine startup configuration abstraction_

---

## 1. Background and motivation

### 1.1 Pre-baking Boot.Abstr

The Church Machine boot ROM is a 13-instruction fixed program (BOOT_ROM_WORDS)
that lives in the Boot.Abstr lump at NS slot 3.  The boot sequence (steps
B:00–B:04) loads Boot.Abstr into CR6 with E-permission, then the CPU begins
executing BOOT_ROM_WORDS from CR14 (the code register).

The design is moving toward **pre-baking**: placing Boot.Abstr's GT directly
into Boot.Abstr's own c-list at image-build time (rather than resolving it
dynamically from the NS table at every reset).  This eliminates dynamic NS
lookups and makes the entry point deterministic from reset.

### 1.2 The flexibility gap

Before pre-baking, operators could swap the entire boot behaviour by patching
NS slot 3 (via `PATCH_LUMP`).  After pre-baking Boot.Abstr is firmware — its
physical address is baked into the image.  The system needs a replacement: a
well-defined, patchable abstraction that Boot.Abstr calls immediately, and
which in turn decides what the machine actually does.

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
NS[1]  Boot.Thread      — thread lump; provides the stack and heap region
NS[2]  Startup.Config   — THIS ABSTRACTION (formerly free/null since Task #247)
NS[3]  Boot.Abstr       — 13-instruction firmware; loaded into CR6 at B:03/B:04
NS[4]  LED flash        — first user abstraction (default boot target)
NS[5]  Salvation        — security pipeline entry
NS[6]  Navana           — namespace controller
       …
```

NS slots 0–3 form the **foundational quad**.  All four must be non-null in
every valid boot image.  Adding Startup.Config to this quad requires bumping
`BOOT_IMAGE_FORMAT_TAG` so `validate_boot_image()` rejects stale images.

---

## 3. Boot call chain

Boot.Abstr's 13-instruction BOOT_ROM_WORDS program contains a CALL at
instruction [7].  That CALL targets whatever GT is in Boot.Abstr's **own**
c-list at index 4 (the `CR6[4]` load at instruction [5]).  Startup.Config's
GT is placed in Boot.Abstr's c-list[4] at image-build time.

```
Power-on / Reset
    │
    ▼
B:00  FAULT_RST — clear all CRs and DRs; M-Elevation ON; LED = 0b000001
B:01  LOAD_NS   — load NS[0] into CR15;                   LED = 0b000011
B:02  INIT_THRD — load NS[1] (thread) into CR12;          LED = 0b000111
B:03  INIT_ABSTR — load NS[3] (Boot.Abstr) into CR6 (E); LED = 0b001111
B:04  LOAD_NUC  — set CR14 from CR6 lump header;          LED = 0b111111
    │
    ▼
Boot.Abstr BOOT_ROM_WORDS executes:
  [5]  LOAD  AL, CR0, CR6[4]    ← load Boot.Abstr's own c-list[4]
                                    = Startup.Config GT
  [6]  TPERM AL, CR0, #E        ← grant E-permission
  [7]  CALL  AL, CR0, CR0       ← call Startup.Config
    │
    ▼
Startup.Config.SelfTest()           ← FIRST USER-SPACE ENTRY POINT after boot
    │
    ├─ PASS ──▶ LED stays at 0b111111 (all-on = healthy)
    │            Startup.Config.Execute() called as tail-call
    │               └─ loads NS[entry_slot] and calls it
    │                       │
    │                       ▼
    │               Configured main abstraction runs
    │
    └─ FAIL ──▶ fault_count incremented
                ledBits = fault_count & 0x3F     (6-bit count on all 6 LEDs)
                PP250 restart triggered
                    └─ B:00 → … → Boot.Abstr → SelfTest() again
```

**Key wiring fact**: Startup.Config's GT lives in **Boot.Abstr's c-list[4]**,
not in the thread lump.  The thread lump (NS[1]) only provides the thread stack
and heap region; it has no role in selecting the startup abstraction.

---

## 4. The Startup.Config lump

### 4.1 Lump size

64 words (one SLOT_SIZE allocation).

### 4.2 Permissions

```
E = 1   (callable by Boot.Abstr and privileged callers)
R = 0, W = 0, X = 0, L = 0, S = 0
```

### 4.3 Data region layout

Words in the lump body after the code region form a structured config area.
All words are 32-bit unsigned integers.

| Word | Name              | Default | Writable via        | Description |
|------|-------------------|---------|---------------------|-------------|
| 0    | `entry_slot`      | 3       | `SetEntry`          | NS slot of the main abstraction called by Execute. Default 3. |
| 1    | `config_version`  | *const* | read-only           | Must equal `STARTUP_CONFIG_VERSION`. Mismatch → SelfTest `VERSION_MISMATCH` fault. |
| 2    | `flags`           | 0       | read-only           | Reserved; must remain 0. |
| 3    | `fault_count`     | 0       | SelfTest / `Reset`  | Incremented by SelfTest on each failed boot attempt. Reflected in LED display. |
| 4–63 | `params[0–59]`   | 0       | `WriteParam(k, v)`  | User-defined startup parameters, accessed as `params[k]` where k = 0..59. |

`ReadParam(k)` reads word k directly (k = 0..63).  It covers the full data
region: params 0–3 are the reserved header words and params 4–63 are user data.

`WriteParam(k, v)` only writes words 4–63 (user params).  Attempts to write
k < 4 return error code 2 (`READ_ONLY`).  Use `SetEntry` to change `entry_slot`
and `Reset` to clear `fault_count`.

---

## 5. Methods

Startup.Config exposes **9 methods** (indices 0–8).  Boot.Abstr calls index 0
(`SelfTest`) via the CALL at BOOT_ROM_WORDS[7].  All methods are available to
any caller holding the Startup.Config GT with E-permission.

DR conventions follow the standard Church Machine calling convention:
- **DR0** — return value / status word (0 = ok, non-zero = error code)
- **DR1** — first input argument
- **DR2** — second input argument (where needed)

| # | Method        | DR1 in        | DR2 in  | DR0 out              | Semantics |
|---|---------------|---------------|---------|----------------------|-----------|
| 0 | `SelfTest`    | —             | —       | 0=pass, fault code   | Run all pre-flight checks (§6). On pass, clear fault LED and tail-call `Execute`. On fail, increment `fault_count`, set `ledBits = fault_count & 0x3F`, trigger PP250 restart. |
| 1 | `Execute`     | —             | —       | (propagates callee DR0) | Load NS[entry_slot] with E-permission and CALL it. Returns only if the called abstraction returns. |
| 2 | `GetEntry`    | —             | —       | entry_slot (u32)     | Return `data[0]`. |
| 3 | `SetEntry`    | slot (u32)    | —       | 0=ok, 1=OUT_OF_RANGE, 2=ENTRY_NULL | Validate slot is in `[0, NS_TABLE_SIZE)` and NS[slot] is non-null, then write to `data[0]`. Takes effect on next `Execute` or restart. |
| 4 | `ReadParam`   | key (u32 0–63) | —      | value (u32) or 0xFFFFFFFF=KEY_OOB | Return `data[key]`. Keys 0–3 are the reserved header words; keys 4–63 are user params. |
| 5 | `WriteParam`  | key (u32 4–63) | value (u32) | 0=ok, 1=KEY_OOB, 2=READ_ONLY | Write `value` to `data[key]`. Returns 2 for keys 0–3 (read-only header). Returns 1 for keys ≥ 64. |
| 6 | `Validate`    | —             | —       | status bitmask (u32) | Check each NS slot 0–3. Bit N of the return value is 1 if NS[N] is non-null. A healthy foundational quad returns `0b1111` (0xF). |
| 7 | `Version`     | —             | —       | version word (u32)   | Return `STARTUP_CONFIG_VERSION`. Callers can verify compatibility before calling SelfTest. |
| 8 | `Reset`       | —             | —       | 0=ok                 | Restore factory defaults: `entry_slot` ← 3, `flags` ← 0, `fault_count` ← 0, `params[0..59]` ← 0. Does not change `config_version`. Does not clear the LED display — a subsequent successful SelfTest clears it. |

---

## 6. SelfTest checks

SelfTest runs the following checks in order.  The first failure halts the
sequence, increments `fault_count`, drives the LED display, and triggers a
PP250 restart.

| # | Check | Fault code |
|---|-------|------------|
| 1 | `data[1]` == `STARTUP_CONFIG_VERSION` | `VERSION_MISMATCH` |
| 2 | `data[2]` == 0 (flags reserved zero) | `BAD_FLAGS` |
| 3 | `data[0]` (entry_slot) in `[0, NS_TABLE_SIZE)` | `ENTRY_OOB` |
| 4 | NS[entry_slot] non-null | `ENTRY_NULL` |
| 5 | NS[0] non-null (Boot.NS present) | `NS0_MISSING` |
| 6 | NS[1] non-null (Boot.Thread present) | `NS1_MISSING` |
| 7 | NS[3] non-null (Boot.Abstr present) | `NS3_MISSING` |

On **all checks passing**: `ledBits = 0b111111` (all LEDs on, matching the
B:04 boot-complete state), and `Execute` is called as a tail-call.

On **any failure**: `fault_count` is incremented, then:

```
ledBits = fault_count & 0x3F
```

This encodes `fault_count` as a 6-bit binary number across the 6-LED display.
One failed attempt → `0b000001` (LED[0] only); two → `0b000010` (LED[1] only);
three → `0b000011` (LEDs 0 and 1); and so on up to 63 (`0b111111`).  Values
above 63 wrap (the stored `fault_count` continues counting but the display is
clamped to 6 bits).

---

## 7. LED fault display

The 6-LED display uses `ledBits` as a 6-bit register.  Startup.Config takes
full control of the display when SelfTest runs:

| LED display value (`ledBits`) | Meaning |
|---|---|
| `0b111111` (63) | SelfTest passed — system healthy |
| `0b000001` (1)  | 1 failed boot attempt |
| `0b000010` (2)  | 2 failed boot attempts |
| `0b000011` (3)  | 3 failed boot attempts |
| …               | … |
| `0b111110` (62) | 62 failed boot attempts |

The boot sequence (B:00–B:04) uses the LED display as a progress bar during
hardware initialisation.  SelfTest runs after B:04 completes and is the first
user-space code to control the LEDs; its use of the full display does not
conflict with boot-progress semantics.

`Reset()` does not modify `ledBits`.  A subsequent successful SelfTest is the
only way to restore the display to `0b111111`.

---

## 8. Patching Startup.Config at runtime

To replace Startup.Config without a full reflash:

1. Build a new 64-word lump body with the desired method table and data region.
2. Call `PATCH_LUMP` with the Startup.Config GT and the new lump body.
3. On the next PP250 restart (or full reset), Boot.Abstr loads its c-list[4]
   (unchanged — it still points to NS slot 2) and calls the new lump.

Constraints:
- The patched lump must respond to method index 0 (`SelfTest`).
- `data[1]` must equal `STARTUP_CONFIG_VERSION` unless the replacement
  SelfTest is version-agnostic.
- The lump size must remain ≤ 64 words (one SLOT_SIZE allocation).

Patching Boot.Abstr (NS[3]) or the thread lump (NS[1]) is **not** required.

---

## 9. Capability comparison table

| Capability | Before pre-baking | After pre-baking + Startup.Config |
|---|---|---|
| Change what runs at boot | Patch NS[3] (Boot.Abstr) | `SetEntry(slot)` — no reflash |
| Change startup parameters | No mechanism | `WriteParam(key, value)` |
| Inspect startup health | Only at API level before boot | `Validate()` callable at runtime |
| Count failed boot attempts | No mechanism | `ReadParam(3)` → `fault_count` |
| Show fault count on LEDs | No mechanism | Automatic: `ledBits = fault_count & 0x3F` |
| Replace entire startup logic | Patch NS[3] | `PATCH_LUMP` on NS[2] |
| Replace Boot.Abstr firmware | Patch NS[3] | **Not possible** — pre-baked; requires reflash |
| Know schema version | No mechanism | `Version()` |
| Recover from corrupt config | No mechanism | `Reset()` restores factory defaults |

---

## 10. Version constant

```
STARTUP_CONFIG_VERSION = 0x00000001
```

Written to `data[1]` at lump build time.  SelfTest compares it against the
compiled-in constant and faults with `VERSION_MISMATCH` if they differ.
Increment this value whenever the data region layout (§4.3) changes in a
backward-incompatible way.

---

## 11. Implementation notes for Task #396

The following files must be changed to implement this specification.

### simulator/system_abstractions.js

Add `_bindStartupConfig()` called from `_bindAll()`.  Register 9 methods at
NS slot 2 via `this.registry.bindMethod(2, name, fn)`.  Keep a module-local
`startupConfigState` object with fields mirroring the data region:
`entry_slot` (default 3), `config_version` (= STARTUP_CONFIG_VERSION),
`flags` (0), `fault_count` (0), `params` (60-element array of zeros).

`SelfTest` runs the 7 checks from §6 in order.  On pass: set
`sim.ledBits = 0x3F` then call `Execute`.  On fail: increment
`startupConfigState.fault_count`, set `sim.ledBits = fault_count & 0x3F`,
then call `sim.fault('SELF_TEST', faultCode)` to trigger the PP250 restart.

`Execute` calls `sim.abstractionRegistry.dispatchMethod(state.entry_slot, …)`
or the equivalent simulator dispatch path.

`ReadParam(k)`: return `data[k]` for k in 0–63; return `0xFFFFFFFF` for k ≥ 64.

`WriteParam(k, v)`: write `data[k]` only for k in 4–63; return error 2 for
k in 0–3; return error 1 for k ≥ 64.

`Validate` checks `sim.memory[sim.NS_TABLE_BASE + N * sim.NS_ENTRY_WORDS]` for
N = 0–3 and returns the non-null bitmask.

### server/boot_image.py

Replace `None` at index 2 in `DEFAULT_ABSTRACTION_CATALOG` with:

```python
("Startup.Config", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
```

Add `STARTUP_CONFIG_NS_SLOT = 2` and `STARTUP_CONFIG_VERSION = 0x00000001`
constants.  Update `_MANDATORY_NS_SLOTS` to include slot 2.

In `generate_boot_image()`, allocate a 64-word lump for slot 2.  Write data
region: word 0 = 3 (entry_slot), word 1 = STARTUP_CONFIG_VERSION, word 2 = 0,
word 3 = 0, words 4–63 = 0.  Populate a non-zero NS entry at slot 2.

In the Boot.Abstr lump build, set c-list[4] to the Startup.Config GT (the
newly allocated NS slot 2 GT with E-permission).

Bump `BOOT_IMAGE_FORMAT_TAG` to mark the new slot-2 / c-list-4 layout.

### simulator/simulator.js

In `_initNamespaceTable()`, remove the free/null early-exit for slot 2.  Build
a real NS entry using the same pattern as other foundational slots.  Set
`nsLabels[2] = 'Startup.Config'`.  After building the Boot.Abstr lump (which
writes `clistGTs` into the c-list region), overwrite `c-list[4]` with the
Startup.Config GT.  Add a `slotSizes[2] = 64` entry so the allocator gives
slot 2 a proper 64-word lump.

### tests/test_startup_config.py

One test per method (9 tests), one fault-path test (corrupt a mandatory NS
slot, call SelfTest, verify `fault_count` = 1 and `ledBits` = 1), and one
integration test that runs a full simulated boot and checks the Gate Log for
a `Startup.Config.SelfTest` entry followed by `Startup.Config.Execute`.
All existing tests must continue to pass.
