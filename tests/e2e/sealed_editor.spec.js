'use strict';

// sealed_editor.spec.js — Playwright E2E test for Task #1427
//
// Verifies the sealed-editor behaviour after a clean compile:
//
//   1. A minimal CLOOMC assembly source is injected into #asmEditor and
//      compileAndBuild() is invoked (file download is suppressed in-page).
//   2. After compilation the editor must be read-only, carry the
//      `cm-editor-sealed` CSS class, and the example-tabs-row must be hidden.
//   3. localStorage['cm_sealed_lump'] must be non-null after compile.
//   4. All three conditions must survive a full page reload (restored by
//      the DOMContentLoaded handler in app-misc.js).
//
// The /api/lumps/save POST is route-intercepted so the test is hermetic and
// does not leave artefacts in the server-side lump library.

const { test, expect } = require('@playwright/test');

// ─── Constants ────────────────────────────────────────────────────────────────

// Minimal assembly source: one instruction, no capabilities, no abstraction
// header.  The compiler defaults the name to 'Unnamed' and builds a 64-word
// lump with cw=1 and cc=0 — the smallest valid binary.
const MINIMAL_SOURCE = 'HALT';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Inject MINIMAL_SOURCE into #asmEditor, disable the lumpAudit pass (so the
 * one-instruction binary does not trip structural rules that expect a full
 * boot-image layout), suppress the blob download, and call compileAndBuild().
 *
 * Returns the sealed-state snapshot immediately after the call returns so the
 * test can assert on it without an extra round-trip.
 */
async function triggerCompile(page) {
    return page.evaluate((src) => {
        // ── 1. Set editor source ──────────────────────────────────────────────
        const editor = document.getElementById('asmEditor');
        if (editor) editor.value = src;

        // Force language selector to 'assembly' so smartCompile() does not
        // try to re-detect and switch frontend.
        const sel = document.getElementById('langSelector');
        if (sel) sel.value = 'assembly';

        // ── 2. Bypass lumpAudit — the one-instruction binary is intentionally
        //       minimal and would fail structural-consistency rules.  Audit is
        //       restored after the call so it cannot affect later tests.
        const savedAudit = window.lumpAudit;
        window.lumpAudit = undefined;

        // ── 3. Suppress the blob download so Playwright does not have to
        //       handle a file-save dialog.  We patch the anchor click() method
        //       only for elements that carry a `download` attribute.
        const origAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (this.hasAttribute('download')) return; // swallow download
            return origAnchorClick.call(this);
        };

        // Also stub createObjectURL so it returns a harmless string instead of
        // allocating a real Blob URL (avoids console errors when the anchor
        // click is swallowed).
        const origCreateObjURL = URL.createObjectURL;
        URL.createObjectURL = () => 'blob:suppressed-by-test';

        // ── 4. Run the real compileAndBuild() path ────────────────────────────
        try {
            compileAndBuild();
        } finally {
            // Always restore — even if compile throws.
            window.lumpAudit = savedAudit;
            HTMLAnchorElement.prototype.click = origAnchorClick;
            URL.createObjectURL = origCreateObjURL;
        }

        // ── 5. Return a state snapshot for immediate JS-level assertions ──────
        const ed = document.getElementById('asmEditor');
        const tabsRow = document.querySelector('.example-tabs-row');
        return {
            readOnly:       ed ? ed.readOnly : null,
            hasClass:       ed ? ed.classList.contains('cm-editor-sealed') : false,
            tabsRowDisplay: tabsRow ? (tabsRow.style.display || '') : null,
            sealedLump:     localStorage.getItem('cm_sealed_lump'),
        };
    }, MINIMAL_SOURCE);
}

/**
 * Read the sealed-editor DOM state without triggering any compile — used for
 * post-reload assertions.
 */
async function readSealedState(page) {
    return page.evaluate(() => {
        const ed = document.getElementById('asmEditor');
        const tabsRow = document.querySelector('.example-tabs-row');
        return {
            readOnly:       ed ? ed.readOnly : null,
            hasClass:       ed ? ed.classList.contains('cm-editor-sealed') : false,
            tabsRowDisplay: tabsRow ? (tabsRow.style.display || '') : null,
            sealedLump:     localStorage.getItem('cm_sealed_lump'),
        };
    });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Sealed-editor behaviour after a clean compile', () => {

    test('editor is sealed after compile and seal survives a page reload', async ({ page }) => {
        test.setTimeout(60000);

        // ── Intercept the server-side save so no artefacts are written ────────
        await page.route('**/api/lumps/save', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, lump: 'Unnamed.lump', token: 'test0000' }),
            });
        });

        // ── Load the simulator ────────────────────────────────────────────────
        await page.goto('/simulator/');
        await page.waitForLoadState('networkidle');

        // ── Trigger compile ───────────────────────────────────────────────────
        const after = await triggerCompile(page);

        // ── 1. #asmEditor must be read-only ───────────────────────────────────
        expect(after.readOnly, '#asmEditor.readOnly must be true after compile').toBe(true);

        // ── 2. #asmEditor must carry the cm-editor-sealed class ───────────────
        expect(after.hasClass, '#asmEditor must have class cm-editor-sealed').toBe(true);

        // ── 3. .example-tabs-row must be hidden ──────────────────────────────
        expect(after.tabsRowDisplay, '.example-tabs-row must have display:none').toBe('none');

        // ── 4. localStorage['cm_sealed_lump'] must be non-null ───────────────
        expect(after.sealedLump, 'cm_sealed_lump must be written to localStorage').not.toBeNull();
        const parsed = JSON.parse(after.sealedLump);
        expect(parsed).toHaveProperty('abstraction');
        expect(parsed).toHaveProperty('sealedAt');

        // ── Reload the page ───────────────────────────────────────────────────
        await page.reload();
        await page.waitForLoadState('networkidle');

        // ── Re-assert all three conditions after reload ───────────────────────
        const afterReload = await readSealedState(page);

        expect(afterReload.readOnly,
            '#asmEditor must still be read-only after reload').toBe(true);

        expect(afterReload.hasClass,
            '#asmEditor must still carry cm-editor-sealed after reload').toBe(true);

        expect(afterReload.tabsRowDisplay,
            '.example-tabs-row must still be hidden after reload').toBe('none');

        expect(afterReload.sealedLump,
            'cm_sealed_lump must still be in localStorage after reload').not.toBeNull();
    });

});
