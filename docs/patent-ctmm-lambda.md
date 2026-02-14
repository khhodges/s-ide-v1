# INITIAL PATENT SUBMISSION

## Church-Turing Meta-Machine: Hardware-Enforced Lambda Calculus with the LAMBDA Instruction and NULL Capability Type

---

**Inventor**: Kenneth James Hamer-Hodges

**Filing Date**: February 12, 2026

**Classification**: Computer Architecture; Hardware Security; Capability-Based Computing; Lambda Calculus Implementation

---

## TITLE OF THE INVENTION

Church-Turing Meta-Machine: Hardware-Enforced Lambda Calculus with the LAMBDA Instruction and NULL Capability Type

---

## CROSS-REFERENCE TO RELATED APPLICATIONS

This application relates to capability-based computer architecture, hardware-enforced security through unforgeable tokens ("Golden Tokens"), and the integration of Church's lambda calculus and Turing's computational model into a unified processor architecture known as the Church-Turing Meta-Machine (CTMM).

---

## FIELD OF THE INVENTION

The present invention relates generally to computer processor architecture and, more specifically, to a hardware architecture that unifies Church's lambda calculus with Turing's computational model through a dedicated lightweight LAMBDA instruction for in-scope code application, a NULL capability type for safe initialization and revocation, and self-describing stack frames with a 1-bit tag distinguishing LAMBDA frames from CALL frames, achieving both provable security guarantees and significant performance improvements for code reuse within a capability-based protection system.

---

## BACKGROUND OF THE INVENTION

### The Security Problem

Contemporary computer architectures, derived from von Neumann's 1945 stored-program design, lack hardware-enforced boundaries between code and data, between different programs, and between privilege levels. Software-based security mechanisms (access control lists, virtual memory page tables, privilege rings) are bolt-on mitigations that have repeatedly proven insufficient against modern attacks including buffer overflows, return-oriented programming (ROP), use-after-free exploits, and privilege escalation.

### The Performance Problem

Capability-based architectures address the security problem by requiring unforgeable tokens for every memory access, but they impose significant per-access validation overhead. Every capability dereference requires checking permissions, validating integrity seals (MAC), verifying version numbers, and performing namespace lookups. For lightweight code reuse — applying a small utility function that lives in the same protection domain — the full domain-crossing overhead of a CALL instruction (stack frame allocation, capability list switch, mLoad revalidation) is unnecessary and wasteful. The code body is already validated; it shares the same protection domain as the caller.

### The Conceptual Gap

Existing capability architectures provide only one mechanism for invoking code: the heavyweight CALL instruction that crosses protection domain boundaries. This conflation of in-scope code application with cross-domain service invocation forces all function calls through the same expensive validation path, regardless of whether a domain crossing is semantically required. Church's lambda calculus provides the theoretical framework to resolve this: the distinction between function application within a scope (λ-application) and invocation across a boundary (service call) is fundamental to the calculus and maps directly onto the distinction between the LAMBDA instruction (X permission, same domain) and the CALL instruction (E permission, domain crossing).

### The Initialization Problem

Existing capability architectures lack a clean representation for "empty" or "invalid" capability registers. When a thread is created, when a capability is revoked, or when a register slot is freed, there is no architecturally distinct marker that hardware can recognize as "this register holds nothing." Without such a marker, garbage collection cannot distinguish an empty register from one holding a valid capability with index zero, initialization code must use ad-hoc sentinel values, and revocation cannot cleanly invalidate a register without leaving ambiguous state.

### Prior Art — PP250 Capability Architecture

The present invention builds upon a body of prior work in capability-based computer architecture developed principally at Plessey Telecommunications and subsequently at ITT/Standard Electric Corporation during the period 1969–1984. These patents established the foundational concepts of capability registers, memory protection through unforgeable tokens, segmented memory access, multi-processor capability systems, and information flow security. The present invention extends this foundation with innovations not disclosed or suggested by the prior art: a NULL capability type for safe initialization and revocation, a lightweight LAMBDA instruction for in-scope code application with machine-status fast-path return, and self-describing stack frames with a 1-bit tag distinguishing LAMBDA from CALL frames.

#### A. Core Capability Architecture (Cotton, Plessey, 1969–1973)

**DE2000066A1** — "Data processing arrangement" (Cotton, Plessey, priority 1969-01-02). Discloses a data processing arrangement using procedures divided into functions, each controlled by program instructions stored in a single memory area. Establishes the principle of function-level execution control within segmented memory.

**DE2126206C3** — "Data processing device with memory protection arrangement" (Cotton, Cole, Plessey, priority 1970-05-26). Discloses a memory protection arrangement using capability registers, each storing a capability word that authorizes access to information segments in memory. Establishes the fundamental concept of capability registers mediating all memory access — the architectural ancestor of Golden Tokens.

**DE2303596C2** — "Data processing arrangement" (Cotton, Plessey, priority 1972-01-26). Discloses a data processing arrangement with capability words stored in capability registers for accessing segments in main memory. Extends the capability register concept with refined access control semantics.

**US3771146A** — "Data processing system interrupt arrangements" (Cotton, Williams, Cosserat, Plessey, priority 1972-01-26, granted 1973-11-06). Discloses interrupt handling arrangements in a capability-based data processing system, addressing the problem of secure context switching when interrupts occur during capability-protected execution.

**CA945264A** — "Program interrupt facilities in data processing systems" (Cotton, Plessey, priority 1970-09-02, granted 1974-04-09). Discloses program interrupt facilities for capability-based systems, establishing mechanisms for asynchronous event handling within capability-protected execution environments.

#### B. Multi-Processor Capability Systems (Boom, Arnold, Plessey, 1969–1974)

**US3657736A** — "Method of assembling subroutines" (Boom, Plessey, priority 1969-01-02, granted 1972-04-18). Discloses intercommunication arrangements for multiprocessor systems of the distributed algorithm type, with input/output data wells for subroutine communication. Establishes the principle of structured data passing between computational units.

**DE2230830C2** — "Data processing system" (Arnold, Boom, Plessey, priority 1971-06-24, granted 1985-03-21). Discloses a multi-processor data processing system with multiple peripheral devices, memory modules, and processor modules, each having dedicated access units. Establishes the architectural framework for multi-module capability-based systems.

**CA958490A** — "Multi-processor data processing system" (Arnold, Boom, priority 1971-06-24, granted 1974-11-26). Canadian filing of the multi-processor architecture, covering the coordination of multiple processor modules within a capability-protected memory hierarchy.

#### C. Memory Management and Deallocation (Venton, Plessey, 1975)

