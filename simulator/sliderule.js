const slideruleState = {
    slideOffset: 0,
    cursorX: 0,
    draggingSlide: false,
    draggingCursor: false,
    dragStartX: 0,
    dragStartOffset: 0,
    dragStartCursor: 0,
    result: 1,
    trace: [],
    maxTrace: 50,
    rendered: false,
    scaleWidth: 600,
    scaleStart: 40,
    lastReadD: 1,
    lastReadC: 1
};

function slideruleTraceLog(lambdaExpr, desc) {
    slideruleState.trace.unshift({ lambda: lambdaExpr, desc: desc, time: Date.now() });
    if (slideruleState.trace.length > slideruleState.maxTrace) slideruleState.trace.pop();
}

function slideruleLog10(val) {
    return Math.log10(val);
}

function slideruleValToX(val, offset) {
    offset = offset || 0;
    return slideruleState.scaleStart + slideruleLog10(val) * slideruleState.scaleWidth + offset;
}

function slideruleXToVal(x, offset) {
    offset = offset || 0;
    const logVal = (x - slideruleState.scaleStart - offset) / slideruleState.scaleWidth;
    return Math.pow(10, logVal);
}

function slideruleClampVal(v) {
    v = Math.max(1, Math.min(10, v));
    return Math.round(v * 1000) / 1000;
}

function slideruleReadAtCursor() {
    const cx = slideruleState.cursorX;
    const dVal = slideruleClampVal(slideruleXToVal(cx, 0));
    const cVal = slideruleClampVal(slideruleXToVal(cx, -slideruleState.slideOffset));
    slideruleState.lastReadD = dVal;
    slideruleState.lastReadC = cVal;
    return { d: dVal, c: cVal };
}

function slideruleGetScaleFactor() {
    const svgEl = document.querySelector('.sliderule-svg');
    if (!svgEl) return 1;
    const rect = svgEl.getBoundingClientRect();
    const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;
    return totalW / rect.width;
}

function slideruleStartDragSlide(e) {
    e.preventDefault();
    slideruleState.draggingSlide = true;
    slideruleState.dragStartX = e.clientX || e.touches[0].clientX;
    slideruleState.dragStartOffset = slideruleState.slideOffset;
    document.addEventListener('mousemove', slideruleDragMove);
    document.addEventListener('mouseup', slideruleDragEnd);
    document.addEventListener('touchmove', slideruleDragMove, { passive: false });
    document.addEventListener('touchend', slideruleDragEnd);
}

function slideruleStartDragCursor(e) {
    e.preventDefault();
    e.stopPropagation();
    slideruleState.draggingCursor = true;
    slideruleState.dragStartX = e.clientX || e.touches[0].clientX;
    slideruleState.dragStartCursor = slideruleState.cursorX;
    document.addEventListener('mousemove', slideruleDragMove);
    document.addEventListener('mouseup', slideruleDragEnd);
    document.addEventListener('touchmove', slideruleDragMove, { passive: false });
    document.addEventListener('touchend', slideruleDragEnd);
}

function slideruleDragMove(e) {
    e.preventDefault();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    if (clientX === undefined) return;

    const scale = slideruleGetScaleFactor();
    const dx = (clientX - slideruleState.dragStartX) * scale;

    if (slideruleState.draggingSlide) {
        slideruleState.slideOffset = slideruleState.dragStartOffset + dx;
        slideruleState.slideOffset = Math.max(-slideruleState.scaleWidth, Math.min(slideruleState.scaleWidth, slideruleState.slideOffset));
        slideruleUpdateDisplay();
    } else if (slideruleState.draggingCursor) {
        slideruleState.cursorX = slideruleState.dragStartCursor + dx;
        slideruleState.cursorX = Math.max(slideruleState.scaleStart, Math.min(slideruleState.scaleStart + slideruleState.scaleWidth, slideruleState.cursorX));
        slideruleUpdateDisplay();
    }
}

function slideruleDragEnd() {
    if (slideruleState.draggingSlide) {
        const vals = slideruleReadAtCursor();
        slideruleTraceLog(
            `CALL SlideRule.Mul(${vals.d}, ${vals.c})`,
            `Slide positioned: D=${vals.d}, C=${vals.c}`
        );
    }
    if (slideruleState.draggingCursor) {
        const vals = slideruleReadAtCursor();
        slideruleTraceLog(
            `CALL SlideRule.Read(cursor)`,
            `Cursor reads: D=${vals.d}, C=${vals.c}`
        );
    }
    slideruleState.draggingSlide = false;
    slideruleState.draggingCursor = false;
    document.removeEventListener('mousemove', slideruleDragMove);
    document.removeEventListener('mouseup', slideruleDragEnd);
    document.removeEventListener('touchmove', slideruleDragMove);
    document.removeEventListener('touchend', slideruleDragEnd);
}

