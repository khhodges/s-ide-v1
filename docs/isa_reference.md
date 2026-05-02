# Church Machine ISA Reference

**Version 1.0 — May 2026**
**Authoritative sources: `simulator/simulator.js`, `simulator/assembler.js`, `hardware/*.py`**

This document is the single definitive specification for all 20 Church Machine
instructions. Where existing documents conflict with what is stated here, this
document takes precedence. Simulator/hardware deviations are called out
explicitly; see `docs/HARDWARE-DEVIATIONS.md` for the full deviation register.

---

## 1. Instruction Word Format

Every instruction is a 32-bit word with a fixed layout:

```
 31      28 27    24 23    20 19    16 15             1 0
┌──────────┬─────────┬────────┬────────┬────────────────┬───┐
│  opcode  │  cond   │  fld_a │  fld_b │     imm15      │ 0 │
│  (4 b)   │  (4 b)  │  (4 b) │  (4 b) │    (15 b)      │(1)│
└──────────┴─────────┴────────┴────────┴────────────────┴───┘
```

- **Bit 0** is always 0 (word-aligned; a 1 here is a FAULT).
- **opcode** (bits 31:28): selects one of the 20 instructions (0–19). Values 20–15 are reserved and fault.
- **cond** (bits 27:24): condition under which the instruction executes (see §2).
- **fld_a** (bits 23:20): first register operand — CR or DR index depending on instruction.
- **fld_b** (bits 19:16): second register operand — CR or DR index depending on instruction.
- **imm15** (bits 15:1): 15-bit immediate; interpretation varies per instruction.

The **all-zero word** `0x00000000` (opcode=LOAD, cond=EQ, all fields zero) is
accepted by the assembler as `HALT` or `NOP`. The simulator treats an all-zero
instruction word encountered during normal execution as a warm reboot (not a halt
and not a fault). See §4 (HALT/NOP note) for implications.

---

## 2. Condition Codes

The `cond` field gates execution on the current flag state. If the condition is
false, the instruction is skipped (PC advances, no side effects, no faults).

| Code | Mnemonic | Meaning                    | Flags tested        |
|------|----------|----------------------------|---------------------|
|  0   | EQ       | Equal / Zero               | Z = 1               |
|  1   | NE       | Not equal / Non-zero       | Z = 0               |
|  2   | LT       | Less than (signed)         | N ≠ V               |
|  3   | LE       | Less than or equal (signed)| Z = 1 or N ≠ V      |
|  4   | GT       | Greater than (signed)      | Z = 0 and N = V     |
|  5   | GE       | Greater than or equal      | N = V               |
|  6   | CS / CC  | Carry set                  | C = 1               |
|  7   | CC       | Carry clear                | C = 0               |
|  8   | MI       | Minus / Negative           | N = 1               |
|  9   | PL       | Plus / Non-negative        | N = 0               |
| 10   | VS       | Overflow set               | V = 1               |
| 11   | VC       | Overflow clear             | V = 0               |
| 12   | HI       | Unsigned higher            | C = 1 and Z = 0     |
| 13   | LS       | Unsigned lower or same     | C = 0 or Z = 1      |
| 14   | AL       | Always (unconditional)     | (none)              |
| 15   | NV       | Never (no-op)              | (none — always skip)|

`AL` (always) is the normal unconditional form. `NV` is a no-op regardless of flags.

---

## 3. Register Files

### 3.1 Capability Registers (CR0–CR15)

Sixteen 64-bit capability registers. Each holds a **Guard Token (GT)**: a
type-tagged, permission-bearing, hardware-verified reference to an object.

| Range    | Name                 | Notes                                          |
|----------|----------------------|------------------------------------------------|
| CR0–CR5  | User CRs             | General-purpose; caller context preserved by CALL |
| CR6      | C-list root          | E-permission token for current abstraction's c-list; re-derived by CALL/RETURN |
| CR7–CR11 | User CRs             | General-purpose; caller context preserved by CALL |
| CR12     | Thread stack         | Privileged; system-wide; unchanged by CALL/RETURN; only writeable via CHANGE |
| CR13     | Interrupt handler    | Privileged; system-wide; only writeable via SWITCH (hardware: PassKey gate) |
| CR14     | Code register (CLOOMC) | Privileged; per-thread; set by CALL, re-derived by RETURN; X-only |
| CR15     | Namespace root       | Privileged; per-thread; only writeable via SWITCH (hardware: PassKey gate) |

**Privilege zone**: CR12–CR15 cannot appear as operands in LOAD, SAVE, TPERM,
LAMBDA instructions. CALL, RETURN, CHANGE, and SWITCH are the only Church-domain
instructions that touch them.

### 3.2 Data Registers (DR0–DR15)

Sixteen 32-bit integer registers.

> **A.1 — DR0 is hardwired zero.**
>
> DR0 reads as 0 at all times. After every instruction that produces a result,
> the simulator unconditionally writes 0 to DR0 (`simulator.js` line 2748:
> `this._writeDR(0, 0)`). Writes targeting DR0 are silently discarded — the
> value is immediately overwritten back to 0.
>
> This enables two universal idioms, replacing MOV and load-immediate opcodes
> that would otherwise need their own encodings:
>
> | Idiom | Instruction | Effect |
> |-------|-------------|--------|
> | Register copy | `IADD DRd, DR0, DRs` | DRd ← DRs |
> | Load immediate | `IADD DRd, DR0, #k` | DRd ← k (0 ≤ k ≤ 16383) |
>
> Any instruction that writes a computed result into DR0 (e.g., `IADD DR0, DR1, DR2`)
> always reads back 0 on the next instruction. This is not a bug — it is the
> intended architectural property. Do not use DR0 as a scratch register.

### 3.3 Permission Bits (GT word0)

The permission field of a GT encodes the following access rights:

| Bit | Symbol | Meaning                                      |
|-----|--------|----------------------------------------------|
|  30 | E      | Execute — may call the abstraction            |
|  29 | S      | Save — may store a GT into this object's c-list |
|  28 | L      | Load — may load a GT from this object's c-list |
|  27 | X      | Code — execute raw instructions from lump memory |
|  26 | W      | Write — may write data words into lump memory |
|  25 | R      | Read — may read data words from lump memory   |
|  31 | B      | Busy — object lock; clearable by TPERM B-modifier |

**Domain purity rule**: X may not coexist with L, S, or E in the same GT's
effective permission set. A GT that would combine X with any of L/S/E is invalid
and causes TPERM to fault with `TPERM_RSV` when the combination is tested.

