'use strict';
// Headless harness: tests/gates/sim_lump_step.js
// Used by tests/gates/test_lump_step.py.
//
// Verifies that after a CALL on a slot whose compiled lump is resident in
// memory, the simulator steps one instruction at a time through the lump
// rather than dispatching atomically via a JS stub:
//
//   Test 1 — PC = 0 after CALL on resident lump
//     The simulator's PC must be 0 immediately after the CALL completes,
//     meaning execution will resume at word 1 of the lump (the first code
//     word after the lump header) on the next step.
//
//   Test 2 — Each step() advances PC by exactly 1
//     Stepping twice through two consecutive NV (skip) instructions inside
//     the lump advances PC: 0 → 1 → 2.  This confirms the dispatcher did
//     NOT jump atomically to pc+1 (the CALL site's next instruction) and
//     that instruction-level granularity is maintained.
//
// Exits with code 0 on success, code 1 on any failure (errors to stderr).

global.window = { bootConfig: {} };

const { bootSim } = require('./sim_helpers');

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }

// ── Lump setup ────────────────────────────────────────────────────────────────
// Writes a minimal resident lump at `lumpBase` in simulator memory and
// creates the corresponding NS entry at `slotIdx`.
//
// Lump layout (64 words, n_minus_6=0):
//   [+0]  lump header  (cw=2, cc=1, typ=0)
//   [+1]  NV-condition LOAD  (always skipped — PC++)
//   [+2]  NV-condition LOAD  (always skipped — PC++)
//   [+3..+62]  zero (unused)
//   [+63] c-list slot 0 = 0 (null cap)
//
// The NV condition (0xF = "never") causes step() to skip the instruction
// without side-effects, advancing PC by 1.  This lets the test observe
// PC increments without needing meaningful instructions.

const SLOT     = 30;    // NS slot index — unused after boot
const LUMP_BASE = 1000; // Physical address well below NS_TABLE_BASE (~64768)

function setupResidentLump(sim) {
    const NV = 0xF;   // condition "never" → instruction is always skipped
    // packLumpHeader(n_minus_6, cw, cc, typ=0)
    const hdr = sim.packLumpHeader(0 /* n_minus_6 → lumpSize=64 */, 2 /* cw */, 1 /* cc */);
    sim.memory[LUMP_BASE + 0] = hdr;
    sim.memory[LUMP_BASE + 1] = sim.encodeInstruction(0 /* LOAD */, NV, 0, 6, 0);
    sim.memory[LUMP_BASE + 2] = sim.encodeInstruction(0 /* LOAD */, NV, 0, 6, 0);
    // c-list occupies the last cc=1 word of the 64-word slot.
    // clistStart = lumpSize - cc = 64 - 1 = 63
    sim.memory[LUMP_BASE + 63] = 0;  // null cap — not exercised by these tests

    // NS entry: location=LUMP_BASE, limit17=63 (lumpSize-1), gtType=1 (Inform), clistCount=1
    sim.writeNSEntry(SLOT, LUMP_BASE, 63 /* limit17 */, 0, 0, 0, 0, 1 /* Inform */, 0, 1 /* cc */);
}

// Build an Inform GT (E permission) for SLOT using the gt_seq recorded in
// NS word2 by writeNSEntry (version=0 → gt_seq=0).
function makeInformGT(sim) {
    const nsBase = sim.NS_TABLE_BASE + SLOT * sim.NS_ENTRY_WORDS;
    const nsW2   = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;  // 0 after writeNSEntry(version=0)
    return sim.createGT(gt_seq, SLOT, { E: 1 }, 1 /* Inform */);
}

