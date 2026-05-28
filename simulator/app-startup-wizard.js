'use strict';

const StartupWizard = (function () {

    const LS_KEY   = 'sw_step_ti60';
    const LS_VER   = 'sw_version_ti60';
    const LS_FAIL  = 'sw_fail_';
    const LS_DONE  = 'sw_done_';
    const STEPS    = ['bitstream', 'flash', 'powercycle', 'connect', 'upload', 'running'];
    const TOTAL    = STEPS.length;

    let _currentStep  = 0;
    let _open         = false;
    let _releaseData  = null;
    let _pollTimer    = null;

    // ── DOM helpers ──────────────────────────────────────────────────────────

    function _el(id) { return document.getElementById(id); }

    function _setStepState(idx, state) {
        const el = _el('swStep' + idx);
        if (!el) return;
        el.className = 'sw-strip-step sw-step-' + state;
        const icon = el.querySelector('.sw-step-icon');
        if (icon) {
            icon.textContent = state === 'done'    ? '✓'
                             : state === 'active'  ? '▶'
                             : state === 'fail'    ? '✗'
                             : '○';
        }
    }

    function _renderProgress() {
        for (let i = 0; i < TOTAL; i++) {
            if (i < _currentStep)        _setStepState(i, 'done');
            else if (i === _currentStep) _setStepState(i, 'active');
            else                         _setStepState(i, 'pending');
        }
        const pct = Math.round((_currentStep / TOTAL) * 100);
        const bar = _el('swProgressFill');
        if (bar) bar.style.width = pct + '%';
        const lbl = _el('swProgressLabel');
        if (lbl) lbl.textContent = 'Step ' + (_currentStep + 1) + ' of ' + TOTAL;

        for (let i = 0; i < TOTAL; i++) {
            const body = _el('swBody' + i);
            if (body) body.style.display = (i === _currentStep) ? '' : 'none';
        }
    }

    function _save() {
        try { localStorage.setItem(LS_KEY, String(_currentStep)); } catch (_) {}
    }

    function _load() {
        try {
            const s = parseInt(localStorage.getItem(LS_KEY), 10);
            if (!isNaN(s) && s >= 0 && s < TOTAL) _currentStep = s;
        } catch (_) {}
    }

    // ── Success / failure / stuck state helpers ───────────────────────────────

    function markStepDone(idx) {
        _setStepState(idx, 'done');
        _clearFail(idx);
        const succ = _el('swSuccess' + idx);
        if (succ) succ.classList.add('sw-visible');
        try { localStorage.setItem(LS_DONE + idx, '1'); } catch (_) {}
    }

    // confirmStep — used by "✓ Done" buttons on steps 0–2.
    // Shows the success banner then auto-advances after a short pause so
    // the user can see the green confirmation before the step transitions.
    // The "→ Next step" button in the banner lets them skip the wait.
    function confirmStep(idx) {
        markStepDone(idx);
        setTimeout(function () {
            if (_currentStep === idx) advance();
        }, 700);
    }

    function markStepFail(idx, silent) {
        _setStepState(idx, 'fail');
        const trouble = _el('swTrouble' + idx);
        if (trouble) trouble.classList.add('sw-visible');
        if (!silent) {
            try { localStorage.setItem(LS_FAIL + idx, '1'); } catch (_) {}
        }
    }

    function toggleTrouble(idx) {
        const trouble = _el('swTrouble' + idx);
        if (!trouble) return;
        trouble.classList.toggle('sw-visible');
    }

    function _clearFail(idx) {
        try { localStorage.removeItem(LS_FAIL + idx); } catch (_) {}
    }

    // ── Public ───────────────────────────────────────────────────────────────

    function advance() {
        if (_currentStep < TOTAL - 1) {
            _clearFail(_currentStep);
            _currentStep++;
            _save();
            _renderProgress();
        }
    }

    function back() {
        if (_currentStep > 0) {
            _currentStep--;
            _save();
            _renderProgress();
        }
    }

    function reset() {
        for (let i = 0; i < TOTAL; i++) {
            try { localStorage.removeItem(LS_FAIL + i); } catch (_) {}
            try { localStorage.removeItem(LS_DONE + i); } catch (_) {}
        }
        _currentStep = 0;
        _save();
        _renderProgress();
        for (let i = 0; i < TOTAL; i++) {
            const succ = _el('swSuccess' + i);
            if (succ) succ.classList.remove('sw-visible');
            const trouble = _el('swTrouble' + i);
            if (trouble) trouble.classList.remove('sw-visible');
        }
    }

    function toggle() {
        const body = _el('swWizardBody');
        const chev = _el('swChevron');
        if (!body) return;
        _open = !_open;
        body.style.display = _open ? '' : 'none';
        if (chev) chev.textContent = _open ? '▾' : '▸';
    }

    function open() {
        const body = _el('swWizardBody');
        const chev = _el('swChevron');
        if (!body) return;
        _open = true;
        body.style.display = '';
        if (chev) chev.textContent = '▾';
    }

    // ── Connect button shortcut ───────────────────────────────────────────────

    function clickConnect() {
        const menu = document.getElementById('ti60ConnectMenu');
        if (!menu) return;
        const toggle = menu.querySelector('.ti60-connect-menu-toggle');
        if (toggle) toggle.click();
        menu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Release version check ────────────────────────────────────────────────

    async function _loadRelease() {
        try {
            const r = await fetch('/api/releases', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (!d.ok || !d.release) return;
            _releaseData = d.release;

            const badge = _el('swVersionBadge');
            if (badge) {
                badge.textContent = 'v' + d.release.version;
                badge.title = d.release.description || '';
            }

            if (d.stale) {
                const warn = _el('swStaleWarning');
                if (warn) {
                    warn.textContent = '⚠ Verilog source has changed since v' + d.release.version + ' — re-synthesis recommended.';
                    warn.style.display = '';
                }
                const badge2 = _el('swVersionBadge');
                if (badge2) badge2.classList.add('sw-version-stale');
            }

            const dlBtn = _el('swDownloadBtn');
            if (dlBtn && d.release.verilog_download) {
                dlBtn.href = d.release.verilog_download;
                dlBtn.setAttribute('download', 'church_ti60_f225.v');
            }
            const zipBtn = _el('swZipBtn');
            if (zipBtn && d.release.zip_download) {
                zipBtn.href = d.release.zip_download;
            }

            try {
                const prev = localStorage.getItem(LS_VER);
                if (prev && prev !== d.release.version) {
                    const warn2 = _el('swUpdateWarning');
                    if (warn2) {
                        warn2.textContent = '🆕 New release v' + d.release.version + ' (was v' + prev + ') — re-flash recommended before connecting.';
                        warn2.style.display = '';
                    }
                }
                localStorage.setItem(LS_VER, d.release.version);
            } catch (_) {}

        } catch (_) {}
    }

    // ── Watch the existing Ti60 steps to auto-advance wizard ─────────────────

    function _watchTi60Steps() {
        _pollTimer = setInterval(function () {
            if (_currentStep < 3) return;

            const uartStep = _el('ti60Step-uart');
            if (_currentStep === 3 && uartStep) {
                if (uartStep.classList.contains('ti60-step-pass')) {
                    markStepDone(3);
                    setTimeout(function () {
                        if (_currentStep === 3) {
                            _currentStep = 4;
                            _save();
                            _renderProgress();
                        }
                    }, 700);
                } else if (uartStep.classList.contains('ti60-step-fail')) {
                    markStepFail(3);
                }
            }

            const relStep = _el('ti60Step-release');
            if (_currentStep >= 4 && relStep) {
                if (relStep.classList.contains('ti60-step-pass')) {
                    markStepDone(4);
                    setTimeout(function () {
                        if (_currentStep === 4) {
                            _currentStep = 5;
                            _save();
                            _renderProgress();
                            clearInterval(_pollTimer);
                        }
                    }, 700);
                } else if (relStep.classList.contains('ti60-step-fail')) {
                    markStepFail(4);
                }
            }
        }, 800);
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init() {
        _load();
        _renderProgress();

        // Restore persisted done banners for steps before current
        for (let i = 0; i < _currentStep; i++) {
            try {
                if (localStorage.getItem(LS_DONE + i) === '1') {
                    const succ = _el('swSuccess' + i);
                    if (succ) succ.classList.add('sw-visible');
                }
            } catch (_) {}
        }

        // Restore fail state for current step — open troubleshoot panel,
        // but don't re-save (silent=true) so it is cleared on next visit
        try {
            if (localStorage.getItem(LS_FAIL + _currentStep) === '1') {
                markStepFail(_currentStep, true);
            }
        } catch (_) {}

        _loadRelease();
        _watchTi60Steps();
    }

    document.addEventListener('DOMContentLoaded', init);

    return { advance, back, reset, toggle, open, clickConnect, markStepDone, markStepFail, toggleTrouble, confirmStep };
})();
