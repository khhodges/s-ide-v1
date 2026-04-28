# Ada Lovelace's Note G — Plain-Text Transcription

## Introduction

Ada Lovelace (1815–1852) translated Luigi Menabrea's French memoir on Charles Babbage's proposed Analytical Engine into English, adding a set of her own annotations that ran to nearly three times the length of the original text. The seventh and longest of these annotations — Note G — was published in Taylor's *Scientific Memoirs*, Vol. III, in August 1843. It contains a complete 25-operation program for computing Bernoulli numbers on the Analytical Engine, widely regarded as the first published computer algorithm.

The Analytical Engine was a general-purpose mechanical computer that Babbage designed but never completed. It operated on variable columns (gear stacks labelled V1–V24) and performed one arithmetic operation at a time — addition, subtraction, multiplication, or division — storing each result in one or more columns. Lovelace's Note G program computes B₇, the seventh Bernoulli number in the convention she used (corresponding to B₈ = −1/30 in modern notation), by summing a series of weighted terms through a loop that runs n−2 times. The algorithm requires no division-free shortcut: it derives every Bernoulli coefficient from those already computed, using only the four basic arithmetic operations.

---

## The 25-Operation Table

The table below transcribes all 25 operations from Ada Lovelace's published diagram. Column headings follow her original layout. "Nature" uses her symbols: × (multiply), + (add), − (subtract), ÷ (divide). "Variables acted upon" and "Variables receiving results" use her V-numbered column notation. "Statement of results" gives the algebraic meaning of each step. "Values (n=4)" shows the numeric result when computing B₇, the example she worked through.

**Note on the values column:** Operation 4 is shown with both the published value (9÷7, from the swapped operands Ada printed) and the corrected value (7÷9, per Bromley 1990). All values for Operations 5 onward use the corrected operand order, since tracing the published error forward produces a meaningless result. Where the table uses a normalised notation such as "V21 (B₁)" it is paraphrasing Ada's column references for readability; a note explains any such abstraction.

Ada used superscript prefixes to track how many times a variable column had been written (e.g., ²V₄ means V4 has been assigned twice). That notation is reproduced in the Variables columns where it clarifies which value of a column is being used.

| Op | Nature | Variables acted upon | Variables receiving results | Statement of results | Values (n=4) |
|----|--------|---------------------|-----------------------------|----------------------|--------------|
| 1  | ×      | V2, V3              | V4, V5, V6                 | 2n — result copied to three columns simultaneously | V4=V5=V6=8 |
| 2  | −      | ¹V4, V1             | ²V4                         | 2n − 1               | V4 = 7 |
| 3  | +      | ¹V5, V1             | ²V5                         | 2n + 1               | V5 = 9 |
| 4  | ÷      | ²V5, ²V4            | ¹V11                        | (2n+1) ÷ (2n−1) **[BUG — see annotation below]** | published: 9÷7; corrected: 7÷9 |
| 5  | ÷      | ¹V11, V2            | ²V11                        | A₀ coefficient ÷ 2   | 7/18 |
| 6  | −      | V13, ²V11           | ¹V13                        | 0 − (A₀/2) = −(2n−1)/(2(2n+1)) | −7/18 |
| 7  | −      | V3, V1              | ¹V10                        | n − 1 (loop counter) | V10 = 3 |
| 8  | +      | V2, V7              | ¹V7                         | Set denominator counter = 2 | V7 = 2 |
| 9  | ÷      | ²V6, ¹V7            | ³V11                        | 2n ÷ 2 = first A₁ factor | V11 = 4 |
| 10 | ×      | V21, ³V11           | ¹V12                        | B₁ × A₁ — V21 holds the previously computed B₁ = 1/6 | V12 = 2/3 |
| 11 | +      | ¹V12, ¹V13          | ²V13                        | Running sum += B₁ × A₁ | V13 = 5/18 |
| 12 | −      | ¹V10, V1            | ²V10                        | Decrement loop counter | V10 = 2 |
| 13 | −      | ³V6, V1             | ⁴V6                         | Decrement working variable | V6 = 7 (1st pass) |
| 14 | +      | V1, ¹V7             | ²V7                         | Increment denominator  | V7 = 3 |
| 15 | ÷      | ⁴V6, ²V7            | ¹V8                         | First ratio for coefficient Aₖ | V8 = 7/3 |
| 16 | ×      | ¹V8, ³V11           | ⁴V11                        | Update running coefficient | V11 = 28/3 |
| 17 | −      | ⁴V6, V1             | ⁵V6                         | Decrement again        | V6 = 6 |
| 18 | +      | V1, ²V7             | ³V7                         | Increment denominator again | V7 = 4 |
| 19 | ÷      | ⁵V6, ³V7            | ¹V9                         | Second ratio for coefficient Aₖ | V9 = 3/2 |
| 20 | ×      | ¹V9, ⁴V11           | ⁵V11                        | Aₖ coefficient complete | V11 = 14 |
| 21 | ×      | V22/V23, ⁵V11       | ²V12                        | Bₖ × Aₖ — V22 holds B₃, V23 holds B₅ (Ada stored previously computed Bernoulli numbers in V21–V23; the correct column advances each loop pass) | (uses stored Bₖ) |
| 22 | +      | ²V12, ²V13          | ³V13                        | Running sum += Bₖ × Aₖ | (accumulates) |
| 23 | —      | ²V10, V1            | ³V10                        | Decrement loop counter; if V10 ≠ 0, back to Op 13 | repeats (n−2) times |
| 24 | −      | V24, ³V13           | ²V24                        | B₇ = 0 − accumulated sum | V24 = −1/30 |
| 25 | +      | V1, V3              | ²V3                         | Advance n for next Bernoulli number | V3 = 5 |