// Place a CALL CR1 instruction at the current fetch address (codeBase+1+pc)
// and prepare CR1, CR12, CR15 so the CALL can proceed cleanly.
function prepareCallSite(sim) {
    // M-window must be inactive so _mwinWriteback() passes without writing back.
    if (sim.cr[15]) sim.cr[15].m = 0;

    // CR12.word1 = 0 → callThreadBase = 0 → thread-bounds check skipped.
    if (sim.cr[12]) sim.cr[12].word1 = 0;

    // Load the GT into CR1.
    sim.cr[1].word0 = makeInformGT(sim);

    // Write CALL CR1 at the fetch address for pc=0.
    // _fetchInstruction() reads memory[cr14.word1 + 1 + pc], so at pc=0
    // the instruction lives at codeBase + 1.
    const codeBase  = sim.cr[14].word1;
    const callInstr = sim.encodeInstruction(2 /* CALL */, 0xE /* AL */, 1, 0, 0);
    sim.memory[codeBase + 1] = callInstr >>> 0;

    sim.pc     = 0;
    sim.halted = false;
}

// ── Test 1: PC = 0 immediately after CALL on resident lump ───────────────────

(function testCallResidentLumpPC() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Test 1: boot did not complete');
        return;
    }

    setupResidentLump(sim);
    prepareCallSite(sim);

    const faultsBefore = sim.faultLog.length;
    sim.step();  // execute CALL CR1
    const newFaults = sim.faultLog.slice(faultsBefore);

    if (newFaults.length > 0) {
        fail('Test 1: unexpected fault(s) during CALL on resident lump — ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    // After a CALL to a lump-resident abstraction _execCall sets this.pc = 0.
    if (sim.pc !== 0) {
        fail(`Test 1: expected PC=0 after CALL on resident lump, got PC=${sim.pc}`);
        return;
    }

    // CR14.word1 must now point at the lump base so fetch addresses are
    // relative to the loaded lump, not the boot-entry code buffer.
    if (sim.cr[14].word1 !== LUMP_BASE) {
        fail(`Test 1: expected CR14.word1=${LUMP_BASE} after CALL, got ${sim.cr[14].word1}`);
        return;
    }

    console.log('[PASS] Test 1: PC=0 immediately after CALL on resident lump');
    console.log(`[PASS] Test 1: CR14.word1=${sim.cr[14].word1} == LUMP_BASE=${LUMP_BASE}`);
})();

// ── Test 2: Each step() advances PC by exactly 1 ─────────────────────────────

(function testStepThroughCompiledLump() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Test 2: boot did not complete');
        return;
    }

    setupResidentLump(sim);
    prepareCallSite(sim);

    // Execute the CALL; after this PC must be 0.
    const faultsAfterCall = sim.faultLog.length;
    sim.step();
    if (sim.faultLog.length > faultsAfterCall) {
        const f = sim.faultLog[faultsAfterCall];
        fail(`Test 2: fault during CALL — ${f.type}: ${f.message}`);
        return;
    }
    if (sim.pc !== 0) {
        fail(`Test 2: pre-condition failed — PC should be 0 after CALL, got ${sim.pc}`);
        return;
    }

    // First step inside the lump: NV instruction at lump+1 is skipped → PC = 1.
    const faultsBefore1 = sim.faultLog.length;
    sim.step();
    const newFaults1 = sim.faultLog.slice(faultsBefore1);
    if (newFaults1.length > 0) {
        fail('Test 2: fault on first step inside lump — ' +
             newFaults1.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }
    if (sim.pc !== 1) {
        fail(`Test 2: expected PC=1 after first step inside lump, got PC=${sim.pc}`);
        return;
    }

    // Second step inside the lump: NV instruction at lump+2 is skipped → PC = 2.
    const faultsBefore2 = sim.faultLog.length;
    sim.step();
    const newFaults2 = sim.faultLog.slice(faultsBefore2);
    if (newFaults2.length > 0) {
        fail('Test 2: fault on second step inside lump — ' +
             newFaults2.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }
    if (sim.pc !== 2) {
        fail(`Test 2: expected PC=2 after second step inside lump, got PC=${sim.pc}`);
        return;
    }

    console.log('[PASS] Test 2: PC advanced 0 → 1 → 2 one instruction at a time inside compiled lump');
})();

