---
name: NS entry stride
description: Each namespace slot is exactly 4 words (16 bytes) — not 3. Confirmed in _make_ns_entry return value.
---

Each NS entry returned by `_make_ns_entry` is **4 words**:

```
[location, word1_authority, word2_integrity, abstract_gt]
```

- `+0`  location / lump base byte address
- `+4`  word1_authority: limit_offset[20:0] | gt_seq[6:0] | g_bit | spare
- `+8`  word2_integrity: integrity32(W0, W1 with g_bit masked)
- `+12` abstract_gt: permission-profile annotation (M-bit gated)

**Stride = 4 words = 16 bytes per slot. Slot N starts at byte address N × 16.**

**Why:** The abstract_gt word (word 3) is the permission-profile annotation added to make M-bit gating and capability introspection work without reading the lump header itself. It was always there; the mistake was counting only the first three words.

**How to apply:** Any time you calculate NS table size, multiply slot count by 4 (not 3). DEMO_NAMESPACE with 23 slots = 92 words = 368 bytes. Any time you reference a slot's word offsets in code, use +0/+4/+8/+12 (byte) or +0/+1/+2/+3 (word index).
