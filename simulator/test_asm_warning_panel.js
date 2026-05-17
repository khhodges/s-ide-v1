// test_asm_warning_panel.js — regression tests for the assembly warning panel
// (Task #1326)
//
// Verifies that _showAsmWarnings actually populates #asmWarningPanel with
// line-clickable items, that _clearAsmWarnings hides it again, and that
// clicking a line item invokes _jumpToAsmLine with the correct argument.
//
// Uses jsdom so the real production DOM manipulation code is exercised.
//
// Run with: node simulator/test_asm_warning_panel.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────

function extractFunctionByName(srcPath, fnName) {
    const src   = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const lines = src.split('\n');

    const startIdx = lines.findIndex(l =>
        new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`).test(l.trimStart()));
    if (startIdx === -1) throw new Error(`Function ${fnName} not found in ${srcPath}`);

    let declStart = startIdx;
    for (let i = startIdx - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (/^(?:let|var)\s+/.test(t)) { declStart = i; }
        else if (t === '' || t.startsWith('//')) { continue; }
        else { break; }
    }

    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (depth === 0 && i > startIdx) break;
    }

    return lines.slice(declStart, endIdx + 1).join('\n');
}

const ESC_HTML_SRC      = extractFunctionByName('app-misc.js',      '_escHtml');
const SHOW_WARN_SRC     = extractFunctionByName('app-cr-detail.js', '_showAsmWarnings');
const CLEAR_WARN_SRC    = extractFunctionByName('app-cr-detail.js', '_clearAsmWarnings');

// ── VM context factory ────────────────────────────────────────────────────────

function makeCtx() {
    const html = `<!DOCTYPE html><body>
        <div id="asmWarningPanel" style="display:none;"></div>
        <textarea id="asmEditor"></textarea>
        <div id="asmWarningOverlay"></div>
        <div id="lineNumbers"></div>
    </body>`;

    const dom      = new JSDOM(html);
    const document = dom.window.document;

    const jumpCalls = [];

    // ── Sandbox stub registry ────────────────────────────────────────────────
    // Every function that _showAsmWarnings / _clearAsmWarnings call internally
    // must be present in this sandbox, otherwise the VM throws a ReferenceError.
    //
    // Known production helpers (keep this list in sync with app-cr-detail.js
    // lines ~544-593 when editing those functions):
    //
    //   _highlightAsmWarningLines(warnings)  — highlights gutter lines; touches
    //       many DOM elements not present in the test fixture.
    //   _updateAsmWarnBadge(count)           — updates the badge counter; the
    //       real implementation guards with `if (!badge) return` but we stub it
    //       here so no badge DOM element is required at all.
    //   _jumpToAsmLine(lineNum)              — spy: we want to capture calls.
    //
    // CATCH-ALL PROXY: The sandbox is wrapped in a Proxy so that any NEW
    // helper added to _showAsmWarnings / _clearAsmWarnings in the future will
    // silently no-op instead of crashing with a ReferenceError.  Explicit stubs
    // above are kept for documentation and for the _jumpToAsmLine spy; the
    // Proxy covers anything not yet listed here.
    const sandbox = {
        document,
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        // Module-level state used by the real functions.
        _activeAsmWarnings: [],
        // Stub for line-highlight side-effect (touches many DOM elements not
        // relevant to panel correctness).
        _highlightAsmWarningLines: function() {},
        // Stub for badge update (touches asmWarnBadge elements not in the
        // test fixture — the real function guards with if (!badge) return).
        _updateAsmWarnBadge: function() {},
        // Spy: records every call to _jumpToAsmLine.
        _jumpToAsmLine: function(lineNum) { jumpCalls.push(lineNum); },
    };

    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            // Pass JavaScript built-ins (String, Number, Object, Math, …)
            // through from the host globalThis so the VM code continues to work
            // normally.
            if (typeof prop === 'string' && prop in globalThis) {
                return globalThis[prop];
            }
            // Return a silent no-op for any unknown production helper
            // (underscore- or letter-prefixed identifier).  This prevents
            // ReferenceErrors when new DOM-touching helpers are added to
            // _showAsmWarnings / _clearAsmWarnings without a simultaneous
            // update to this test file.
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) {
                return function() {};
            }
            return undefined;
        },
        has(target, prop) {
            return true;
        },
    }));

    vm.runInContext(ESC_HTML_SRC,   ctx, { filename: 'app-misc.js' });
    vm.runInContext(SHOW_WARN_SRC,  ctx, { filename: 'app-cr-detail.js' });
    vm.runInContext(CLEAR_WARN_SRC, ctx, { filename: 'app-cr-detail.js' });

    return { ctx, document, jumpCalls };
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

// ── WP-1: panel becomes visible after _showAsmWarnings ───────────────────────
{
    const { ctx, document } = makeCtx();
    const warnings = [
        { line: 3, message: 'Undefined label: foo' },
        { line: 7, message: 'Unreachable instruction' },
    ];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel = document.getElementById('asmWarningPanel');
    assert('WP-1: panel display is flex after _showAsmWarnings',
        panel.style.display === 'flex',
        'display=' + panel.style.display);
}

// ── WP-2: each warning renders a line-number label ───────────────────────────
{
    const { ctx, document } = makeCtx();
    const warnings = [
        { line: 5,  message: 'Unknown mnemonic: FOO' },
        { line: 12, message: 'Operand out of range' },
    ];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel   = document.getElementById('asmWarningPanel');
    const buttons = panel.querySelectorAll('.asm-warning-item[data-line]');
    assert('WP-2: correct number of line-item buttons rendered',
        buttons.length === 2, 'count=' + buttons.length);

    const label0 = buttons[0] && buttons[0].querySelector('.asm-warning-line-label');
    assert('WP-2: first item shows "Line 5:"',
        label0 && label0.textContent === 'Line 5:',
        label0 ? label0.textContent : '(no label)');

    const label1 = buttons[1] && buttons[1].querySelector('.asm-warning-line-label');
    assert('WP-2: second item shows "Line 12:"',
        label1 && label1.textContent === 'Line 12:',
        label1 ? label1.textContent : '(no label)');
}

// ── WP-3: warning message text is present in each item ───────────────────────
{
    const { ctx, document } = makeCtx();
    const warnings = [
        { line: 2, message: 'Undefined label: bar' },
    ];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel  = document.getElementById('asmWarningPanel');
    const button = panel.querySelector('.asm-warning-item[data-line]');
    assert('WP-3: warning message text is present in the button',
        button && button.textContent.includes('Undefined label: bar'),
        button ? button.textContent : '(no button)');
}

// ── WP-4: clicking a line item calls _jumpToAsmLine with the correct line ─────
{
    const { ctx, document, jumpCalls } = makeCtx();
    const warnings = [
        { line: 9,  message: 'Warning A' },
        { line: 14, message: 'Warning B' },
    ];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel   = document.getElementById('asmWarningPanel');
    const buttons = Array.from(panel.querySelectorAll('.asm-warning-item[data-line]'));

    buttons[0].click();
    assert('WP-4: clicking first item passes line 9 to _jumpToAsmLine',
        jumpCalls.length === 1 && jumpCalls[0] === 9,
        'calls=' + JSON.stringify(jumpCalls));

    buttons[1].click();
    assert('WP-4: clicking second item passes line 14 to _jumpToAsmLine',
        jumpCalls.length === 2 && jumpCalls[1] === 14,
        'calls=' + JSON.stringify(jumpCalls));
}

// ── WP-5: no-line warning renders a non-clickable span (no data-line button) ──
{
    const { ctx, document } = makeCtx();
    const warnings = [
        { message: 'Global warning with no line number' },
    ];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel   = document.getElementById('asmWarningPanel');
    const buttons = panel.querySelectorAll('.asm-warning-item[data-line]');
    const noline  = panel.querySelectorAll('.asm-warning-item-noline');
    assert('WP-5: no data-line button for a line-less warning',
        buttons.length === 0, 'buttons=' + buttons.length);
    assert('WP-5: a no-line span is rendered',
        noline.length === 1, 'spans=' + noline.length);
}

// ── WP-6: panel is hidden again after _clearAsmWarnings ──────────────────────
{
    const { ctx, document } = makeCtx();
    const warnings = [{ line: 1, message: 'Some warning' }];
    vm.runInContext('_showAsmWarnings(' + JSON.stringify(warnings) + ')', ctx);

    const panel = document.getElementById('asmWarningPanel');
    assert('WP-6: panel visible before clear',
        panel.style.display === 'flex', 'display=' + panel.style.display);

    vm.runInContext('_clearAsmWarnings()', ctx);
    assert('WP-6: panel hidden after _clearAsmWarnings',
        panel.style.display === 'none', 'display=' + panel.style.display);
    assert('WP-6: panel innerHTML is empty after _clearAsmWarnings',
        panel.innerHTML === '', 'innerHTML=' + panel.innerHTML);
}

// ── WP-7: empty warnings array hides the panel via _showAsmWarnings ──────────
{
    const { ctx, document } = makeCtx();
    vm.runInContext('_showAsmWarnings([])', ctx);

    const panel = document.getElementById('asmWarningPanel');
    assert('WP-7: panel stays hidden when warnings array is empty',
        panel.style.display === 'none', 'display=' + panel.style.display);
}

// ── WP-8: title reflects singular/plural count ───────────────────────────────
{
    const { ctx: ctx1, document: doc1 } = makeCtx();
    vm.runInContext('_showAsmWarnings(' + JSON.stringify([{ line: 1, message: 'x' }]) + ')', ctx1);
    const header1 = doc1.querySelector('.asm-warning-panel-title');
    assert('WP-8: singular "Warning" title for 1 issue',
        header1 && header1.textContent.includes('Warning \u2014 1 issue'),
        header1 ? header1.textContent : '(no title)');

    const { ctx: ctx2, document: doc2 } = makeCtx();
    vm.runInContext('_showAsmWarnings(' + JSON.stringify([
        { line: 1, message: 'a' }, { line: 2, message: 'b' }
    ]) + ')', ctx2);
    const header2 = doc2.querySelector('.asm-warning-panel-title');
    assert('WP-8: plural "Warnings" title for 2 issues',
        header2 && header2.textContent.includes('Warnings \u2014 2 issues'),
        header2 ? header2.textContent : '(no title)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
