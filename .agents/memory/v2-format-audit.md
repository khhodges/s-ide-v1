---
name: v2.0 Hardware Format Audit
description: Key non-obvious facts found during the v2.0 GoldenDetails.md inconsistency audit — cond codes, opcode gaps, integrity32 formula, simulator/hardware NS divergence.
---

## Condition Codes — ARM ordering (not isa_reference.md ordering)

`hw_types.py` CondCode and `simulator/assembler.js` both use ARM-compatible encoding.
`docs/isa_reference.md` has a DIFFERENT ordering (LT=2, GE=5, CS=6 ...) — it is WRONG.
GoldenDetails.md v2.0 was corrected to match hardware:

| Code | Mnemonic | | Code | Mnemonic |
|------|----------|-|------|----------|
| 2 | CS | | 10 | GE |
| 3 | CC | | 11 | LT |
| 4 | MI | | 12 | GT |
| 5 | PL | | 13 | LE |

**Why:** Hardware synthesis and assembler both use ARM order. isa_reference.md was authored independently and got it wrong. Always verify against hw_types.py.

## Opcode Gaps — Turing opcodes start at decimal 16 (0x10), not 10

Church opcodes: 0–9 (0b0000–0b1001).
Unassigned Church extension reserved: 10–15 (0b1010–0b1111) → FAULT.
Turing opcodes: 16–25 (0b10000–0b11001, i.e. DREAD through SHR).
OPCODE_WORD = 30 (0x1E) — inline data constant → FAULT if executed.
LUMP magic = 31 (0x1F) → FAULT.

**Why:** The 5-bit opcode field with high bit set distinguishes Turing from Church at the bit level. Opcodes 10–15 are the "high-Church" reserved zone with the high bit still clear.

## integrity32 formula — ROL-XOR, NOT CRC-16

```python
w1_masked = w1 & ~((1 << 30) | (1 << 31))   # zero g_bit[30] and f_flag[31]
result = ROL32(w0, 7) ^ ROL32(w1_masked, 13) ^ 0xDEADBEEF
```

**Why:** It's a custom 32-bit linear XOR check (single LUT layer in FPGA synthesis). NOT CRC-16/CCITT. The formula is in `hardware/integrity32.py`.

## v2.0 g_bit and f_flag masking rule

Both g_bit[30] and f_flag[31] in NS SLOT W1 are masked before integrity32.
- g_bit: toggled (inverted) by GC — never independently set or cleared.
- f_flag: can be updated by IDE (e.g. Outform promoted from Far to local) without resealing.
Mask: `G_BIT_MASK_32 = 0xFFFFFFFF ^ (1 << 30) ^ (1 << 31)`
Old code masks only bit 28 (pre-v2.0 g_bit position) — needs updating everywhere.

## Simulator NS entry format diverges from hardware WORD2_LAYOUT

Simulator `makeVersionSeals()` produces a "word2_seals" format: `gt_seq[31:25] | seal[15:0]`.
Hardware NS SLOT W1 (WORD2_LAYOUT): `f_flag[31] | g_bit[30] | gt_seq[29:21] | limit_offset[20:0]`.
These are incompatible. The simulator and hardware cannot round-trip NS entries at binary level.
This is a pre-existing divergence, not introduced by v2.0.