**US4121286A** — "Data processing memory space allocation and deallocation arrangements" (Venton, Plessey, priority 1975-10-08, granted 1978-10-17). Discloses the mechanism for deallocating master capability table (MCT) entries when storage blocks are returned, and the problem of cancelling capability pointers that still exist in the live system. This patent is directly relevant to the present invention's garbage collection mechanism (PP250 three-phase Mark-Scan-Sweep), which addresses the same fundamental problem — invalidating stale capability references — through version bumping rather than explicit cancellation.

#### D. Information Security and Data Handling (Hamer-Hodges, Plessey, 1976–1984)

**MY8400351A** — "Information flow security mechanisms for data processing systems" (Hamer-Hodges, Plessey, priority 1976-07-30). Discloses information flow security mechanisms ensuring that data moves only through authorized paths within a capability-based system. Establishes the principle of hardware-enforced information flow control that the present invention extends through the GT Type field's enforcement of capability classification boundaries.

**CA1132251A** — "Data handling equipment for use with sequential access digital data storage" (Hamer-Hodges, priority 1976-11-17, granted 1982-09-21). Discloses a disc buffer peripheral access unit with a random access memory equivalent to one complete disc track, with command and status registers at sector boundaries. Addresses peripheral integration within capability-protected systems.

**HK31983A** — "Improvements in or relating to information protection arrangements in data processing systems" (Hamer-Hodges, Plessey, priority 1977-05-04). Discloses refined information protection arrangements for capability-based data processing, extending the security model with additional protection mechanisms.

#### E. Telecommunications Capability Systems (Cotton, Lawrence, ITT, 1978–1979)

**DE2909762A1** — "Remote communication system" (Cotton, ITT/Standard Electric, priority 1978-03-17). Discloses capability-based principles applied to telecommunications switching, extending the PP250 architecture's concepts to distributed communication systems.

**DD143994A5** — "Telecommunications switching system" (Lawrence, ITT/Standard Electric, priority 1979-04-05). Discloses a flexible telecommunications switching system with modular expansion capability, applying capability-based design principles to switching network architecture.

#### F. Distinction from Prior Art

The above prior art establishes capability registers (DE2126206C3), capability-mediated memory access (DE2303596C2), multi-processor capability systems (DE2230830C2), capability deallocation and reference invalidation (US4121286A), information flow security (MY8400351A), and interrupt handling within capability-protected environments (US3771146A, CA945264A).

However, none of the prior art discloses or suggests:

1. **A NULL capability type** within the capability token's type field that architecturally represents an empty, invalid, or revoked capability register, detectable by hardware at every instruction, causing an immediate FAULT on any operation — enabling clean initialization, safe revocation, and unambiguous garbage collection scanning (Claims 1, 2)

2. **A lightweight LAMBDA instruction** for in-scope code application that uses Execute (X) permission to branch to a code body within the same protection domain, passing arguments and receiving results through data registers, without stack frame allocation, capability list switching, or namespace revalidation — in contrast to the CALL instruction which uses Enter (E) permission and crosses protection domain boundaries (Claims 3, 4)

3. **A machine-status fast path** for LAMBDA return addresses, wherein the return PC and LAMBDA-active flag reside in machine status registers rather than the capability stack in the common case (LAMBDA → body → RETURN), achieving zero stack access for lightweight code application; with the stack accessed only when a CALL or CHANGE instruction intervenes during the LAMBDA body (Claim 5)

4. **Self-describing stack frames with a 1-bit tag** distinguishing CALL frames from LAMBDA frames, enabling the RETURN instruction to determine the correct restoration path by inspecting the frame tag — restoring full domain context for CALL frames versus restoring only the program counter for LAMBDA frames (Claim 6)

5. **Non-nestable LAMBDA with CALL-mediated nesting**, wherein a second LAMBDA instruction while the LAMBDA-active flag is set causes a FAULT, but a CALL instruction during a LAMBDA body saves the LAMBDA machine status as part of its frame, clearing the LAMBDA-active flag and thereby permitting a nested LAMBDA within the called domain (Claim 7)

6. **Network-transparent RPC** using cryptographic keys stored in standard namespace entries (accessed via CAP.LOAD with R permission), where garbage collection of the namespace entry instantly revokes the tunnel by bumping the version (Claim 10)

The prior art's capability registers hold references exclusively but lack a hardware-enforced NULL state for empty or invalid registers. The prior art provides only heavyweight domain-crossing invocation (CALL) for all code execution. The present invention's GT Type field adds a NULL type for safe initialization and revocation, and the LAMBDA instruction provides a lightweight in-scope code application path that complements the heavyweight CALL path — the Church-Turing marriage of lambda application within a domain and service invocation across domains.

---

### Prior Art Limitations — Academic Capability Architectures

Beyond the PP250 patent family, academic capability architectures including Cambridge CAP (Wilkes and Needham, 1979), IBM System/38 (Berstis, 1980), Intel iAPX 432 (Pollack et al., 1981), and CHERI (Watson et al., 2015) treat all capability register contents as either valid references or raw data. No prior architecture provides:

1. A hardware-enforced NULL capability type that represents an empty or invalid register, distinct from any valid reference, detectable at every instruction
2. A lightweight in-scope code application instruction (LAMBDA) that stays within the current protection domain using X permission, as distinct from a domain-crossing CALL using E permission
3. Self-describing stack frames with a tag bit distinguishing lightweight LAMBDA frames from heavyweight CALL frames
4. A machine-status fast path that avoids stack access entirely for the common LAMBDA → body → RETURN pattern

---

## SUMMARY OF THE INVENTION

The present invention provides a processor architecture, the Church-Turing Meta-Machine (CTMM), that implements Church's lambda calculus in hardware through a clean separation of concerns and a lightweight code application mechanism:

1. **Golden Token (GT) Type Field**: A 2-bit field in every capability token that architecturally classifies four categories: Inform (local reference), Outform (remote reference), NULL (empty/invalid), and Spare (reserved for future use). The Type field determines the hardware execution path at every instruction. The clean architectural rule is: capability registers (CRs) hold capabilities only, data registers (DRs) hold values only. No mixing.

2. **NULL Type (Type = 10)**: A capability register encoding that represents an empty, invalid, or revoked capability. Any operation on a NULL-typed GT causes an immediate FAULT. NULL enables clean initialization (freshly created threads have all CRs set to NULL), safe revocation (revoking a capability sets the register to NULL), and unambiguous garbage collection (the scanner can distinguish empty registers from valid capabilities with index zero).

