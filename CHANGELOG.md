# Church Machine IDE — Release History

---

## Docs 1.2 — 2026-05-15

### Documentation corrections (audit items H-2 and M-1)

- **H-2 — Max lump size** (`docs/Lump-Architecture.md`): corrected Release 1
  maximum from n ≤ 14 (16 384 words) to **n ≤ 13 (8 192 words)**, matching
  `MAX_EXP = 13` in `simulator/app-lump-editor.js`. n = 14 is now explicitly
  noted as architecturally reserved. Mint validation gate updated accordingly
  (`n-6 ≤ 7`). Boot.NS (n = 14, pre-synthesised system lump) separated into
  its own table as a system-level exception not subject to the user size gate.
- **M-1 — mLoad step count** (`replit.md`, `docs/mload.md`): removed the
  "8-step" fixed step count from `replit.md`; replaced with a functional
  description. Added a supersession note to `docs/mload.md` stating that the
  Release 1 PDF `ctmm-r1-10-mload.pdf` title "Five-step capability validation
  pipeline" is superseded — no specific step count is part of the architecture
  definition.

---

## Release 1.2 — 2026-05-14

### Summary

NS table integrity fix. Removes illegal pool NS entries (slots 50-63) written
by a previous task agent, rewrites Constants.Add() to return a plain data value
(not a malformed GT), adds Constants.Get(), and introduces AbstractGTManager as
the correct home for Abstract GT lifecycle tracking.

### Foundational rules enforced

1. NS table is **only** for Inform (gtType=1) and Outform (gtType=2) abstractions.
2. GTs live in c-lists (CRs at runtime, lump c-list area at rest). Never in the NS table.
3. Abstract GT pool memory is internal to AbstractGTManager; no NS entries pierce it.
4. `writeNSEntry()` now rejects gtType=3 (Abstract GT) with a hard fault.

### Changes

#### Simulator JS (scope: no FPGA binaries touched)

| File | Change |
|---|---|
| `simulator/boot_uploads.js` | Removed `pool-W` capability from Constants c-list boot entry; added `Get` method stub |
| `simulator/simulator.js` | Removed pool block from `lazyLoad()` that wrote NS slots 50-63; added `writeNSEntry()` guard (rejects gtType=3); Node.js shim for `AbstractGTManager`; instantiates `abstractGTManager` in constructor |
| `simulator/system_abstractions.js` | Rewrote `Constants.Add()` to Pi pattern (returns plain integer data value, not malformed GT); added `Constants.Get()` method |
| `simulator/app-run.js` | Fixed two import-path field defaults (undefined → 0); clamped localStorage restore to valid range |
| `simulator/app-lumps.js` | Updated pool display section for new Constants.Add/Get interface |
| `simulator/abstract_gt_manager.js` | **New file.** `AbstractGTManager` class — Map keyed by 7-bit `gt_seq`; `createAtoken`, `get`, `release`, `live`, `GC` methods; never touches NS table |

#### Metadata (00001200 / Constants)

| File | Change |
|---|---|
| `server/lumps/00001200.json` | `Add`/`Get` method descriptions updated; `pool_w`/`pool_ns_base`/`pool_size` fields removed; `cc` stays 2 (matches binary header — slot 1 is NULL GT after boot) |
| `server/lumps/manifest.json` | Same pool field removals; `Get` method entry added; `cc` stays 2 |

#### Documentation

| File | Change |
|---|---|
| `docs/plans/ns-table-integrity.md` | New plan doc — foundational rules, AbstractGTManager spec, all 9 fixes |

### Test results

| Suite | Before | After |
|---|---|---|
| lump-consistency | 106 passed | **106 passed** |
| assembler-tests | 862 passed | **862 passed** |
| boot-image-matches-sim | 6 passed | **6 passed** |
| boot-image-loads-and-boots | **5 failed** (pool wrote NS slot 50, pushing nsCount to 51) | **5 passed** |
| fault-recovery-tests | 192 passed | **192 passed** |

---

## Release 1.1 — 2026-05-03

### Summary

LUMP metadata integrity overhaul. Establishes automated consistency gate,
formalises the floating-lump concept as a first-class architectural pattern,
and introduces formal change control (this document).

### Changes

#### Metadata corrections

