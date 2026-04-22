// Boot integration harness for Startup.Config (Task #396).
//
// Verifies that, after a real boot image is loaded and boot steps B:00-B:04
// complete, Startup.Config.Execute() can be dispatched and produces a
// 'Startup.Config.Execute' gate-log entry.  This replicates the dispatch
// path that BOOT_ROM_WORDS[7] (CALL AL, CR0, CR0 after loading c-list[4])
// would take in the running system.
//
// Note: running the NUC code directly after bootComplete would require
// Boot.Thread to hold an S-perm capability for CHANGE CR12 (BOOT_ROM_WORDS[0]).
// That is a separate architectural concern; this harness focuses on the
// registry dispatch path that is Startup.Config's responsibility.
//
// Steps:
//   1. Load a full boot image from boot_image.py via Python subprocess (or
//      use _initNamespaceTable() defaults which produce the same layout).
//   2. Initialize AbstractionRegistry + SystemAbstractions.
//   3. Drive _bootStep() until bootComplete.
//   4. Directly call registry.dispatchMethod(2, 'Execute', sim, {}) to
//      simulate BOOT_ROM_WORDS[7] CALL → Startup.Config.Execute().
//   5. Print a JSON report to stdout.
//
// Print format:
//   {
//     "bootComplete":            boolean,
//     "faultLog":                [...],
//     "startupConfigEntry":      <auditLog entry> | null,
//     "executeResult":           { ok, message },
//     "auditLogHasStartup":      boolean,
//     "ledBits":                 number,  // 0x3F on success
//     "dispatchedToSlot":        number   // NS slot Execute dispatched to
//   }

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords:  16384,
            namespaceLumpWords:      64,
            threadLumpWords:        256,
            abstractionLumpWords:   256,
        }
    }
};

const ChurchSimulator     = require('../simulator/simulator.js');
const AbstractionRegistry = require('../simulator/abstractions.js');
const SystemAbstractions  = require('../simulator/system_abstractions.js');

const sim      = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys      = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);

// --- Phase 1: drive boot state machine (B:00–B:04) ---
const MAX_BOOT = 32;
let bootIters = 0;
while (bootIters < MAX_BOOT && !sim.bootComplete && !sim.halted) {
    const advanced = sim._bootStep();
    bootIters++;
    if (!advanced) break;
}

// --- Phase 2: dispatch Startup.Config.Execute() directly ---
// This mirrors what BOOT_ROM_WORDS[7] (CALL AL, CR0, CR0) does after
// loading Startup.Config's GT from Boot.Abstr c-list[4] into CR0.
let execResult = null;
if (sim.bootComplete && !sim.halted) {
    execResult = registry.dispatchMethod(2, 'Execute', sim, {});
}

const scEntry = (sim.auditLog || []).find(e => e.gate === 'Startup.Config.Execute');

const out = {
    bootComplete:       sim.bootComplete === true,
    faultLog:           (sim.faultLog || []).map(f => ({
                            type: f.type, message: f.message
                        })),
    startupConfigEntry: scEntry || null,
    executeResult:      execResult
        ? { ok: execResult.ok, message: execResult.message || '' }
        : null,
    auditLogHasStartup: scEntry !== undefined,
    ledBits:            sim.ledBits | 0,
    dispatchedToSlot:   scEntry ? (scEntry.nsIndex | 0) : -1,
};

process.stdout.write(JSON.stringify(out) + '\n');