3. **LAMBDA Instruction**: A dedicated hardware instruction for Church's function application: `LAMBDA CRn, x`. CRn holds a Golden Token with X (Execute) permission pointing to a code body in the same protection domain. The data register x holds the argument. LAMBDA saves only the return address (PC+4) to a machine status register, sets the LAMBDA-active flag, and branches to the code body. Arguments and results flow through data registers. Unlike CALL (E permission, domain crossing, full stack frame), LAMBDA stays within the current protection domain with near-zero overhead — a macro that doesn't replicate the code base.

4. **Machine-Status Fast Path**: In the common case (LAMBDA → body → RETURN), the return PC and LAMBDA-active flag live in machine status registers, not the capability stack. RETURN checks the LAMBDA-active flag: if set, it restores PC from the machine status register with zero stack access. The stack is only accessed when CALL or CHANGE intervenes during the LAMBDA body.

5. **Self-Describing Stack Frames**: Every stack frame carries a 1-bit tag: CALL frame (0) or LAMBDA frame (1). When RETURN pops a frame from the stack (because the machine-status fast path was not available), the tag tells RETURN whether to perform full domain restoration (CALL) or simple PC restoration (LAMBDA). This makes the thread's call history self-describing.

6. **Non-Nestable LAMBDA with CALL-Mediated Nesting**: A second LAMBDA while LAMBDA-active is set causes a FAULT, preventing uncontrolled nesting. However, a CALL during a LAMBDA body saves the LAMBDA machine status as part of the CALL frame, clears the LAMBDA-active flag, and thereby permits a nested LAMBDA within the called procedure. This provides controlled nesting through the existing CALL/RETURN infrastructure.

The architecture achieves macro-like code reuse efficiency — code exists once in memory, near-zero overhead per invocation, no code duplication — while maintaining the full security guarantees of the capability model for all reference-oriented operations. The Church-Turing marriage is explicit: the GT *is* the lambda (Church's λx.body), data registers hold arguments and results (Turing's computation), LAMBDA bridges them with X permission (execute code, same domain), and CALL bridges with E permission (enter domain, cross boundary).

---

## DETAILED DESCRIPTION OF THE INVENTION

### 1. Architecture Overview

The Church-Turing Meta-Machine (CTMM) is a processor architecture built on the principle that every computational resource — code, data, I/O, network objects, cryptographic keys — is accessed exclusively through unforgeable capability tokens called **Golden Tokens (GTs)**. The architecture integrates two foundational computational models with a clean separation:

- **Turing's model**: Data registers (x0-x31 in the 32-bit implementation, DR0-DR15 in the 64-bit implementation) hold numeric values and perform arithmetic, logic, comparison, and branching. This is the computational substrate. Data registers hold values — and only values.

- **Church's model**: Capability registers (CR0-CR15) hold Golden Tokens that name, protect, and mediate access to every resource. The GT's Type field classifies each token. Capability registers hold capabilities — and only capabilities.

This clean separation is fundamental: CRs never hold raw values, DRs never hold capabilities. The LAMBDA instruction bridges the two domains by using a capability (the GT with X permission in a CR) to execute code that operates on values (arguments and results in DRs).

The synthesis is expressed as the **Church-Lambda-Object-Oriented-Meta-Calculus (CLOOMC)**, which organizes GT permissions into three domains:

| Domain | Permissions | Purpose |
|--------|------------|---------|
| Turing | R (Read), W (Write), X (Execute) | Data access and code execution |
| Church | L (Load), S (Save) | Capability transfer between C-Lists |
| Lambda | E (Enter) | Protection domain crossing |

A seventh permission, M (Meta), is transient — elevated by microcode during RETURN and CHANGE instructions, never stored in the GT itself.

### 2. The Golden Token Format

#### 2.1 Standard GT Format (32-bit Implementation)

```
GT [31:0]:
  [31:25] Version     (7 bits)  — Namespace entry version for cross-check
  [24:8]  Index       (17 bits) — Namespace table index
  [7:2]   Permissions (6 bits)  — R, W, X, L, S, E
  [1:0]   Type        (2 bits)  — Resource classification
```

#### 2.2 GT Type Field

The 2-bit Type field classifies every Golden Token:

| Value | Type | Semantic Category | Hardware Behavior |
|-------|------|------------------|-------------------|
| 00 | Inform | Name (local) | Dereference through mLoad: validate MAC, version, permissions, namespace lookup |
| 01 | Outform | Name (remote) | Dereference through HTTPS fetch/flush or RPC tunnel |
| 10 | NULL | Empty/invalid | FAULT on any operation — register is empty, revoked, or uninitialized |
| 11 | Spare | Reserved | Reserved for future architectural extension; FAULT on any operation |

This classification reflects the clean architectural separation:

- **Inform** is a *local name* — it refers to a resource in the local namespace and requires evaluation (dereferencing through the mLoad validation path)
- **Outform** is a *remote name* — it refers to a resource at a network location and requires evaluation (HTTPS fetch or RPC tunnel)
- **NULL** is *nothing* — the register is empty. Any attempt to use it FAULTs immediately. This is the safe, unambiguous "no capability" state
- **Spare** is *reserved* — available for future architectural extension without changing the existing type encodings

The Type field is checked by hardware at every instruction. A NULL or Spare GT cannot be dereferenced, loaded, saved, called, or used in any capability operation — the hardware rejects it before any validation path is entered.

#### 2.3 The NULL Type

The NULL type (10) serves three critical architectural roles:

**Initialization**: When a thread is created, all capability registers that are not explicitly loaded with valid GTs are set to NULL. This provides a clean, unambiguous initial state — the hardware knows these registers hold nothing, rather than potentially valid capabilities with coincidental bit patterns.

**Revocation**: When a capability must be revoked (e.g., access rights withdrawn, resource deallocated), the capability register is set to NULL. Any subsequent attempt to use the revoked capability FAULTs immediately with a clear diagnostic: the register holds NULL, not a stale or forged reference.

**Garbage Collection**: The NULL type enables the GC scanner to unambiguously distinguish empty registers from valid capabilities. Without NULL, a register holding all zeros could be confused with a valid Inform GT pointing to namespace index 0 with version 0 and no permissions. With NULL (Type = 10), the scanner knows immediately that the register does not reference any namespace entry and can be skipped.

### 3. The LAMBDA Instruction

#### 3.1 Instruction Format

```
LAMBDA CRn, x
```

**Operands**:
- `CRn`: A capability register holding a Golden Token with **X (Execute) permission** pointing to an executable code object in the same protection domain (Inform type). This is Church's lambda — the code body λx.body.
- `x`: A data register holding the argument value. This is the bound variable — the input to the function.