function sliderulePresetMultiply(a, b) {
    const aClamp = Math.max(1, Math.min(10, a));
    const bClamp = Math.max(1, Math.min(10, b));
    slideruleState.slideOffset = slideruleLog10(aClamp) * slideruleState.scaleWidth;
    slideruleState.cursorX = slideruleValToX(bClamp, slideruleState.slideOffset);
    slideruleState.cursorX = Math.max(slideruleState.scaleStart, Math.min(slideruleState.scaleStart + slideruleState.scaleWidth, slideruleState.cursorX));
    const result = aClamp * bClamp;
    slideruleTraceLog(
        `CALL SlideRule.Mul(${aClamp}, ${bClamp}) \u2192 ${Math.round(result * 1000) / 1000}`,
        `Multiply: set C-scale 1 at D=${aClamp}, read D at C=${bClamp}`
    );
    slideruleUpdateDisplay();
}

function sliderulePresetSqrt(val) {
    const v = Math.max(1, Math.min(100, val));
    const sqr = Math.sqrt(v);
    slideruleState.slideOffset = 0;
    slideruleState.cursorX = slideruleValToX(sqr, 0);
    slideruleTraceLog(
        `CALL SlideRule.Sqrt(${v}) \u2192 ${Math.round(sqr * 1000) / 1000}`,
        `Square root: \u221a${v} \u2248 ${Math.round(sqr * 1000) / 1000}`
    );
    slideruleUpdateDisplay();
}

function slideruleReset() {
    slideruleState.slideOffset = 0;
    slideruleState.cursorX = slideruleState.scaleStart + slideruleState.scaleWidth / 2;
    slideruleTraceLog('CALL SlideRule.Reset()', 'Slide and cursor reset to home position');
    slideruleUpdateDisplay();
}

function slideruleUpdateDisplay() {
    slideruleRenderDisplay();
}

function slideruleGenerateScaleTicks(offset) {
    let ticks = '';
    const majorVals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const v of majorVals) {
        const x = slideruleValToX(v, offset);
        ticks += `<line x1="${x}" y1="0" x2="${x}" y2="18" stroke="#ccc" stroke-width="1.5"/>`;
        const label = v === 10 ? '1' : v.toString();
        ticks += `<text x="${x}" y="28" text-anchor="middle" fill="#ddd" font-size="9" font-family="monospace">${label}</text>`;
    }

    const minorSets = [
        [1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9],
        [2.2,2.4,2.6,2.8],
        [3.5],
        [4.5],
        [5.5],
        [6.5],
        [7.5],
        [8.5],
        [9.5]
    ];
    for (const set of minorSets) {
        for (const v of set) {
            const x = slideruleValToX(v, offset);
            ticks += `<line x1="${x}" y1="0" x2="${x}" y2="10" stroke="#888" stroke-width="0.5"/>`;
        }
    }

    return ticks;
}

