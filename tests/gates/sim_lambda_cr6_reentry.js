'use strict';
// Headless harness for tests/gates/test_lambda_cr6_reentry.py.
//
// Exercises the D-9 idempotent re-entry rule implemented in hardware/core.py
// (nested_lambda_fault signal, lines ~343-353 and ~2003-2007) and mirrored
// in simulator/simulator.js _execLambda:
//
//   • LAMBDA CR6 (CR_CLIST) while lambdaActive=1 → idempotent, no fault.
//   • LAMBDA CRn (n≠6)      while lambdaActive=1 → INVALID_OP fault.
//
// Strategy:
//   For each scenario, boot a fresh sim, manually force lambdaActive=true
//   (to simulate being mid-lambda without needing a full first-LAMBDA setup),
//   inject a LAMBDA instruction at PC=0 in the boot code lump, and step().
//   Collect faultLog entries and pass results to stdout as JSON.
//
// Stdout: JSON array of result objects
// Exits: 0 always (assertions are in the Python layer)

global.window = { bootConfig: {} };

const { bootSim } = require('./sim_helpers');

// CR_CLIST = 6 (hardware/hw_types.py)
const CR_CLIST = 6;

// LAMBDA opcode = 7
// ('LOAD'=0,'SAVE'=1,'CALL'=2,'RETURN'=3,'CHANGE'=4,'SWITCH'=5,'TPERM'=6,'LAMBDA'=7)
const LAMBDA_OPCODE = 7;

// ─── buildXGtForSlot ─────────────────────────────────────────────────────────
// Build a valid Inform GT with X permission for the given NS slot index.
function buildXGtForSlot(sim, slotIdx) {
    const nsBase = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    const gt_seq = (sim.memory[nsBase + 2] >>> 25) & 0x7F;
    return sim.createGT(gt_seq, slotIdx, { X: 1 }, 1);
}

// ─── runLambdaReentry ────────────────────────────────────────────────────────
// Boot a fresh sim, set lambdaActive=true, inject a LAMBDA targeting crIdx,
// and step once.  Returns a result object.
function runLambdaReentry(scenarioName, crIdx) {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { name: scenarioName, error: 'boot did not complete' };
    }

    // Force lambdaActive=true to put the sim into the "already in lambda" state.
    sim.lambdaActive = true;

    // For CR6 (CR_CLIST) re-entry: give CR6 a valid X-permission GT so that
    // the instruction can proceed past the guard and complete successfully.
    // For non-CR6 targets the INVALID_OP fault fires before any GT read, so
    // the CR content doesn't matter, but we set it consistently anyway.
    const slotIdx = sim.bootEntrySlot;
    const xGT = buildXGtForSlot(sim, slotIdx);

    if (sim.cr[crIdx] === undefined) sim.cr[crIdx] = {};
    sim.cr[crIdx].word0 = xGT >>> 0;

    // Inject LAMBDA crIdx (cond=AL=0xE, crDst=crIdx, crSrc=0, imm=0).
    const codeBase = sim.cr[14].word1;
    const lambdaInstr = sim.encodeInstruction(LAMBDA_OPCODE, 0xE, crIdx, 0, 0);
    sim.memory[codeBase + 1] = lambdaInstr >>> 0;

    sim.pc = 0;
    sim.halted = false;
    const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;
    sim.step();
    const newFaults = sim.faultLog ? sim.faultLog.slice(faultsBefore) : [];

    return {
        name:      scenarioName,
        crIdx,
        faulted:   newFaults.length > 0,
        faultCode: newFaults.length ? newFaults[0].type    : null,
        faultMsg:  newFaults.length ? newFaults[0].message : null,
    };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const results = [
    // CR6 (CR_CLIST) while lambdaActive=1 → idempotent, must NOT fault.
    runLambdaReentry('CR6_reentry_while_active_no_fault', CR_CLIST),

    // CR0 (non-CR_CLIST) while lambdaActive=1 → must fault INVALID_OP.
    runLambdaReentry('CR0_nested_lambda_while_active_INVALID_OP', 0),

    // CR5 (another non-CR_CLIST) while lambdaActive=1 → must fault INVALID_OP.
    runLambdaReentry('CR5_nested_lambda_while_active_INVALID_OP', 5),
];

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
