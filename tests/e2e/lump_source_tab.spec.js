'use strict';

// lump_source_tab.spec.js — Playwright E2E tests for the LUMP Source tab.
//
// The Source tab is populated lazily when first clicked via
// _fetchAndShowLumpSavedSource(), which fetches
// GET /api/lumps/<token>/detail and injects the `source` field of the
// sidecar JSON into the `#lumpStoredSourceBody_<tk>` placeholder div.
//
// Suite 1 — LUMP with stored source:
//   Intercept /api/lumps/list (lump has source_hash set so the Source button is
//   not dimmed) and /api/lumps/<token>/detail (returns a sidecar with a known
//   `source` string).  Open the detail panel, click the Source tab, and assert
//   that `#lumpStoredSourceBody_<tk>` contains a `.lump-stored-src-pre` element
//   with the expected source text.
//
// Suite 2 — LUMP without stored source:
//   Same setup but /api/lumps/<token>/detail returns a sidecar with no `source`
//   field.  Assert that the `lump-stored-src-empty` notice appears inside
//   `#lumpStoredSourceBody_<tk>` and that no `.lump-stored-src-pre` element is
//   injected.
//
// All suites intercept the relevant API endpoints so results are deterministic
// and no real server lumps are read or written.

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────────────────────
// Shared stub data
// ─────────────────────────────────────────────────────────────────────────────

const STUB_TOKEN = 'ab1e86af';
// token.replace(/[^a-z0-9]/gi, '') — already alphanumeric for this token
const STUB_TK    = 'ab1e86af';

// Minimal lump entry for /api/lumps/list.
// source_hash is set so the Source tab button renders without the lump-tab-dim
// class and is easily clickable.
const STUB_LUMP = {
    token:        STUB_TOKEN,
    abstraction:  'TestAbs',
    ns_slot:      20,
    lump_size:    64,
    cw:           10,
    cc:           2,
    content_type: 'code',
    language:     'cloomc',
    lump_type:    'code',
    version:      1,
    source_hash:  'abc123',
};

// Sidecar response for /api/lumps/<token>/detail — has a `source` field.
const STUB_SOURCE_TEXT = 'abstraction TestAbs\n  method Run\n    RETURN\n  end\nend';
const STUB_DETAIL_WITH_SOURCE = {
    token:       STUB_TOKEN,
    abstraction: 'TestAbs',
    ns_slot:     20,
    lump_size:   64,
    cw:          10,
    cc:          2,
    language:    'cloomc',
    version:     1,
    source:      STUB_SOURCE_TEXT,
    compiled_at: 1716206400,
};

