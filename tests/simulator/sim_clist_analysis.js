// Headless harness for Task #546.
//
// Unit-tests _computeReferencedCListSlots() from simulator/app-memory.js
// without booting the full IDE. The function is extracted from the production
// source via a brace-counting parser and injected with a minimal stub for
// the `sim` global it reads (only sim.memory[] is accessed).
//
// Covered cases:
//   1. codeCount = 0  (null / empty code section)
//   2. Direct reference via LOAD from CR6
//   3. Direct reference via SAVE via CR6
//   4. Direct reference via ELOADCALL via CR6
//   5. Direct reference via XLOADLAMBDA via CR6
//   6. Alias: LOAD crX from CR6+s1 then access [crX+s2] → s2 in indirect
//   7. Non-CR6 source, no alias → nothing recorded
//   8. CR alias clobbered: crX re-loaded from CR6+s2 before use via crX
//   9. Alias CR = 6 itself (LOAD CR6 from [CR6+slot]) — indirect via that
//      alias stays in the direct bucket (crSrc=6 is excluded from alias path)
//  10. Slot in both direct and indirect — indirect set must NOT contain it
//  11. codeCount larger than memory — boundary guard works, no crash
//
// Exits 0 on success, non-zero on any failure.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Extract _computeReferencedCListSlots from the live production file ────────