// ── Test 3: RETURN unwinds call frame back to CALL site (pc+1) ───────────────
//
// After CALL → step → step, a RETURN instruction at lump[+3] must:
//   • restore PC to the saved return PC  (CALL was at pc=0 → returnPC = 1)
//   • leave only the boot sentinel on the call stack (length === 1)
//   • restore CR14.word1 back to the original caller's code base

(function testReturnAfterLumpSteps() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Test 3: boot did not complete');
        return;
    }

    setupResidentLump(sim);

    // Place an unconditional RETURN at lump word [+3], after the two NV NOPs.
    // encodeInstruction(opcode=3 RETURN, cond=0xE AL, crDst=0, crSrc=0, imm=0)
    sim.memory[LUMP_BASE + 3] = sim.encodeInstruction(3 /* RETURN */, 0xE /* AL */, 0, 0, 0) >>> 0;

    prepareCallSite(sim);

    // Save the caller's code base so we can verify CR14 restoration later.
    const callerCodeBase = sim.cr[14].word1;

    // ── Step 1: execute CALL CR1 ──
    const f0 = sim.faultLog.length;
    sim.step();
    if (sim.faultLog.length > f0) {
        const f = sim.faultLog[f0];
        fail(`Test 3: fault during CALL — ${f.type}: ${f.message}`);
        return;
    }
    if (sim.pc !== 0) {
        fail(`Test 3: pre-condition failed — expected PC=0 after CALL, got PC=${sim.pc}`);
        return;
    }

    // ── Step 2: first NV instruction inside lump (lump[+1]) → PC = 1 ──
    const f1 = sim.faultLog.length;
    sim.step();
    if (sim.faultLog.length > f1) {
        const f = sim.faultLog[f1];
        fail(`Test 3: fault on step 2 (first NV) — ${f.type}: ${f.message}`);
        return;
    }
    if (sim.pc !== 1) {
        fail(`Test 3: expected PC=1 after first NV step, got PC=${sim.pc}`);
        return;
    }

    // ── Step 3: second NV instruction inside lump (lump[+2]) → PC = 2 ──
    const f2 = sim.faultLog.length;
    sim.step();
    if (sim.faultLog.length > f2) {
        const f = sim.faultLog[f2];
        fail(`Test 3: fault on step 3 (second NV) — ${f.type}: ${f.message}`);
        return;
    }
    if (sim.pc !== 2) {
        fail(`Test 3: expected PC=2 after second NV step, got PC=${sim.pc}`);
        return;
    }

    // ── Step 4: RETURN at lump[+3] — must unwind to returnPC = 1 ──
    const f3 = sim.faultLog.length;
    sim.step();
    const newFaults = sim.faultLog.slice(f3);
    if (newFaults.length > 0) {
        fail('Test 3: unexpected fault(s) during RETURN — ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    // The CALL was at pc=0, so returnPC = pc+1 = 1.
    if (sim.pc !== 1) {
        fail(`Test 3: expected PC=1 after RETURN (returnPC=CALL_pc+1=1), got PC=${sim.pc}`);
        return;
    }

    // Only the boot sentinel should remain on the call stack (length === 1).
    if (sim.callStack.length !== 1) {
        fail(`Test 3: expected callStack.length=1 (sentinel only) after RETURN, got ${sim.callStack.length}`);
        return;
    }
    if (!sim.callStack[0].sentinel) {
        fail('Test 3: bottom-of-stack entry after RETURN is not the sentinel frame');
        return;
    }

    // CR14.word1 must have been restored to the caller's code base.
    if (sim.cr[14].word1 !== callerCodeBase) {
        fail(`Test 3: expected CR14.word1=${callerCodeBase} (caller codeBase) after RETURN, got ${sim.cr[14].word1}`);
        return;
    }

    console.log('[PASS] Test 3: RETURN unwound to returnPC=1 (CALL_pc+1) after stepping through lump');
    console.log(`[PASS] Test 3: callStack.length=1 (sentinel only) after RETURN`);
    console.log(`[PASS] Test 3: CR14.word1=${sim.cr[14].word1} restored to caller codeBase=${callerCodeBase}`);
})();

// ── Report ────────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
