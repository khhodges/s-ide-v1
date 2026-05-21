'use strict';
// test_pet_name_mem.js — Unit tests for Task #1532 pet-name DWRITE port and lazy-resolve path
// Run:  node simulator/test_pet_name_mem.js
//
// Coverage:
//   T_PNM1 — DWRITE to 0xFFFFFF38 registers slot n in _petNamedSlots (verify value & 0x3F masking)
//   T_PNM2 — ELOADCALL on a named NULL slot fires Scheduler.IRQ(LAZY_RESOLVE) and returns lazySuspended=true
//   T_PNM3 — XLOADLAMBDA on a named NULL slot fires Scheduler.IRQ(LAZY_RESOLVE) and returns lazySuspended=true
//   T_PNM4 — ELOADCALL on an UNnamed NULL slot still hard-faults NULL_CAP (regression guard)
//   T_PNM5 — _petNamedSlots is cleared on reset() (no cross-test pollution)

const ChurchSimulator    = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

function makeTestSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    const sysAbs = new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    return { sim, registry, sysAbs };
}

// Set up CR6 pointing to NS slot 0 with a c-list at clistLoc.
// NS slot 0 is always valid after _initNamespaceTable() (gt_seq=0, valid seal).
// clistSize determines ecClistSize in ELOADCALL / XLOADLAMBDA.
// The rangeOverride supplied by ELOADCALL/XLOADLAMBDA is { base: clistLoc,
// upperBound: clistLoc + clistSize - 1 }, so ecRow must be < clistSize.
function setupCR6(sim, clistLoc, clistSize) {
    const gt0 = sim.createGT(0, 0, { E: 1 }, 1);
    sim.cr[6] = {
        word0: gt0,
        word1: clistLoc,
        word2: sim.packNSWord1(0x1FFF, 0, 0, 1, clistSize),
        word3: 0,
        m: 0,
    };
    return gt0;
}

// ── T_PNM1: DWRITE to IO_PORT_PET_NAME_WR registers the slot ─────────────────
console.log('\n--- T_PNM1: DWRITE to 0xFFFFFF38 registers slot via _petNamedSlots ---');
{
    const { sim } = makeTestSim();

    // CR1 needs a non-zero, non-abstract GT (bits 24:23 must not be 0b11).
    // word1 = 0xFFFFFF38 so that (word1 + imm=0) === IO_PORT_PET_NAME_WR.
    // The IO_PORT intercept fires BEFORE mLoad, so GT validity is irrelevant.
    sim.cr[1] = { word0: 1, word1: 0xFFFFFF38, word2: 0, word3: 0, m: 0 };

    // DR2 = 0x47 (71 decimal) → masked: 71 & 0x3F = 7
    sim.dr[2] = 0x47;

    const d = { opcode: 11, crDst: 2, crSrc: 1, imm: 0, cond: 0 };
    const result = sim._execDwrite(d);

    check('T_PNM1a: _execDwrite returns non-null result', result !== null);
    check('T_PNM1b: slot 7 (DR & 0x3F) added to _petNamedSlots', sim._petNamedSlots.has(7));
    check('T_PNM1c: raw value 71 NOT in _petNamedSlots (masking applied)', !sim._petNamedSlots.has(71));
    check('T_PNM1d: result desc mentions IO_PORT_PET_NAME_WR',
        result !== null && typeof result.desc === 'string' && result.desc.includes('IO_PORT_PET_NAME_WR'));

    // Second write: DR2 = 0x7F → masked to slot 0x3F (63)
    sim.dr[2] = 0x7F;
    sim._execDwrite(d);
    check('T_PNM1e: DR=0x7F registers slot 0x3F (63)', sim._petNamedSlots.has(0x3F));
    check('T_PNM1f: slot 0x7F (127) NOT in _petNamedSlots (mask applied)', !sim._petNamedSlots.has(0x7F));

    // Third write: DR2 = 5 (no high bits) → slot 5
    sim.dr[2] = 5;
    sim._execDwrite(d);
    check('T_PNM1g: DR=5 registers slot 5', sim._petNamedSlots.has(5));

    // All three distinct masked values should now be present
    check('T_PNM1h: _petNamedSlots contains exactly 3 distinct masked slots',
        sim._petNamedSlots.size === 3);
}

