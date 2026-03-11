# Church Instructions Reference

## Overview

The Church instructions implement capability-based access control as hardware-enforced operations. They are the mechanism by which software interacts with Golden Tokens (GTs), capability registers (CRs), and the Namespace. Named after Alonzo Church, these instructions embody the lambda calculus principle of controlled access through abstraction.

All Church instructions that access the namespace route through the **mLoad master validation path**, which enforces permission checks, bounds validation, MAC verification, and G-bit reset on every access.

---

## Architectural Principles

1. **CR0-CR11 Only**: Church instructions can only address CR0-CR11 via the 4-bit register field. Privileged registers CR12-CR15 are physically unreachable through instruction encoding (exception: DREAD/DWRITE may use CR14 as source).
2. **SWITCH Is the Gate**: The only way to write to privileged registers CR12-CR15 is through the privileged SWITCH instruction.
3. **Permission Domains Are Mutually Exclusive**: Turing (R, W, X) and Church (L, S, E) permissions cannot be mixed within a single operation context.
4. **Failsafe FAULT**: Every validation failure (permission, bounds, version, MAC) routes to a FAULT handler — except TPERM, which sets Z=0 on failure to enable conditional execution without trapping.
5. **C-List Mediation**: LOAD and SAVE operate through capability-mediated access, never through raw memory addressing.
6. **mLoad Validation**: All namespace access routes through the mLoad trusted path, which always resets the G-bit on accessed entries.
7. **G-bit Reset on Access**: Every namespace access resets G=0 on the accessed entry, regardless of the instruction or permission type. Reachability determines liveness.

---

## The Six Church Instructions

### 1. LOAD — Load Capability from C-List

**Purpose**: Retrieve a Golden Token from a C-List entry and place it into a capability register.

**Required Permission**: L (Load) on the C-List capability

**Validation Path**: Routes through mLoad — permission check, bounds check, GT fetch, namespace validation, MAC check, G-bit reset, thread update.

**Operation**:
1. Check that the C-List capability has L permission via mLoad → FAULT if not
2. Use the index operand to locate the entry
3. Validate bounds (index must be within valid range) → FAULT if not
4. Validate GT against namespace (version, MAC/seal) → FAULT if invalid
5. Reset G=0 on the accessed namespace entry
6. Copy the capability into the destination CR

**Mnemonic**: `LOAD CRd, CRs, index`

| Aspect | Detail |
|--------|--------|
| **Permission Check** | L on source CR (M-elevation by microcode for CR6) |
| **GT Validation** | Version match + MAC seal validation |
| **G-bit Reset** | Yes — G bit cleared on namespace access via mLoad |
| **Bounds Check** | Index must be within C-List bounds |
| **Result** | Validated GT loaded into destination CR |

---

### 2. SAVE — Save Capability to C-List

**Purpose**: Store a Golden Token from a capability register into a C-List or namespace entry.

**Required Permission**: S (Save) on the C-List capability

**Validation Path**: Routes through mSave for write validation; G-bit reset on the accessed C-List namespace entry.

**Operation**:
1. Check that the C-List capability has S permission → FAULT if not
2. Use the index operand to locate the target entry
3. Validate bounds → FAULT if not
4. Copy the capability from the source CR into the target entry
5. Reset G=0 on the accessed C-List namespace entry

**Mnemonic**: `SAVE CRsrc, CRdst, index`

| Aspect | Detail |
|--------|--------|
| **Permission Check** | S on destination CR |
| **Bounds Check** | Index must be within C-List bounds |
| **Seal Recompute** | MAC seal recomputed from Location+Limit |
| **G-bit Reset** | Yes — on accessed C-List namespace entry |
| **Result** | Capability stored into target C-List entry |

---

### 3. CALL — Protected Call Through Capability

**Purpose**: Invoke a protected abstraction (service/function) referenced by a Golden Token, saving context for later return.

**Validation Path**: Routes through mLoad for loading the callee's context — permission check, namespace validation, MAC check, G-bit reset.

**Operation**:
1. Check required permission on the target CR via mLoad → FAULT if not
2. Validate the GT → FAULT if invalid
3. Reset G=0 on the accessed namespace entry
4. Push return context onto the call stack
5. Transfer control to the target abstraction

**Mnemonic**: `CALL CRs`