**Operation**: LAMBDA applies the code body referenced by CRn to the argument in data register x. It is Church's function application: (λx.body)(arg). The result is returned in data registers by the code body.

#### 3.2 Execution Sequence

```
Step 1: Verify CRn.Type = Inform (00) → FAULT if NULL (10), Outform (01), or Spare (11)
Step 2: Check X permission on CRn → FAULT if X bit not set
Step 3: Check LAMBDA-active flag in machine status → FAULT if already set (non-nestable)
Step 4: Save return address (PC+4) to machine status register (LAMBDA_PC)
Step 5: Set LAMBDA-active flag in machine status
Step 6: Branch to CRn's code entry point
Step 7: Body instructions execute using data registers for computation
Step 8: Body executes RETURN → hardware detects LAMBDA-active flag
Step 9: Restore PC from LAMBDA_PC machine status register
Step 10: Clear LAMBDA-active flag
Step 11: Execution continues at PC+4 (the instruction after LAMBDA)
```

#### 3.3 Machine-Status Fast Path

In the common case — LAMBDA → body → RETURN with no intervening CALL or CHANGE — the entire invocation uses zero stack access:

- The return address (PC+4) is stored in the **LAMBDA_PC machine status register**, not pushed to the capability stack
- The LAMBDA-active flag is a single bit in the **machine status register**, not a stack entry
- RETURN checks the LAMBDA-active flag first: if set, it restores PC from LAMBDA_PC and clears the flag — no stack pop, no frame inspection, no mLoad revalidation

This fast path makes LAMBDA as efficient as a branch-and-link instruction with a hardware return address register, while maintaining the capability security model (X permission is verified on entry).

#### 3.4 Stack Interaction: When CALL Intervenes

If a CALL instruction is executed during a LAMBDA body, the CALL instruction saves the LAMBDA machine status as part of its stack frame:

```
CALL stack frame (when LAMBDA-active):
  [Tag = 0]           — CALL frame tag
  [LAMBDA_PC]         — saved LAMBDA return address from machine status
  [LAMBDA_active = 1] — saved LAMBDA-active flag
  [CR5, CR6, CR7]     — saved capability registers (standard CALL save)
  [PC_return]         — CALL return address
```

After saving, CALL clears the LAMBDA-active flag in machine status, because the called domain is a fresh context. This permits a nested LAMBDA within the called procedure.

When the CALL RETURNs, the RETURN instruction restores the saved LAMBDA machine status from the CALL frame, re-establishing the LAMBDA-active flag and LAMBDA_PC. The LAMBDA body then continues, and its eventual RETURN uses the fast path.

#### 3.5 Stack Interaction: When CHANGE Intervenes

If a CHANGE instruction (thread context switch) occurs during a LAMBDA body, the CHANGE instruction saves the LAMBDA machine status to the thread memory object:

```
Thread context (LAMBDA-related fields):
  [LAMBDA_PC]         — saved LAMBDA return address
  [LAMBDA_active]     — saved LAMBDA-active flag
```

When the thread is resumed by a subsequent CHANGE, these fields are restored to machine status registers, and the LAMBDA body continues seamlessly.

#### 3.6 Self-Describing Stack Frames

Every frame on the capability stack carries a **1-bit tag** identifying its type:

| Tag | Frame Type | Contents | RETURN Behavior |
|-----|-----------|----------|----------------|
| 0 | CALL frame | CR5, CR6, CR7, PC, LAMBDA state | Full domain restoration: restore CRs, switch C-List, revalidate via mLoad |
| 1 | LAMBDA frame | PC only | Simple PC restoration: pop return address, resume |

LAMBDA frames appear on the stack only when a CALL intervenes during a LAMBDA body and the LAMBDA state must be saved. In the common case (no CALL intervention), no LAMBDA frame is ever pushed — the machine-status fast path handles everything.

The 1-bit tag makes the thread's execution history self-describing: by walking the stack and inspecting tags, the system can reconstruct the exact interleaving of LAMBDA and CALL invocations without external metadata.

#### 3.7 Non-Nestable LAMBDA with CALL-Mediated Nesting

LAMBDA is non-nestable on its own: if the LAMBDA-active flag is set in machine status and a second LAMBDA instruction is executed, the hardware generates a FAULT. This prevents uncontrolled nesting depth and eliminates the need for a hardware LAMBDA return stack.

However, nesting is possible through CALL mediation:

```
LAMBDA CR2, x10        ; LAMBDA-active set, LAMBDA_PC saved
  ; ... LAMBDA body ...
  CALL CR5              ; saves LAMBDA state to stack, clears LAMBDA-active
    ; ... called procedure ...
    LAMBDA CR3, x11     ; permitted: LAMBDA-active was cleared by CALL
      ; ... nested LAMBDA body ...
      RETURN            ; fast path: restore from machine status
    ; ... called procedure continues ...
    RETURN              ; pops CALL frame, restores LAMBDA state
  ; ... LAMBDA body continues ...
  RETURN                ; fast path: restore from machine status (re-established by CALL RETURN)
```

This design provides controlled nesting: each nesting level is mediated by a CALL/RETURN pair that manages the LAMBDA state on the stack. The nesting depth is bounded by the stack depth, which is already managed by the capability architecture.

#### 3.8 Key Distinction from CALL

The LAMBDA instruction and the CALL instruction serve fundamentally different purposes:

| Property | LAMBDA | CALL |
|----------|--------|------|
| Permission required | X (Execute) | E (Enter) |
| Protection domain | Same (no C-List change) | Crosses to new domain |
| Stack frame (common case) | None (machine status registers) | Full (CR5/CR6/CR7 + PC + LAMBDA state) |
| mLoad validation | None (body already validated) | Full path for new C-List |
| CR6 (C-List) | Unchanged | Switched to callee's C-List |
| Arguments/results | Data registers (x0-x31) | Data registers (x0-x31) |
| CR writes | None — LAMBDA does not write to CRs | mLoad writes to CRs during C-List switch |
| Code reuse model | Macro-like: code once, invoke many times | Service: encapsulated domain with own C-List |
| Overhead | ~2 cycles (verify + branch) | 10+ cycles (frame push + C-List switch + mLoad + branch) |
| Purpose | In-scope code application | Cross-domain service invocation |

LAMBDA is the lightweight path for code that lives in the same protection domain — a macro that doesn't replicate the code base. CALL is the heavyweight path for crossing into a different protection domain with its own capability list and namespace view.