function slideruleGenerateArrows(cx) {
    const so = slideruleState.slideOffset;
    if (Math.abs(so) < 2) return '';

    const arrowColor = '#ff3333';
    const defs = `
        <defs>
            <marker id="arrowRight" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M0,0 L10,3 L0,6 Z" fill="${arrowColor}"/>
            </marker>
            <marker id="arrowLeft" viewBox="0 0 10 6" refX="0" refY="3" markerWidth="8" markerHeight="6" orient="auto">
                <path d="M10,0 L0,3 L10,6 Z" fill="${arrowColor}"/>
            </marker>
        </defs>`;

    let arrows = defs;
    const ss = slideruleState.scaleStart;

    const cOneX = ss + so;
    const arrowY1 = 120;
    const arrowY2 = 132;
    const arrowY3 = 144;

    if (so > 0 && cOneX > ss) {
        arrows += `<line x1="${ss}" y1="${arrowY1}" x2="${cOneX}" y2="${arrowY1}" stroke="${arrowColor}" stroke-width="2" marker-end="url(#arrowRight)" opacity="0.85"/>`;
        const midA = (ss + cOneX) / 2;
        arrows += `<text x="${midA}" y="${arrowY1 - 4}" text-anchor="middle" fill="${arrowColor}" font-size="8" font-family="monospace" opacity="0.9">log(a)</text>`;
    }

    if (cx > cOneX + 2) {
        arrows += `<line x1="${cOneX}" y1="${arrowY2}" x2="${cx}" y2="${arrowY2}" stroke="${arrowColor}" stroke-width="2" marker-end="url(#arrowRight)" opacity="0.65"/>`;
        const midB = (cOneX + cx) / 2;
        arrows += `<text x="${midB}" y="${arrowY2 - 4}" text-anchor="middle" fill="${arrowColor}" font-size="8" font-family="monospace" opacity="0.7">log(b)</text>`;
    } else if (cx < cOneX - 2) {
        arrows += `<line x1="${cOneX}" y1="${arrowY2}" x2="${cx}" y2="${arrowY2}" stroke="${arrowColor}" stroke-width="2" marker-end="url(#arrowLeft)" opacity="0.65"/>`;
        const midB = (cOneX + cx) / 2;
        arrows += `<text x="${midB}" y="${arrowY2 - 4}" text-anchor="middle" fill="${arrowColor}" font-size="8" font-family="monospace" opacity="0.7">log(b)</text>`;
    }

    if (cx > ss + 2) {
        arrows += `<line x1="${ss}" y1="${arrowY3}" x2="${cx}" y2="${arrowY3}" stroke="${arrowColor}" stroke-width="2.5" marker-end="url(#arrowRight)" opacity="0.95"/>`;
        const midR = (ss + cx) / 2;
        const vals = slideruleReadAtCursor();
        const product = Math.round(vals.d * vals.c * 1000) / 1000;
        arrows += `<text x="${midR}" y="${arrowY3 - 4}" text-anchor="middle" fill="${arrowColor}" font-size="9" font-weight="bold" font-family="monospace">log(${product}) = log(a) + log(b)</text>`;
    }

    return arrows;
}

function slideruleRenderDisplay() {
    const container = document.getElementById('slideruleContainer');
    if (!container) return;

    const vals = slideruleReadAtCursor();

    const readout = container.querySelector('.sliderule-readout-value');
    if (readout) readout.textContent = `D: ${vals.d}  \u00b7  C: ${vals.c}  \u00b7  D\u00d7C \u2248 ${Math.round(vals.d * vals.c * 1000) / 1000}`;

    const svgEl = container.querySelector('.sliderule-svg');
    if (svgEl) {
        const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;
        const dTicks = slideruleGenerateScaleTicks(0);
        const cTicks = slideruleGenerateScaleTicks(slideruleState.slideOffset);
        const cx = slideruleState.cursorX;
        const arrowsSVG = slideruleGenerateArrows(cx);
        const svgHeight = Math.abs(slideruleState.slideOffset) > 2 ? 155 : 110;

        svgEl.setAttribute('viewBox', `0 0 ${totalW} ${svgHeight}`);

        svgEl.innerHTML = `
            <rect x="0" y="0" width="${totalW}" height="110" rx="4" fill="#2a1a0a" stroke="#8B7355" stroke-width="2"/>
            <rect x="${slideruleState.scaleStart - 4}" y="2" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a1a1a" rx="2"/>
            <text x="14" y="20" fill="#cc9933" font-size="10" font-weight="bold" font-family="monospace">D</text>
            <g transform="translate(0, 4)">${dTicks}</g>

            <rect x="${slideruleState.scaleStart - 4 + slideruleState.slideOffset}" y="38" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a2a1a" rx="2" class="sliderule-slide-rect" style="cursor:grab;"/>
            <text x="${slideruleState.scaleStart - 16 + slideruleState.slideOffset}" y="58" fill="#33cc66" font-size="10" font-weight="bold" font-family="monospace">C</text>
            <g transform="translate(0, 42)">${cTicks}</g>

            <rect x="${slideruleState.scaleStart - 4}" y="74" width="${slideruleState.scaleWidth + 8}" height="32" fill="#1a1a1a" rx="2"/>
            <text x="14" y="94" fill="#cc9933" font-size="10" font-weight="bold" font-family="monospace">D</text>
            <g transform="translate(0, 78)">${dTicks}</g>

            <line x1="${cx}" y1="0" x2="${cx}" y2="110" stroke="rgba(255,50,50,0.8)" stroke-width="1.5" stroke-dasharray="3,2"/>
            <rect x="${cx - 10}" y="0" width="20" height="110" fill="rgba(255,50,50,0.08)" class="sliderule-cursor-zone" style="cursor:crosshair;"/>
            <circle cx="${cx}" cy="3" r="4" fill="#ff3333" class="sliderule-cursor-handle" style="cursor:crosshair;"/>

            ${arrowsSVG}
        `;

        const slideRect = svgEl.querySelector('.sliderule-slide-rect');
        if (slideRect) {
            slideRect.addEventListener('mousedown', slideruleStartDragSlide);
            slideRect.addEventListener('touchstart', slideruleStartDragSlide, { passive: false });
        }

        const cursorZone = svgEl.querySelector('.sliderule-cursor-zone');
        const cursorHandle = svgEl.querySelector('.sliderule-cursor-handle');
        if (cursorZone) {
            cursorZone.addEventListener('mousedown', slideruleStartDragCursor);
            cursorZone.addEventListener('touchstart', slideruleStartDragCursor, { passive: false });
        }
        if (cursorHandle) {
            cursorHandle.addEventListener('mousedown', slideruleStartDragCursor);
            cursorHandle.addEventListener('touchstart', slideruleStartDragCursor, { passive: false });
        }
    }

    const traceArea = container.querySelector('.sliderule-trace-area');
    if (traceArea) {
        traceArea.innerHTML = slideruleState.trace.map((t, i) =>
            `<div class="sliderule-trace-entry${i === 0 ? ' sliderule-trace-latest' : ''}">
                <div class="sliderule-trace-lambda">${t.lambda}</div>
                <div class="sliderule-trace-desc">${t.desc}</div>
            </div>`
        ).join('');
    }
}

