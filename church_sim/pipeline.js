class PipelineVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.stages = [
            { id: 'load1',  label: 'LOAD',   desc: 'Namespace lookup (L permission)' },
            { id: 'tperm1', label: 'TPERM',  desc: 'Verify entry permission' },
            { id: 'call',   label: 'CALL',   desc: 'Enter scope, save context' },
            { id: 'load2',  label: 'LOAD',   desc: 'C-List slot lookup (L permission)' },
            { id: 'tperm2', label: 'TPERM',  desc: 'Verify execute permission (X)' },
            { id: 'lambda', label: 'LAMBDA', desc: 'Church reduction' },
            { id: 'return', label: 'RETURN', desc: 'Restore scope, return result' },
        ];
        this.currentStage = -1;
        this.animating = false;
        this.stageData = [];
    }

    render() {
        if (!this.container) return;

        let html = '<div class="pipeline-wrapper">';
        html += '<div class="pipeline-title">7-Step Security Pipeline</div>';
        html += '<div class="pipeline-subtitle">Every operation passes through all 7 gates</div>';
        html += '<div class="pipeline-stages">';

        for (let i = 0; i < this.stages.length; i++) {
            const s = this.stages[i];
            const stateClass = i < this.currentStage ? 'stage-done' :
                              i === this.currentStage ? 'stage-active' : 'stage-pending';
            const data = this.stageData[i] || {};

            html += `<div class="pipeline-stage ${stateClass}" id="pipe-stage-${i}">`;
            html += `<div class="stage-number">${i + 1}</div>`;
            html += `<div class="stage-label">${s.label}</div>`;
            html += `<div class="stage-desc">${data.desc || s.desc}</div>`;
            if (data.gt) {
                html += `<div class="stage-gt">GT: 0x${data.gt}</div>`;
            }
            if (data.perm) {
                html += `<div class="stage-perm ${data.status || ''}">${data.perm} ${data.status === 'pass' ? '\u2713' : data.status === 'fail' ? '\u2717' : ''}</div>`;
            }
            html += '</div>';

            if (i < this.stages.length - 1) {
                html += `<div class="pipeline-arrow ${i < this.currentStage ? 'arrow-done' : ''}">→</div>`;
            }
        }

        html += '</div>';

        html += '<div class="pipeline-info">';
        if (this.currentStage >= 0 && this.currentStage < this.stages.length) {
            const s = this.stages[this.currentStage];
            const data = this.stageData[this.currentStage] || {};
            html += `<div class="pipeline-current">Stage ${this.currentStage + 1}: ${s.label}</div>`;
            html += `<div class="pipeline-detail">${data.desc || s.desc}</div>`;
        } else if (this.currentStage >= this.stages.length) {
            html += '<div class="pipeline-current pipeline-complete">Pipeline Complete</div>';
            html += '<div class="pipeline-detail">All 7 security gates passed successfully</div>';
        } else {
            html += '<div class="pipeline-current">Ready</div>';
            html += '<div class="pipeline-detail">Step through code to see the security pipeline in action</div>';
        }
        html += '</div>';
        html += '</div>';

        this.container.innerHTML = html;
    }

    reset() {
        this.currentStage = -1;
        this.stageData = [];
        this.animating = false;
        this.render();
    }

    showFullPipeline(stageDataArray) {
        this.stageData = stageDataArray || [];
        this.currentStage = this.stages.length;
        this.render();
    }

    async animate(stageDataArray, delayMs) {
        delayMs = delayMs || 400;
        this.stageData = stageDataArray || [];
        this.animating = true;

        for (let i = 0; i < this.stages.length; i++) {
            if (!this.animating) break;
            this.currentStage = i;
            this.render();
            await new Promise(r => setTimeout(r, delayMs));
        }

        if (this.animating) {
            this.currentStage = this.stages.length;
            this.render();
        }
        this.animating = false;
    }

    stopAnimation() {
        this.animating = false;
    }

    setStage(idx, data) {
        this.currentStage = idx;
        if (data) this.stageData[idx] = data;
        this.render();
    }

    buildSecurityTrace(operation, details) {
        const trace = [];
        const opUpper = (operation || '').toUpperCase();

        switch (opUpper) {
            case 'CALL':
                trace.push({ desc: `LOAD: Namespace lookup via CR${details.crSrc || 6}`, perm: 'L', status: 'pass', gt: details.gt || '' });
                trace.push({ desc: `TPERM: Verify E permission on target`, perm: 'E', status: 'pass' });
                trace.push({ desc: `CALL: Enter ${details.target || 'abstraction'}, save context` });
                trace.push({ desc: `LOAD: C-List slot [1] = Access Code`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify X on Access Code`, perm: 'X', status: 'pass' });
                trace.push({ desc: `LAMBDA: Church reduction → ${details.result || 'compute'}` });
                trace.push({ desc: `RETURN: Restore scope, result in DR0` });
                break;
            case 'LAMBDA':
                trace.push({ desc: `LOAD: Read CR${details.crDst || 0} capability`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify E permission`, perm: 'E', status: 'pass' });
                trace.push({ desc: `CALL: Fast-path lambda entry` });
                trace.push({ desc: `LOAD: C-List access code`, perm: 'L', status: 'pass' });
                trace.push({ desc: `TPERM: Verify execution`, perm: 'X', status: 'pass' });
                trace.push({ desc: `LAMBDA: ${details.desc || 'Church reduction'}` });
                trace.push({ desc: `RETURN: Result → DR0 = ${details.result || '?'}` });
                break;
            default:
                trace.push({ desc: `${opUpper}: ${details.desc || 'execute'}` });
                break;
        }
        return trace;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PipelineVisualizer;
}
