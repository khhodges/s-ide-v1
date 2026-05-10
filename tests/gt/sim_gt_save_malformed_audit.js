'use strict';
// Headless harness for tests/gt/test_gt_save_malformed_audit.py.
//
// Tests that a SAVE instruction whose source CR contains a malformed GT
// (i.e. one with illegal permission bits placed directly into the CR,
// bypassing createGT()) produces the correct AUDIT TRAIL — specifically
// that auditLog contains a 'malformedGT' gate entry and that faultLog[0]
// carries the malformedReason field — in addition to raising a DOMAIN_PURITY
// fault.
//
// This validates the defence-in-depth audit pipeline on the SAVE path:
//   parseGT() sets the 'malformed' flag for any GT whose permission bits
//   violate isDomainPure or isSinglePerm, and _execSave() now pushes a
//   malformedGT entry to auditLog before calling fault() (mirroring the
//   audit pipeline in _execLoad, introduced by Task #958/#960).
//
// Scenario: X+E GT placed directly into CR1.
//   X is a Turing permission (bit2); E is a Church permission (bit5).
//   Mixing them violates isDomainPure.
//   malformedReason = 'domain-impure permissions (XE)'.
//
// GT bit layout (simulator parseGT):
//   bits [15: 0]  namespace slot index
//   bits [22:16]  gt_seq
//   bits [24:23]  type  (0b00=NULL 0b01=Inform 0b10=Outform 0b11=Abstract)
//   bits [31:25]  permBits: B=bit6 E=bit5 S=bit4 L=bit3 X=bit2 W=bit1 R=bit0
//
// Stdin:  (none — scenario is hardcoded)
// Stdout: JSON object with all fields needed by the Python assertions

global.window = { bootConfig: {} };

const { bootSim, setupCR6 } = require('../gates/sim_helpers');

// X+E: Turing X (bit2) mixed with Church E (bit5) → domain-impure
//   permBits = 0b0100100 = 0x24
//   Inform type (0b01 at bits[24:23]), index=1
const MALFORMED_XE = ((0x24 << 25) | (0x01 << 23) | 1) >>> 0;

function runSaveMalformedAudit() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { error: 'boot did not complete' };
    }

    // Wire CR6 to a 2-slot scratch c-list at address 500.
    // setupCR6 installs a valid E-GT for the boot entry slot so the c-list
    // pointer itself (CR6) passes mLoad validation.
    setupCR6(sim);

    // Place the malformed X+E GT directly into CR1 word0, simulating a
    // compromised CR (e.g. from a boot-sequence bug or a future vulnerability).
    // This bypasses the createGT() guards that normally prevent malformed GTs.
    sim.cr[1] = {
        word0: MALFORMED_XE,
        word1: 0,
        word2: 0,
        word3: 0,
        m:     0,
    };

    // Find the code-lump base from CR14.
    const cr14 = sim.cr[14];
    const codeBase = cr14 ? cr14.word1 : null;
    if (codeBase == null) return { error: 'CR14.word1 is null' };

    // Encode: SAVE CR1, [CR6 + 0]
    // opcode=1 (SAVE), cond=0xE (AL=Always), crDst=1, crSrc=6, imm=0
    const instr = sim.encodeInstruction(1, 0xE, 1, 6, 0);
    sim.memory[codeBase + 1] = instr >>> 0;

    sim.pc = 0;
    sim.halted = false;

    const faultLenBefore = sim.faultLog ? sim.faultLog.length : 0;

    sim.step();

    // step() resets this.auditLog = [] at the very start (simulator.js step()),
    // so the entire auditLog after step() belongs to this instruction.
    const newAuditEntries = sim.auditLog ? sim.auditLog.slice() : [];
    const newFaults       = sim.faultLog ? sim.faultLog.slice(faultLenBefore) : [];

    // Locate the first malformedGT audit entry produced by this step.
    const malformedGTEntry = newAuditEntries.find(e => e.gate === 'malformedGT') || null;

    // Capture the first fault entry and its malformedReason field.
    const firstFault = newFaults.length > 0 ? newFaults[0] : null;

    return {
        // Fault basics
        faulted:              newFaults.length > 0,
        faultCode:            firstFault ? firstFault.type                     : null,
        faultMessage:         firstFault ? firstFault.message                  : null,
        faultMalformedReason: firstFault ? (firstFault.malformedReason || null) : null,
        // Audit trail
        malformedGTEntryFound: malformedGTEntry !== null,
        auditGate:            malformedGTEntry ? malformedGTEntry.gate   : null,
        auditReason:          malformedGTEntry ? malformedGTEntry.reason : null,
        auditResult:          malformedGTEntry ? malformedGTEntry.result : null,
        auditChecks:          malformedGTEntry ? malformedGTEntry.checks : null,
        auditLabel:           malformedGTEntry ? malformedGTEntry.label  : null,
        // Raw counts for diagnostics
        newAuditCount: newAuditEntries.length,
        newFaultCount:  newFaults.length,
    };
}

const result = runSaveMalformedAudit();
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
