#!/usr/bin/env node
// scripts/check-capabilities-blocks.js
//
// Scans every simulator/examples/*.cloomc file.
// For any file that uses dot-notation operands (named LOAD, CALL Name.method,
// or ELOADCALL CRd, Name, method), the script verifies:
//
//   1. A  capabilities { }  block is present in the file.
//   2. Every referenced abstract name has an explicit permission entry
//      inside that block (e.g.  "Scheduler E"  or  "LED RW").
//
// What counts as a dot-notation reference:
//   CALL  Name.method          — Church-domain method call by name
//   ELOADCALL  CRd, Name, method — fused load+TPERM+call
//   LOAD  CRn, Name            — named namespace load (plain identifier,
//                                no dot, not a CR register)
//
// Names that contain a dot in the LOAD operand position (e.g. Boot.Nucs,
// Boot.Abstr) are pre-qualified boot-level references and are exempt.
//
// Usage:
//   node scripts/check-capabilities-blocks.js          # report violations
//   node scripts/check-capabilities-blocks.js --help   # show this message
//
// Exit codes:
//   0  — all files pass
//   1  — one or more violations found (details printed to stdout)

'use strict';

const fs   = require('fs');
const path = require('path');

if (process.argv.includes('--help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter(l => l.startsWith('//'))
        .map(l => l.slice(3))
        .join('\n'));
    process.exit(0);
}

const ROOT         = path.resolve(__dirname, '..');
const EXAMPLES_DIR = path.join(ROOT, 'simulator', 'examples');

// ── helpers ──────────────────────────────────────────────────────────────────

// Strip trailing inline comments and trim whitespace from a source line.
function stripComment(line) {
    return line.replace(/;.*$/, '').trim();
}

// Return the capabilities map parsed from a file's source, or null if the
// file contains no capabilities { } block.
//
// The map keys are abstract names; the values are permission strings
// (e.g. "E", "RW", "RX").  Trailing commas on entries are accepted.
function parseCapabilities(src) {
    const blockMatch = src.match(/capabilities\s*\{([^}]*)\}/);
    if (!blockMatch) return null;

    const map = new Map();
    for (const raw of blockMatch[1].split('\n')) {
        const line = raw.replace(/;.*$/, '').trim().replace(/,$/, '');
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(parts[0])
                               && /^[ERWXLSB]+$/.test(parts[1])) {
            map.set(parts[0], parts[1]);
        }
    }
    return map;
}

// Return the set of abstract names referenced by dot-notation operands in src.
// Names that are boot-level qualified references (containing a dot in the LOAD
// operand) are excluded; only plain identifiers are returned.
function extractReferencedNames(src) {
    const names = new Set();

    for (const raw of src.split('\n')) {
        const code = stripComment(raw);
        if (!code) continue;

        // CALL Name.method  — dot-notation dispatch
        const callDot = code.match(/^CALL\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
        if (callDot) {
            names.add(callDot[1]);
            continue;
        }

        // ELOADCALL CRd, Name, method  — fused load+TPERM+call
        const eload = code.match(/^ELOADCALL\s+CR\d+\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/);
        if (eload) {
            names.add(eload[1]);
            continue;
        }

        // LOAD CRn, Name  — named namespace load (exactly two operands).
        // Excluded patterns:
        //   LOAD CR0, CR6, 4   — raw three-operand slot reference (second tok is CR-reg)
        //   LOAD CR1, Boot.Nucs — boot-level dotted name (contains '.')
        const loadNamed = code.match(/^LOAD\s+CR\d+\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:,|$)/);
        if (loadNamed) {
            const name = loadNamed[1];
            if (/^CR\d+$/.test(name)) continue;  // raw CR-register operand
            if (name.includes('.'))   continue;   // dotted boot-level reference
            names.add(name);
        }
    }

    return names;
}

// ── main ─────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(EXAMPLES_DIR)
    .filter(f => f.endsWith('.cloomc'))
    .sort();

let violations = 0;

for (const filename of files) {
    const filepath = path.join(EXAMPLES_DIR, filename);
    const src      = fs.readFileSync(filepath, 'utf8');

    const referenced = extractReferencedNames(src);
    if (referenced.size === 0) {
        // No dot-notation usage — no capabilities block required.
        console.log(`  ok   (no dot-notation)  ${filename}`);
        continue;
    }

    const caps = parseCapabilities(src);

    // Collect missing names: either no block at all, or a name absent from it.
    const missing = [];
    for (const name of referenced) {
        if (!caps || !caps.has(name)) {
            missing.push(name);
        }
    }

    if (missing.length === 0) {
        console.log(`  ok   ${filename}`);
    } else {
        console.error(`  FAIL ${filename}`);
        if (!caps) {
            console.error(`       missing capabilities block entirely`);
            console.error(`       referenced names: ${[...referenced].join(', ')}`);
        } else {
            console.error(`       missing entries in capabilities block: ${missing.join(', ')}`);
        }
        violations++;
    }
}

console.log('');
if (violations > 0) {
    console.error(`check-capabilities-blocks: ${violations} violation(s) found.`);
    console.error('');
    console.error('Every .cloomc file that uses named LOAD, CALL Name.method,');
    console.error('or ELOADCALL must declare a  capabilities { }  block listing');
    console.error('each referenced abstract name with its permission letters.');
    console.error('');
    console.error('Example:');
    console.error('  capabilities {');
    console.error('      Scheduler E');
    console.error('      LED RW');
    console.error('  }');
    process.exit(1);
} else {
    console.log(`check-capabilities-blocks: all ${files.length} file(s) pass.`);
}
