/**
 * Unit tests for simulator/lump-audit.js
 *
 * Run with Node.js:
 *   node tests/lump/test_lump_audit.js
 *
 * The module is loaded via a minimal shim (no DOM required).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '../../simulator/lump-audit.js'),
    'utf8'
);

const _mod = new Function(
    src + '\nreturn { lumpAudit, lumpAuditHasErrors, lumpAuditHasWarnings };'
)();
const lumpAudit           = _mod.lumpAudit;
const lumpAuditHasErrors  = _mod.lumpAuditHasErrors;
const lumpAuditHasWarnings = _mod.lumpAuditHasWarnings;

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  \u2713 ${label}`);
        passed++;
    } else {
        console.error(`  \u2717 FAIL: ${label}`);
        failed++;
    }
}

function assertRule(results, ruleId, severity, label) {
    const r = results.find(x => x.ruleId === ruleId);
    if (!r) {
        console.error(`  \u2717 FAIL: ${label} — rule ${ruleId} not found in results`);
        failed++;
        return;
    }
    if (r.severity !== severity) {
        console.error(`  \u2717 FAIL: ${label} — expected severity '${severity}', got '${r.severity}' (detail: ${r.detail})`);
        failed++;
        return;
    }
    console.log(`  \u2713 ${label}`);
    passed++;
}

function buildHeader({ magic = 0x1F, nMinus6 = 0, cw = 1, typ = 0, cc = 0 } = {}) {
    return ((magic & 0x1F) << 27) |
           ((nMinus6 & 0xF) << 23) |
           ((cw & 0x1FFF) << 10) |
           ((typ & 0x3) << 8) |
           (cc & 0xFF);
}

function makeWellFormed({ cw = 2, cc = 1, nMinus6 = 0 } = {}) {
    const lumpSize = 1 << (nMinus6 + 6);
    const header   = buildHeader({ nMinus6, cw, cc });
    const words    = new Array(lumpSize).fill(0);
    words[0] = header;
    for (let i = 1; i <= cw; i++) words[i] = 0x01000000;
    return words;
}

// ─── Test 1: well-formed LUMP — all checks pass ──────────────────────────
console.log('\nTest 1: Well-formed LUMP (all pass)');
{
    const words   = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'R1',  'pass', 'R1 magic pass');
    assertRule(results, 'R2',  'pass', 'R2 size pass');
    assertRule(results, 'RB1', 'pass', 'RB1 cw>=1 pass');
    assertRule(results, 'RB2', 'pass', 'RB2 bounds pass');
    assertRule(results, 'RFS', 'pass', 'RFS freespace pass');
    assert(!lumpAuditHasErrors(results),   'no errors');
    assert(!lumpAuditHasWarnings(results), 'no warnings');
}

// ─── Test 2: bad magic — R1 error ────────────────────────────────────────
console.log('\nTest 2: Bad magic (R1 fail)');
{
    const words   = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[0] = buildHeader({ magic: 0x0E, nMinus6: 0, cw: 2, cc: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'R1', 'error', 'R1 magic error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 3: truncated binary — R2 error ─────────────────────────────────
console.log('\nTest 3: Truncated binary (R2 fail)');
{
    const words = makeWellFormed({ cw: 4, cc: 0, nMinus6: 0 });
    const truncated = words.slice(0, 32);
    const results = lumpAudit(truncated, null);
    assertRule(results, 'R2', 'error', 'R2 size error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 4: non-zero freespace — RFS warn ────────────────────────────────
console.log('\nTest 4: Dirty freespace (RFS warn)');
{
    const words = makeWellFormed({ cw: 2, cc: 0, nMinus6: 0 });
    words[3] = 0xDEADBEEF;
    const results = lumpAudit(words, null);
    assertRule(results, 'RFS', 'warn', 'RFS freespace warn');
    assert(lumpAuditHasWarnings(results), 'has warnings');
    assert(!lumpAuditHasErrors(results),  'no errors');
}

// ─── Test 5: cw+cc overflow — RB2 error ──────────────────────────────────
console.log('\nTest 5: cw+cc bounds overflow (RB2 fail)');
{
    const lumpSize = 64;
    const cw = 60;
    const cc = 10;
    const nMinus6 = 0;
    const header = buildHeader({ nMinus6, cw, cc });
    const words = new Array(lumpSize).fill(0);
    words[0] = header;
    const results = lumpAudit(words, null);
    assertRule(results, 'RB2', 'error', 'RB2 bounds error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 6: cw=0 — RB1 error ────────────────────────────────────────────
console.log('\nTest 6: cw=0 (RB1 fail)');
{
    const words = makeWellFormed({ cw: 0, cc: 0, nMinus6: 0 });
    const results = lumpAudit(words, null);
    assertRule(results, 'RB1', 'error', 'RB1 cw=0 error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 7: manifest coherence — RMC pass ───────────────────────────────
console.log('\nTest 7: Manifest coherent (RMC pass)');
{
    const words = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const manifest = { cw: 2, cc: 1, lump_size: 64 };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RMC', 'pass', 'RMC manifest pass');
    assert(!lumpAuditHasErrors(results), 'no errors');
}

// ─── Test 8: manifest mismatch — RMC error ───────────────────────────────
console.log('\nTest 8: Manifest mismatch (RMC fail)');
{
    const words = makeWellFormed({ cw: 2, cc: 1, nMinus6: 0 });
    const manifest = { cw: 99, cc: 1, lump_size: 64 };
    const results  = lumpAudit(words, manifest);
    assertRule(results, 'RMC', 'error', 'RMC manifest error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 9: empty binary ────────────────────────────────────────────────
console.log('\nTest 9: Empty binary (R0 error)');
{
    const results = lumpAudit([], null);
    assertRule(results, 'R0', 'error', 'R0 empty binary error');
    assert(lumpAuditHasErrors(results), 'has errors');
}

// ─── Test 10: lumpAuditHasErrors / lumpAuditHasWarnings helpers ──────────
console.log('\nTest 10: Helper functions');
{
    const pass  = [{ ruleId: 'R1', severity: 'pass', message: 'OK', detail: '' }];
    const warn  = [{ ruleId: 'RFS', severity: 'warn', message: 'Dirty', detail: '' }];
    const err   = [{ ruleId: 'R1', severity: 'error', message: 'Bad', detail: '' }];
    assert(!lumpAuditHasErrors(pass) && !lumpAuditHasWarnings(pass), 'all-pass: no errors or warnings');
    assert(!lumpAuditHasErrors(warn) && lumpAuditHasWarnings(warn),  'warn only: no errors, has warnings');
    assert(lumpAuditHasErrors(err)   && !lumpAuditHasWarnings(err),  'error only: has errors, no warnings');
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
    console.log(`\u2713 All ${passed} assertions passed.\n`);
    process.exit(0);
} else {
    console.error(`\u2717 ${failed} assertion${failed !== 1 ? 's' : ''} failed, ${passed} passed.\n`);
    process.exit(1);
}