| Aspect | Detail |
|--------|--------|
| **Required Permission** | E (Enter) on source CR |
| **GT Validation** | Version match + MAC seal validation |
| **G-bit Reset** | Yes — on callee namespace entry via mLoad |
| **Saved Context** | PC, CR5, CR6, CR14 pushed to call stack (max 256 frames) |
| **Stack Overflow** | FAULT if call stack full. Updates stackSpace/stackFrames indicators |
| **New Context** | CR6 set to callee C-List (M-bit set), CR14 set to callee code (privileged), PC set to entry point |

---

### 4. RETURN — Return from Protected Call

**Purpose**: Restore context saved by a previous CALL and resume execution at the caller.

**Required Permission**: None (return is always permitted if a saved context exists)

**Validation Path**: Routes saved CR5/CR6/CR14 GTs through mLoad for namespace revalidation — version check, MAC check, G-bit reset. Catches recycled entries (use-after-free prevention).

**Operation**:
1. Check that a saved context exists on the call stack → FAULT if empty
2. Pop the saved context
3. Restore CR5 via mLoad (tolerant — clears CR5 on fault, continues)
4. Restore CR6 via mLoad (fatal — FAULTs on validation failure)
5. Restore CR14 via mLoad (fatal — FAULTs on validation failure)
6. Reset G=0 on all restored namespace entries
7. Resume execution at the saved return address

**Mnemonic**: `RETURN`

| Aspect | Detail |
|--------|--------|
| **Permission Check** | None |
| **Restored Registers** | CR5 (tolerant), CR6 (M-bit set), CR14, PC via mLoad revalidation |
| **CR5 Fault Tolerance** | CR5 fault clears CR5, continues to CR6/CR14 |
| **G-bit Reset** | Yes — on all restored namespace entries via mLoad |
| **Stack Underflow** | FAULT: "No saved context to restore" |
| **Stack Indicators** | Updates stackFrames and stackSpace |

---

### 5. CHANGE — Change Thread Context

**Purpose**: Create or set a new thread identity by writing to CR8 (Thread register). This is the mechanism for context switching between threads.

**Validation Path**: Routes through mLoad — full validation with G-bit reset.

**Operation**:
1. Obtain source capability
2. Write to CR8 (Thread identity)
3. Reset G=0 on accessed namespace entries
4. Advance the PC

**Mnemonic**: `CHANGE CRs`

| Aspect | Detail |
|--------|--------|
| **Permission Check** | E (Enter) on source CR |
| **Target** | CR8 (Thread) — full atomic thread swap |
| **G-bit Reset** | Yes — on accessed namespace entries |
| **Save Side** | Saves data registers and PC to thread table (CRs always current via mLoad shadow) |
| **Restore Side** | CRs restored from thread table via mLoad revalidation; data registers restored directly |

---

### 6. SWITCH — Copy Capability to System Register

**Purpose**: Write a capability into one of the privileged registers CR12-CR15. This is the only instruction that can modify privileged registers, making it the privilege gate.

**Validation Path**: Routes through mLoad — full validation with G-bit reset.

**Operation**:
1. Check M permission on the source capability → FAULT if not
2. Determine the target privileged register from the 2-bit target field
3. Copy the capability into the target privileged register
4. Reset G=0 on accessed namespace entries

**Mnemonic**: `SWITCH CRs, target`

| Aspect | Detail |
|--------|--------|
| **Permission Check** | M (Machine) on source CR |
| **Target Field** | 2-bit: 0=CR12(fault), 1=CR13(interrupt), 2=CR14(code), 3=CR15(namespace) |
| **G-bit Reset** | Yes — via mLoad on namespace access |
| **Bounds Check** | Target must map to CR12-CR15 |

---

## TPERM — Test Permission / GT Health Check

TPERM is the single-instruction GT health check. It evaluates permissions, validity, and bounds in one cycle and **sets condition flags** — it does not trap. The flags persist across subsequent instructions, enabling ARM-style conditional execution for zero-cost try-catch patterns.

```
TPERM CRs, #preset [, offset]
```

**What TPERM checks (all at once)**:
1. **Permissions** — does the GT have the requested permission bits? (R, W, RW, E, LS, etc.)
2. **Valid** — does the GT pass version and MAC validation?
3. **Base + Limit** — if an offset is provided, is Base + offset within the GT's region?

**Flags set**:
- **Z = 1**: all checks passed (permissions present, valid, in bounds)
- **Z = 0**: one or more checks failed