// ── T_PNM2: ELOADCALL on a named NULL slot fires LAZY_RESOLVE ─────────────────
console.log('\n--- T_PNM2: ELOADCALL on named NULL slot fires Scheduler.IRQ(LAZY_RESOLVE) ---');
{
    const { sim } = makeTestSim();

    const ecRow    = 5;
    const clistLoc = 0x100;
    setupCR6(sim, clistLoc, 10);

    sim.memory[clistLoc + ecRow] = 0;   // NULL GT at the c-list slot
    sim._petNamedSlots.add(ecRow);       // register via PetNameMemory

    // Replace _fireSchedulerIRQ with a spy so we can verify it was called
    // with reason='LAZY_RESOLVE' without running the full IRQ dispatch chain.
    let irqFiredWith = null;
    sim._fireSchedulerIRQ = (reason, faultRecord, slot) => {
        irqFiredWith = { reason, slot };
        return true;
    };

    let lazyEvent = null;
    sim.on('lazyResolvePending', (ev) => { lazyEvent = ev; });

    const d = { opcode: 8, crDst: 0, crSrc: 6, imm: ecRow, cond: 0 };
    const result = sim._execEloadcall(d);

    check('T_PNM2a: result has lazySuspended=true', result !== null && result.lazySuspended === true);
    check('T_PNM2b: result.slot matches ecRow', result !== null && result.slot === ecRow);
    check('T_PNM2c: result.instrName is ELOADCALL', result !== null && result.instrName === 'ELOADCALL');
    check('T_PNM2d: result.kind is NULL_GT', result !== null && result.kind === 'NULL_GT');
    check('T_PNM2e: sim._lazySuspended flag set to true', sim._lazySuspended === true);
    check('T_PNM2f: _pendingResolves has entry for ecRow', sim._pendingResolves.has(ecRow));
    check('T_PNM2g: _pendingResolves entry instrName is ELOADCALL',
        sim._pendingResolves.get(ecRow) && sim._pendingResolves.get(ecRow).instrName === 'ELOADCALL');
    check('T_PNM2h: Scheduler.IRQ fired with LAZY_RESOLVE',
        irqFiredWith !== null && irqFiredWith.reason === 'LAZY_RESOLVE');
    check('T_PNM2i: IRQ fired for the correct slot', irqFiredWith !== null && irqFiredWith.slot === ecRow);
    check('T_PNM2j: lazyResolvePending event emitted', lazyEvent !== null);
    check('T_PNM2k: lazyResolvePending event.slot matches ecRow',
        lazyEvent !== null && lazyEvent.slot === ecRow);
    check('T_PNM2l: machine NOT halted', !sim.halted);
    check('T_PNM2m: no fault logged (IRQ path, not hard fault)', sim.faultLog.length === 0);
}

