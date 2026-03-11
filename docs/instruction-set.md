# Church Machine Instruction Set

## Encoding Format

All instructions are 32 bits:

```
31    27 26  23 22  19 18  15 14           0
|opcode | cond |  dst |  src |    imm15    |
| 5 bit | 4 bit| 4 bit| 4 bit|   15 bits   |
```

- **opcode** (5 bits): Instruction identifier (0–19)
- **cond** (4 bits): ARM-style condition code for conditional execution
- **dst** (4 bits): Destination register (CR0–CR15 or DR0–DR15)
- **src** (4 bits): Source register (CR0–CR15 or DR0–DR15)
- **imm15** (15 bits): Immediate value (signed or unsigned depending on instruction)

## Condition Codes

All instructions support conditional execution:

| Code | Mnemonic | Meaning | Flags |
|------|----------|---------|-------|
| 0000 | EQ | Equal | Z=1 |
| 0001 | NE | Not equal | Z=0 |
| 0010 | CS/HS | Carry set / unsigned higher or same | C=1 |
| 0011 | CC/LO | Carry clear / unsigned lower | C=0 |
| 0100 | MI | Minus (negative) | N=1 |
| 0101 | PL | Plus (positive or zero) | N=0 |
| 0110 | VS | Overflow set | V=1 |
| 0111 | VC | Overflow clear | V=0 |
| 1000 | HI | Unsigned higher | C=1 and Z=0 |
| 1001 | LS | Unsigned lower or same | C=0 or Z=1 |
| 1010 | GE | Signed greater or equal | N=V |
| 1011 | LT | Signed less than | N≠V |
| 1100 | GT | Signed greater than | Z=0 and N=V |
| 1101 | LE | Signed less or equal | Z=1 or N≠V |
| 1110 | AL | Always (unconditional) | — |
| 1111 | NV | Never (reserved) | — |

Append the condition suffix to any mnemonic: `CALLEQ`, `BRANCHNE`, `IADDGE`, etc.

---

## Church Domain (10 Instructions)

These instructions manipulate capabilities (Golden Tokens). They operate on Context Registers (CR0–CR15).

### LOAD (opcode 0)

```
LOAD CRd, CRs, #slot
```

Loads a Golden Token from the c-list pointed to by CRs at the given slot into CRd. Requires L (load) permission on the source GT. CR6-specific M-elevation: LOAD from CR6 skips L permission check because CALL already validated E.

**Security**: mLoad validates version, seal, bounds, L permission, and F-bit.

### SAVE (opcode 1)

```
SAVE CRd, CRs, #slot
```

Saves the GT in CRs to the c-list pointed to by CRd at the given slot. Requires S (save) permission on the target c-list. Source GT must have B=1 (bindable).

**Security**: mSave validates version, seal, bounds, S permission, B-bit, and F-bit on target slot.

### CALL (opcode 2)

```
CALL CRd
```

Enters the abstraction referenced by CRd. Requires E (enter) permission. Pushes current CR6, CR7, and PC onto the call stack. Loads target's c-list into CR6 and code (c-list[0]) into CR7. Sets PC=0. Clears B-bit on all preserved CRs.

### RETURN (opcode 3)

```
RETURN
```

Returns from the current abstraction. Pops saved CR6, CR7, and PC from the call stack. Shared between Church and Turing domains.

If the call stack is empty, RETURN triggers a reboot (warm restart) — not a halt.

### CHANGE (opcode 4)

```
CHANGE CRd, CRs
```

Copies a Context Register from CRs to CRd. Used to move Golden Tokens between register slots.

### SWITCH (opcode 5)

```
SWITCH CRd, CRs
```

Atomically swaps the contents of CRd and CRs. Used for thread context switching (swap CR8 for new thread identity).

### TPERM (opcode 6)

TPERM is the single-instruction GT health check. It evaluates permissions, validity, and bounds in one cycle and **sets condition flags** — it does not trap. The flags persist across subsequent instructions, enabling ARM-style conditional execution for zero-cost try-catch patterns.

```
TPERM CRs, #preset [, offset]
```

**What TPERM checks (all at once)**:
1. **Permissions** — does the GT have the requested permission bits? (R, W, RW, E, LSE, etc.)
2. **Valid** — does the GT pass version and MAC validation?
3. **Base + Limit** — if an offset is provided, is Base + offset within the GT's region?

**Flags set**:
- **Z = 1**: all checks passed (permissions present, valid, in bounds)
- **Z = 0**: one or more checks failed

**No trap**: TPERM never faults. If checks fail, the Z flag says so and software decides what to do via conditional execution. The CRs themselves enforce safety — an actual read/write to an invalid or out-of-bounds region will FAULT at that point. TPERM is the "ask first" instruction.

