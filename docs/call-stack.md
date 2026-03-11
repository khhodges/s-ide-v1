# Call Stack, CALL/RETURN, and Thread Switching

## CALL Operation

The CALL instruction invokes a protected abstraction (service or function) referenced by a Golden Token. It saves the caller's context so that execution can resume after the callee returns.

### CALL Flow

| Step | Detail |
|------|--------|
| **1. Permission Check** | E (Enter) on source CR |
| **2. GT Validation** | Version match + MAC seal validation |
| **3. Context Save** | PC, CR5, CR6, CR14, LAMBDA-active pushed to call stack |
| **3a. LAMBDA Clear** | Clears LAMBDA-active flag (callee gets clean LAMBDA state) |
| **4. Stack Check** | FAULT if stack full (256 frames) |
| **5. Register Setup** | CR6 = callee C-List (M-bit set), CR14 = callee code (privileged) |
| **6. Register Clearing** | CR5 cleared after push; software clears others |
| **7. PC Update** | PC set to namespace entry Location |

---

## RETURN Operation

The RETURN instruction has two paths: a **LAMBDA fast path** and a **stack path**.

### LAMBDA Fast Path

When RETURN executes and the LAMBDA-active flag is set in machine status:
1. Restore PC from LAMBDA_PC machine status register
2. Clear LAMBDA-active flag
3. Zero stack access — pure machine-status operation

### Stack Path (CALL Frame)

When RETURN executes and LAMBDA-active is NOT set, pop the top stack frame:

| Aspect | Detail |
|--------|--------|
| **Permission Check** | None |
| **Restored Registers** | CR5, CR6 (M-bit set), CR14, PC (+4) |
| **LAMBDA State Restore** | Restores LAMBDA-active from frame |
| **Stack Underflow** | FAULT: "No saved context to restore" |
| **Stack Indicators** | Updates stackFrames and stackSpace flags |

RETURN requires no permission -- it is always permitted if a saved context exists on the call stack. If the stack is empty, a FAULT is triggered.

When RETURN restores a CALL frame that was pushed while LAMBDA was active, the LAMBDA-active flag and LAMBDA_PC are restored from the frame. This means the next RETURN will use the LAMBDA fast path, correctly completing the interrupted LAMBDA return. This is how CALL-mediated LAMBDA nesting works: CALL saves the LAMBDA state, the callee runs freely, and RETURN restores the LAMBDA return path.

In Church Machine, the M-bit is set on the restored CR6. This marks the C-List as having Machine permission, indicating that the caller's context has been properly restored through the hardware return mechanism.

---

## CR5 Save Area

CR5 serves as a programmer-controlled register for call frame data. It provides a mechanism for passing data between caller and callee:

- Before CALL, the caller can place data in CR5 that the callee needs.
- The hardware automatically pushes CR5 to the call stack during CALL.
- The hardware restores CR5 from the call stack during RETURN.
- After CALL completes (entering the callee), CR5 is cleared.

This gives the programmer a dedicated register for inter-abstraction data transfer without relying on global state or shared memory.

---

## Stack Indicators (Church Machine)

Church Machine provides two 1-bit stack indicator flags that are automatically maintained by the CALL and RETURN microcode:

| Flag | Meaning |
|------|---------|
| **stackSpace** | 1 = room for at least one more frame on the call stack (CALL is safe) |
| **stackFrames** | 1 = at least one frame exists on the call stack (RETURN is safe) |

These flags are visible on the Dashboard and can be tested programmatically using the TPERM instruction.

---

## TPERM Instruction (Church Machine)

The TPERM (Test Permission) instruction tests the permissions, validity, type, and stack indicators of a Golden Token and writes the result to a data register.

**Mnemonic**: `CAP.TPERM rd, CRs`

**Result Layout (rd)**:

| Bits | Field | Description |
|------|-------|-------------|
| [5:0] | Permissions | R, W, X, L, S, E from the CRs Golden Token |
| [7:6] | Reserved | Zero |
| [8] | stackFrames | 1 = at least one frame on call stack |
| [9] | stackSpace | 1 = room for at least one more frame |
| [10] | Valid | 1 = GT passes version and MAC validation |
| [12:11] | Type | GT type: 00=Inform, 01=Outform, 10=NULL, 11=Abstract |
| [31:13] | Reserved | Zero |

TPERM allows software to inspect capability metadata and stack state without triggering a FAULT. This is useful for conditional logic: check whether a CALL is safe (stackSpace=1) before attempting it, or verify that a token has the required permissions before using it.

---

## Stack Overflow Protection

The Church Machine prevents stack overflow with a hardware-enforced 256-frame limit. If the call stack is full when a CALL is executed, an immediate FAULT is triggered. The stackSpace indicator (testable via TPERM) allows software to check for available space before calling.

---

## CHANGE: Thread Context Switching

The CHANGE instruction performs thread context switching by modifying the thread identity.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `CHANGE CRs` |
| **Required Permission** | E (Enter) on source CR |
| **Operation** | Full atomic thread swap via thread table |
| **Context Saved** | DR0-DR15, CR0-CR11, CR14, CR15, PC, LAMBDA state saved to thread table |
| **Context Loaded** | Target thread's registers, CRs, PC, LAMBDA state loaded from thread table |
| **CR12-CR13** | Unchanged (system-wide: fault handler and interrupt handler) |

CHANGE performs a full atomic swap. Per-thread context saved/restored: data registers DR0-DR15, programmer-accessible capability registers CR0-CR11, per-thread privileged registers CR14 (code) and CR15 (namespace), and the PC. System-wide registers CR12 (data fault handler) and CR13 (interrupt handler) are shared across all threads and remain unchanged during CHANGE. The thread table stores complete thread contexts indexed by the GT's namespace index, and entries are created on first use.

---

## SWITCH: The Privilege Gate

The SWITCH instruction is the sole mechanism for writing to privileged registers CR12-CR15. It copies a capability from an instruction-addressable register into a privileged register.

| Aspect | Detail |
|--------|--------|
| **Mnemonic** | `SWITCH CRs, target` |
| **Required Permission** | M (Machine) on source CR |
| **Target Field** | 2-bit: 0=CR12(fault), 1=CR13(interrupt), 2=CR14(code), 3=CR15(namespace) |

SWITCH is architecturally significant because it is the only way to escalate privilege. All other instructions are confined to CR0-CR11. To modify the namespace root (CR15), the fault handler (CR12), the interrupt handler (CR13), or the code register (CR14), code must possess a valid capability with the appropriate permission and use SWITCH to install it.
