# Church Machine Project Overview

## What Is This Project?

This project implements a simulator for Kenneth James Hamer-Hodges' **Church Machine** capability-based security architecture. The Church Machine is a hardware architecture that enforces failsafe security through **Golden Tokens** — unforgeable capability keys that mediate all access to system resources. Named after Alonzo Church and Alan Turing, the architecture integrates lambda calculus principles (controlled access through abstraction) with Turing's computational model (data processing and execution).

---

## Architectural Principles

The Church Machine enforces these core security invariants:

- **Failsafe Security**: Every validation failure routes to a single FAULT handler. There are no silent failures or undefined behaviors.
- **Golden Tokens**: All access rights are embodied in unforgeable capability keys. No raw memory addressing is permitted.
- **Capability Registers (CR0-CR15)**: 16 capability registers hold Golden Tokens. CR0-CR7 are instruction-addressable via 3-bit encoding. CR8-CR15 are system registers, protected from direct instruction access.
- **Two Permission Domains (Domain Purity)**: A GT may carry Turing permissions (R, W, X) or Church permissions (L, S, E), but never both. This is enforced in hardware -- any attempt to mix domains raises a DOMAIN_PURITY fault.
  - **Turing (R, W, X)**: Read, Write, and Execute data/code
  - **Church (L, S, E)**: Load, Save, and Enter capabilities/abstractions
- **M Permission -- Transient Only**: M (Machine/Microcode) is never stored in a GT. It exists only as a transient hardware signal during microcode execution, invisible to user instructions.
- **B and F -- Namespace Metadata**: B (Bind) and F (Far/Foreign) are properties of namespace entries, not GT permission bits. B controls whether a capability can be copied; F marks remote resources.
- **C-List Mediation**: LOAD and SAVE operations go through capability-mediated C-Lists, never through raw memory addresses.
- **SWITCH as Privilege Gate**: The only way to write to system registers CR8-CR15 is through the SWITCH instruction.
- **mLoad as Sole Trusted Path**: All capability register writes route through the mLoad validation pipeline.

---

## Key Features

| Feature | Detail |
|---------|--------|
| **Golden Token Width** | 32-bit |
| **GT Format** | Version(7) + Index(17) + Perms(6) + Type(2) |
| **GT Permission Bits** | 6 (R, W, X, L, S, E) |
| **Permission Domains** | Turing (RWX) xor Church (LSE) — domain purity enforced in hardware |
| **Namespace Metadata** | B (Bind), F (Far) in namespace entry |
| **Data Registers** | DR0-DR15 |
| **Capability Registers** | CR0-CR15 (CR0-CR7 instruction-addressable, CR8-CR15 system) |
| **Church Instructions** | LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LOADX, SAVEX, LDM, STM |
| **Turing Instructions** | DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR |
| **Max Namespace Entries** | 131,072 (17-bit index) |
| **GT Version Field** | 7-bit (128 generations) |
| **GT Type Field** | 2-bit: Inform, Outform, NULL, Abstract |
| **MAC Validation** | 25-bit FNV seal in VersionSeals |
| **Garbage Collection** | Version bump on sweep; G-bit reset on access |

---

## Directory Structure

```
/
+-- simulator/              Church Machine IDE (web application)
|   +-- index.html          Single-page application
|   +-- app.js              UI controller and examples
|   +-- styles.css          Dark-themed styling
|
+-- server/                 Flask web server
|   +-- app.py              API routes and doc serving
|
+-- docs/                   Project documentation (The Church Machine book)
+-- hardware/               Amaranth HDL hardware implementation (Tang Nano 20K)
+-- ctmm_amaranth/          Amaranth HDL hardware implementation
+-- verilog/                SystemVerilog hardware implementation
+-- CTMM/                   Haskell console simulator
```