// ── T_PNM3: XLOADLAMBDA on a named NULL slot fires LAZY_RESOLVE ───────────────
console.log('\n--- T_PNM3: XLOADLAMBDA on named NULL slot fires Scheduler.IRQ(LAZY_RESOLVE) ---');
{
    const { sim } = makeTestSim();

    const xlSlot   = 3;
    const clistLoc = 0x200;
    setupCR6(sim, clistLoc, 8);

    sim.memory[clistLoc + xlSlot] = 0;  // NULL GT
    sim._petNamedSlots.add(xlSlot);

    let irqFiredWith = null;
    sim._fireSchedulerIRQ = (reason, faultRecord, slot) => {
        irqFiredWith = { reason, slot };
        return true;
    };

    let lazyEvent = null;
    sim.on('lazyResolvePending', (ev) => { lazyEvent = ev; });

    const d = { opcode: 9, crDst: 0, crSrc: 6, imm: xlSlot, cond: 0 };
    const result = sim._execXloadlambda(d);

    check('T_PNM3a: result has lazySuspended=true', result !== null && result.lazySuspended === true);
    check('T_PNM3b: result.slot matches xlSlot', result !== null && result.slot === xlSlot);
    check('T_PNM3c: result.instrName is XLOADLAMBDA', result !== null && result.instrName === 'XLOADLAMBDA');
    check('T_PNM3d: result.kind is NULL_GT', result !== null && result.kind === 'NULL_GT');
    check('T_PNM3e: sim._lazySuspended flag set to true', sim._lazySuspended === true);
    check('T_PNM3f: _pendingResolves has entry for xlSlot', sim._pendingResolves.has(xlSlot));
    check('T_PNM3g: _pendingResolves entry instrName is XLOADLAMBDA',
        sim._pendingResolves.get(xlSlot) && sim._pendingResolves.get(xlSlot).instrName === 'XLOADLAMBDA');
    check('T_PNM3h: Scheduler.IRQ fired with LAZY_RESOLVE',
        irqFiredWith !== null && irqFiredWith.reason === 'LAZY_RESOLVE');
    check('T_PNM3i: IRQ fired for the correct slot', irqFiredWith !== null && irqFiredWith.slot === xlSlot);
    check('T_PNM3j: lazyResolvePending event emitted', lazyEvent !== null);
    check('T_PNM3k: lazyResolvePending event.slot matches xlSlot',
        lazyEvent !== null && lazyEvent.slot === xlSlot);
    check('T_PNM3l: machine NOT halted', !sim.halted);
    check('T_PNM3m: no fault logged (IRQ path, not hard fault)', sim.faultLog.length === 0);
}

// ── T_PNM4: ELOADCALL on an UNNAMED NULL slot → hard NULL_CAP fault ───────────
console.log('\n--- T_PNM4: ELOADCALL on unnamed NULL slot → hard NULL_CAP (regression guard) ---');
{
    const { sim } = makeTestSim();

    const ecRow    = 7;
    const clistLoc = 0x300;
    setupCR6(sim, clistLoc, 10);

    sim.memory[clistLoc + ecRow] = 0;   // NULL GT
    // ecRow is NOT added to _petNamedSlots
    // sim.programCapabilities is null/undefined — no pet name via that route either

    const d = { opcode: 8, crDst: 0, crSrc: 6, imm: ecRow, cond: 0 };
    const result = sim._execEloadcall(d);

    check('T_PNM4a: result is null (hard fault path)', result === null);
    check('T_PNM4b: sim._lazySuspended is false (no lazy suspend)', !sim._lazySuspended);
    check('T_PNM4c: faultLog has exactly one entry', sim.faultLog.length === 1);
    check('T_PNM4d: fault code is NULL_CAP',
        sim.faultLog.length > 0 &&
        sim.faultLog[0].faultCode === ChurchSimulator.FAULT_CODES.NULL_CAP);
    check('T_PNM4e: _pendingResolves has NO entry for ecRow', !sim._pendingResolves.has(ecRow));
}

// ── T_PNM5: reset() clears _petNamedSlots ─────────────────────────────────────
console.log('\n--- T_PNM5: reset() clears _petNamedSlots ---');
{
    const { sim } = makeTestSim();

    sim._petNamedSlots.add(1);
    sim._petNamedSlots.add(5);
    sim._petNamedSlots.add(10);

    check('T_PNM5a: slots present before reset', sim._petNamedSlots.size === 3);

    sim.reset();

    check('T_PNM5b: _petNamedSlots is a Set after reset', sim._petNamedSlots instanceof Set);
    check('T_PNM5c: _petNamedSlots is empty after reset', sim._petNamedSlots.size === 0);
    check('T_PNM5d: slot 1 absent after reset', !sim._petNamedSlots.has(1));
    check('T_PNM5e: slot 5 absent after reset', !sim._petNamedSlots.has(5));
    check('T_PNM5f: slot 10 absent after reset', !sim._petNamedSlots.has(10));

    // Verify the cleared Set is still functional (no cross-test pollution)
    sim._petNamedSlots.add(2);
    check('T_PNM5g: freshly-cleared Set can accept new entries', sim._petNamedSlots.has(2));
    check('T_PNM5h: pre-reset slots remain absent after new add', !sim._petNamedSlots.has(1));
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