The distinction is Church's: application within a domain (λ-application, X permission) vs. invocation across a domain (service call, E permission).

#### 3.9 The Golden Rule — Strengthened

The **Golden Rule** of the CTMM architecture is: mLoad is the sole trusted path for all capability register writes that involve namespace dereferencing. The LAMBDA instruction strengthens this rule because LAMBDA does not write to capability registers at all. It branches to code and returns. Arguments and results flow through data registers, not capability registers. The capability register file is untouched by LAMBDA execution.

This makes LAMBDA safe by construction: it cannot forge, modify, or create capabilities. It merely executes code (verified by X permission check) on values (in data registers). The capability register file's integrity is preserved without any validation overhead.

### 4. Security Model

#### 4.1 Clean Separation: CRs = Capabilities, DRs = Values

The CTMM architecture enforces a clean separation between the capability domain and the value domain:

- **Capability registers (CRs)** hold Golden Tokens exclusively. Every GT in a CR has a Type field (Inform, Outform, NULL, or Spare) and is subject to hardware type checking at every instruction. CRs never hold raw numeric values.

- **Data registers (DRs)** hold numeric values exclusively. DRs are the computational substrate for arithmetic, logic, comparison, and branching. DRs never hold capabilities.

This separation is enforced by the instruction set architecture:

- Church instructions (CAP.LOAD, CAP.SAVE, CALL, RETURN, CHANGE, SWITCH) operate on CRs and route through the mLoad validation path
- Turing instructions (ADD, SUB, MUL, AND, OR, SLL, LW, SW, BEQ, etc.) operate on DRs and perform computation
- The LAMBDA instruction bridges the two: it reads a capability (GT with X permission in a CR) and operates on values (arguments and results in DRs)

There are no instructions that move raw values into capability registers or extract raw bits from capabilities into data registers. The domains are architecturally sealed.

#### 4.2 NULL Safety

The NULL type provides fail-safe behavior for uninitialized, revoked, or empty capability registers:

1. **Any operation on NULL FAULTs**: Attempting to dereference (CAP.LOAD), invoke (CALL), save (CAP.SAVE), load (CAP.LOAD as source), execute (LAMBDA), or otherwise use a NULL-typed GT causes an immediate hardware FAULT. There is no "undefined behavior" — the hardware catches every use of an invalid capability.

2. **NULL is unforgeable**: The Type field (bits [1:0]) is set by hardware during initialization and revocation. Software cannot construct a NULL GT by writing arbitrary bits to a capability register — only mLoad and the hardware initialization/revocation path can set the Type field.

3. **NULL is unambiguous**: The NULL type (10) is distinct from all valid capability types. A NULL GT cannot be confused with an Inform GT, an Outform GT, or a Spare GT. The 2-bit Type field makes the distinction at every instruction cycle.

#### 4.3 LAMBDA Security

The LAMBDA instruction maintains capability security through several mechanisms:

1. **X permission check**: LAMBDA verifies that the target GT has X (Execute) permission before branching. Code without X permission cannot be invoked via LAMBDA.

2. **Same-domain constraint**: LAMBDA requires Inform type (local reference). An Outform GT cannot be LAMBDA'd — remote code requires CALL with E permission through the RPC tunnel. This prevents LAMBDA from being used for unauthorized network access.

3. **Non-escalation**: LAMBDA does not write to capability registers. It cannot forge, create, or modify GTs. The capability register file is untouched by LAMBDA execution. Only mLoad can write to CRs.

4. **Non-nestable safety**: The LAMBDA-active FAULT on double-LAMBDA prevents uncontrolled stack growth and ensures the machine-status fast path is always correct (there is at most one pending LAMBDA return address in machine status).

5. **CALL-mediated nesting**: When CALL saves the LAMBDA state to the stack, the saved state is protected by the capability stack's integrity — it cannot be tampered with by the called procedure. When CALL RETURNs, the LAMBDA state is restored from the stack with the same integrity guarantees as any CALL frame restoration.

### 5. The mLoad Master Validation Path

The mLoad function is the single trusted path for all namespace access in the CTMM architecture. Every Church instruction (CAP.LOAD, CAP.SAVE, CAP.CALL, CAP.RETURN, CAP.CHANGE, CAP.SWITCH) routes through mLoad. This is the **Golden Rule**: mLoad is the sole path for all capability register writes that involve namespace dereferencing.

The LAMBDA instruction is significant precisely because it provides a validated code execution path that **does not go through mLoad**. This is safe because:

- LAMBDA does not write to capability registers — it branches to code and returns through data registers
- The LAMBDA body's X permission was validated when the body GT was loaded via mLoad (at an earlier point)
- The LAMBDA instruction verifies X permission on the GT before branching
- The data registers used for arguments and results are in the Turing domain, not the Church domain

This strengthens the Golden Rule rather than violating it: mLoad remains the sole path for all CR writes. LAMBDA does not write to CRs at all. The two mechanisms are complementary: mLoad gates capability access, LAMBDA gates code execution.

### 6. Lambda Calculus Correspondence

The architecture implements a direct hardware correspondence with Church's lambda calculus:

| Lambda Calculus Concept | CTMM Hardware Element |
|------------------------|----------------------|
| Abstraction (λx.body) | GT with X permission referencing code object in a CR |
| Variable (bound name) | Data register x holding the argument value |
| Application ((λx.body) arg) | LAMBDA CRn, x instruction |
| Free variable | Data registers and CRs in scope (available to the body) |
| Substitution | Branch to body code, arguments in DRs, execute, return |
| Result | Data register(s) holding the computed value after RETURN |

The Church-Turing marriage is explicit in the instruction:

- **The GT is the lambda**: Church's λx.body lives in a capability register as a GT with X permission. The GT names the code, the X permission authorizes execution, and the code body is the function's implementation. The GT *is* the closure — it binds the code to a namespace context.

- **Data registers are the computation**: Turing's model — arithmetic, logic, comparison, branching — operates on data registers. The argument goes in, the result comes out. DRs are the computational substrate.

- **LAMBDA bridges them**: The LAMBDA instruction takes a Church entity (GT with X permission) and applies it to a Turing entity (value in a data register), producing a Turing result. X permission means "execute code, same domain." E permission (CALL) means "enter domain, cross boundary."

### 7. Constructive Examples

#### 7.1 Clamp Function — Macro-Like Code Reuse

The LAMBDA instruction enables a code body to exist once in memory and be invoked from multiple call sites with near-zero overhead — a macro that doesn't replicate the code base.