// Sidecar response for /api/lumps/<token>/detail — no `source` field.
const STUB_DETAIL_NO_SOURCE = {
    token:       STUB_TOKEN,
    abstraction: 'TestAbs',
    ns_slot:     20,
    lump_size:   64,
    cw:          10,
    cc:          2,
    language:    'cloomc',
    version:     1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Navigates to the Lumps view and opens the detail panel for STUB_TOKEN.
// Callers must already have set up the /api/lumps/list route interceptor.
async function openLumpDetail(page) {
    await page.goto('/simulator/');
    await page.waitForLoadState('networkidle');
    // Wait until app-shell.js has executed and switchView is in scope.
    await page.waitForFunction(() => typeof switchView === 'function');

    // switchView('lumps') automatically calls renderLumps() which fetches
    // /api/lumps/list and populates _lumpsCache.
    await page.evaluate(() => switchView('lumps'));

    // Wait for the lump picker <select> to appear, confirming renderLumps()
    // finished and the list view is live.
    await page.locator('#lumpPickerSelect').waitFor({ state: 'visible', timeout: 12000 });

    // Open the detail panel for our stub lump.
    await page.evaluate((token) => showLumpDetail(token), STUB_TOKEN);

    // Wait for the tab bar to render.
    await page.locator(`#lumpTabBar_${STUB_TK}`).waitFor({ state: 'visible', timeout: 8000 });
}

// Clicks the "Source" tab and waits for the tab panel to become active.
async function clickSourceTab(page) {
    const tabBar = page.locator(`#lumpTabBar_${STUB_TK}`);
    const srcBtn = tabBar.locator('button.lump-tab', { hasText: 'Source' });
    await srcBtn.waitFor({ state: 'visible' });
    await srcBtn.click();

    // Wait for the source panel to become the active tab.
    const srcPanel = page.locator(`#lumpTabSource_${STUB_TK}`);
    await srcPanel.waitFor({ state: 'visible', timeout: 8000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — LUMP with stored source renders .lump-stored-src-pre
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP Source tab — stored source is displayed', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/detail`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_DETAIL_WITH_SOURCE),
            });
        });
    });

    test('Source tab shows a .lump-stored-src-pre element with the expected source text', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickSourceTab(page);

        const storedSrcDiv = page.locator(`#lumpStoredSourceBody_${STUB_TK}`);

        // The pre element must appear inside the placeholder after the fetch resolves.
        const pre = storedSrcDiv.locator('.lump-stored-src-pre');
        await expect(pre).toBeVisible({ timeout: 10000 });

        // It must contain the exact source text from the sidecar.
        await expect(pre).toContainText('abstraction TestAbs');
        await expect(pre).toContainText('method Run');
        await expect(pre).toContainText('RETURN');
    });

    test('Source tab shows the language label in the section header', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);
        await clickSourceTab(page);

        const storedSrcDiv = page.locator(`#lumpStoredSourceBody_${STUB_TK}`);

        // The section must exist with the "Saved Source" title.
        const section = storedSrcDiv.locator('.lump-stored-src-section');
        await expect(section).toBeVisible({ timeout: 10000 });

        // Language meta tag must appear inside the section title area.
        const meta = section.locator('.lump-stored-src-meta');
        await expect(meta).toBeVisible();
        await expect(meta).toContainText('cloomc');
    });

    test('Source tab fires GET /api/lumps/<token>/detail exactly once', async ({ page }) => {
        test.setTimeout(40000);

        let detailCallCount = 0;
        // Override the beforeEach route to count calls.
        await page.route(`**/api/lumps/${STUB_TOKEN}/detail`, async route => {
            detailCallCount++;
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_DETAIL_WITH_SOURCE),
            });
        });

        await openLumpDetail(page);
        await clickSourceTab(page);

        // Wait for the pre element to confirm the fetch completed.
        await expect(page.locator(`#lumpStoredSourceBody_${STUB_TK} .lump-stored-src-pre`)).toBeVisible({ timeout: 10000 });

        // Exactly one detail fetch must have fired.
        expect(detailCallCount).toBe(1);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — LUMP without stored source shows the empty-state notice
// ─────────────────────────────────────────────────────────────────────────────

test.describe('LUMP Source tab — no stored source shows empty-state notice', () => {

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/lumps/list', async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify([STUB_LUMP]),
            });
        });
        await page.route(`**/api/lumps/${STUB_TOKEN}/detail`, async route => {
            await route.fulfill({
                status:      200,
                contentType: 'application/json',
                body:        JSON.stringify(STUB_DETAIL_NO_SOURCE),
            });
        });
    });

    test('Source tab shows the lump-stored-src-empty notice when the sidecar has no source field', async ({ page }) => {
        test.setTimeout(40000);
        await openLumpDetail(page);

        // Set up the waitForResponse listener BEFORE clicking the tab so the
        // promise is in place before _fetchAndShowLumpSavedSource fires its
        // fetch — mocked routes resolve very quickly and the response can be
        // gone before a listener registered after the click could catch it.
        const detailResponsePromise = page.waitForResponse(
            resp => resp.url().includes(`/api/lumps/${STUB_TOKEN}/detail`),
            { timeout: 10000 }
        );

        await clickSourceTab(page);

        // Wait for the detail response to land.
        await detailResponsePromise;

        const storedSrcDiv = page.locator(`#lumpStoredSourceBody_${STUB_TK}`);

        // The placeholder must be present in the DOM...
        await expect(storedSrcDiv).toBeAttached();

        // ...and must show the empty-state notice (no source field in sidecar).
        await expect(storedSrcDiv.locator('.lump-stored-src-empty')).toBeVisible({ timeout: 5000 });

        // No source pre element must have been injected.
        await expect(storedSrcDiv.locator('.lump-stored-src-pre')).toHaveCount(0);
    });

});