**No trap**: TPERM never faults. If checks fail, the Z flag says so and software decides what to do via conditional execution. The CRs themselves enforce safety — an actual read/write to an invalid or out-of-bounds region will FAULT at that point. TPERM is the "ask first" instruction.

No namespace access occurs — TPERM is a register-local read-only operation. No G-bit reset.

### Conditional Execution: Zero-Cost Try-Catch

Because every Church Machine instruction carries a 4-bit ARM condition code, TPERM + conditional suffixes give you try-catch with no branches and no overhead on the happy path:

```
TPERM CR5, RW, offset      ; check R+W perms, valid, base+offset in bounds
                            ; Z=1 if all pass, Z=0 if any fail

readEQ DR1, CR5, offset     ; happy path — only fires if Z=1
IADDEQ DR2, DR1, 1          ; happy path — continues if Z=1
writeEQ CR5, offset, DR2    ; happy path — writes if Z=1

; catch path (TBD — recovery is case-by-case)
; instructions with NE suffix fire when Z=0
```

The happy path does not branch, does not check errors, does not even know failure is possible. Every instruction carries EQ and the hardware silently skips it if TPERM failed.

### Permission Restriction (monotonic)

TPERM can also restrict permissions on a GT:

```
TPERM CRd, #preset
```

The assembler encodes restriction mode by setting `imm15 = 0x7FFF` (all fifteen bits set). This sentinel distinguishes restriction from a health-check at offset 0 (`imm15 = 0`), which is a valid bounds test of the base address itself. The full range 0–32766 is available for health-check offsets.

Permissions can only be removed, never added (monotonic restriction). Domain purity is enforced: Turing (R, W, X) and Church (L, S, E) permissions cannot be mixed.

### Full Metadata Query

TPERM can read all metadata fields from a CR into a data register:

**Result Layout (DRd)**:
| Bits | Field | Description |
|------|-------|-------------|
| [5:0] | Permissions | R, W, X, L, S, E from CRs Golden Token |
| [10:6] | (Reserved) | Zero |
| [11] | stackFrames | 1 = at least one frame on call stack (RETURN safe) |
| [12] | stackSpace | 1 = room for at least one more frame (CALL safe) |
| [13] | Valid | 1 = GT passes version and MAC validation |
| [15:14] | Type | GT type: 00=Inform, 01=Outform, 10=NULL, 11=Abstract |
| [31:16] | (Reserved) | Zero |

---

## Additional Church Instructions

These instructions provide atomic operations, bulk transfers, and extended permission management:

| Instruction | Purpose | Permission | G-bit Reset |
|-------------|---------|------------|-------------|
| **LOADX** | Load Exclusive — same as LOAD but sets an exclusive monitor for atomic operations | L or M | Yes — via mLoad |
| **SAVEX** | Save Exclusive — conditional save that only succeeds if the exclusive monitor is still valid | S or M | Yes — on accessed entry |
| **LDM** | Load Multiple — load multiple CRs from consecutive C-List entries in one instruction | L or M | Yes — on each accessed entry |
| **STM** | Store Multiple — store multiple CRs to consecutive C-List entries in one instruction | S or M | Yes — on each accessed entry |

---

## Encoding

### Instruction Encoding Format
```
[31:27] Opcode (5 bits) — each Church instruction has its own opcode
[26:23] Condition (4 bits) — ARM-style conditional execution (N,Z,C,V)
[22]    I-bit — 0=register source, 1=C-List lookup
[21:0]  Operands (22 bits) — CRs, indices, target fields
```
Every instruction can be conditionally executed based on the condition flags. This is what enables the TPERM try-catch pattern — one TPERM sets the flags, subsequent instructions carry EQ/NE suffixes.

---

## Security Model Summary

The Church Machine enforces these core security invariants:

| Principle | Enforcement |
|-----------|-------------|
| No direct privileged register access | CR0-CR11 only in instruction encoding (4-bit field) |
| Privilege through SWITCH only | Only SWITCH writes to CR12-CR15 |
| Permission before access | Every Church instruction checks permissions before operating |
| Single validation path | All namespace access routes through mLoad |
| G-bit reset on every access | mLoad always resets G=0, ensuring GC accuracy |
| Failure handling | All violations route to FAULT handler |
| Capability-mediated access | LOAD/SAVE go through C-List capabilities, never raw memory |
| Mutually exclusive domains | Turing (R,W,X) / Church (L,S,E) |