#### Conditional Execution: Zero-Cost Try-Catch

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

#### Permission Restriction (monotonic)

TPERM can also restrict permissions on a GT:

```
TPERM CRd, #preset
```

Permissions can only be removed, never added (monotonic restriction). Domain purity is enforced: Turing (R, W, X) and Church (L, S, E) permissions cannot be mixed.

**Presets**:

| Value | Name | Bits Set |
|-------|------|----------|
| 0 | CLEAR | None |
| 1 | R | R |
| 2 | RW | R, W |
| 3 | X | X |
| 4 | RX | R, X |
| 5 | RWX | R, W, X |
| 6 | L | L |
| 7 | S | S |
| 8 | E | E |
| 9 | LS | L, S |
| 10 | LE | L, E |
| 11 | SE | S, E |
| 12 | LSE | L, S, E |
| 13 | RWXLSE | All |

B-modifier variants (add 0x10): RB, RWB, XB, EB, etc. — sets B-bit alongside permissions.

**Design rationale**: TPERM is the single gateway for inspecting and restricting GT metadata — permissions, validity, type, stack indicators, and bounds. Keeping all metadata operations in one instruction minimises opcode usage and silicon cost while providing a uniform interface. The flag-setting (no-trap) design enables the conditional execution try-catch pattern that gives the happy path zero overhead.

### LAMBDA (opcode 7)

```
LAMBDA CRd
```

Applies the code object referenced by CRd in the current scope. Requires X (execute) permission. Does not switch c-lists — executes target code with caller's capabilities. Saves current PC as lambda return point. Machine-status fast path available for single-instruction targets.

### ELOADCALL (opcode 8)

```
ELOADCALL CRd, CRs, #slot
```

Fused LOAD + CALL. Loads a GT from CRs's c-list at slot, then immediately enters it. Equivalent to `LOAD CRd, CRs, #slot` followed by `CALL CRd`, but atomic.

### XLOADLAMBDA (opcode 9)

```
XLOADLAMBDA CRd, CRs, #slot
```

Fused LOAD + LAMBDA. Loads a GT from CRs's c-list at slot, then immediately applies it. Equivalent to `LOAD CRd, CRs, #slot` followed by `LAMBDA CRd`, but atomic.

---

## Turing Domain (10 Instructions + shared RETURN)

These instructions process data. They operate on Data Registers (DR0–DR15) and access DATA objects via R/W-permissioned GTs.

### DREAD (opcode 10)

```
DREAD DRd, CRs, #offset
```

Reads a 32-bit word from the DATA object referenced by CRs at the given offset into DRd. Requires R (read) permission.

### DWRITE (opcode 11)

```
DWRITE CRd, DRs, #offset
```

Writes DRs to the DATA object referenced by CRd at the given offset. Requires W (write) permission.

### BFEXT (opcode 12)

```
BFEXT DRd, DRs, #width, #lsb
```

Extracts a bitfield from DRs. Width and LSB position are encoded in the immediate field.

### BFINS (opcode 13)

```
BFINS DRd, DRs, #width, #lsb
```

Inserts a bitfield from DRs into DRd at the specified position.

### MCMP (opcode 14)

```
MCMP DRd, DRs
```

Compares DRd and DRs, setting condition flags (N, Z, C, V) without storing a result. Used before conditional instructions.

### IADD (opcode 15)

```
IADD DRd, DRs, #imm
```

Integer addition. DRd = DRs + imm. Sets condition flags.

### ISUB (opcode 16)

```
ISUB DRd, DRs, #imm
```

Integer subtraction. DRd = DRs - imm. Sets condition flags.

### BRANCH (opcode 17)

```
BRANCH #offset
BRANCHEQ #offset
BRANCHNE #offset
```

Branches to PC + offset (signed). Always conditional-compatible. Offset is relative to the current instruction.

### SHL (opcode 18)

```
SHL DRd, DRs, #amount
```

Logical shift left. DRd = DRs << amount.

### SHR (opcode 19)

```
SHR DRd, DRs, #amount
```

Logical shift right. DRd = DRs >> amount.

---

## Assembly Syntax

### Labels

```asm
loop:
    IADD DR1, DR1, #1
    BRANCHNE loop
```

### Comments

```asm
LOAD CR0, CR6, #4    ; Load Salvation from c-list slot 4
CALL CR0             -- Enter the abstraction
```

Both `;` and `--` introduce comments.

### Register Names

- Context registers: `CR0` through `CR15`
- Data registers: `DR0` through `DR15`

### Immediate Values

- Decimal: `#42`
- Hexadecimal: `#0x2A`
- Negative: `#-1`