| File | Change |
|---|---|
| `manifest.json` — TestBoundary (00006000) | `cw` 0 → 1, `cc` 0 → 9 (was stale; binary had real code and 9 c-list slots) |
| `manifest.json` — TestLazy (00006100) | `cw` 0 → 1 (binary had a LOAD instruction) |
| `manifest.json` — TestConsistent (00006200) | `cw` 0 → 1, `cc` 0 → 1 (binary had real code + live LED Abstract GT in c-list) |
| `manifest.json` — TestInconsistent (00006300) | `cw` 0 → 1, `cc` 0 → 1 |
| `manifest.json` — WordString (ab1e86af) | `cw` 281 → 294 (manifest was 13 words behind the compiled binary) |
| `00006000.json` sidecar | `cw` 0 → 1, `cc` 0 → 9 |
| `00006100.json` sidecar | `cw` 0 → 1 |
| `00006200.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |
| `00006300.json` sidecar | `cw` 0 → 1, `cc` 0 → 1 |

#### File removals

| File | Reason |
|---|---|
| `server/lumps/00000003.json` | Orphan sidecar. Described a historical 256-word, cc=18 Boot.Abstr that no longer exists. No matching `.lump` on disk. Server already ignored it in favour of `00000300.json`. |

#### New sidecar files created

Six manifest entries had no per-lump `.json` sidecar. Sidecars created:
`00000c00.json` (LED), `00001000.json` (SlideRule), `00001001.json` (SlideRuleHS),
`00001f00.json` (Tunnel), `00130000.json` (Loader), `00002000.json` (Keystone).

#### Schema additions (manifest.json)

| Field | Applies to | Meaning |
|---|---|---|
| `variant_group` | SlideRule, SlideRuleHS | Both share `"variant_group": "sliderule"`. Two entries may claim the same `ns_slot` if and only if they share a non-null `variant_group`. The boot image installs exactly one at a time; the other is an alternative implementation. |
| `ns_slot_policy` | WordString | `"ns_slot_policy": "dynamic"` — formally declares the floating-lump pattern (see Architecture section below). |

#### Architecture: floating lumps formalised

A **floating lump** is a lump with `ns_slot: null` and `ns_slot_policy: "dynamic"`.
It has no fixed NS slot at boot. The Loader fetches its binary on first use,
Mint allocates an ephemeral NS slot, and the lump is installed there. The slot
number may differ between runs. The caller holds a GT — not a slot number —
so the slot's ephemerality is invisible to callers.

WordString (ab1e86af) is the prototype. Any abstraction that is not on the
cold-boot critical path should be a floating lump to conserve NS table space.

Slot-assignment rule (machine-enforceable):

| `ns_slot` | `ns_slot_policy` | Classification |
|---|---|---|
| integer | absent | Boot-resident — fixed slot, placed by boot image generator |
| `null` | `"dynamic"` | Floating — allocated by Mint on first use; may be evicted |
| `null` | absent | **Error** — caught by R9 in the consistency test |

#### Automated consistency gate

New test file: `tests/lump/test_lump_consistency.py`

Eleven rules enforced on every run:

| Rule | What it checks |
|---|---|
| R1 | Every `.lump` has valid header magic (0x1F) |
| R2 | File size in words == header-declared lump_size |
| R3 | Every `.lump` token has a manifest.json entry |
| R4 | No orphan sidecar `.json` without a matching `.lump` |
| R5 | manifest.cw / cc / lump_size == binary header |
| R6 | sidecar.cw / cc / lump_size == binary header |
| R7 | sidecar fields agree with manifest where both exist |
| R8 | No duplicate ns_slot values unless all claimants share a `variant_group` |
| R9 | ns_slot=null entries carry `ns_slot_policy: "dynamic"` |
| R10 | Every manifest entry with lump_size has a `.lump` file on disk |
| R11 | Every manifest entry with lump_size has a sidecar `.json` on disk |

#### Documentation updates

`docs/CM_LUMP_SPECIFICATION.md`, `docs/Lump-Architecture.md`, and
`docs/json-information.md` bumped from v1.0 to v1.1. Floating-lump concept
and updated schema fields added to all three.

---

## Release 1.0 — 2026-04-29

Initial documented release.

- Lump binary format specified: header word `[31:27]=magic [26:23]=n-6 [22:10]=cw [9:8]=typ [7:0]=cc`.
- manifest.json schema defined covering `token`, `abstraction`, `ns_slot`, `lump_size`, `cw`, `cc`, `methods`, `grants`, `capabilities`.
- Boot image generator (`server/boot_image.py`) producing 65 536-byte image with NS table at `memory.length - 0x400`.
- Boot-resident lumps: Boot.Abstr (NS[3]), LED (NS[12]), Constants (NS[18]), Loader (NS[19]), Tunnel (NS[31]), Keystone (NS[32]).
- Test lumps: TestBoundary (NS[96]), TestLazy (NS[97]), TestConsistent (NS[98]), TestInconsistent (NS[99]).
- WordString (ab1e86af) present in repository with `ns_slot: null` (undocumented floating pattern).
- Editor source persistence implemented (localStorage auto-save per NS slot).

---

## Change Control Rules — effective Release 1.1

The following rules apply to every commit touching a lump binary, manifest,
or sidecar from this release onwards. No exceptions.

### Rule 1 — Consistency gate must pass

`tests/lump/test_lump_consistency.py` must pass (all 11 rules, zero failures)
before any lump-related change is merged.

To run locally:
```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

### Rule 2 — Binary change requires metadata update

Any recompilation or hand-edit of a `.lump` binary that changes `cw`, `cc`,
or `lump_size` MUST be accompanied by:

1. An update to the matching `<token>.json` sidecar.
2. An update to the `manifest.json` entry for that token.
3. Both changes in the same commit as the binary.

### Rule 3 — New lump requires three files

Adding a new lump to the repository requires:

1. `<token>.lump` — the binary.
2. `<token>.json` — the sidecar (at minimum: token, abstraction, ns_slot or ns_slot_policy, lump_size, cw, cc, grants).
3. An entry in `manifest.json`.

If the lump is floating (no fixed boot slot), `ns_slot` must be `null` and
`ns_slot_policy` must be `"dynamic"`.

### Rule 4 — NS slot collision requires variant_group

If two lumps claim the same `ns_slot` (alternative implementations), both
entries MUST carry the same non-null `variant_group` string. The consistency
test (R8) enforces this.

### Rule 5 — CHANGELOG entry required

Every structural change — new lump, binary rebuild, schema field addition,
metadata correction — MUST add an entry to this file under the current
release heading before the change is considered complete.

### Rule 6 — Spec documents bump version

If a change affects the manifest schema, the lump header format, or the
floating-lump policy, the version line in the affected spec document
(`CM_LUMP_SPECIFICATION.md`, `Lump-Architecture.md`, `json-information.md`)
must be bumped to the new release number.
