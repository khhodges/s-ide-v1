# PP250 Meta-Machine Simulator

## Overview
A Haskell simulator for the PP250 capability-based meta-machine, implementing Kenneth James Hamer-Hodges' architecture. The system uses "Golden Tokens" (192-bit capability keys) for all access control.

## Project Structure
```
metaMachine.hs              # Main entry point
PP250/
├── Core/
│   ├── Types.hs            # Shared data types (CPUState, ContextRegister, etc.)
│   └── Utils.hs            # Utility functions (formatting, key operations)
├── Instructions/
│   ├── Arithmetic.hs       # ADD, SUB, MUL, MOV, MVN, NEG, ADDI, SUBI
│   ├── Logic.hs            # AND, ORR, EOR, BIC, NOT
│   ├── Shift.hs            # LSL, LSR, ASR, ROR
│   ├── Compare.hs          # CMP, CMN, TST, TEQ + condition checker
│   ├── Branch.hs           # B, BL with condition codes
│   ├── LoadSave.hs         # LOAD, SAVE capability operations
│   ├── Call.hs             # CALL instruction (procedure entry)
│   ├── Return.hs           # RETURN instruction (procedure exit)
│   └── Change.hs           # CHANGE instruction (context switch)
├── Console/
│   ├── HUD.hs              # System telemetry display
│   └── REPL.hs             # Interactive console
└── Boot/
    └── Sequence.hs         # 4-step boot sequence
```

## Running the Project
```bash
runghc -i. metaMachine.hs
```

## Key Concepts
- **Context Registers (CR0-CR7)**: Hold capability keys granting access rights
- **Data Registers (DR0-DR7)**: Hold 64-bit numeric values
- **CR15 (Namespace)**: Root capability defining system scope
- **CR8 (Thread)**: Current user/process identity
- **C-List**: List of capability keys available to current context
- **Condition Flags (NZCV)**: ARM-style flags set by arithmetic operations
  - N (Negative): Result has sign bit set
  - Z (Zero): Result is zero
  - C (Carry): Unsigned overflow on ADD, no borrow on SUB
  - V (Overflow): Signed overflow detected

## Available Commands

### System
| Command | Description |
|---------|-------------|
| HELP | Show full command reference |
| HUD | Display system telemetry |
| NS | Display namespace (CR15) |
| CLIST | Display C-List keys |
| FLAGS | Display condition flags (NZCV) |
| EXIT | Shutdown |

### Arithmetic (sets NZCV)
| Command | Description |
|---------|-------------|
| ADD d s | DR[d] = DR[d] + DR[s] |
| SUB d s | DR[d] = DR[d] - DR[s] |
| MUL d s | DR[d] = DR[d] * DR[s] |
| NEG d s | DR[d] = -DR[s] |
| ADDI d imm | DR[d] = DR[d] + immediate |
| SUBI d imm | DR[d] = DR[d] - immediate |
| MOV d s | DR[d] = DR[s] |
| MVN d s | DR[d] = NOT DR[s] |

### Logic (sets N, Z)
| Command | Description |
|---------|-------------|
| AND d s | DR[d] = DR[d] AND DR[s] |
| ORR d s | DR[d] = DR[d] OR DR[s] |
| EOR d s | DR[d] = DR[d] XOR DR[s] |
| BIC d s | DR[d] = DR[d] AND (NOT DR[s]) |
| NOT d s | DR[d] = NOT DR[s] |

### Shifts (sets N, Z, C)
| Command | Description |
|---------|-------------|
| LSL d s amt | Logical shift left |
| LSR d s amt | Logical shift right |
| ASR d s amt | Arithmetic shift right |
| ROR d s amt | Rotate right |

### Compare (flags only)
| Command | Description |
|---------|-------------|
| CMP a b | Compare DR[a] - DR[b] |
| CMN a b | Compare negative DR[a] + DR[b] |
| TST a b | Test bits DR[a] AND DR[b] |
| TEQ a b | Test equal DR[a] XOR DR[b] |

### Branch
| Command | Description |
|---------|-------------|
| B offset | Unconditional branch |
| B cond offset | Conditional branch (EQ/NE/GT/LT/etc) |
| BL offset | Branch with link |

### Capabilities
| Command | Description |
|---------|-------------|
| LOAD d s i | Load capability |
| SAVE d s | Save data |
| CALL reg | Enter procedure |
| RETURN | Exit procedure |
| CHANGE offset | Switch thread |

## Recent Changes
- 2026-01-13: Added full ARM-style instruction set (arithmetic, logic, shifts, compare, branch)
- 2026-01-13: Added ARM-style NZCV condition flags to arithmetic operations
- 2026-01-13: Refactored into modular structure with separate instruction files
- 2026-01-13: Added CALL and RETURN instructions
- 2026-01-13: Added comprehensive code documentation
- 2026-01-13: Added CLIST command for capability key display
- 2026-01-10: Initial project setup with Haskell GHC 9.8