---

## 4. HALT / NOP (all-zero word)

```
Encoding: 0x00000000
Assembler aliases: HALT, NOP
```

The all-zero word is architecturally the instruction `LOAD AL, CR0, CR0, #0`
— a conditional LOAD that would load CR0 from `CR0[0]`. In practice, an
all-zero instruction word is used to mark the end of a code region.

**Simulator behaviour:** an all-zero word encountered during execution triggers
a warm reboot sequence, not a halt. Execution does not pause cleanly; the boot
ROM re-runs. Writers of code lumps should never allow execution to fall through
to an all-zero word unless a reboot is the intended outcome.

---

---

## 5. Flag Behaviour — Quick Reference

Four flags: **N** (negative), **Z** (zero), **C** (carry), **V** (overflow).

> **A.2 — BFEXT and BFINS do write flags: N and Z reflect the result; C and V are always cleared.**
>
> Hardware (`core.py` lines 1140–1143, 1169–1172) sets N = result[31],
> Z = (result == 0), C = 0, V = 0 for both instructions. The simulator
> (`_execBfext`, `_execBfins`) matches this behaviour.
>
> This means a BFEXT result can be tested directly with a conditional branch:
>
> ```
> BFEXT  DR1, DR2, 0, 8      ; extract byte — Z = 1 if byte is zero
> BRANCH EQ, handle_zero     ; correctly tests the extracted byte
> ```
>
> Note that C and V are **cleared**, not preserved. Any preceding instruction's
> carry or overflow flag is lost after BFEXT or BFINS.

Flag-writing summary across all 20 instructions:

