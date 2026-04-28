// fault_label_eviction_test.js — regression test for task #654
//
// Verifies that a fault entry's lump label is captured at fault() time and
// remains correct even after the faulting lump is evicted from memory
// (which can change or clear the nsLabels entry before the fault log is
// serialised).
//
// Run with: node simulator/fault_label_eviction_test.js

'use strict';

const ChurchSimulator = require('./simulator.js');

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build the minimal CR14 word0 value for a given ns slot index.
// The simulator uses (word0 & 0xFFFF) as the ns slot index.
function makeCr14Word0(nsIdx) {
    // Set a non-zero base token in the upper bits so word0 is non-zero,
    // and embed the ns index in the lower 16 bits.
    return ((0x01 << 16) | (nsIdx & 0xFFFF)) >>> 0;
}

// Set up a minimal simulator with nsLabels and cr[14] pointing at a slot.
function makeSimWithFault(nsIdx, label) {
    const sim = new ChurchSimulator();
    // Ensure cr array exists (reset initialises it).
    sim.reset();

    // Install a label into the namespace labels map.
    sim.nsLabels[nsIdx] = label;

    // Point CR14 at the chosen ns slot.
    sim.cr[14] = { word0: makeCr14Word0(nsIdx), word1: 0, word2: 0, word3: 0, m: 0 };

    // Trigger a fault.
    sim.fault('TEST_FAULT', 'synthetic fault for label regression');

    return sim;
}

// Simulate the label-resolution logic from _saveFaultLog in app-run.js so we
// can test it in isolation without requiring a full browser DOM.
function resolveFaultLabel(faultEntry, liveNsLabels) {
    // Mirror the logic from _saveFaultLog (app-run.js ~1609–1620):
    // If _nsSnapshot is not yet set, resolve it now using faultLabel (preferred)
    // or the live nsLabels table (fallback).
    if (Object.prototype.hasOwnProperty.call(faultEntry, '_nsSnapshot')) {
        return faultEntry._nsSnapshot && faultEntry._nsSnapshot.label;
    }
    const cr14s = faultEntry.crSnapshot && faultEntry.crSnapshot[14];
    if (cr14s && cr14s.word0) {
        const ni = cr14s.word0 & 0xFFFF;
        return faultEntry.faultLabel || (liveNsLabels && liveNsLabels[ni]) || `NS[${ni}]`;
    }
    return null;
}

// ── T1: faultLabel is captured at fault() time ────────────────────────────────
(function t1() {
    const nsIdx = 5;
    const label = 'SlideRule +1';
    const sim = makeSimWithFault(nsIdx, label);

    const entry = sim.faultLog[0];
    assert('T1 fault entry exists', entry !== undefined);
    assert('T1 faultLabel equals label at fault time',
        entry.faultLabel === label, entry.faultLabel);
    assert('T1 crSnapshot[14] word0 contains ns slot index',
        (entry.crSnapshot[14].word0 & 0xFFFF) === nsIdx,
        entry.crSnapshot[14].word0);
})();

// ── T2: faultLabel survives nsLabels mutation (simulated eviction churn) ──────
(function t2() {
    const nsIdx = 7;
    const originalLabel = 'SlideRule +1';
    const sim = makeSimWithFault(nsIdx, originalLabel);

    // Simulate what lazyEvict() / slot reuse does: overwrite the label.
    sim.nsLabels[nsIdx] = '(free)';

    const entry = sim.faultLog[0];
    assert('T2 faultLabel still holds original label after nsLabels mutation',
        entry.faultLabel === originalLabel, entry.faultLabel);
})();

// ── T3: _saveFaultLog resolution prefers faultLabel over mutated nsLabels ─────
(function t3() {
    const nsIdx = 3;
    const originalLabel = 'Acorn.Boot';
    const sim = makeSimWithFault(nsIdx, originalLabel);

    // Mutate nsLabels to simulate a re-used slot (new lump loaded after eviction).
    const mutatedNsLabels = { [nsIdx]: 'NewLump.Foo' };

    const entry = sim.faultLog[0];
    const resolved = resolveFaultLabel(entry, mutatedNsLabels);

    assert('T3 resolved label equals original (faultLabel wins over mutated nsLabels)',
        resolved === originalLabel, resolved);
})();

// ── T4: faultLabel is null when CR14 word0 is zero (no executing lump) ────────
(function t4() {
    const sim = new ChurchSimulator();
    sim.reset();
    // CR14 word0 = 0 → no valid ns slot.
    sim.cr[14] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.fault('TEST_NO_CR14', 'fault with zero CR14');

    const entry = sim.faultLog[0];
    assert('T4 faultLabel is null when CR14.word0 is zero',
        entry.faultLabel === null, entry.faultLabel);
})();

// ── T5: faultLabel fallback to NS[n] when nsLabels has no entry for slot ──────
// reset() pre-populates nsLabels via _initNamespaceTable(), so we explicitly
// delete the entry to simulate a slot that truly has no label assigned yet.
(function t5() {
    const nsIdx = 12;
    const sim = new ChurchSimulator();
    sim.reset();
    // Clear any label that _initNamespaceTable() may have written for this slot.
    delete sim.nsLabels[nsIdx];
    sim.cr[14] = { word0: makeCr14Word0(nsIdx), word1: 0, word2: 0, word3: 0, m: 0 };
    sim.fault('TEST_NOLABEL', 'fault with unlabelled ns slot');

    const entry = sim.faultLog[0];
    assert('T5 faultLabel falls back to NS[n] when slot is unlabelled',
        entry.faultLabel === `NS[${nsIdx}]`, entry.faultLabel);
})();

// ── T6: lazyEvict does not alter the stored faultLabel ────────────────────────
(function t6() {
    const nsIdx = 9;
    const label = 'Calc.Eval';
    const sim = makeSimWithFault(nsIdx, label);

    // Register a minimal lazyManifest entry so lazyEvict() has something to work with.
    // We need: entry.loaded = true and priority != 'hot', plus a NS table entry so
    // the code path that zeroes lump memory finds a valid location.
    sim.lazyManifest[nsIdx] = { loaded: true, priority: 'normal', allocSize: 4 };
    // Write a minimal NS table entry so readNSEntry returns something.
    // NS table base is at memory.length - NS_TABLE_RESERVE; each entry is NS_ENTRY_WORDS wide.
    const nsBase = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
    // word0 of NS entry = base address of lump (0 means no lump memory to zero in this stub).
    sim.memory[nsBase] = 0; // location 0 → lazyEvict skips zeroing (loc === 0 guard in code)

    sim.lazyEvict(nsIdx);

    // After eviction, nsLabels[nsIdx] is unchanged in this path because lazyEvict
    // only reads the label, it doesn't clear it.  However, in real usage the slot
    // might be reused and the label overwritten.  Simulate that:
    sim.nsLabels[nsIdx] = '(free)';

    const entry = sim.faultLog[0];
    assert('T6 faultLabel unchanged after lazyEvict and slot reuse',
        entry.faultLabel === label, entry.faultLabel);

    // Also verify that the resolution function still returns the correct label.
    const resolved = resolveFaultLabel(entry, sim.nsLabels);
    assert('T6 resolved label equals original even after eviction-induced nsLabels change',
        resolved === label, resolved);
})();

// ── Summary ───────────────────────────────────────────────────────────────────
setTimeout(function () {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);
}, 50);
