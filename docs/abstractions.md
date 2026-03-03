# Church Machine Abstraction Catalog

## Canonical Form

Every abstraction in the Church Machine follows the same structure:

- **Namespace entry** — Has a c-list (CR6 target) and code (CR7 target at c-list[0])
- **Entry** — Via CALL (E-GT) or application via LAMBDA (X-GT)
- **Method dispatch** — Symbolic dispatch (high-security), LAMBDA fast-path (performance), or compiled binary (fastest)

There is no operating system. Every system service, hardware driver, and user-facing tool is an abstraction accessed through Golden Tokens. The same security model applies at every level — from boot firmware to social networking.

## Scale-Free Architecture

The abstraction model is scale-free. The same primitives — namespace isolation, L/S capability grants, version revocation, Negotiate dual-approval, Outform+Far tunnels — apply from a single family to a national government. The architecture enforces rules; the namespace configuration reflects the local tradition.

---

## Layer 0 — Boot

Hardware-initialized entries, always present after reset.

| Index | Name | Perms | Description |
|-------|------|-------|-------------|
| 0 | Boot.NS | — | Namespace root. Location = NS_TABLE_BASE (0xFD00). The root of the capability tree. |
| 1 | Boot.Thread | — | Initial thread identity, loaded into CR8. Identifies the boot thread. |
| 2 | Boot.CList | E | Boot abstraction c-list, loaded into CR6. Contains the boot code and initial capabilities. |
| 3 | Boot.CLOOMC | X | Boot code entry point, loaded into CR7. First instruction executes from here. |

**Rationale**: Boot entries establish the minimum viable secure state. The processor cannot execute any instruction until CR6 (c-list), CR7 (code), and CR15 (namespace) are initialized. Boot sequence writes these entries to the namespace table, then triggers execution.

---

## Layer 1 — System Services

Shared, atomic Turing abstractions hidden behind Church-callable interfaces.

### 4 — Salvation

**Methods**: LOAD, TPERM, LAMBDA, RETURN

The first callable abstraction. Its purpose is to prove that the CALL→RETURN cycle works correctly. Salvation loads a GT, restricts its permissions, applies a lambda, and returns. If Salvation returns without faulting, the security pipeline is verified.

**Rationale**: Named for the theological concept of proving grace through works. This abstraction is the "smoke test" for the entire capability system.

### 5 — Mint

**Methods**: Create, Revoke, Transfer

GT lifecycle management. Mint creates new Golden Tokens with permissions that are a subset of the caller's permissions (you cannot grant what you don't have). Revoke increments the namespace version, instantly killing all outstanding copies. Transfer moves a GT from one c-list to another.

**Rationale**: Centralized GT creation ensures the permission subsetting invariant is never violated. No code can create a GT with more permissions than it holds.

### 6 — Memory

**Methods**: Allocate, Free, Resize

Namespace entry allocation for DATA objects. Allocate claims unused namespace slots. Free releases them. Resize adjusts object bounds.

**Rationale**: Memory management is a system service, not an implicit runtime feature. Programs must hold a GT to the Memory abstraction to allocate storage.

### 7 — Scheduler

**Methods**: Yield, Spawn, Wait, Stop

Thread lifecycle management. Yield surrenders the current time slice. Spawn creates a new thread (new CR8 identity). Wait blocks until a condition is met. Stop terminates a thread.

**Rationale**: Thread scheduling is GT-gated. A program cannot spawn threads without holding the Scheduler capability.

### 8 — Stack

**Methods**: Push, Pop, Peek, Depth

Managed call stack with hardware-enforced overflow protection. Push/Pop manage stack frames. Peek inspects without modifying. Depth reports current stack depth.

**Rationale**: Stack overflow is a hardware fault, not a software crash. The Stack abstraction enforces bounded recursion.

---

## Layer 2 — Hardware Attachments

Device drivers entered via GT-gated I/O. Each device is mapped to the unified address space at segment 0xFE.

### 9 — UART