function renderSlideRuleCalculator() {
    const container = document.getElementById('slideruleContainer');
    if (!container) return;

    slideruleState.cursorX = slideruleState.scaleStart + slideruleState.scaleWidth / 2;
    const totalW = slideruleState.scaleStart * 2 + slideruleState.scaleWidth;

    container.innerHTML = `
    <div class="sliderule-calc-wrapper">
        <div class="sliderule-body">
            <div class="sliderule-title">
                <span class="sliderule-title-label">SLIDE RULE</span>
                <span class="sliderule-title-ns">NS[16] \u00b7 SlideRule</span>
            </div>
            <div class="sliderule-readout">
                <span class="sliderule-readout-value">D: 1  \u00b7  C: 1  \u00b7  D\u00d7C \u2248 1</span>
            </div>
            <svg class="sliderule-svg" width="${totalW}" height="110" viewBox="0 0 ${totalW} 110" preserveAspectRatio="xMidYMid meet"></svg>
            <div class="sliderule-instructions">Drag <span style="color:#33cc66;">green C-scale</span> to slide \u00b7 Drag <span style="color:#ff3333;">red cursor</span> to read</div>
            <div class="sliderule-presets">
                <span class="sliderule-preset-label">Try:</span>
                <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(2, 3)">2 \u00d7 3</button>
                <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(1.5, 4)">1.5 \u00d7 4</button>
                <button class="sliderule-preset-btn" onclick="sliderulePresetMultiply(3.14, 2)">\u03c0 \u00d7 2</button>
                <button class="sliderule-preset-btn" onclick="sliderulePresetSqrt(2)">\u221a2</button>
                <button class="sliderule-preset-btn" onclick="sliderulePresetSqrt(9)">\u221a9</button>
                <button class="sliderule-preset-btn" onclick="slideruleReset()">Reset</button>
            </div>
        </div>

        <div class="sliderule-info-panel">
            <div class="sliderule-stack-header">How It Works</div>
            <div class="sliderule-info-text">
                The slide rule multiplies by <em>adding logarithms</em> physically.
                Sliding the C-scale by log(a) and reading at C=b gives D = a\u00d7b.
                The <span style="color:#ff3333;">red arrows</span> show the two lengths being added:
                log(a) + log(b) = log(a\u00d7b). This is the same principle behind
                CALL SlideRule.Mul \u2014 the Church Machine's floating-point abstraction at NS[16].
            </div>
        </div>

        <div class="sliderule-trace-inline">
            <div class="sliderule-trace-header">Church Machine Trace</div>
            <div class="sliderule-trace-area"></div>
        </div>
    </div>`;

    slideruleState.rendered = true;
    slideruleUpdateDisplay();
}
