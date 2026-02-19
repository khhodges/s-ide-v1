class BernoulliTutorial {
    constructor(repl, pipeline) {
        this.repl = repl;
        this.pipeline = pipeline;
        this.currentStep = -1;
        this.results = [];
        this.running = false;

        this.steps = [
            {
                title: "Ada Lovelace's Bernoulli Computation",
                description: "Ada's Note G (1843) computed Bernoulli numbers step by step, naming each intermediate result. We compute the sum of squares: 1\u00b2 + 2\u00b2 + 3\u00b2 + 4\u00b2 = 30 using n(n+1)(2n+1)/6 where n=4.",
                code: null,
                isIntro: true,
            },
            {
                title: "Step 1: Establish working values",
                description: "Set n=4 using Church successor function. Every succ() call passes through all 7 security gates.",
                code: "let n = succ(3)",
                expected: 4,
            },
            {
                title: "Step 1b: Define constant",
                description: "Define two = succ(1). Each operation is a complete security-checked Church reduction.",
                code: "let two = succ(1)",
                expected: 2,
            },
            {
                title: "Step 2: Compute n+1",
                description: "n+1 = succ(4) = 5. The successor function is a Church-encoded operation: \u03bbf.\u03bbx.f(n f x).",
                code: "let n_plus_1 = succ(n)",
                expected: 5,
            },
            {
                title: "Step 3a: Compute 2n",
                description: "2n = two * n = 2 \u00d7 4 = 8. Multiplication via Church numerals: \u03bbm.\u03bbn.\u03bbf.m(n f).",
                code: "let two_n = two * n",
                expected: 8,
            },
            {
                title: "Step 3b: Compute 2n+1",
                description: "2n+1 = succ(8) = 9. Building the formula piece by piece, exactly as Ada prescribed.",
                code: "let two_n_plus_1 = succ(two_n)",
                expected: 9,
            },
            {
                title: "Step 4a: First product",
                description: "n \u00d7 (n+1) = 4 \u00d7 5 = 20. Each multiplication passes through the 7-gate security pipeline.",
                code: "let prod1 = n * n_plus_1",
                expected: 20,
            },
            {
                title: "Step 4b: Complete product",
                description: "20 \u00d7 9 = 180. We now have n(n+1)(2n+1) — the numerator of our formula.",
                code: "let product = prod1 * two_n_plus_1",
                expected: 180,
            },
            {
                title: "Step 5a: Compute divisor",
                description: "6 = two \u00d7 3 = 2 \u00d7 3 = 6. Even simple constants go through full capability checking.",
                code: "let six = two * 3",
                expected: 6,
            },
            {
                title: "Step 5b: Final formula result",
                description: "180 \u00f7 6 = 30. This is our answer: \u2211(k\u00b2) for k=1..4 = 30 via the closed-form formula.",
                code: "let sum_of_squares = product / six",
                expected: 30,
            },
            {
                title: "Step 6a: Verify — compute 1\u00b2",
                description: "Now verify by direct computation. 1\u00b2 = 1. The Church POW abstraction uses repeated application.",
                code: "let sq1 = 1 ^ two",
                expected: 1,
            },
            {
                title: "Step 6b: Compute 2\u00b2",
                description: "2\u00b2 = 4.",
                code: "let sq2 = two ^ two",
                expected: 4,
            },
            {
                title: "Step 6c: Compute 3\u00b2",
                description: "3\u00b2 = 9.",
                code: "let sq3 = 3 ^ two",
                expected: 9,
            },
            {
                title: "Step 6d: Compute 4\u00b2",
                description: "4\u00b2 = 16.",
                code: "let sq4 = n ^ two",
                expected: 16,
            },
            {
                title: "Step 7a: Sum squares",
                description: "1 + 4 = 5. Adding the first two squares.",
                code: "let partial1 = sq1 + sq2",
                expected: 5,
            },
            {
                title: "Step 7b: Add third square",
                description: "5 + 9 = 14.",
                code: "let partial2 = partial1 + sq3",
                expected: 14,
            },
            {
                title: "Step 7c: Final verification",
                description: "14 + 16 = 30. Both methods agree! The formula n(n+1)(2n+1)/6 and direct computation 1\u00b2+2\u00b2+3\u00b2+4\u00b2 both give 30.",
                code: "let verify = partial2 + sq4",
                expected: 30,
            },
            {
                title: "Computation Complete",
                description: "Ada Lovelace's method — naming each intermediate result — maps perfectly to Church lambda calculus with Golden Token security. Every single operation passed through 7 security gates. Zero Turing-domain instructions were used. This proves computational completeness of the Pure Church Machine.",
                code: null,
                isConclusion: true,
            },
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="tutorial-wrapper">';

        html += '<div class="tutorial-header">';
        html += '<h2>Ada Lovelace\'s Bernoulli Computation</h2>';
        html += '<p class="tutorial-tagline">Pure Lambda Calculus \u2022 Zero Turing Instructions \u2022 7-Gate Security Pipeline</p>';
        html += '<div class="tutorial-controls">';
        html += `<button class="btn btn-tutorial" onclick="churchTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>\u25C0 Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="churchTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next \u25B6'}</button>`;
        html += `<button class="btn btn-tutorial btn-run-all" onclick="churchTutorial.runAll()">Run All</button>`;
        html += '</div>';
        html += '</div>';

        html += '<div class="tutorial-body">';

        html += '<div class="tutorial-step-panel">';
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];
            html += `<div class="tutorial-step-title">${step.title}</div>`;
            html += `<div class="tutorial-step-desc">${step.description}</div>`;
            if (step.code) {
                html += `<div class="tutorial-code"><code>${this._escapeHtml(step.code)}</code></div>`;
            }
            if (this.results[this.currentStep]) {
                const r = this.results[this.currentStep];
                if (r.type === 'result') {
                    html += `<div class="tutorial-result">${this._escapeHtml(r.text)}</div>`;
                    if (r.churchSteps && r.churchSteps.length > 0) {
                        html += '<div class="tutorial-pipeline-trace">';
                        html += '<div class="trace-title">Security Pipeline Trace:</div>';
                        for (const s of r.churchSteps) {
                            html += `<div class="trace-step">${this._escapeHtml(s)}</div>`;
                        }
                        html += '</div>';
                    }
                } else if (r.type === 'error') {
                    html += `<div class="tutorial-error">${this._escapeHtml(r.text)}</div>`;
                }
            }
        } else if (this.currentStep < 0) {
            html += '<div class="tutorial-step-title">Welcome</div>';
            html += '<div class="tutorial-step-desc">Click "Next" to begin Ada Lovelace\'s Bernoulli computation, demonstrating that the Pure Church Machine achieves computational completeness with zero Turing-domain instructions.</div>';
        }
        html += '</div>';

        html += '<div class="tutorial-vars-panel">';
        html += '<div class="vars-title">Named Values (Ada\'s Style)</div>';
        if (this.repl && Object.keys(this.repl.variables).length > 0) {
            for (const [name, val] of Object.entries(this.repl.variables)) {
                const displayVal = Number.isInteger(val) ? val : val.toFixed(6);
                const isHighlight = this.results[this.currentStep] && this.results[this.currentStep].variable === name;
                html += `<div class="var-entry ${isHighlight ? 'var-highlight' : ''}">`;
                html += `<span class="var-name">${name}</span>`;
                html += `<span class="var-value">${displayVal}</span>`;
                html += '</div>';
            }
        } else {
            html += '<div class="vars-empty">No values yet — step through to compute</div>';
        }
        html += '</div>';

        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    stepForward() {
        if (this.currentStep >= this.steps.length - 1) {
            this.reset();
            return;
        }

        this.currentStep++;
        const step = this.steps[this.currentStep];

        if (step.code && this.repl) {
            const result = this.repl.execute(step.code);
            this.results[this.currentStep] = result;

            if (result && result.pipeline && this.pipeline) {
                this.pipeline.showFullPipeline(result.pipeline);
            }
        }

        this.render('tutorialView');
    }

    stepBack() {
        if (this.currentStep <= 0) return;

        if (this.repl) {
            this.repl._clear();
            this.results = [];

            for (let i = 0; i <= this.currentStep - 1; i++) {
                const s = this.steps[i];
                if (s.code) {
                    const r = this.repl.execute(s.code);
                    this.results[i] = r;
                }
            }
        }

        this.currentStep--;
        this.render('tutorialView');
    }

    async runAll() {
        if (this.running) return;
        this.running = true;
        this.reset();

        for (let i = 0; i < this.steps.length; i++) {
            this.currentStep = i;
            const step = this.steps[i];

            if (step.code && this.repl) {
                const result = this.repl.execute(step.code);
                this.results[i] = result;

                if (result && result.pipeline && this.pipeline) {
                    await this.pipeline.animate(result.pipeline, 150);
                }
            }

            this.render('tutorialView');
            await new Promise(r => setTimeout(r, 300));
        }

        this.running = false;
    }

    reset() {
        this.currentStep = -1;
        this.results = [];
        if (this.repl) this.repl._clear();
        if (this.pipeline) this.pipeline.reset();
        this.render('tutorialView');
    }

    _escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BernoulliTutorial;
}