**Methods**: Send, Receive, SetBaud  
**Perms**: R, W, E

Serial communication via the Tang Nano 20K's BL616 USB bridge. Send transmits a byte. Receive reads a byte. SetBaud configures the baud rate (default 115200).

### 10 — LED

**Methods**: Set, Clear, Toggle, Pattern  
**Perms**: R, W, E

Controls the 6 onboard LEDs on the Tang Nano 20K. LEDs are active-low. Pattern sets all 6 LEDs simultaneously.

### 11 — Button

**Methods**: Read, WaitPress, OnEvent  
**Perms**: R, E

Push button input. Read returns current state. WaitPress blocks until button is pressed. OnEvent registers a callback.

### 12 — Timer

**Methods**: Start, Stop, Read, SetAlarm  
**Perms**: R, W, E

Hardware timer for delays, timeouts, and scheduling. SetAlarm triggers an interrupt after a specified count.

### 13 — Display

**Methods**: Write, Clear, Scroll  
**Perms**: R, W, E

HDMI output via the Tang Nano 20K's HDMI connector. Write outputs text or pixel data. Clear resets the display. Scroll moves content.

---

## Layer 3 — Mathematics

Computational abstractions for arithmetic and trigonometry.

### 14 — SlideRule

**Methods**: Add, Sub, Mul, Div, Sqrt, Log, Pow

IEEE 754 floating-point arithmetic. Named after the analog computing device used before electronic calculators.

### 15 — Abacus

**Methods**: Add, Sub, Mul, Div, Mod, Abs

64-bit integer arithmetic. Named after the oldest known computing device.

### 16 — Constants

**Methods**: Pi, E, Phi, Zero, One

Read-only mathematical constants. Returns pre-computed values with full precision.

### 17 — Circle

**Methods**: Sin, Cos, Tan, Area, Circumference

Trigonometry via CORDIC (COordinate Rotation DIgital Computer). Hardware-efficient iterative computation without multiply units.

---

## Layer 4 — Lambda Calculus

Pure Church domain abstractions implementing lambda calculus primitives.

### 18 — Lambda

**Methods**: Apply, Compose, Curry

Core reduction engine. Apply performs beta reduction. Compose combines two functions. Curry transforms a multi-argument function.

### 19–26 — Church Numerals

| Index | Name | Description |
|-------|------|-------------|
| 19 | SUCC | Successor function — adds 1 |
| 20 | PRED | Predecessor function — subtracts 1 |
| 21 | ADD | Addition of Church numerals |
| 22 | SUB | Subtraction of Church numerals |
| 23 | MUL | Multiplication of Church numerals |
| 24 | ISZERO | Zero test — returns TRUE or FALSE |
| 25 | TRUE | Boolean true (Church encoding: λx.λy.x) |
| 26 | FALSE | Boolean false (Church encoding: λx.λy.y) |

### 42 — PAIR

**Methods**: Apply

Church pair constructor (λx.λy.λf.f x y). Used to build data structures in pure lambda calculus.

**Rationale**: Church numerals prove that the machine is computationally complete using only lambda calculus — zero Turing-domain instructions. Every number, boolean, and data structure can be encoded as a pure function.

---

## Layer 5 — Social Abstractions

Networking and oversight capabilities for multi-user environments.

### 27 — Family

**Methods**: Register, HelloMum, Oversight

Parent-child capability binding. Parent's namespace is the root; each child namespace is subordinate with parent-controlled GT grants. Register creates a child namespace. HelloMum sends a message to the parent. Oversight returns the parent's view of a child's activity.

**Namespace isolation**: Each sibling has their own namespace (CR15 points to a distinct NS root). Parent holds S permission on each child's namespace. Siblings cannot see each other's namespaces unless the parent explicitly grants cross-sibling GTs.

### 28 — Schoolroom

**Methods**: Join, Lesson, Submit, Grade

Teacher distributes lessons as DATA objects. Students submit work. Grade returns assessment. All operations are GT-gated — a student can only access lessons the teacher has granted.