**Structural blocks:**

| Block | Operations | Purpose | Executes |
|-------|-----------|---------|----------|
| Setup | 1–7 | Compute A₀, set loop counter | Once |
| First term | 8–12 | Compute B₁ × A₁, accumulate | Once |
| Inner loop | 13–23 | Compute Bₖ × Aₖ for k=2…n−1, accumulate | n−2 times |
| Finalize | 24–25 | Negate sum to get result, advance n | Once |

---

### Operation 4 — Transcribed Exactly as Published

> **Op 4: ÷ — Variables acted upon: ²V5, ²V4 — Result: ¹V11**
> Statement: (2n+1) ÷ (2n−1)

> [!CAUTION]
> **Bug — Operands swapped.** Ada's published table shows the dividend as ²V5 (which holds 2n+1 = 9) and the divisor as ²V4 (which holds 2n−1 = 7), producing 9÷7. The correct computation needed by the algorithm is (2n−1)÷(2n+1) = 7÷9, i.e., the operand order must be reversed. The corrected form is: **÷ V4, V5 → V11**.
>
> This is the bug identified by Allan Bromley (University of Sydney) around 1990 when he studied the original published diagram. It is transcribed here exactly as Ada published it to preserve the historical record.

---

## The Bug

### What Bromley Found

Around 1990, historian of computing Allan Bromley examined the original published diagram in Taylor's *Scientific Memoirs* (1843) in detail. He noticed that Operation 4 — the division that forms the seed of the A₀ coefficient — has its operands in the wrong order.

The algorithm builds a ratio (2n−1)/(2n+1). For the B₇ computation (n=4), that is 7/9 ≈ 0.778. Ada's table as published gives the dividend column as ²V5 (which holds 2n+1 = 9) and the divisor column as ²V4 (which holds 2n−1 = 7), producing 9/7 ≈ 1.286 — the reciprocal of the intended value. Every subsequent term in the accumulation inherits this error, and the final result would be wrong.

### Why It Matters

Lovelace's program is the earliest known example of a complete, published computer algorithm. The bug in Operation 4 means that the program as printed in 1843 would not produce the correct Bernoulli number if executed on a working Analytical Engine. Because Babbage's Engine was never completed, the program was never tested. The error had no practical consequence for 147 years — it sat undiscovered in a Victorian scientific journal, examined by historians and mathematicians who read it as mathematics rather than as executable code to be checked step by step.

The cause is almost certainly a transcription error, either by Ada herself while preparing the table or during typesetting. The algebraic structure of the algorithm is correct throughout — every other step follows consistently from the intended formula. Only the operand order in this one division is inverted.

### The Remarkable Timeline

The program was published in August 1843. Bromley identified the bug around 1990. The gap is approximately 147 years — the longest known interval between the publication of a computer program and the discovery of a bug in it. This record is unlikely ever to be broken.

Bromley's discovery is a reminder that bugs do not require a running machine to exist, and that careful reading of source code — even century-old typeset source code — can reveal errors invisible to the algorithm's author.

---

## Connection to the CLOOMC Implementation

The Church Machine simulator includes a working implementation of Ada's Note G algorithm in `simulator/cloomc/ada_note_g.cloomc`. That implementation incorporates the Bromley correction: Operation 4 is written as

```
let V11 = V4 / V5
```

dividing V4 (2n−1) by V5 (2n+1), in the correct order. A comment in the source explicitly flags the discrepancy with Ada's published table:

```
-- NOTE: Ada's published table shows V5/V4 — CORRECTED per Bromley (1990)
```

The variable mapping, block structure, and loop logic all follow Ada's original 25-operation layout faithfully. The CLOOMC program is written in the Church Machine's Symbolic Mathematics front-end, which maps naturally to the Analytical Engine's one-operation-per-step model: each line corresponds to one row of Ada's table, with each intermediate result explicitly named.

For production use, `SlideRule.Bernoulli(n)` computes any Bernoulli number in a single CALL instruction. The `ada_note_g.cloomc` program exists to preserve Ada's algorithm for historical fidelity — a direct operational translation of the 1843 table into a language the Church Machine can execute, with the one correction that Bromley determined the original required.

---

*Sources:*
*Ada Lovelace, "Notes by the Translator" (Note G), in L.F. Menabrea, "Sketch of The Analytical Engine Invented by Charles Babbage, Esq.," translated with notes by Ada Augusta, Countess of Lovelace, Taylor's Scientific Memoirs, Vol. III, August 1843.*
*Allan G. Bromley, "Babbage's Analytical Engine Plans 28 and 28a — the Programmable Mill," IEEE Annals of the History of Computing, Vol. 12, No. 3, 1990.*