| Instruction | N | Z | C | V | Notes |
|-------------|---|---|---|---|-------|
| LOAD        | — | — | — | — | |
| SAVE        | — | — | — | — | |
| CALL        | — | — | — | — | |
| RETURN      | — | — | — | — | |
| CHANGE      | — | — | — | — | |
| SWITCH      | — | — | — | — | |
| TPERM       | ✓ | ✓ | 0 | 0 | N = !Z; C and V always cleared |
| LAMBDA      | — | — | — | — | |
| ELOADCALL   | — | — | — | — | |
| XLOADLAMBDA | — | — | — | — | |
| DREAD       | — | — | — | — | |
| DWRITE      | — | — | — | — | |
| BFEXT       | ✓ | ✓ | 0 | 0 | N = result[31]; Z = (result==0); C and V cleared — see A.2 |
| BFINS       | ✓ | ✓ | 0 | 0 | N = result[31]; Z = (result==0); C and V cleared — see A.2 |
| MCMP        | ✓ | ✓ | ✓ | ✓ | Subtraction flags: a − b; no result register |
| IADD        | ✓ | ✓ | ✓ | ✓ | Addition flags |
| ISUB        | ✓ | ✓ | ✓ | ✓ | Subtraction flags |
| BRANCH      | — | — | — | — | Reads flags, never writes them |
| SHL         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out (source[32-shamt], 0 if shamt=0); V always 0. Hardware confirmed (Task #857) |
| SHR         | ✓ | ✓ | ✓ | 0 | C = last bit shifted out (source[shamt-1], 0 if shamt=0); imm[5]=0→LSR, imm[5]=1→ASR (sign-extend). V always 0. Hardware confirmed (Task #857) |

---

## 6. Cross-Cutting Encoding Rules

### A.3 — SHR: bit 5 selects ASR vs LSR; A.4 — BRANCH: bit 14 is the sign bit

> **A.3 — SHR imm15[5] = mode select.**
>
> `SHR DRd, DRs, #amt` encodes the shift amount in `imm15[4:0]` (0–31).
> `imm15[5]` selects the fill mode:
>
> | imm15[5] | Mode | Fill bit | Assembler suffix |
> |----------|------|----------|-----------------|
> | 0        | LSR  | 0        | (none)          |
> | 1        | ASR  | sign bit (DRs[31]) | `ASR` |
>
> Assembler syntax: `SHR DR1, DR2, #4` (LSR) or `SHR DR1, DR2, #4, ASR` (ASR).
> C = last bit shifted out. V = 0 always.
>
> **Simulator/hardware deviation (D-12, open):** The hardware currently implements
> LSR only (C = 0, no ASR mode). The simulator implements both correctly.
> Task #857 tracks the hardware fix.

> **A.4 — BRANCH: bit 14 of imm15 is the sign bit.**
>
> BRANCH uses all 15 bits of the imm15 field as a signed PC-relative word offset:
>
> ```
> soff  = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm   ; sign-extend bit 14
> target = current_PC + soff                            ; word addressing
> ```
>
> Range: **−16384 to +16383 words** (±65536 bytes on byte-addressed hardware).
>
> Hardware sign-extension (Amaranth): `Cat(immediate, immediate[14].replicate(17))`
> then `nia += sign_extend(imm) × 4` — equivalent; byte vs word addressing only.
>
> **Key offsets:**
>
> | Offset | Effect |
> |--------|--------|
> | `#0`   | **Infinite loop** — branches back to itself (target = current PC) |
> | `#1`   | Fall-through — target = current_PC + 1 = next instruction (effectively a NOP branch) |
> | `#-1`  | Step back — target = previous instruction |
>
> **Assembler label resolution:** labels resolve at assemble time as
> `offset = label_word_index − branch_word_index`. The assembler is two-pass,
> so forward references (label appears after the branch) are legal. After
> encoding, every BRANCH imm is bounds-checked to fit in −16384..+16383;
> out-of-range offsets are a hard assembler error.
>
> **Runtime bounds:** the simulator faults immediately with BOUNDS if the target
> is outside the loaded memory image. Hardware detects the violation on the next
> instruction fetch via the CR14 code fence (`fetch_bounds_fault`).
>
> **Condition code is mandatory.** There is no bare `BRANCH label` form — the
> condition code is always present in the word encoding. Use `BRANCH AL, label`
> for an unconditional jump, or the alias mnemonics: `BRANCHEQ`, `BRANCHNE`,
> `BRANCHLT`, `BRANCHGE`, `BRANCHGT`, `BRANCHLE`, etc.

---

### A.5 — CALL: 1-based method index; A.6 — ELOADCALL: split imm15

> **A.5 — CALL imm15 is 1-based: user method index N encodes as imm15 = N + 1.**
>
> imm15 = 0 is the fast-path shorthand: NIA = lump_base + 4 (word 1, first
> instruction in the lump). The method table is bypassed entirely. This is the
> correct encoding for single-entry-point abstractions.
>
> imm15 > 0 is a table lookup: hardware reads `memory[lump_base + imm15 × 4]`
> to get the callee's first instruction word offset, then sets
> NIA = lump_base + entry × 4. A zero table entry → PRIVATE_METHOD FAULT.
>
> | What you write | imm15 encoded | Hardware does |
> |----------------|---------------|---------------|
> | `CALL CRn` (no selector) | 0 | Fast path: NIA = lump_base + 4 |
> | `CALL CRn, 0` | 1 | Table entry [1]: user method index 0 |
> | `CALL CRn, 1` | 2 | Table entry [2]: user method index 1 |
> | `CALL CRn, N` | N + 1 | Table entry [N+1]: user method index N |
>
> Assembler: named methods (`CALL CRn, MethodName`) are resolved from the
> registered method conventions table and encoded as `imm15 = method.index + 1`.
> Dot-notation (`CALL SlideRule.Multiply`) resolves the object binding and method
> name in one step. Numeric selector range: 0–16383 (imm15 range: 1–16384).
>
> **Disassembly note:** a disassembled CALL showing imm15 = 3 means user method
> index 2, not 3. Always subtract 1 from the raw imm15 field to get the user-facing
> method selector.

> **A.6 — ELOADCALL imm15 is split into two fields.**
>
> ```
> imm15[14:8]  =  method index (7 bits, 0–127)    — same 1-based encoding as CALL
> imm15[7:0]   =  c-list row   (8 bits, 0–255)    — word offset into CRsrc c-list
> ```
>
> ELOADCALL atomically loads the GT at `CRsrc[row]` into the destination CR and
> calls it with the given method index. The method index is encoded identically
> to CALL (0 = fast path, N+1 = user method N).
>
> **Backward compatibility:** old programs that encoded `ELOADCALL CRd, CRs, #N`
> with a simple row number stored the row in bits[7:0] and left bits[14:8] = 0.
> Method index 0 → fast path — behaviour is identical to the pre-split encoding.
>
> Valid ranges (enforced by assembler and checked at assembly time):
> - c-list row: 0–255 (8 bits; values 256+ are a hard assembler error)
> - method index: 0–126 in user terms → 0–127 in imm15[14:8] (value 127 rejected)

---

### A.7–A.11 — TPERM: preset table, NULL behaviour, domain-purity, B-modifier, flag invariants

> **TPERM preset encoding (imm15[4:0])**
>
> Bit 4 = B-modifier (see A.11). Bits [3:0] = preset code (0–15).
>
> | Code | Mnemonic | Permissions required | Reserved? |
> |------|----------|----------------------|-----------|
> | 0x00 | CLEAR    | none                 | No |
> | 0x01 | R        | R                    | No |
> | 0x02 | RW       | R, W                 | No |
> | 0x03 | X        | X                    | No |
> | 0x04 | RX       | R, X                 | No |
> | 0x05 | RWX      | R, W, X              | No |
> | 0x06 | L        | L                    | No |
> | 0x07 | S        | S                    | No |
> | 0x08 | E        | E                    | No |
> | 0x09 | LS       | L, S                 | No |
> | 0x0A | W        | W only (no R)        | No |
> | 0x0B–0x0F | — | —                   | **Reserved** |
>
> Adding 0x10 to any valid code sets the B-modifier: `TPERM CRd, RB` = code 0x11.
> All B-modifier variants of 0x0B–0x0F are also reserved.

> **A.7 — CLEAR (preset 0) always passes for any non-NULL, non-reserved GT.**
>
> `TPERM CRd, CLEAR` requires no permissions. Since the required set is empty,
> `required.every(p => gt.permissions[p])` is vacuously true. Z = 1 for any valid
> non-NULL GT regardless of what permissions it actually holds. This is the
> standard "GT is live and non-NULL" existence check.

> **A.8 — NULL GT always produces Z = 0, N = 1, no fault.**
>
> If `CR.word0 = 0` (NULL GT), TPERM immediately sets Z = 0, N = 1, C = 0, V = 0
> and returns — before checking the preset code, before the domain-purity check,
> before anything else. No fault is raised. This applies to every preset including
> CLEAR: `TPERM CRd, CLEAR` on a NULL GT gives Z = 0.
>
> Pattern to distinguish NULL from "lacks permission":
> ```
> TPERM  CR1, CLEAR        ; Z=1 → non-NULL; Z=0 → NULL
> BRANCH EQ, not_null
> ```

> **A.9 — Domain-purity violation → hard FAULT(TPERM_RSV).**
>
> If the *result* permission set (intersection of preset's required bits and the GT's
> held bits) would combine X with any of L, S, or E, TPERM faults with `TPERM_RSV`.
> This is a hard fault — not Z = 0, not recoverable.
>
> No built-in preset triggers this (presets are X-pure or LSE-pure, never mixed),
> but a GT that already combines X and L/S/E could trigger it on certain presets.
> In practice this guards against malformed GTs reaching code that uses them.

> **A.10 — TPERM flag invariants: N = !Z, C = 0, V = 0 always.**
>
> These three relationships hold unconditionally after every TPERM that does not
> fault. The flag table in §5 already captures this. Key implication: C and V are
> **always cleared** by TPERM — any preceding instruction's carry or overflow is
> lost.

> **A.11 — B-modifier (imm15 bit 4): clears the Busy bit on a passing test.**
>
> When bit 4 of the imm15 field is set and the permission test passes (Z = 1),
> TPERM clears bit 31 of `CR.word0` (the B "Busy" bit) **in place** — no namespace
> write, no SAVE needed. The change is local to the CR until a SAVE commits it.
>
> If the test fails (Z = 0), the B bit is left unchanged regardless of the modifier.
> The modifier has no effect on flags.
>
> ```
> TPERM  CR2, EB          ; test for E permission; if Z=1, clear B bit atomically
> BRANCH EQ, call_ok      ; Z=1: abstraction is callable and now marked un-busy
> ```
>
> **Reserved preset + B-modifier:** codes 0x1B–0x1F are reserved; behaviour
> matches A-13 (simulator: Z=0 no fault; hardware: FAULT — see D-3 in
> `HARDWARE-DEVIATIONS.md`).

---

### A.12–A.14 — Call stack: CALL frame layout, LAMBDA SZ=0, M-window writeback

> **A.12 — CALL pushes exactly 2 words to thread memory; no CRs or DRs.**
>
> When CALL executes, it writes two words into the current thread's lump memory
> at the stack pointer (STO):
>
> | Word offset (from STO) | Contents |
> |------------------------|----------|
> | STO      | Frame word: packed (returnPC[14:0] \| sz[12] \| flags[11:8] \| savedSTO[7:0]) |
> | STO − 1  | Caller's E-GT (CR6 value before the call) |
>
> `sz = 1` distinguishes CALL frames from LAMBDA frames (sz = 0). No capability
> registers or data registers are written to thread memory — the callee inherits
> all DRs and CRs from the caller (with the exception of CR6 and CR14, which
> are replaced by the callee's c-list and code tokens).
>
> The JS-side simulator call stack (`callStack[]`) additionally holds a snapshot
> of all saved registers for state inspection, but this is not part of the
> hardware frame format.

> **A.13 — LAMBDA pushes a SZ=0 (1-word) frame; RETURN identifies it by sz.**
>
> LAMBDA writes only the frame word (sz = 0) to thread memory — no E-GT slot.
> RETURN distinguishes frame types by the sz field:
>
> | sz | Frame type | Pop size | Return address source |
> |----|------------|----------|-----------------------|
> | 0  | LAMBDA     | 1 word   | `lambdaReturnPC` cache (no memory read) |
> | 1  | CALL       | 2 words  | Frame word in thread memory |
>
> The leaf-lambda fast path: when `lambdaActive = 1` and the frame popped is SZ=0,
> RETURN restores PC from the cached `lambdaReturnPC` register without a memory
> read. This gives O(1) RETURN at any recursion depth.
>
> LAMBDA CR6 idempotent re-entry (D-9): re-executing `LAMBDA CR6` while
> `lambdaActive = 1` is non-faulting (same return address overwrites the same
> register). `LAMBDA CRn` (n ≠ 6) while `lambdaActive = 1` → FAULT.

> **A.14 — M-window writeback fires at every CALL and every RETURN.**
>
> When an abstraction is called via an Abstract GT (M-bit = 1), hardware tracks
> modified namespace state in a 3-register M-window (DR11–DR13). Before the
> callee's frame is pushed (CALL) or before the caller's frame is popped (RETURN),
> the M-window writeback fires: DR11–DR13 are written back to the CR15 namespace
> entry and the M-bit is cleared.
>
> If the writeback fails (e.g. NULL DR11, invalid state), CALL and RETURN both
> fault with `INVALID_OP` before any frame manipulation occurs. The frame stack
> is never left in a partially-modified state.

---

### A.15–A.16 — BFINS source masking; LOAD short form

> **A.15 — BFINS uses only the low `width` bits of DRs.**
>
> The value inserted is `DRs & ((1 << width) - 1)`. Upper bits of DRs beyond
> `width` are discarded before insertion. The destination word is modified as:
>
> ```
> mask     = ((1 << width) - 1) << pos
> new_word = (old_DRd & ~mask) | ((DRs & ((1<<width)-1)) << pos)
> ```
>
> There is no alignment requirement — `pos` and `width` may be any values
> satisfying `width ≥ 1` and `pos + width ≤ 32`.

> **A.16 — LOAD (and SAVE, ELOADCALL, XLOADLAMBDA) short form uses CR6 implicitly.**
>
> Two-operand forms resolve the named abstraction from the assembler's NS binding
> table and substitute CR6 as the c-list base:
>
> ```
> LOAD  CRd, SlideRule        →  LOAD  CRd, CR6, <slot>
> SAVE  CRd, SlideRule        →  SAVE  CRd, CR6, <slot>
> ELOADCALL  CRd, SlideRule   →  ELOADCALL  CRd, CR6, <slot>
> XLOADLAMBDA  CRd, SlideRule →  XLOADLAMBDA  CRd, CR6, <slot>
> ```
>
> CR6 is the c-list root by architectural convention. The slot is looked up from
> the namespace binding established by a prior `LOAD CRd, Name` (which registers
> the name → CR mapping in `nsLoaded`). Using the short form for a name that has
> never been loaded is a hard assembler error.

---

## §7 — Instruction Reference (Opcodes 0–19)

Encoding template for all instructions:

```
 31      27 26    23 22    19 18    15 14             0
 ┌─────────┬────────┬────────┬────────┬───────────────┐
 │  op[4:0]│ cond   │ fld_a  │ fld_b  │   imm15       │
 └─────────┴────────┴────────┴────────┴───────────────┘
```

`op` selects the instruction. `cond` (4 bits) is the condition code (see §2);
most instructions use `cond = 0b1110` (AL — always execute). `fld_a` and `fld_b`
are 4-bit register indices; their roles vary per instruction. `imm15` is the
15-bit immediate field; its internal structure varies.

> **Permission abbreviations** used below: R=Read, W=Write, X=Execute, L=Load,
> S=Store, E=Enter, B=Busy. "GT" = Golden Token (capability). NULL GT = word0=0.

---

### LOAD — opcode 0 (0x00)

```
LOAD  CRd, CRs, #row        ; three-operand (explicit c-list base)
LOAD  CRd, Name             ; two-operand shorthand (CRs=CR6 implicit)
```

**Encoding:** `op=0 | cond | CRd | CRs | row[14:0]`

**Semantics:** Read the GT from c-list slot `CRs[row]` and write it to `CRd`. The
c-list base GT must have L-permission. If `CRs = CR6` the c-list location is read
directly from `CR6.word1` (NS root); otherwise the lump header is read first to
locate the embedded c-list at `lumpBase + lumpSize − cc`. The target NS entry's
CRC-16 seal is validated before `CRd` is written.

*Outform (type=2):* Dispatches the Loader to install the lump, then promotes the
slot GT from Outform → Inform and writes the Inform GT to `CRd`.

*Abstract (type=3):* GT is written to `CRd` directly without a MAC/seal check.

**Flags:** None written.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRs` is NULL, or slot `row` is empty (NULL GT) |
| `PERM_L` | `CRs` GT lacks L-permission |
| `BOUNDS` | `row` outside c-list range, or NS index out of bounds |
| `SEAL` | CRC-16 MAC check fails on the NS entry |
| `F_BIT` | Source GT is in a Far namespace (F=1) |
| `CODE_NOT_RESIDENT` | Lazy load (Mode 1 restore) failed |

---

### SAVE — opcode 1 (0x01)

```
SAVE  CRd, CRs, #row        ; write CRd into c-list slot CRs[row]
SAVE  CRd, Name             ; two-operand shorthand (CRs=CR6 implicit)
```

**Encoding:** `op=1 | cond | CRd | CRs | row[14:0]`

**Semantics:** Write the GT in `CRd` into c-list slot `CRs[row]`. Requires
S-permission on `CRs`. The destination c-list is located by the same lump-header
path as LOAD. After writing `memory[clistLoc + row] = CRd.word0`, updates the
internal c-list membership map (`nsClistMap`) for the affected NS entries.

**Flags:** None written.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRd` or `CRs` is NULL |
| `PERM_S` | `CRs` GT lacks S-permission |
| `BOUNDS` | `row` outside c-list range |
| `F_BIT` | Source GT's NS entry has F=1 |

---

### CALL — opcode 2 (0x02)

```
CALL  CRd, MethodName       ; named method (assembler resolves index)
CALL  CRd, #n               ; numeric method index (assembler encodes n+1)
```

**Encoding:** `op=2 | cond | CRd | 0 | method_index_plus1[14:0]`

`imm15 = 0` → fast path (NIA = lump_base + word 4, skipping the method table).
`imm15 = k > 0` → method index `k−1`; hardware reads the method table at
`lump_base + k` to find the callee's entry point.

**Semantics:**
1. Verify E-permission on `CRd` GT. Far-cap check (F=1 → `F_BIT` fault, before
   M-window writeback).
2. M-window writeback (if M-bit active): DR11–DR13 → CR15 namespace entry, M cleared.
3. Push 2-word frame to thread lump at STO:
   - `STO−1`: caller's E-GT (current `CR6.word0`)
   - `STO`: packed frame word (`returnPC[14:0] | sz=1[12] | flags[11:8] | savedSTO[7:0]`)
4. STO decrements by 2. Callee inherits all CRs and DRs.
5. PC → 0 (fast path) or method table entry (named method).

**Flags:** None written (saved in frame; restored by RETURN).

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRd` is NULL |
| `PERM_E` | `CRd` GT lacks E-permission |
| `F_BIT` | Far-namespace GT (checked before M-window writeback) |
| `PRIVATE_METHOD` | Method table entry is 0 (private or unmapped) |
| `INVALID_OP` | M-window writeback failed |
| `BOUNDS` | Stack overflow (STO underrun) |

---

### RETURN — opcode 3 (0x03)

```
RETURN              ; mask = 0 (no CRs cleared)
RETURN  #mask       ; bits 0–11 select CRs 0–11 to clear; bit 6 reserved
```

**Encoding:** `op=3 | cond | 0 | 0 | mask[11:0]`

**Semantics:**
1. If call stack is empty → `STACK_UNDERFLOW` fault.
2. M-window writeback fires (same as CALL).
3. Pop frame. `sz=0` → LAMBDA 1-word frame; `sz=1` → CALL 2-word frame.
4. Restore PC, STO, and flags from frame.
5. Reset M-bits on all CRs (`_resetAllMBits`).
6. Apply clear mask: for each bit `i` set in `mask[11:0]`, clear `CR[i]` (zero
   word0–word3). Bit 6 is reserved — CR6 is always restored from the frame.
7. Sentinel frame (NIA = 0x7FFF at bottom of call stack) → `STACK_UNDERFLOW` fault.

*LAMBDA fast path:* When `lambdaActive=1` and the popped frame has `sz=0`, PC is
restored from the cached `lambdaReturnPC` register — no memory read required.

> **Note:** Older docs say RETURN "triggers a reboot". This is incorrect. The
> simulator (and hardware) fault with `STACK_UNDERFLOW` when the stack is empty
> or the sentinel frame is reached.

**Flags:** Restored from saved frame (not written by RETURN itself).

**Faults:**
| Fault | Condition |
|-------|-----------|
| `STACK_UNDERFLOW` | Empty call stack, or RETURN through sentinel frame |
| `INVALID_OP` | M-window writeback failed |

---

### CHANGE — opcode 4 (0x04)

```
CHANGE  CRd, CRs, #ns_slot      ; CRd must be CR12–CR15
```

**Encoding:** `op=4 | cond | CRd | CRs | ns_slot[14:0]`

**Semantics by destination register:**

| CRd | Behaviour |
|-----|-----------|
| CR12 (thread stack) | System-wide direct write. Requires S-permission on `CRs`, or first-activation bypass (self-reload `CRs=CRd=CR12` by Boot.Abstr). |
| CR13 (interrupt handler) | System-wide direct write. Requires S-permission on `CRs`. |
| CR14 (code register) | Per-thread full context switch: saves outgoing thread's CR0–CR11, CR14, CR15, DR0–DR15, STO, PC, FLAGS; restores incoming thread's saved state (or first-activation at PC=0). CR12 and CR13 are never saved/restored (system-wide). |
| CR15 (namespace root) | Same full context switch as CR14. |

The assembler enforces that `CRd` is CR12 for normal code; CR13–CR15 require
explicit operand override. See SWITCH (opcode 5) for context-switch via PassKey.

**Flags:** None written by the instruction itself; CR14/CR15 switches restore the
incoming thread's saved flags.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `PRIV_REG` | `CRd` is CR0–CR11 |
| `NULL_CAP` | `CRs` is NULL |
| `BOUNDS` | `ns_slot` out of range |
| `PERM_S` | CR12/CR13 write and `CRs` lacks S-permission (unless first-activation bypass) |

---

### SWITCH — opcode 5 (0x05)

```
SWITCH  CRs, #Tgt
```

**Encoding:** `op=5 | cond | 0 | CRs | Tgt[2:0]`  (`Tgt` in `imm15[2:0]`)

**⚠ Major simulator/hardware deviation — see D-11 in `HARDWARE-DEVIATIONS.md`.**

**Hardware semantics** (`hardware/switch.py`):
1. Read `CRs`. Check `gt_type == 0b11` (Abstract GT) → else `FAULT(INVALID_OP)`.
2. Check `Tgt ∈ {5=CR13, 7=CR15}` → else `FAULT(INVALID_OP)`.
3. Check `CRs.word1_location == sentinel[Tgt]`:
   - Tgt=5 (CR13): sentinel = `0xFFFFFFFE`
   - Tgt=7 (CR15): sentinel = `0xFFFFFFFF`
   → else `FAULT(INVALID_OP)`.
4. `ChurchMLoad` writes `CRs` into the target privileged register with `m_elevated=1`,
   resetting G=0 on the NS entry. The source CR is **not** cleared.

**Simulator semantics** (`_execSwitch`, line ~3836):
Atomic swap `cr[CRs] ↔ cr[Tgt]` where `Tgt = imm & 0x7`. No type check, no
target-validity check, no sentinel check, no mLoad. Any register 0–7 is a valid
target. The source CR receives the old contents of the target.

**Flags:** None written.

---

### TPERM — opcode 6 (0x06)

```
TPERM  CRd, PRESET      ; named preset (assembler expands to code)
TPERM  CRd, #code       ; raw preset code (0–10 valid; 11–15 reserved)
TPERM  CRd, PRESET B    ; B-modifier variant (bit 4 of code set)
```

**Encoding:** `op=6 | cond | CRd | 0 | B[4] | code[3:0]`  (`imm15[4:0]`)

**Preset table:**

| Code | Name | Required permissions |
|------|------|---------------------|
| 0x00 | CLEAR | none (vacuously true) |
| 0x01 | R | R |
| 0x02 | RW | R, W |
| 0x03 | X | X |
| 0x04 | RX | R, X |
| 0x05 | RWX | R, W, X |
| 0x06 | L | L |
| 0x07 | S | S |
| 0x08 | E | E |
| 0x09 | LS | L, S |
| 0x0A | W | W only (no R) |
| 0x0B–0x0F | — | **Reserved** |

B-modifier variants: add 0x10 to any valid code (e.g. `EB = 0x18`).

**Semantics:**
1. If `CRd.word0 == 0` (NULL GT): Z=0, N=1, C=0, V=0. Return. No fault.
2. If preset code is reserved (0x0B–0x0F, or B-modifier variant): hardware faults
   `TPERM_RSV`; simulator currently sets Z=0 silently (deviation C.1, Task #873).
3. Domain-purity check: if result would combine X with any of L/S/E →
   `FAULT(TPERM_RSV)`. Hard fault in both simulator and hardware.
4. Test: does the GT hold all required permissions? Z = 1 if yes, 0 if no.
5. If Z=1 and B-modifier set: clear bit 31 of `CRd.word0` (the Busy bit) in-place.

**Mode 2 (attenuation sentinel):** `imm15 = 0x7FFF` triggers permission
attenuation rather than a test — see A.7 in §6. Not yet implemented in simulator
(Task #874).

**Flags:** Z = pass/fail, N = !Z, C = 0, V = 0. Always.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `TPERM_RSV` | Reserved preset code, or domain-purity violation (X+LSE) |

---

### LAMBDA — opcode 7 (0x07)

```
LAMBDA  CRd
```

**Encoding:** `op=7 | cond | CRd | 0 | 0`

**Semantics:** Enter an inline (leaf) Church reduction. `CRd` must hold a non-NULL
GT with X-permission.
1. Verify X-permission on `CRd` GT via mLoad.
2. Check stack bounds against thread lump `sw` (stack watermark) field; set V=1 if
   STO would go below the watermark, but do not fault.
3. Push SZ=0 frame word to thread lump at `STO`: `returnPC[14:0] | sz=0[12] | flags[11:8] | savedSTO[7:0]`.
4. Cache `lambdaReturnPC = PC + 1` and set `lambdaActive = true`.
5. STO decrements by 1. PC advances by 1 (callee code immediately follows).

*Idempotent re-entry:* Re-executing `LAMBDA CR6` while `lambdaActive = 1` is
non-faulting — the same return address overwrites the cached register. `LAMBDA CRn`
(n ≠ 6) while `lambdaActive = 1` → `FAULT`.

**Flags:** V=1 if stack below watermark (soft warning only); otherwise flags
unchanged by LAMBDA itself.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRd` is NULL |
| `PERM_X` | `CRd` GT lacks X-permission |
| `BOUNDS` | Stack pointer would overwrite the heap/DR zone |
| `FAULT` | `LAMBDA CRn` (n≠6) while `lambdaActive=1` |

---

### ELOADCALL — opcode 8 (0x08)

```
ELOADCALL  CRd, CRs, #row       ; explicit c-list base
ELOADCALL  CRd, Name            ; shorthand (CRs=CR6, method index from convention)
```

**Encoding:** `op=8 | cond | CRd | CRs | method_idx[14:8] | row[7:0]`

- `imm15[14:8]` = method index (7 bits, 0–127). 0 = fast path.
- `imm15[7:0]` = c-list row (8 bits, 0–255).

**Semantics:** Atomic LOAD + TPERM(E) + CALL in a single instruction. Loads the GT
from `CRs[row]`, verifies E-permission, pushes a SZ=1 CALL frame, and enters the
abstraction. Outform (type=2) GTs trigger a lazy load before the TPERM check.
Method dispatch behaves identically to CALL: `method_idx=0` → fast path (NIA=
lump_base + word 4); `method_idx=k>0` → read method table entry k.

**Flags:** None written.

**Faults:** Same combined set as LOAD + CALL (NULL_CAP, PERM_E, F_BIT,
PRIVATE_METHOD, INVALID_OP, BOUNDS, CODE_NOT_RESIDENT).

---

### XLOADLAMBDA — opcode 9 (0x09)

```
XLOADLAMBDA  CRd, CRs, #row
XLOADLAMBDA  CRd, Name
```

**Encoding:** `op=9 | cond | CRd | CRs | row[14:0]`

**Semantics:** Atomic LOAD + TPERM(X) + LAMBDA. Loads the GT from `CRs[row]`,
verifies X-permission, and enters it as an inline reduction (SZ=0 frame). Combines
the load and lambda phases with no intermediate instruction.

**Flags:** V=1 if stack below watermark (from LAMBDA phase); otherwise unchanged.

**Faults:** Same combined set as LOAD + LAMBDA (NULL_CAP, PERM_X, F_BIT, BOUNDS,
CODE_NOT_RESIDENT).

---

### DREAD — opcode 10 (0x0A)

```
DREAD  DRd, CRs, #offset
```

**Encoding:** `op=10 | cond | DRd | CRs | offset[14:0]`

`fld_a` encodes the destination DR index (not a CR). `fld_b` encodes the source
CR index (the capability granting data access).

**Semantics:** Read the 32-bit word at `memory[CRs.word1 + offset]` into `DRd`.
Requires R-permission on `CRs`.

**CR14 exception:** When `CRs = CR14` (the code register, which is X-only),
DREAD uses X-permission instead of R. This is the only instruction that accepts
X in place of R for a data read.

**Abstract GT intercept:** If `CRs` holds an Abstract GT (type=3), DREAD is
routed to the Abstract Manager rather than performing a direct memory read.

**Thread lump sync:** After writing `DRd`, the value is mirrored to the DR zone of
the current thread lump (`CR12.word1 + 1 + DRd`). CR12 must be non-NULL.

**Flags:** None written.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRs` is NULL, or CR12 is NULL (thread lump sync) |
| `PERM_R` / `PERM_X` | `CRs` GT lacks required permission |
| `BOUNDS` | `offset` out of GT address range |

---

### DWRITE — opcode 11 (0x0B)

```
DWRITE  DRs, CRd, #offset
```

**Encoding:** `op=11 | cond | DRs | CRd | offset[14:0]`

Note: by convention the assembler places the source DR in `fld_a` and the
capability register in `fld_b`. The simulator decoder names these `crDst` (= DRs)
and `crSrc` (= CRd) which is misleading — `crDst` holds the DR index here.

**Semantics:** Write `DRs` to `memory[CRd.word1 + offset]`. Requires W-permission
on `CRd`. Mirrors the written value to the thread lump's DR zone (same path as
DREAD). Device writes for LED, UART, and Timer NS indices are routed to simulated
hardware peripherals.

**Abstract GT intercept:** Same as DREAD — routed to Abstract Manager if `CRd`
holds type=3.

**Flags:** None written.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `NULL_CAP` | `CRd` is NULL, or CR12 is NULL |
| `PERM_W` | `CRd` GT lacks W-permission |
| `BOUNDS` | `offset` out of GT address range |

---

### BFEXT — opcode 12 (0x0C)

```
BFEXT  DRd, DRs, pos, width
```

**Encoding:** `op=12 | cond | DRd | DRs | pos[9:5] | width[4:0]`

- `imm15[9:5]` = bit position (0–31)
- `imm15[4:0]` = field width (1–31; 0 = fault)

**Semantics:** Extract a `width`-bit field starting at bit `pos` from `DRs`,
zero-extend to 32 bits, write to `DRd`:

```
mask  = (1 << width) − 1
DRd   = (DRs >>> pos) & mask
```

**Flags:** N = DRd[31], Z = (DRd == 0), C = 0, V = 0.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `BOUNDS` | `width == 0` or `pos + width > 32` |

---

### BFINS — opcode 13 (0x0D)

```
BFINS  DRd, DRs, pos, width
```

**Encoding:** identical field packing as BFEXT.

**Semantics:** Insert the low `width` bits of `DRs` into `DRd` at bit position
`pos`. All other bits of `DRd` are preserved:

```
mask   = ((1 << width) − 1) << pos
DRd    = (DRd & ~mask) | ((DRs & ((1<<width)−1)) << pos)
```

Upper bits of `DRs` beyond bit `width−1` are **discarded** before insertion
(see A.15 in §6).

**Flags:** N = DRd[31] (result), Z = (result == 0), C = 0, V = 0.

**Faults:**
| Fault | Condition |
|-------|-----------|
| `BOUNDS` | `width == 0` or `pos + width > 32` |

---

### MCMP — opcode 14 (0x0E)

```
MCMP  DRa, DRb
```

**Encoding:** `op=14 | cond | DRa | DRb | 0`

`fld_a` = DRa, `fld_b` = DRb. The decoder field names `crDst`/`crSrc` are
misleading here — both encode DR indices. No result register.

**Semantics:** Set flags from the unsigned subtraction `DRa − DRb`. No register
is written. Equivalent to a compare for use with BRANCH condition codes.

```
N = (DRa − DRb)[31]
Z = (DRa == DRb)
C = (DRa >= DRb)         ; C=1 means no borrow (ARM-style)
V = signed overflow from DRa − DRb
```

**Flags:** N, Z, C, V all written.

**Faults:** None.

---

### IADD — opcode 15 (0x0F)

```
IADD  DRd, DRa, DRb         ; register form (imm15[14]=0)
IADD  DRd, DRa, #imm        ; immediate form (imm15[14]=1)
```

**Encoding:**

- Register form: `op=15 | cond | DRd | DRa | 0[14] | 0…0 | DRb[3:0]`
- Immediate form: `op=15 | cond | DRd | DRa | 1[14] | imm14[13:0]`

`imm14` is a 14-bit **unsigned** integer (range 0–16383). There is no sign
extension — the assembler masks negative values with `0x3FFF`.

**Semantics:** `DRd = DRa + DRb` (or `DRa + #imm14`). 32-bit unsigned addition
with full flag computation. DR0 as destination silently discards the result (DR0
is always 0 — see A.1).

**Flags:** N = result[31], Z = (result==0), C = (unsigned overflow), V = (signed overflow).

**Faults:** None.

**Common patterns:**
```
IADD  DR3, DR0, DR5         ; copy: DR3 = DR5  (using DR0 = 0)
IADD  DR2, DR0, #42         ; load immediate: DR2 = 42
IADD  DR1, DR1, #1          ; increment: DR1++
```

---

### ISUB — opcode 16 (0x10)

```
ISUB  DRd, DRa, DRb
ISUB  DRd, DRa, #imm
```

**Encoding:** identical structure to IADD; `op=16`.

**Semantics:** `DRd = DRa − DRb` (or `DRa − #imm14`). 32-bit unsigned subtraction.

**Flags:** N = result[31], Z = (result==0), C = (DRa ≥ DRb — no borrow, ARM style),
V = (signed overflow from subtraction).

**Faults:** None.

---

### BRANCH — opcode 17 (0x11)

```
BRANCH.cond  ±offset        ; signed PC-relative
```

**Encoding:** `op=17 | cond | 0 | 0 | soff[14:0]`

`imm15[14]` is the sign bit. Sign-extend to 32 bits:

```
soff = (imm15 & 0x4000) ? (imm15 | 0xFFFF8000) : imm15
```

**Semantics:** If the condition code `cond` is satisfied by the current flags: PC
← PC + soff. Otherwise: PC ← PC + 1 (sequential).

`soff = 0` is an **infinite loop** (PC + 0 = PC). `soff = -1` (0x7FFF) branches
to the previous instruction. BRANCH is the only instruction that may leave PC
unchanged.

**Flags:** None written (reads existing flags to evaluate `cond`).

**Faults:**
| Fault | Condition |
|-------|-----------|
| `BOUNDS` | Target address `PC + soff` is outside memory |

---

### SHL — opcode 18 (0x12)

```
SHL  DRd, DRs, #shamt       ; shamt = 0–31
```

**Encoding:** `op=18 | cond | DRd | DRs | 0…0 | shamt[4:0]`

**Semantics:** `DRd = (DRs << shamt) & 0xFFFFFFFF`. Logical left shift; vacated
low bits are filled with 0.

Carry: `C = DRs[32 − shamt]` (the last bit shifted out of the top of the word),
gated to 0 when `shamt = 0`.

```
shamt = 0: DRd = DRs, C = 0
shamt = 1: DRd = DRs << 1, C = DRs[31]
shamt = 31: DRd = DRs << 31, C = DRs[1]
```

**Flags:** N = DRd[31], Z = (DRd==0), C = last bit shifted out, V = 0.

**Faults:** None.

---

### SHR — opcode 19 (0x13)

```
SHR  DRd, DRs, #shamt           ; LSR — logical (zero-fill)
SHR  DRd, DRs, #shamt, ASR      ; ASR — arithmetic (sign-extend)
```

**Encoding:** `op=19 | cond | DRd | DRs | 0…0 | arith[5] | shamt[4:0]`

- `imm15[5] = 0` → LSR (logical shift right, zero-fill from top)
- `imm15[5] = 1` → ASR (arithmetic shift right, replicate sign bit)
- `imm15[4:0]` = shift amount (0–31)

**Semantics:**

```
LSR: DRd = DRs >>> shamt                        ; zero-extended
ASR: DRd = sign_extend_32(DRs >> shamt)         ; sign bit replicated
C   = DRs[shamt − 1]  if shamt > 0  else  0     ; last bit shifted out
```

`shamt = 0`: DRd = DRs, C = 0 (no bits shifted — both LSR and ASR are identity).

**ASR examples:**
```
SHR  DR3, DR1, 4, ASR    ; 0x80000000 >> 4 = 0xF8000000 (N=1, C=0)
SHR  DR3, DR1, 1, ASR    ; 0xFFFFFFFE >> 1 = 0xFFFFFFFF (N=1, C=1)
```

**Hardware note:** Prior to Task #857, hardware only supported LSR (imm15[5] was
ignored) and C was hardwired to 0. Both are now fixed. See D-12 in
`HARDWARE-DEVIATIONS.md` (CLOSED).

**Flags:** N = DRd[31], Z = (DRd==0), C = last bit shifted out, V = 0.

**Faults:** None.

---

## §8 — Quick-Reference Appendix

| Opcode | Hex | Mnemonic | fld_a | fld_b | imm15 key | N | Z | C | V | Faults |
|--------|-----|----------|-------|-------|-----------|---|---|---|---|--------|
| 0 | 0x00 | LOAD | CRd | CRs | c-list row | — | — | — | — | NULL_CAP PERM_L BOUNDS SEAL F_BIT |
| 1 | 0x01 | SAVE | CRd | CRs | c-list row | — | — | — | — | NULL_CAP PERM_S BOUNDS F_BIT |
| 2 | 0x02 | CALL | CRd | — | method_idx+1 (0=fast) | — | — | — | — | NULL_CAP PERM_E F_BIT PRIVATE_METHOD |
| 3 | 0x03 | RETURN | — | — | mask[11:0] | restored | restored | restored | restored | STACK_UNDERFLOW |
| 4 | 0x04 | CHANGE | CRd | CRs | ns_slot | — | — | — | — | PRIV_REG NULL_CAP PERM_S BOUNDS |
| 5 | 0x05 | SWITCH | — | CRs | Tgt[2:0] | — | — | — | — | NULL_CAP INVALID_OP (hw) |
| 6 | 0x06 | TPERM | CRd | — | B\|code[4:0] | !Z | pass | 0 | 0 | TPERM_RSV |
| 7 | 0x07 | LAMBDA | CRd | — | 0 | — | — | — | W | NULL_CAP PERM_X BOUNDS |
| 8 | 0x08 | ELOADCALL | CRd | CRs | midx[14:8]\|row[7:0] | — | — | — | — | (LOAD+CALL combined) |
| 9 | 0x09 | XLOADLAMBDA | CRd | CRs | c-list row | — | — | — | W | (LOAD+LAMBDA combined) |
| 10 | 0x0A | DREAD | DRd | CRs | offset | — | — | — | — | NULL_CAP PERM_R/X BOUNDS |
| 11 | 0x0B | DWRITE | DRs | CRd | offset | — | — | — | — | NULL_CAP PERM_W BOUNDS |
| 12 | 0x0C | BFEXT | DRd | DRs | pos[9:5]\|w[4:0] | res[31] | res=0 | 0 | 0 | BOUNDS |
| 13 | 0x0D | BFINS | DRd | DRs | pos[9:5]\|w[4:0] | res[31] | res=0 | 0 | 0 | BOUNDS |
| 14 | 0x0E | MCMP | DRa | DRb | 0 | sub[31] | a=b | a≥b | ovf | — |
| 15 | 0x0F | IADD | DRd | DRa | 0\|DRb or 1\|imm14 | r[31] | r=0 | uovf | sovf | — |
| 16 | 0x10 | ISUB | DRd | DRa | 0\|DRb or 1\|imm14 | r[31] | r=0 | a≥b | sovf | — |
| 17 | 0x11 | BRANCH | cond | — | soff[14:0] (signed) | — | — | — | — | BOUNDS |
| 18 | 0x12 | SHL | DRd | DRs | shamt[4:0] | r[31] | r=0 | last-out | 0 | — |
| 19 | 0x13 | SHR | DRd | DRs | arith[5]\|shamt[4:0] | r[31] | r=0 | last-out | 0 | — |

**Flag column key:** `—` = not written (preserved). `W` = written with specific value noted in entry. `res` = result. `sub` = DRa−DRb. `uovf` = unsigned overflow. `sovf` = signed overflow. `last-out` = last bit shifted out. `a≥b` = C=1 when no borrow.

**Deviation flags:** SWITCH (D-11), SHR/SHL carry+ASR (D-12, closed). TPERM reserved-preset fault (C.1, Task #873). TPERM Mode 2 (C.3, Task #874).
