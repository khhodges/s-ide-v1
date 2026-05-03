/**
 * lump-audit.js — LUMP binary structural consistency checker
 *
 * lumpAudit(words, manifest?) → Array<{ruleId, severity, message, detail}>
 *
 *   words    — Array or Uint32Array of 32-bit unsigned integers (the LUMP binary)
 *   manifest — optional object with cw / cc / lump_size fields from sidecar / manifest JSON
 *
 * severity values: 'pass' | 'warn' | 'error'
 *
 * Rules checked
 *   R1  — bits[31:27] of word 0 must equal 0x1F
 *   R2  — word count of the binary matches the size encoded in the header exponent
 *   RB1 — cw >= 1 (at least one code word)
 *   RB2 — 1 + cw + cc <= lump_size (bounds)
 *   RFS — all words in the freespace zone are zero
 *   RMC — if a manifest is supplied, its cw / cc / lump_size agree with the binary header
 */

function lumpAudit(words, manifest) {
    const results = [];

    if (!words || words.length === 0) {
        results.push({
            ruleId: 'R0',
            severity: 'error',
            message: 'Empty binary',
            detail: 'The word array is empty — nothing to audit.',
        });
        return results;
    }

    const word0 = (words[0] >>> 0);

    const magic    = (word0 >>> 27) & 0x1F;
    const nMinus6  = (word0 >>> 23) & 0xF;
    const cw       = (word0 >>> 10) & 0x1FFF;
    const cc       =  word0         & 0xFF;
    const lumpSize = 1 << (nMinus6 + 6);

    if (magic === 0x1F) {
        results.push({
            ruleId: 'R1',
            severity: 'pass',
            message: 'Magic OK',
            detail: `bits[31:27] = 0x${magic.toString(16).toUpperCase()} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R1',
            severity: 'error',
            message: 'Bad magic',
            detail: `bits[31:27] = 0x${magic.toString(16).toUpperCase()}, expected 0x1F — repack the binary with a correct header word.`,
        });
    }

    const actualWords = words.length;
    if (actualWords === lumpSize) {
        results.push({
            ruleId: 'R2',
            severity: 'pass',
            message: 'Size match',
            detail: `${actualWords} words == declared lump_size ${lumpSize} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R2',
            severity: 'error',
            message: 'Size mismatch',
            detail: `Binary has ${actualWords} words but header declares lump_size=${lumpSize} (n_m6=${nMinus6} \u2192 2^${nMinus6 + 6}).`,
        });
    }

    if (cw >= 1) {
        results.push({
            ruleId: 'RB1',
            severity: 'pass',
            message: 'cw \u2265 1',
            detail: `cw=${cw} — at least one code word \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB1',
            severity: 'error',
            message: 'cw = 0',
            detail: 'cw must be \u2265 1 — the lump must contain at least one code word.',
        });
    }

    const contentWords = 1 + cw + cc;
    if (contentWords <= lumpSize) {
        results.push({
            ruleId: 'RB2',
            severity: 'pass',
            message: 'Bounds OK',
            detail: `1 + cw(${cw}) + cc(${cc}) = ${contentWords} \u2264 lump_size=${lumpSize} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB2',
            severity: 'error',
            message: 'Header bounds overflow',
            detail: `1 + cw(${cw}) + cc(${cc}) = ${contentWords} exceeds lump_size=${lumpSize} — cw or cc is too large for this lump size.`,
        });
    }

    if (actualWords === lumpSize && contentWords <= lumpSize) {
        const fsStart = 1 + cw;
        const fsEnd   = lumpSize - cc;
        const fsCount = Math.max(0, fsEnd - fsStart);

        if (fsCount === 0) {
            results.push({
                ruleId: 'RFS',
                severity: 'pass',
                message: 'Freespace (none)',
                detail: 'No freespace zone — lump is fully packed \u2713',
            });
        } else {
            let dirtyWords = 0;
            let firstDirtyIdx = -1;
            let firstDirtyVal = 0;
            for (let i = fsStart; i < fsEnd; i++) {
                if ((words[i] >>> 0) !== 0) {
                    if (firstDirtyIdx < 0) {
                        firstDirtyIdx = i;
                        firstDirtyVal = words[i] >>> 0;
                    }
                    dirtyWords++;
                }
            }
            if (dirtyWords === 0) {
                results.push({
                    ruleId: 'RFS',
                    severity: 'pass',
                    message: 'Freespace clean',
                    detail: `${fsCount} freespace word${fsCount !== 1 ? 's' : ''} (words[${fsStart}\u2013${fsEnd - 1}]) are all zero \u2713`,
                });
            } else {
                results.push({
                    ruleId: 'RFS',
                    severity: 'warn',
                    message: 'Dirty freespace',
                    detail: `${dirtyWords} non-zero word${dirtyWords !== 1 ? 's' : ''} in freespace zone (first at word[${firstDirtyIdx}] = 0x${firstDirtyVal.toString(16).toUpperCase().padStart(8, '0')}).`,
                });
            }
        }
    } else {
        results.push({
            ruleId: 'RFS',
            severity: 'warn',
            message: 'Freespace skipped',
            detail: 'Freespace check skipped — fix size/bounds errors above first.',
        });
    }

    if (manifest && typeof manifest === 'object') {
        const checks = [];
        let mCoherent = true;

        if (manifest.cw !== undefined && manifest.cw !== null) {
            const mCw = parseInt(manifest.cw);
            if (mCw === cw) {
                checks.push(`cw: ${cw} \u2713`);
            } else {
                checks.push(`cw: manifest=${mCw} \u2260 binary=${cw}`);
                mCoherent = false;
            }
        }
        if (manifest.cc !== undefined && manifest.cc !== null) {
            const mCc = parseInt(manifest.cc);
            if (mCc === cc) {
                checks.push(`cc: ${cc} \u2713`);
            } else {
                checks.push(`cc: manifest=${mCc} \u2260 binary=${cc}`);
                mCoherent = false;
            }
        }
        if (manifest.lump_size !== undefined && manifest.lump_size !== null) {
            const mSz = parseInt(manifest.lump_size);
            if (mSz === lumpSize) {
                checks.push(`lump_size: ${lumpSize} \u2713`);
            } else {
                checks.push(`lump_size: manifest=${mSz} \u2260 binary=${lumpSize}`);
                mCoherent = false;
            }
        }

        if (checks.length === 0) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Manifest present',
                detail: 'Manifest has no cw/cc/lump_size fields to compare.',
            });
        } else if (mCoherent) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Manifest coherent',
                detail: checks.join(', '),
            });
        } else {
            results.push({
                ruleId: 'RMC',
                severity: 'error',
                message: 'Manifest mismatch',
                detail: checks.join(', ') + ' — update the manifest or re-assemble.',
            });
        }
    }

    return results;
}