function extractFunctionSource(src, name) {
    const pattern = new RegExp('function\\s+' + name + '\\s*\\(');
    const match   = pattern.exec(src);
    if (!match) throw new Error('Cannot find function ' + name + ' in source');

    // Walk forward to the opening brace of the function body.
    let i = match.index;
    while (i < src.length && src[i] !== '{') i++;

    // Count braces to find the matching closing brace.
    let depth = 0;
    const bodyStart = i;
    while (i < src.length) {
        if      (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    return src.slice(match.index, i);
}

const srcPath = path.resolve(__dirname, '../../simulator/app-memory.js');
const appSrc  = fs.readFileSync(srcPath, 'utf8');
const fnSrc   = extractFunctionSource(appSrc, '_computeReferencedCListSlots');

// Build the function with `sim` injected as a parameter so it is fully
// isolated from any real browser globals.  new Function() runs in strict mode
// but that is fine — the function body itself contains no 'use strict'.
const _makeAnalyzer = new Function('sim', fnSrc + '\nreturn _computeReferencedCListSlots;');

// ── Shared minimal sim stub ───────────────────────────────────────────────────
// Each test sets sim.memory to a fresh array before calling analyze().

let simStub = { memory: [] };
const analyze = _makeAnalyzer(simStub);

// ── Instruction encoding helper ───────────────────────────────────────────────
// Mirrors the field layout used by the function:
//   [31:27] opcode  (5 bits)
//   [22:19] crDst   (4 bits)
//   [18:15] crSrc   (4 bits)
//   [14: 0] imm     (15 bits)

const LOAD        = 0;
const SAVE        = 1;
const ELOADCALL   = 8;
const XLOADLAMBDA = 9;

function instr(opcode, crDst, crSrc, imm) {
    return (((opcode & 0x1F) << 27) |
            ((crDst  & 0x0F) << 19) |
            ((crSrc  & 0x0F) << 15) |
            (imm     & 0x7FFF)) >>> 0;
}

// ── Test runner ───────────────────────────────────────────────────────────────

const ERRORS = [];
let   PASS_COUNT = 0;

function pass(label) {
    process.stdout.write('[PASS] ' + label + '\n');
    PASS_COUNT++;
}

function fail(label, msg) {
    const line = '[FAIL] ' + label + ': ' + msg;
    ERRORS.push(line);
    process.stderr.write(line + '\n');
}

// Load a word sequence into simStub.memory starting at address 0 and return
// the analyze() result for that range.
function runOn(words) {
    simStub.memory = words.map(w => w >>> 0);
    return analyze(0, words.length);
}

// ── Test 1: empty code section (codeCount = 0) ───────────────────────────────
(function test_empty_code() {
    const label = 'empty code section → both sets empty';
    simStub.memory = [];
    const { direct, indirect } = analyze(0, 0);
    if (direct.size !== 0)   { fail(label, 'direct should be empty, size=' + direct.size);   return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty, size=' + indirect.size); return; }
    pass(label);
})();

// ── Test 2: direct LOAD from CR6 ─────────────────────────────────────────────
(function test_direct_load() {
    const label = 'LOAD [CR6+3] → slot 3 in direct, indirect empty';
    const { direct, indirect } = runOn([instr(LOAD, 1, 6, 3)]);
    if (!direct.has(3))      { fail(label, 'expected slot 3 in direct');  return; }
    if (direct.size !== 1)   { fail(label, 'direct.size should be 1, got ' + direct.size); return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty');  return; }
    pass(label);
})();

// ── Test 3: direct SAVE via CR6 ──────────────────────────────────────────────
(function test_direct_save() {
    const label = 'SAVE [CR6+7], crX → slot 7 in direct, indirect empty';
    // SAVE: opcode=1, crSrc=6 → slot 7 recorded; crDst is irrelevant for aliases
    const { direct, indirect } = runOn([instr(SAVE, 0, 6, 7)]);
    if (!direct.has(7))      { fail(label, 'expected slot 7 in direct');  return; }
    if (direct.size !== 1)   { fail(label, 'direct.size should be 1');   return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty');  return; }
    pass(label);
})();

// ── Test 4: direct ELOADCALL via CR6 ─────────────────────────────────────────
(function test_direct_eloadcall() {
    const label = 'ELOADCALL [CR6+2] → slot 2 in direct';
    const { direct, indirect } = runOn([instr(ELOADCALL, 0, 6, 2)]);
    if (!direct.has(2))    { fail(label, 'expected slot 2 in direct'); return; }
    if (direct.size !== 1) { fail(label, 'direct.size should be 1');  return; }
    pass(label);
})();

// ── Test 5: direct XLOADLAMBDA via CR6 ───────────────────────────────────────
(function test_direct_xloadlambda() {
    const label = 'XLOADLAMBDA [CR6+5] → slot 5 in direct';
    const { direct, indirect } = runOn([instr(XLOADLAMBDA, 0, 6, 5)]);
    if (!direct.has(5))    { fail(label, 'expected slot 5 in direct'); return; }
    if (direct.size !== 1) { fail(label, 'direct.size should be 1');  return; }
    pass(label);
})();

// ── Test 6: alias register used for indirect access ──────────────────────────
// Word 0: LOAD CR2, [CR6+10]  → CR2 becomes alias; slot 10 in direct
// Word 1: LOAD CR3, [CR2+20]  → slot 20 in indirect (via alias CR2)
(function test_alias_indirect() {
    const label = 'alias CR2 loaded from CR6+10, then accessed [CR2+20] → 10 in direct, 20 in indirect';
    const words = [
        instr(LOAD, 2, 6, 10),
        instr(LOAD, 3, 2, 20),
    ];
    const { direct, indirect } = runOn(words);
    if (!direct.has(10))      { fail(label, 'expected slot 10 in direct');   return; }
    if (direct.size !== 1)    { fail(label, 'direct.size should be 1');      return; }
    if (!indirect.has(20))    { fail(label, 'expected slot 20 in indirect'); return; }
    if (indirect.size !== 1)  { fail(label, 'indirect.size should be 1');    return; }
    pass(label);
})();

// ── Test 7: non-CR6 source with no prior alias → nothing recorded ─────────────
(function test_no_cr6_no_alias() {
    const label = 'LOAD via CR3 (not an alias, no CR6 use) → both sets empty';
    const { direct, indirect } = runOn([instr(LOAD, 1, 3, 99)]);
    if (direct.size !== 0)   { fail(label, 'direct should be empty');   return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty'); return; }
    pass(label);
})();

// ── Test 8: alias register clobbered (re-loaded) before indirect use ──────────
// First LOAD from CR6+1 establishes CR2 as alias.
// Second LOAD from CR6+4 re-loads CR2 — both slots in direct, CR2 still alias.
// Third instruction accesses [CR2+30] → slot 30 in indirect.
//
// The function is a conservative approximation; once a register appears as a
// destination of LOAD from CR6 anywhere in the code body it stays in aliasSet.
// Consequently slot 30 must appear in indirect regardless of ordering.
(function test_alias_clobbered() {
    const label = 'CR2 alias clobbered (re-loaded CR6+4), then [CR2+30] → 30 in indirect';
    const words = [
        instr(LOAD, 2, 6, 1),   // CR2 ← [CR6+1]  → direct: {1}, alias: {2}
        instr(LOAD, 2, 6, 4),   // CR2 ← [CR6+4]  → direct: {1,4}, alias: {2}
        instr(LOAD, 5, 2, 30),  // CR5 ← [CR2+30] → indirect: {30}
    ];
    const { direct, indirect } = runOn(words);
    if (!direct.has(1))      { fail(label, 'expected slot 1 in direct');    return; }
    if (!direct.has(4))      { fail(label, 'expected slot 4 in direct');    return; }
    if (direct.size !== 2)   { fail(label, 'direct.size should be 2');      return; }
    if (!indirect.has(30))   { fail(label, 'expected slot 30 in indirect'); return; }
    if (indirect.size !== 1) { fail(label, 'indirect.size should be 1');    return; }
    pass(label);
})();

// ── Test 9: alias CR = 6 itself (LOAD CR6, [CR6+slot]) ───────────────────────
// The first pass adds CR6 to aliasSet.  In the second pass the condition is
// `crSrc !== 6 && aliasSet.has(crSrc)` — so any subsequent LOAD/SAVE via CR6
// is captured as a *direct* reference, not an indirect one.  The "alias via 6"
// path therefore produces no entries in indirect.
(function test_alias_is_cr6() {
    const label = 'LOAD CR6 from [CR6+11], then LOAD [CR6+22] → 11 and 22 in direct, indirect empty';
    const words = [
        instr(LOAD, 6, 6, 11),  // CR6 ← [CR6+11] → direct: {11}, alias: {6}
        instr(LOAD, 0, 6, 22),  // CR0 ← [CR6+22] → direct: {11,22} (crSrc=6 → direct path)
    ];
    const { direct, indirect } = runOn(words);
    if (!direct.has(11))     { fail(label, 'expected slot 11 in direct');   return; }
    if (!direct.has(22))     { fail(label, 'expected slot 22 in direct');   return; }
    if (direct.size !== 2)   { fail(label, 'direct.size should be 2');      return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty (CR6 alias is not a true indirect)'); return; }
    pass(label);
})();

// ── Test 10: slot in both direct and indirect — indirect must NOT contain it ───
// The second pass skips any imm already in `direct`, so a slot reached both
// directly (via CR6) and indirectly (via alias) appears only in direct.
(function test_direct_wins_over_indirect() {
    const label = 'slot 5 accessed directly and via alias → only in direct, not in indirect';
    const words = [
        instr(LOAD, 2, 6,  5),  // CR2 ← [CR6+5]  → direct: {5}, alias: {2}
        instr(LOAD, 3, 2,  5),  // CR3 ← [CR2+5]  → imm=5 already in direct → skip
        instr(LOAD, 4, 2, 99),  // CR4 ← [CR2+99] → indirect: {99}
    ];
    const { direct, indirect } = runOn(words);
    if (!direct.has(5))        { fail(label, 'expected slot 5 in direct');             return; }
    if (indirect.has(5))       { fail(label, 'slot 5 must NOT appear in indirect');    return; }
    if (!indirect.has(99))     { fail(label, 'expected slot 99 in indirect');          return; }
    if (indirect.size !== 1)   { fail(label, 'indirect.size should be 1, got ' + indirect.size); return; }
    pass(label);
})();

// ── Test 11: codeCount extends beyond memory boundary ────────────────────────
// The function contains `if (addr >= sim.memory.length) break;`.
// Providing codeCount=10 but memory.length=3 must not crash and must still
// correctly record the instructions that are within bounds.
(function test_boundary_guard() {
    const label = 'codeCount > memory.length → no crash, in-bounds words processed';
    simStub.memory = [
        instr(LOAD, 1, 6, 42),  // addr 0 — in bounds
        instr(SAVE, 0, 6, 43),  // addr 1 — in bounds
        instr(LOAD, 2, 6, 44),  // addr 2 — in bounds
        // addr 3..9 are past memory end → break
    ];
    const { direct, indirect } = analyze(0, 10);  // intentional over-count
    if (!direct.has(42)) { fail(label, 'expected slot 42 in direct'); return; }
    if (!direct.has(43)) { fail(label, 'expected slot 43 in direct'); return; }
    if (!direct.has(44)) { fail(label, 'expected slot 44 in direct'); return; }
    if (direct.size !== 3) { fail(label, 'direct.size should be 3, got ' + direct.size); return; }
    pass(label);
})();

// ── Test 12: mixed opcodes — only LOAD/SAVE/ELOADCALL/XLOADLAMBDA count ──────
// A NOP (opcode 0xF, say) via CR6 must not add anything to direct or indirect.
(function test_other_opcodes_ignored() {
    const label = 'non-tracked opcode via CR6 → not recorded in direct or indirect';
    const OTHER = 7;   // opcode 7 is not in the tracked set
    const words = [
        instr(OTHER, 0, 6, 55),  // opcode 7 — must be ignored
        instr(LOAD,  1, 6, 56),  // LOAD — direct slot 56
    ];
    const { direct, indirect } = runOn(words);
    if (direct.has(55))    { fail(label, 'slot 55 (non-tracked opcode) must NOT appear in direct'); return; }
    if (!direct.has(56))   { fail(label, 'expected slot 56 in direct'); return; }
    if (direct.size !== 1) { fail(label, 'direct.size should be 1, got ' + direct.size); return; }
    pass(label);
})();

// ── Test 13: SAVE and ELOADCALL do NOT create aliases ────────────────────────
// Only LOAD (opcode 0) promotes a destination register to alias status.
// Using SAVE or ELOADCALL via CR6 must add the slot to direct but must NOT
// make crDst an alias for subsequent indirect tracking.
(function test_save_eloadcall_no_alias() {
    const label = 'SAVE/ELOADCALL via CR6 add to direct but do not create alias';
    const words = [
        instr(SAVE,      2, 6, 10),  // crDst=2 via CR6 — NOT an alias
        instr(ELOADCALL, 3, 6, 11),  // crDst=3 via CR6 — NOT an alias
        instr(LOAD,      0, 2, 20),  // via CR2 — CR2 not in aliasSet → ignored
        instr(LOAD,      0, 3, 21),  // via CR3 — CR3 not in aliasSet → ignored
    ];
    const { direct, indirect } = runOn(words);
    if (!direct.has(10))     { fail(label, 'expected slot 10 in direct');  return; }
    if (!direct.has(11))     { fail(label, 'expected slot 11 in direct');  return; }
    if (direct.size !== 2)   { fail(label, 'direct.size should be 2');     return; }
    if (indirect.size !== 0) { fail(label, 'indirect should be empty (no LOAD-based alias was created)'); return; }
    pass(label);
})();

// ── Report ─────────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    process.stderr.write('\n' + ERRORS.length + ' test(s) failed.\n');
    process.exit(1);
}
process.stdout.write('\n' + PASS_COUNT + ' test(s) passed.\n');
process.exit(0);