```asm
; clamp body lives once in memory at the code pointed to by CR2
; CR2 holds a GT with X permission (Inform type, X bit set)
; x10 holds the value to clamp to the range [0, 255]

LAMBDA CR2, x10         ; verify X perm, save PC+4 to LAMBDA_PC,
                         ; set LAMBDA-active, branch to clamp body
; returns here with x10 clamped to [0, 255]

; --- clamp body (exists once in memory) ---
clamp:
  BGE  x10, x0, .not_neg  ; if x10 >= 0, skip
  MV   x10, x0             ; clamp to 0
  J    .check_high
.not_neg:
.check_high:
  LI   x5, 255
  BLE  x10, x5, .done      ; if x10 <= 255, done
  LI   x10, 255            ; clamp to 255
.done:
  RETURN                    ; LAMBDA-active set → fast path:
                            ;   restore PC from LAMBDA_PC, clear flag
                            ;   zero stack access
```

**Performance**: 2 cycles (LAMBDA verify + branch) + body execution (~5 cycles for clamp) + 1 cycle (RETURN fast path) = **~8 cycles total**.

**Comparison with CALL/RETURN**: Push stack frame (3 cycles), switch C-List via mLoad (5 cycles), execute body (~5 cycles), RETURN with revalidation (5 cycles) = **18+ cycles**.

**Speedup**: ~2.25× faster. LAMBDA avoids the domain-crossing overhead because the body executes in the same protection domain with X permission, not E.

**Comparison with inline macro**: A traditional macro would replicate the clamp code at every call site, bloating the code segment. LAMBDA achieves the same performance as an inline macro (near-zero call overhead) without code duplication. The code exists once in memory and is invoked through the GT.

#### 7.2 Multiple Invocations — Code Once, Use Many

```asm
; Process RGB pixel: clamp each channel
; CR2 = GT with X permission pointing to clamp body
; x10 = red channel, x11 = green channel, x12 = blue channel

MV   x10, x20            ; load red value
LAMBDA CR2, x10           ; clamp red → x10 clamped
MV   x20, x10            ; store clamped red

MV   x10, x21            ; load green value
LAMBDA CR2, x10           ; clamp green → x10 clamped
MV   x21, x10            ; store clamped green

MV   x10, x22            ; load blue value
LAMBDA CR2, x10           ; clamp blue → x10 clamped
MV   x22, x10            ; store clamped blue
```

The clamp body exists once in memory. Three invocations, zero code duplication, near-zero overhead per invocation. Each LAMBDA uses the machine-status fast path (no stack access) because no CALL intervenes between the LAMBDA and its RETURN.

#### 7.3 LAMBDA with CALL Nesting

```asm
; Process a value: clamp it, then log the result via a cross-domain service call
; CR2 = GT with X permission pointing to process body
; CR5 = GT with E permission pointing to logging service (different domain)

LAMBDA CR2, x10           ; LAMBDA-active set, branch to process body

; --- process body ---
process:
  ; First, clamp the value (cannot nest LAMBDA — LAMBDA-active is set)
  ; Instead, do the clamp inline or use CALL:
  BGE  x10, x0, .not_neg
  MV   x10, x0
  J    .check_high
.not_neg:
.check_high:
  LI   x5, 255
  BLE  x10, x5, .clamped
  LI   x10, 255
.clamped:

  ; Now log the result via CALL (cross-domain service)
  CALL CR5                 ; saves LAMBDA state to CALL frame, clears LAMBDA-active
    ; ... logging service executes in its own domain ...
    ; ... logging service RETURNs ...
  ; CALL RETURN restores LAMBDA state: LAMBDA-active re-set, LAMBDA_PC restored

  RETURN                   ; LAMBDA-active set → fast path: restore PC, clear flag
```

This example demonstrates CALL-mediated interaction: the LAMBDA body can invoke cross-domain services via CALL, and the LAMBDA state is transparently saved and restored.

#### 7.4 Array Processing with LAMBDA

```asm
; Apply a transformation to each element of an array
; CR2 = GT with X permission pointing to transformation body
; x20 = base address of input array (5 elements)
; x21 = base address of output array

ADDI  x22, x0, 5           ; x22 = count = 5
ADDI  x23, x0, 0           ; x23 = index = 0

loop:
  BEQ   x23, x22, done     ; if index == count, done
  SLL   x24, x23, 2        ; x24 = index * 4 (word offset)
  ADD   x25, x20, x24      ; x25 = &input[index]
  LW    x10, 0(x25)        ; x10 = input[index]

  LAMBDA CR2, x10           ; apply transformation → x10 = result
                             ; (machine-status fast path each iteration)

  ADD   x26, x21, x24      ; x26 = &output[index]
  SW    x10, 0(x26)        ; output[index] = result

  ADDI  x23, x23, 1        ; index++
  J     loop
done:
```

**Performance per element**: 2 cycles (LAMBDA) + body execution + 1 cycle (RETURN fast path) + ~5 cycles (loop overhead) = **~12 cycles per element**.

**Comparison with CALL/RETURN per element**: ~22 cycles per element (full domain crossing each iteration).

**Speedup**: ~1.8× faster for functional map patterns. Each iteration uses the machine-status fast path because no CALL intervenes between LAMBDA and RETURN within the loop body.

### 8. Network Transparency Integration

The GT Type field enables seamless network transparency through the Outform type (01). Outform GTs reference remote resources accessed via standard HTTPS:

- **R on Outform**: Object fetch via standard HTTPS GET (browser mechanisms: TLS, ETag, Cache-Control)
- **W on Outform**: Object flush via standard HTTPS PUT (ETag/If-Match for conflict detection)
- **E on Outform**: RPC call through an encrypted point-to-point tunnel keyed by a cryptographic key stored in a standard namespace entry

The RPC tunnel key is stored in a namespace entry accessed via standard CAP.LOAD with R permission. Both communicating Meta Machines hold matching namespace entries with identical key material stored in the entry's Location and Limit fields. The MAC seal ensures key integrity. The version field enables instant revocation: garbage-collecting the namespace entry bumps the version, killing the tunnel.

No special capability type is needed for cryptographic keys — they are simply namespace entries with R permission, protected by the same MAC, version, and permission checks as any other namespace entry. The clean design is: capabilities reference resources, and cryptographic keys are resources.

Object fetch and flush use standard HTTPS — the same browser mechanisms the web has used for decades — ensuring interoperability with existing web servers, CDNs, and REST APIs without requiring the remote end to understand capabilities.

### 9. Garbage Collection Integration

The architecture employs deterministic three-phase garbage collection (designated PP250):

