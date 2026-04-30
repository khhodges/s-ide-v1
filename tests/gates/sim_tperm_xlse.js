'use strict';
// Headless harness for tests/test_tperm_xlse.py.
//
// Tests the TPERM X⊕LSE domain-purity fault:
//   result_perms = preset_mask ∩ GT.perms
//   fault TPERM_RSV if result has X AND (L or S or E)
//
// Because no standard preset combines X with L/S/E, the test injects a
// custom preset via the sim.tpermPresetMasks property (exposed for
// testability). This mirrors the hardware tperm.py is_xlse_conflict check
// on result_perms = new_perms & target_gt.perms.
//
// GT word layout (simulator parseGT):
//   bits [15: 0]  slot_id
//   bits [22:16]  gt_seq
//   bits [24:23]  gt_type  (0b01 = Inform)
//   bits [31:25]  permBits: R=bit0 W=bit1 X=bit2 L=bit3 S=bit4 E=bit5 B=bit6
//                           → X at bit 27, L at bit 28, S at bit 29
//
// Preset code 11 is a reserved slot reused here as the test-only X+L preset.
// Preset code 14 is reused as the test-only X+S preset.
// Preset code 13 is reused as the test-only X+E preset.
//
// Stdin:  (none — scenarios are hardcoded)
// Stdout: JSON array of result objects

global.window = { bootConfig: {} };
const { bootSim } = require('./sim_helpers');

function runTperm(scenarioName, crIdx, word0GT, customPresetSlot, customPresetPerms) {
    const sim = bootSim();
    if (!sim.bootComplete) {
        return { name: scenarioName, error: 'boot did not complete' };
    }

    // Preload the target CR with the desired GT word.
    // slot_id=1 (Boot.Thread) ensures the GT references a valid NS entry so
    // mLoad version/seal checks inside TPERM pass.
    if (sim.cr[crIdx] === undefined) sim.cr[crIdx] = {};
    sim.cr[crIdx].word0 = word0GT >>> 0;

    // Inject the custom preset if requested.
    if (customPresetSlot !== null && customPresetPerms !== null) {
        sim.tpermPresetMasks[customPresetSlot] = customPresetPerms;
    }

    // Find the code lump.
    const cr14 = sim.cr[14];
    const codeBase = cr14 ? cr14.word1 : null;
    if (codeBase == null) return { name: scenarioName, error: 'CR14.word1 is null' };

    // Encode TPERM (opcode=6), targeting crIdx, imm = customPresetSlot.
    const imm = (customPresetSlot !== null) ? customPresetSlot : 3;  // default: X preset
    const instr = sim.encodeInstruction(6, 0xE, crIdx, 0, imm);
    sim.memory[codeBase + 1] = instr >>> 0;

    sim.pc = 0;
    sim.halted = false;
    const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;
    sim.step();
    const faultsAfter = sim.faultLog ? sim.faultLog.length : 0;
    const newFaults = sim.faultLog ? sim.faultLog.slice(faultsBefore) : [];

    return {
        name:      scenarioName,
        faulted:   newFaults.length > 0,
        faultCode: newFaults.length ? newFaults[0].type : null,
        faultMsg:  newFaults.length ? newFaults[0].message : null,
        flags:     { Z: sim.flags.Z, N: sim.flags.N },
    };
}

// GT word constants (simulator bit layout)
// X at bit 27 (permBits bit 2), L at bit 28 (permBits bit 3),
// S at bit 29 (permBits bit 4), E at bit 30 (permBits bit 5)
// Inform type (0b01) at bit 23; slot_id = 1
const GT_X_ONLY  = (0x04 << 25) | (0x01 << 23) | 1;   // X only: permBits=0b0000100
const GT_X_L     = (0x0C << 25) | (0x01 << 23) | 1;   // X + L:  permBits=0b0001100
const GT_X_S     = (0x14 << 25) | (0x01 << 23) | 1;   // X + S:  permBits=0b0010100
const GT_X_E     = (0x24 << 25) | (0x01 << 23) | 1;   // X + E:  permBits=0b0100100

const results = [
    // T_XLSE1: GT has X+L, custom preset ['X','L'] → result has X+L → TPERM_RSV fault
    runTperm('T_XLSE1_xL_conflict',  5, GT_X_L, 11, ['X','L']),
    // T_XLSE2: GT has X+S, custom preset ['X','S'] → result has X+S → TPERM_RSV fault
    runTperm('T_XLSE2_xS_conflict',  5, GT_X_S, 14, ['X','S']),
    // T_XLSE3: GT has X+E, custom preset ['X','E'] → result has X+E → TPERM_RSV fault
    runTperm('T_XLSE3_xE_conflict',  5, GT_X_E, 13, ['X','E']),
    // T_XLSE4: GT has X+L, standard preset [X] (code 3) → result has X only (L stripped)
    //          → no conflict, TPERM succeeds (Z depends on whether GT has X)
    runTperm('T_XLSE4_xL_no_conflict_via_X_preset', 5, GT_X_L, null, null),
    // T_XLSE5: GT has X only, standard preset [X] (code 3) → result has X → no fault
    runTperm('T_XLSE5_x_only_no_conflict', 5, GT_X_ONLY, null, null),
];

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
