// clist-viewer.js
// C-List Viewer popup for the assembly editor toolbar.
// Shows every Golden Token in the current thread's C-List (CR6),
// with permissions, B/F bits, and pet name.
//
// Depends on globals set up by other simulator scripts:
//   sim           — ChurchMachineSim instance (app-shell.js)
//   _petNameCRMap — slot-indexed pet name map  (app-run.js)
//
// This file loads synchronously AFTER asm-instruction-picker.js, so
// window.AsmInstructionPicker is already defined at the point the IIFE runs.
// Mutual exclusion is wired without a polling loop:
//   • CListViewer.show() calls AsmInstructionPicker.hide() directly.
//   • AsmInstructionPicker.show is wrapped once, synchronously, at the
//     bottom of this file, to call CListViewer.hide() before showing.
//
// Public API: window.CListViewer = { show, hide, toggle, isVisible }

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    var DEFAULT_SHORTCUT = { code: 'KeyC', ctrl: true, shift: true };

    // ── State ─────────────────────────────────────────────────────────────────
    var popupEl      = null;
    var activeEditor = null;
    var focusedRow   = -1;

    // ── DOM helpers ───────────────────────────────────────────────────────────
    function getOrCreatePopup() {
        if (popupEl) return popupEl;
        popupEl = document.createElement('div');
        popupEl.className = 'clist-viewer-popup';
        popupEl.setAttribute('role', 'listbox');
        popupEl.setAttribute('aria-label', 'C-List viewer');
        document.body.appendChild(popupEl);

        // ── Delegated click handler: handles row clicks without inline onclick ─
        popupEl.addEventListener('click', function (e) {
            var row = e.target.closest('.clist-row[data-slot]');
            if (!row || row.classList.contains('clist-row--null')) return;
            insertCROperand(parseInt(row.dataset.slot, 10));
        });

        // ── Close on outside click ─────────────────────────────────────────────
        document.addEventListener('mousedown', function (e) {
            if (!popupEl) return;
            if (!popupEl.contains(e.target) &&
                !e.target.classList.contains('btn-clist-viewer')) {
                hideViewer();
            }
        });

        document.addEventListener('keydown', onDocKeyDown, true);
        return popupEl;
    }

    // ── Keyboard handler ──────────────────────────────────────────────────────
    function onDocKeyDown(e) {
        if (!isVisible()) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            hideViewer();
            return;
        }

        var rows = popupEl ? popupEl.querySelectorAll('.clist-row[data-slot]') : [];
        if (!rows.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusedRow = Math.min(focusedRow + 1, rows.length - 1);
            applyRowFocus(rows);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusedRow = Math.max(focusedRow - 1, 0);
            applyRowFocus(rows);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusedRow >= 0 && focusedRow < rows.length) {
                insertCROperand(parseInt(rows[focusedRow].dataset.slot, 10));
            }
        }
    }

    function applyRowFocus(rows) {
        rows.forEach(function (r, i) {
            if (i === focusedRow) {
                r.classList.add('clist-row--focused');
                r.scrollIntoView({ block: 'nearest' });
            } else {
                r.classList.remove('clist-row--focused');
            }
        });
    }

    // ── Insert CR operand into editor ─────────────────────────────────────────
    function insertCROperand(slotIdx) {
        var ed = activeEditor || document.getElementById('asmEditor');
        if (!ed) return;
        var token = 'CR' + slotIdx;
        var start = ed.selectionStart;
        var end   = ed.selectionEnd;
        var val   = ed.value;
        ed.value = val.slice(0, start) + token + val.slice(end);
        ed.selectionStart = ed.selectionEnd = start + token.length;
        ed.dispatchEvent(new Event('input', { bubbles: true }));
        hideViewer();
        ed.focus();
    }

    // ── Data helpers ──────────────────────────────────────────────────────────
    var PERM_LABELS = ['R', 'W', 'X', 'L', 'S', 'E'];
    var PERM_COLORS = {
        R: '#5b9aef',
        W: '#e07b54',
        X: '#7ecb61',
        L: '#b87ee0',
        S: '#e0d25b',
        E: '#f4b942',
    };

    function permChipsHtml(perms) {
        return PERM_LABELS.map(function (p) {
            var on = perms && perms[p];
            return '<span class="clist-perm-chip' + (on ? ' clist-perm-chip--on' : '') + '"' +
                   (on ? ' style="background:' + PERM_COLORS[p] + '22;color:' + PERM_COLORS[p] + ';border-color:' + PERM_COLORS[p] + '55;"' : '') +
                   '>' + p + '</span>';
        }).join('');
    }

    // ── Inline GT decode (used by the static-binary path, no sim needed) ─────
    function _decodeGTWord(raw32) {
        raw32 = raw32 >>> 0;
        var permBits = (raw32 >>> 25) & 0x7F;
        return {
            type:  (raw32 >>> 23) & 0x3,
            index:  raw32 & 0xFFFF,
            permissions: {
                B: (permBits >>> 6) & 1,
                E: (permBits >>> 5) & 1,
                S: (permBits >>> 4) & 1,
                L: (permBits >>> 3) & 1,
                X: (permBits >>> 2) & 1,
                W: (permBits >>> 1) & 1,
                R: (permBits >>> 0) & 1,
            },
        };
    }

    function _decodeAbstractGTWord(raw32) {
        raw32 = raw32 >>> 0;
        var ab_type      = (raw32 >>> 27) & 0x1F;
        var ab_data      =  raw32 & 0xFFFF;
        var device_class = (ab_data >>> 8) & 0xFF;
        var device_data  =  ab_data & 0xFF;
        return { ab_type, device_class, device_data, ab_data };
    }

    // ── Build rows HTML from a flat array of raw GT words ────────────────────
    function _buildRowsFromWords(gtWords, petMap, nsLabels, nsTable, s) {
        var DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
        var html = '';
        for (var i = 0; i < gtWords.length; i++) {
            var rawWord = gtWords[i] >>> 0;
            var isNull  = rawWord === 0;

            if (isNull) {
                html += '<div class="clist-row clist-row--null" data-slot="' + i + '" tabindex="-1">' +
                    '<span class="clist-slot">CR' + i + '</span>' +
                    '<span class="clist-null-label">\u2014 null \u2014</span>' +
                    '</div>';
                continue;
            }

            var gt = _decodeGTWord(rawWord);
            var nsIdx   = gt.index || 0;
            var bFlag = 0, fFlag = 0;
            if (nsTable && nsTable[nsIdx]) {
                try {
                    var nsParsed = s && s.parseNSWord1 ? s.parseNSWord1(nsTable[nsIdx].word1_limit) : null;
                    if (nsParsed) { bFlag = nsParsed.b || 0; fFlag = nsParsed.f || 0; }
                } catch (e2) { /* ignore */ }
            }

            var petName = (petMap && petMap[i]) || (nsLabels && nsLabels[nsIdx]) || '';
            if (!petName && gt.type === 3) {
                try {
                    var ab = _decodeAbstractGTWord(rawWord);
                    petName = ab.ab_type === 0
                        ? (DC[ab.device_class] || ('dc' + ab.device_class)) + '[' + ab.device_data + ']'
                        : 'M-Elev 0x' + ab.ab_data.toString(16).toUpperCase();
                } catch (e2) { /* ignore */ }
            }

            var displayName = petName || ('0x' + (rawWord >>> 0).toString(16).toUpperCase().padStart(8, '0'));
            html += '<div class="clist-row" data-slot="' + i + '" tabindex="-1">' +
                '<span class="clist-slot">CR' + i + '</span>' +
                '<span class="clist-perms">' + permChipsHtml(gt.permissions) + '</span>' +
                '<span class="clist-b-badge' + (bFlag ? ' clist-b-badge--on' : '') + '" title="Bind bit">B</span>' +
                '<span class="clist-f-badge' + (fFlag ? ' clist-f-badge--on' : '') + '" title="Fault-on-use bit">F</span>' +
                '<span class="clist-name">' + escHtml(displayName) + '</span>' +
                '</div>';
        }
        return html;
    }

    function _wrapRows(titleExtra, rows) {
        return '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List' + (titleExtra ? ' \u2014 ' + titleExtra : ' (CR6)') + '</span>' +
            '<span class="clist-viewer-hint">\u2191\u2193 navigate \u00b7 Enter insert \u00b7 Esc close</span>' +
            '</div>' +
            '<div class="clist-viewer-body">' + rows + '</div>';
    }

    // ── Async builder: live-sim takes priority when booted; static-binary otherwise ──
    async function buildContentAsync() {
        /* global sim, _petNameCRMap */
        var s      = (typeof sim !== 'undefined') ? sim : null;
        var petMap = (typeof _petNameCRMap !== 'undefined') ? (_petNameCRMap || {}) : {};

        // ── Path 1: live sim (boot-complete) — preferred when simulator is running ─
        if (s && s.bootComplete) {
            var cr6 = s.cr && s.cr[6];
            if (cr6 && (cr6.word0 >>> 0) !== 0) {
                var clistBase  = cr6.word1 >>> 0;
                var clistCount = 0;
                try {
                    clistCount = s.parseNSWord1(cr6.word2).clistCount;
                } catch (e) { clistCount = 0; }

                if (clistCount > 0) {
                    var liveWords = [];
                    for (var j = 0; j < clistCount; j++) {
                        liveWords.push((s.memory && s.memory[clistBase + j] !== undefined)
                            ? (s.memory[clistBase + j] >>> 0)
                            : 0);
                    }
                    var liveRows = _buildRowsFromWords(liveWords, petMap,
                        s.nsLabels, s.nsTable, s);
                    return _wrapRows(null, liveRows);
                }
            }
        }

        // ── Path 2: decode from the last saved LUMP binary (no boot required) ─
        var savedToken = window._editorLastSavedToken || null;
        if (savedToken) {
            try {
                var resp = await fetch('/api/lump/' + savedToken + '/words');
                if (resp.ok) {
                    var data = await resp.json();
                    var words = data.words;
                    if (words && words.length > 0) {
                        var hdr      = words[0] >>> 0;
                        var cc       = hdr & 0xFF;
                        var nMinus6  = (hdr >>> 23) & 0xF;
                        var lumpSize = 1 << (nMinus6 + 6);

                        if (cc > 0 && lumpSize <= words.length && (lumpSize - cc) >= 0) {
                            var gtWords = words.slice(lumpSize - cc, lumpSize);
                            var rows = _buildRowsFromWords(gtWords, petMap,
                                s && s.nsLabels, s && s.nsTable, s);
                            return _wrapRows('saved binary', rows);
                        }
                        return emptyState('This LUMP has no C-List (cc = 0).');
                    }
                }
            } catch (e) { /* fall through */ }
        }

        // ── Path 3: nothing available ─────────────────────────────────────────
        if (!savedToken) {
            return emptyState('No LUMP saved yet — compile and save first.');
        }
        return emptyState('No C-List loaded — boot a program first.');
    }

    function emptyState(msg) {
        return '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List (CR6)</span>' +
            '</div>' +
            '<div class="clist-viewer-empty">' + escHtml(msg) + '</div>';
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Position popup below the toolbar button ───────────────────────────────
    function positionPopup() {
        var btn = document.querySelector('.btn-clist-viewer');
        var popup = getOrCreatePopup();
        if (!btn) {
            popup.style.left = '8px';
            popup.style.top = '80px';
            return;
        }
        var rect = btn.getBoundingClientRect();
        var popupW = 480;
        var left = rect.left;
        var top  = rect.bottom + 4;

        if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
        if (left < 4) left = 4;

        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function showViewer() {
        // Mutual exclusion: close the instruction picker if open
        if (window.AsmInstructionPicker && window.AsmInstructionPicker.hide) {
            window.AsmInstructionPicker.hide();
        }

        activeEditor = document.getElementById('asmEditor');
        focusedRow = -1;

        var popup = getOrCreatePopup();

        // Show a loading spinner immediately, then populate asynchronously
        popup.innerHTML = '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List</span>' +
            '</div>' +
            '<div class="clist-viewer-empty" style="opacity:0.6;">\u29BF Loading\u2026</div>';
        popup.style.display = 'flex';
        positionPopup();

        var btn = document.querySelector('.btn-clist-viewer');
        if (btn) btn.classList.add('btn-clist-viewer--active');

        buildContentAsync().then(function (html) {
            if (popup.style.display !== 'none') {
                popup.innerHTML = html;
                positionPopup();
            }
        }).catch(function () {
            if (popup.style.display !== 'none') {
                popup.innerHTML = emptyState('C-List unavailable.');
            }
        });
    }

    function hideViewer() {
        if (popupEl) popupEl.style.display = 'none';
        focusedRow = -1;
        var btn = document.querySelector('.btn-clist-viewer');
        if (btn) btn.classList.remove('btn-clist-viewer--active');
    }

    function toggleViewer() {
        if (isVisible()) hideViewer();
        else showViewer();
    }

    function isVisible() {
        return !!(popupEl && popupEl.style.display !== 'none');
    }

    // ── Keyboard shortcut (Ctrl+Shift+C / Cmd+Shift+C) ───────────────────────
    document.addEventListener('keydown', function (e) {
        var cfg = (window.CListViewerConfig) ? window.CListViewerConfig : DEFAULT_SHORTCUT;
        var wantCtrl  = (cfg.ctrl  !== undefined) ? cfg.ctrl  : DEFAULT_SHORTCUT.ctrl;
        var wantShift = (cfg.shift !== undefined) ? cfg.shift : DEFAULT_SHORTCUT.shift;
        var wantCode  = cfg.code || DEFAULT_SHORTCUT.code;
        var ctrlOrCmd = e.ctrlKey || e.metaKey;

        if (e.code === wantCode &&
            ctrlOrCmd === wantCtrl &&
            e.shiftKey === wantShift) {
            var ed = document.getElementById('asmEditor');
            if (!ed) return;
            e.preventDefault();
            toggleViewer();
        }
    });

    // Publish API first so the mutual-exclusion wrap below can reference it
    window.CListViewer = {
        show:      showViewer,
        hide:      hideViewer,
        toggle:    toggleViewer,
        isVisible: isVisible,
    };

    // ── Mutual exclusion: wrap AsmInstructionPicker.show synchronously ────────
    // clist-viewer.js loads after asm-instruction-picker.js in the same
    // <script> sequence, so window.AsmInstructionPicker is already defined here.
    // No polling timer is needed.
    if (window.AsmInstructionPicker && window.AsmInstructionPicker.show) {
        var _origPickerShow = window.AsmInstructionPicker.show;
        window.AsmInstructionPicker.show = function () {
            hideViewer();
            return _origPickerShow.apply(this, arguments);
        };
    }

}());
