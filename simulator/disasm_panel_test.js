// disasm_panel_test.js — Unit tests for the click-to-expand disassembly row feature
//
// Verifies the production click handler in app-misc.js (the "Click-to-expand"
// section) against four contracted behaviours:
//
//   DP-1  Clicking a non-current row with data-desc inserts a .nia-disasm-desc sibling
//   DP-2  At-most-one constraint: clicking row B collapses row A's desc first
//   DP-3  Clicking the same already-expanded row collapses it
//   DP-4  The .nia-disasm-current row is not clickable (no desc inserted)
//   DP-5  The expanded row receives the .nia-row-expanded class
//   DP-6  When a row collapses, .nia-row-expanded is removed from it
//   DP-7  A row without data-desc is silently ignored (no desc inserted)
//   DP-8  The inserted desc element contains the data-desc text
//
// Run with:  node simulator/disasm_panel_test.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────
// Extracts the self-contained `disasmBody.addEventListener(...)` statement from
// app-misc.js by locating the known comment marker and matching parentheses.

function extractClickHandler(srcPath) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');

    const marker = '// Click-to-expand: any non-current disassembly row with a description';
    const markerIdx = src.indexOf(marker);
    if (markerIdx === -1) {
        throw new Error('Click-to-expand comment marker not found in ' + srcPath);
    }

    const aeIdx = src.indexOf('disasmBody.addEventListener(', markerIdx);
    if (aeIdx === -1) {
        throw new Error('disasmBody.addEventListener( not found after marker in ' + srcPath);
    }

    // Walk forward tracking paren depth to find the matching close paren.
    let depth = 0;
    let end   = -1;
    for (let i = aeIdx; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
            if (--depth === 0) { end = i; break; }
        }
    }
    if (end === -1) throw new Error('Could not find end of addEventListener call');

    return src.slice(aeIdx, end + 1) + ';';
}

const HANDLER_SRC = extractClickHandler('app-misc.js');

// ── DOM fixture helpers ───────────────────────────────────────────────────────

// Build a fresh JSDOM environment with a .nia-disasm-body containing the
// requested row specs.  Each spec is:
//   { desc, current, noDesc }
//   desc    — string → sets data-desc attribute (omit or falsy for no attr)
//   current — bool  → adds .nia-disasm-current class
//   noDesc  — bool  → row has no data-desc (overrides desc)
function makeFixture(rowSpecs) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    const document = dom.window.document;

    const body = document.createElement('div');
    body.className = 'nia-disasm-body';
    document.body.appendChild(body);

    const rows = rowSpecs.map(function(spec) {
        const row = document.createElement('div');
        let cls = 'nia-disasm-row';
        if (spec.current) cls += ' nia-disasm-current';
        row.className = cls;
        if (spec.desc && !spec.noDesc) {
            row.dataset.desc = spec.desc;
        }
        row.textContent = spec.label || 'row';
        body.appendChild(row);
        return row;
    });

    // Attach the production click handler (requires disasmBody in scope).
    const sandbox = { disasmBody: body, document: document };
    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
            return undefined;
        },
        has() { return true; },
    }));
    vm.runInContext(HANDLER_SRC, ctx, { filename: 'app-misc.js' });

    return { document, body, rows };
}

// Fire a synthetic click whose e.target is the given element.
// jsdom's dispatchEvent / click() honours event bubbling so the delegated
// listener on .nia-disasm-body receives it with the correct e.target.
function click(el) {
    el.click();
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' \u2014 ' + detail : ''));
        failed++;
    }
}

// ── DP-1: clicking a non-current row with data-desc inserts a desc sibling ───
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha instruction explanation' },
    ]);

    click(rows[0]);

    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-1: desc element inserted after click',
        desc !== null, 'querySelector returned null');
    assert('DP-1: desc is immediately after the clicked row',
        desc && rows[0].nextElementSibling === desc, 'sibling mismatch');
}

// ── DP-2: at-most-one — clicking row B collapses row A's desc ────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Explanation A' },
        { label: 'row B', desc: 'Explanation B' },
    ]);

    click(rows[0]);
    const descAfterA = body.querySelectorAll('.nia-disasm-desc');
    assert('DP-2: exactly one desc after first click',
        descAfterA.length === 1, 'count=' + descAfterA.length);

    click(rows[1]);
    const descs = body.querySelectorAll('.nia-disasm-desc');
    assert('DP-2: still exactly one desc after second click',
        descs.length === 1, 'count=' + descs.length);
    assert('DP-2: the remaining desc belongs to row B',
        descs[0] && rows[1].nextElementSibling === descs[0], 'sibling mismatch');
    assert('DP-2: row A has no desc sibling',
        rows[0].nextElementSibling !== null
            ? !rows[0].nextElementSibling.classList.contains('nia-disasm-desc')
            : true,
        'row A still has desc');
}

// ── DP-3: clicking the same expanded row a second time collapses it ───────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Toggle me' },
    ]);

    click(rows[0]);
    assert('DP-3: desc present after first click',
        body.querySelector('.nia-disasm-desc') !== null);

    click(rows[0]);
    assert('DP-3: desc removed after second click (toggle collapse)',
        body.querySelector('.nia-disasm-desc') === null,
        'desc still in DOM');
}

// ── DP-4: .nia-disasm-current row click is a no-op ───────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'current row', desc: 'Should not expand', current: true },
    ]);

    click(rows[0]);

    // The current row's desc element (if any) would carry .nia-disasm-desc-current,
    // added by the HTML builder — not by the click handler.  The click handler
    // must NOT insert an additional .nia-disasm-desc (without the -current suffix).
    const nonCurrentDescs = body.querySelectorAll('.nia-disasm-desc:not(.nia-disasm-desc-current)');
    assert('DP-4: current row click inserts no desc',
        nonCurrentDescs.length === 0, 'count=' + nonCurrentDescs.length);
}

// ── DP-5: expanded row receives .nia-row-expanded class ──────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha' },
    ]);

    click(rows[0]);
    assert('DP-5: .nia-row-expanded added to clicked row',
        rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
}

// ── DP-6: .nia-row-expanded removed when a row collapses ─────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'row A', desc: 'Alpha' },
        { label: 'row B', desc: 'Beta'  },
    ]);

    // Expand row A, then click row B — row A should lose the class.
    click(rows[0]);
    assert('DP-6: row A expanded after first click',
        rows[0].classList.contains('nia-row-expanded'));

    click(rows[1]);
    assert('DP-6: row A loses .nia-row-expanded after row B clicked',
        !rows[0].classList.contains('nia-row-expanded'),
        'classList=' + rows[0].className);
    assert('DP-6: row B gains .nia-row-expanded',
        rows[1].classList.contains('nia-row-expanded'),
        'classList=' + rows[1].className);
}

// ── DP-7: row without data-desc is silently ignored ──────────────────────────
{
    const { body, rows } = makeFixture([
        { label: 'no-desc row', noDesc: true },
    ]);

    click(rows[0]);
    assert('DP-7: clicking row without data-desc inserts no desc',
        body.querySelector('.nia-disasm-desc') === null,
        'desc found unexpectedly');
}

// ── DP-8: inserted desc contains the data-desc text ──────────────────────────
{
    const expected = 'Load capability into register CR3 from namespace slot 7';
    const { body, rows } = makeFixture([
        { label: 'row X', desc: expected },
    ]);

    click(rows[0]);
    const desc = body.querySelector('.nia-disasm-desc');
    assert('DP-8: desc textContent matches data-desc attribute',
        desc && desc.textContent === expected,
        desc ? JSON.stringify(desc.textContent) : '(no desc)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