1. **Mark**: Set gBit = 1 on all namespace entries
2. **Scan**: Walk the DNA tree from root registers via mLoad; each mLoad access resets gBit = 0 on the accessed entry
3. **Sweep**: Entries with gBit still = 1 are unreachable; bump their version, invalidating all GTs that reference them

The NULL type integrates cleanly with garbage collection:

- **During scanning**: The GC scanner encounters NULL-typed CRs and skips them — there is no namespace entry to mark as reachable. Without the NULL type, the scanner would have to guess whether an all-zeros register is a valid Inform GT pointing to index 0 (which should be scanned) or an empty register (which should be skipped). NULL removes this ambiguity.

- **After sweeping**: When a namespace entry is swept (version bumped), all GTs referencing that entry become stale. The system can optionally set the corresponding capability registers to NULL, providing a clean revocation that is unambiguous at the hardware level.

- **LAMBDA body GTs**: The GT used by LAMBDA (CRn with X permission) is a standard Inform GT that participates fully in garbage collection. If the code object's namespace entry is swept while a LAMBDA body is executing, the entry's version is bumped, but the executing code continues because the instruction stream is already loaded. The GT in CRn becomes stale and cannot be used for a subsequent LAMBDA — the next LAMBDA attempt would go through mLoad verification and FAULT on the version mismatch.

### 10. Performance Analysis

#### 10.1 Cycle Count Comparison

| Operation | LAMBDA Path | CALL Path | Speedup |
|-----------|-------------|-----------|---------|
| Simple function (clamp) | ~8 cycles | ~18 cycles | ~2.25× |
| Array map (per element) | ~12 cycles | ~22 cycles | ~1.8× |
| Chained invocations (3×) | ~24 cycles | ~54 cycles | ~2.25× |
| LAMBDA with CALL nesting | ~20 cycles (LAMBDA + CALL + RETURN overhead) | ~22 cycles (all CALL) | ~1.1× |

The speedup is largest for the common case: lightweight code reuse within a single protection domain. When CALL intervenes (cross-domain service invocation), the overhead of saving and restoring LAMBDA state reduces but does not eliminate the benefit.

#### 10.2 The Machine-Status Fast Path Advantage

The key performance insight is that in the common case (LAMBDA → body → RETURN), zero stack access occurs:

| Step | LAMBDA Path | CALL Path |
|------|-------------|-----------|
| Entry | Verify X perm, save PC to status reg (2 cycles) | Push CR5/CR6/CR7/PC to stack, switch C-List (5+ cycles) |
| Body | Execute code (N cycles) | Execute code (N cycles) |
| Return | Check flag, restore PC from status reg (1 cycle) | Pop frame, revalidate CRs via mLoad (5+ cycles) |
| **Total overhead** | **3 cycles** | **10+ cycles** |

The machine-status fast path eliminates stack access entirely for the lightweight case, while CALL continues to provide the full domain-crossing infrastructure for heavyweight invocations.

---

## CLAIMS

### Claim 1 — GT Type Field with NULL Type

A processor architecture comprising a capability register file wherein each register holds a Golden Token (GT) having a Type field of at least two bits that architecturally classifies the token content as one of: a local reference (Inform, Type = 00), a remote reference (Outform, Type = 01), a null/empty/invalid capability (NULL, Type = 10), or a reserved future type (Spare, Type = 11); wherein the Type field is checked by hardware at each instruction to determine the execution path; and wherein a NULL-typed token causes an immediate hardware fault on any operation, providing an unambiguous representation for empty, uninitialized, or revoked capability registers.

### Claim 2 — NULL Type for Initialization, Revocation, and Garbage Collection

The architecture of Claim 1, wherein the NULL type serves three architectural roles:

(a) initialization, wherein freshly created threads have all non-essential capability registers set to NULL, providing a clean and unambiguous initial state;

(b) revocation, wherein revoking a capability sets the corresponding register to NULL, causing any subsequent use to FAULT immediately rather than encountering ambiguous state;

(c) garbage collection, wherein the GC scanner distinguishes NULL-typed registers (no namespace entry to scan) from valid Inform or Outform GTs (namespace entries to mark as reachable), eliminating the ambiguity between an empty register and a valid capability with index zero.

### Claim 3 — LAMBDA Instruction

The architecture of Claim 1, further comprising a LAMBDA instruction having two operands: a capability register (CRn) holding a Golden Token with Execute (X) permission referencing executable code, and a data register (x) holding an argument value; wherein said LAMBDA instruction:

(a) verifies that CRn holds a token of Inform type (00) with Execute (X) permission;

(b) saves the return address (PC+4) to a machine status register;

(c) sets a LAMBDA-active flag in machine status;

(d) branches to the code referenced by CRn for execution within the same protection domain, without changing the current capability list, without allocating a stack frame, and without performing namespace revalidation;

(e) allows the code body to operate on argument and result values through data registers without writing to capability registers;

thereby implementing Church's lambda calculus function application as a lightweight in-scope code invocation at reduced overhead compared to a domain-crossing CALL instruction, achieving macro-like code reuse without code duplication.

### Claim 4 — LAMBDA vs. CALL Distinction

The architecture of Claim 3, wherein the LAMBDA instruction uses Execute (X) permission and operates within the current protection domain without stack frame allocation or capability list switching; and wherein a separate CALL instruction uses Enter (E) permission and crosses protection domain boundaries with stack frame allocation, capability list switching, and full mLoad validation; said distinction corresponding to Church's lambda calculus application within a domain (λ-application) versus service invocation across domains (function call with domain crossing).

### Claim 5 — Machine-Status Fast Path for LAMBDA Return

The architecture of Claim 3, wherein the LAMBDA instruction stores the return address and LAMBDA-active flag in dedicated machine status registers rather than on the capability stack; and wherein the RETURN instruction, upon detecting the LAMBDA-active flag in machine status, restores the program counter from the machine status register and clears the LAMBDA-active flag, completing the return with zero stack access; said machine-status fast path providing the common-case execution path for LAMBDA invocations where no CALL or CHANGE instruction intervenes during the LAMBDA body.

### Claim 6 — Self-Describing Stack Frames with 1-Bit Tag

The architecture of Claims 3 and 4, wherein every frame on the capability stack carries a 1-bit tag identifying the frame as either a CALL frame (tag = 0) or a LAMBDA frame (tag = 1); and wherein the RETURN instruction, when popping a frame from the stack, inspects the tag to determine the restoration path — performing full domain restoration (capability register restoration, capability list switch, mLoad revalidation) for CALL frames, and performing simple program counter restoration for LAMBDA frames; said tag making the thread's execution history self-describing.