function lumpAuditHasErrors(results) {
    return Array.isArray(results) && results.some(r => r.severity === 'error');
}

function lumpAuditHasWarnings(results) {
    return Array.isArray(results) && results.some(r => r.severity === 'warn');
}

/**
 * Build and inject the audit result panel DOM into `container`.
 * Returns { hasErrors, hasWarnings }.
 *
 * container  — DOM element to append the panel into
 * results    — output from lumpAudit()
 * opts       — optional { collapsible: bool (default true), startOpen: bool (default false for pass, true for failures) }
 */
function lumpAuditRenderPanel(container, results, opts) {
    const hasErrors   = lumpAuditHasErrors(results);
    const hasWarnings = lumpAuditHasWarnings(results);
    const allPass     = !hasErrors && !hasWarnings;

    const o = opts || {};
    const collapsible = (o.collapsible !== false);
    const startOpen   = (o.startOpen !== undefined) ? o.startOpen : (!allPass);

    const panel = document.createElement('div');
    panel.className = 'lump-audit-panel' +
        (hasErrors   ? ' lump-audit-panel-error' :
         hasWarnings ? ' lump-audit-panel-warn'  :
                       ' lump-audit-panel-pass');

    const header = document.createElement('div');
    header.className = 'lump-audit-header';

    const icon = hasErrors ? '\u2717' : hasWarnings ? '\u26a0' : '\u2713';
    const summary = hasErrors
        ? `${results.filter(r => r.severity === 'error').length} check${results.filter(r => r.severity === 'error').length !== 1 ? 's' : ''} failed`
        : hasWarnings
        ? `All checks passed with ${results.filter(r => r.severity === 'warn').length} warning${results.filter(r => r.severity === 'warn').length !== 1 ? 's' : ''}`
        : 'All checks passed';

    header.innerHTML = `<span class="lump-audit-icon">${icon}</span>` +
        `<span class="lump-audit-summary">${summary}</span>`;

    if (collapsible) {
        header.title = 'Click to expand/collapse';
        header.style.cursor = 'pointer';
    }

    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'lump-audit-body';
    if (collapsible && !startOpen) body.style.display = 'none';

    for (const r of results) {
        const row = document.createElement('div');
        row.className = 'lump-audit-row lump-audit-row-' + r.severity;

        const ruleSpan = document.createElement('span');
        ruleSpan.className = 'lump-audit-rule-id';
        ruleSpan.textContent = r.ruleId;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'lump-audit-msg';
        msgSpan.textContent = r.message;

        const detailSpan = document.createElement('span');
        detailSpan.className = 'lump-audit-detail';
        detailSpan.textContent = r.detail;

        row.appendChild(ruleSpan);
        row.appendChild(msgSpan);
        row.appendChild(detailSpan);
        body.appendChild(row);
    }

    panel.appendChild(body);

    if (collapsible) {
        let open = startOpen;
        header.addEventListener('click', () => {
            open = !open;
            body.style.display = open ? '' : 'none';
        });
    }

    container.appendChild(panel);
    return { hasErrors, hasWarnings };
}

/**
 * Run an audit against a token's binary fetched from the server API,
 * then render results into `container`.  Returns a Promise<{hasErrors, hasWarnings}>.
 *
 * token    — lump token string (hex)
 * manifest — optional { cw, cc, lump_size } object
 * container — DOM element to render into (existing children are cleared first)
 * opts      — forwarded to lumpAuditRenderPanel
 */
async function lumpAuditFromServer(token, manifest, container, opts) {
    container.innerHTML = '';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'lump-audit-loading';
    loadingEl.textContent = 'Running audit\u2026';
    container.appendChild(loadingEl);

    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const words = data.words || [];
        if (!words.length) throw new Error('Empty binary returned from server');
        container.innerHTML = '';
        const results = lumpAudit(words, manifest);
        return lumpAuditRenderPanel(container, results, opts);
    } catch (err) {
        container.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'lump-audit-panel lump-audit-panel-error';
        errEl.innerHTML = `<div class="lump-audit-header"><span class="lump-audit-icon">\u2717</span>` +
            `<span class="lump-audit-summary">Audit failed: ${_escHtml ? _escHtml(err.message) : err.message}</span></div>`;
        container.appendChild(errEl);
        return { hasErrors: true, hasWarnings: false };
    }
}