### 29 — Friends

**Methods**: Request, Accept, Share, Revoke

Peer-to-peer capability sharing, parent-gated. Request sends a friendship proposal (requires parent approval via Negotiate). Accept/Revoke manage the relationship. Share transfers a GT to a friend (subject to parent's S permission).

### 30 — Tunnel

**Methods**: Connect, Send, Receive, Close

Outform GT encrypted tunnel for F-bit networking. Connect establishes a tunnel to a remote namespace. Send/Receive exchange data. Close terminates the connection.

### 31 — Negotiate

**Methods**: Propose, Approve, Reject, Status

Dual-approval protocol for special grants:

1. Teacher proposes a grant (resource + permissions + student)
2. Proposal sent to parent via Tunnel
3. Parent reviews and approves or rejects
4. On dual approval: Mint creates GT, SAVE places it in child's c-list
5. Either party can revoke at any time

**Rationale**: Joint approval ensures no single party can unilaterally grant access to a child. The Negotiate abstraction's c-list contains Outform+Far GTs to both parties' Tunnels for messaging.

---

## Layer 6 — IDE Abstractions

Development tools as first-class abstractions.

### 32 — Editor

**Methods**: Open, Save, Load, Undo

Code editor managing source text as a DATA object in the namespace.

### 33 — Assembler

**Methods**: Assemble, Disassemble, Validate

Translates assembly source to machine code. Validate checks syntax without generating output. Disassemble converts binary back to mnemonics.

### 34 — Debugger

**Methods**: Step, Run, Breakpoint, Inspect

Single-step debugger with register and memory inspection. Breakpoint sets a halt condition. Inspect reads any register or memory location (subject to GT permissions).

### 35 — Deployer

**Methods**: Build, Upload, Verify, Boot

Compiles assembly to binary, uploads to Tang Nano 20K via UART, verifies the upload, and triggers boot.

---

## Layer 7 — Internet Abstractions

Parent-approved external services. All internet access is GT-gated via L/S permissions.

The c-list IS the parental approval. Parent holds S permission on the child's internet c-list slots and SAVEs GTs for approved resources. Child holds L permission — they can LOAD whatever GTs the parent has placed, but cannot add new ones. A NULL slot = denied access = FAULT on LOAD.

Each approved external resource is an Outform+Far GT pointing to that resource via the Tunnel abstraction.

| Index | Name | Methods | Description |
|-------|------|---------|-------------|
| 36 | Browser | Navigate, Back, Bookmark, Search | Web browsing — only parent-SAVEd site GTs are reachable |
| 37 | Messenger | Send, Receive, Contacts, Block | Messaging — parent-approved contacts only |
| 38 | Photos | View, Share, Upload, Album | Photo sharing — share targets limited to parent-SAVEd friend GTs |
| 39 | Social | Post, Read, Follow, Feed | Social feed — only parent-SAVEd account GTs appear |
| 40 | Video | Watch, Search, Playlist, Share | Video viewing — only parent-SAVEd channel GTs are watchable |
| 41 | Email | Compose, Read, Reply, Contacts | Email — only parent-SAVEd email address GTs can be reached |

**Revocation model**: Every GT carries a 7-bit version. Parent revokes via Mint.Revoke — version increment instantly invalidates every outstanding copy. Revocation is instant, global, and unforgeable.

---

## Layer 8 — Garbage Collection

### 43 — GC

**Methods**: Scan, Identify, Clear, Flip

PP250 deterministic garbage collection with bidirectional G-bit. Four phases:

1. **Scan** — Walk namespace, mark reachable entries
2. **Identify** — Find unmarked entries
3. **Clear** — Reclaim unmarked entries
4. **Flip** — Toggle GC polarity for next cycle

GC is a safe Turing abstraction — atomic Turing implementation hidden behind a Church-callable interface. Entered via CALL, exited via RETURN. PP250 excludes HALT: the machine always returns to boot instead of halting.