### Claim 7 — Non-Nestable LAMBDA with CALL-Mediated Nesting

The architecture of Claims 3 and 4, wherein a second LAMBDA instruction executed while the LAMBDA-active flag is set in machine status causes a hardware fault, preventing uncontrolled nesting; and wherein a CALL instruction executed during a LAMBDA body saves the LAMBDA machine status (return address and LAMBDA-active flag) as part of the CALL stack frame and clears the LAMBDA-active flag in machine status; thereby permitting a nested LAMBDA instruction within the called procedure, with the outer LAMBDA state preserved on the stack and restored when the CALL returns.

### Claim 8 — Clean CR/DR Separation

The architecture of Claim 1, wherein capability registers hold exclusively Golden Tokens (capabilities) and data registers hold exclusively numeric values; wherein no instruction transfers raw numeric values into capability registers or extracts raw bit patterns from capability registers into data registers; and wherein the LAMBDA instruction bridges the two domains by using a capability (GT with X permission in a CR) to execute code that operates on values (arguments and results in data registers), without writing to capability registers during execution.

### Claim 9 — Network-Transparent RPC via Namespace-Stored Tunnel Key

The architecture of Claim 1, wherein a cryptographic key for a point-to-point RPC tunnel between two Meta Machines is stored in a standard namespace entry, accessed via CAP.LOAD with Read (R) permission through the mLoad validation path; wherein both communicating machines hold namespace entries with matching key material; and wherein the CALL instruction, upon encountering an Outform GT with Enter (E) permission, serializes the data register state, encrypts the payload using the key material from the tunnel key's namespace entry, and transmits the encrypted payload to the remote machine for execution and return of results; and wherein garbage collection of the tunnel key's namespace entry (version bump) instantly revokes the tunnel by invalidating all copies of the GT that references the key entry.

### Claim 10 — LAMBDA as Macro-Like Code Reuse

The architecture of Claim 3, wherein the LAMBDA instruction enables a code body stored once in memory to be invoked from multiple call sites with near-zero overhead per invocation and without code duplication; wherein each invocation uses the machine-status fast path (zero stack access) when no CALL or CHANGE intervenes during the code body; and wherein the code body receives arguments and returns results through data registers, operating as a reusable function that achieves the performance characteristics of an inline macro without replicating the code base.

---

## ABSTRACT

A processor architecture, the Church-Turing Meta-Machine (CTMM), that integrates Church's lambda calculus with Turing's computational model through a clean separation of capabilities and values and a lightweight code application mechanism. Each Golden Token (GT) contains a 2-bit Type field classifying capabilities as: Inform (local reference), Outform (remote reference), NULL (empty/invalid), or Spare (reserved). The NULL type provides an unambiguous hardware-enforced representation for empty, uninitialized, or revoked capability registers, causing an immediate fault on any operation. Capability registers hold capabilities exclusively; data registers hold values exclusively. A LAMBDA instruction applies a code body (GT with Execute permission in a capability register) to an argument (value in a data register), executing within the same protection domain without stack frame allocation, capability list switching, or namespace revalidation — a macro that doesn't replicate the code base. A machine-status fast path stores the return address and LAMBDA-active flag in dedicated machine status registers, achieving zero stack access for the common LAMBDA → body → RETURN pattern. Self-describing stack frames with a 1-bit tag distinguish CALL frames from LAMBDA frames, enabling correct restoration on return. The LAMBDA instruction is non-nestable on its own (FAULT on double-LAMBDA) but supports controlled nesting through CALL mediation, where CALL saves and restores LAMBDA machine status as part of its frame. The architecture unifies capability-based security, lambda calculus code application, and practical code reuse in a single mechanism governed by a 2-bit type field, with the Church-Turing marriage expressed as: LAMBDA bridges Church (GT as λ) and Turing (DRs as computation) with X permission within a domain, while CALL bridges them with E permission across domains.

---

## DRAWINGS (Descriptions for Patent Figures)

### Figure 1: GT Format and Type Field

Diagram showing the bit layout of all four GT types side by side: Inform (Version|Index|Permissions|Type=00), Outform (Version|Index|Permissions|Type=01), NULL (all fields meaningless|Type=10), Spare (reserved|Type=11). Highlights the NULL type as architecturally distinct from all valid reference types.

### Figure 2: LAMBDA vs. CALL Execution Paths

Side-by-side comparison of LAMBDA (~3 cycles overhead: X permission verify, save PC to machine status, branch, fast-path RETURN) and CALL (10+ cycles: stack frame push, C-List switch, mLoad validation, domain crossing, RETURN with revalidation). Shows the machine-status fast path for LAMBDA avoiding all stack access.

### Figure 3: Machine-Status Fast Path

Flow diagram showing LAMBDA entry (save PC+4 to LAMBDA_PC register, set LAMBDA-active flag) and RETURN behavior (check LAMBDA-active flag → if set: restore PC from LAMBDA_PC, clear flag, zero stack access → if not set: pop stack frame, check tag, restore accordingly).

### Figure 4: Self-Describing Stack Frames

Diagram showing the capability stack with interleaved CALL frames (tag=0, full context: CR5/CR6/CR7/PC/LAMBDA state) and LAMBDA frames (tag=1, minimal: PC only). Shows RETURN inspecting the tag to determine the restoration path.

### Figure 5: Non-Nestable LAMBDA with CALL-Mediated Nesting

Sequence diagram showing: LAMBDA (sets LAMBDA-active) → body → CALL (saves LAMBDA state, clears flag) → nested LAMBDA (permitted) → RETURN (fast path) → CALL RETURN (restores LAMBDA state) → RETURN (fast path). Annotated with LAMBDA-active flag state at each step.

### Figure 6: Lambda Calculus Correspondence

Table mapping Church's lambda calculus concepts (abstraction, variable, application, substitution, result) to CTMM hardware elements (GT with X permission, data register argument, LAMBDA instruction, code body execution, data register result).

### Figure 7: Constructive Example — Clamp Function

Annotated instruction sequence showing the clamp function invoked via LAMBDA with cycle counts for each step, demonstrating macro-like code reuse: code exists once, invoked three times (RGB channels), zero stack access per invocation via machine-status fast path.

### Figure 8: Network-Transparent RPC via Namespace Tunnel Key

Diagram showing two Meta Machines with matching namespace entries (same key material in Location/Limit fields), connected by an encrypted tunnel. Shows the namespace entry accessed via standard CAP.LOAD with R permission, the CALL instruction encrypting the payload, and the GC sweep revocation path (version bump invalidates the GT, killing the tunnel).
