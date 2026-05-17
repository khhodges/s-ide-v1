#!/usr/bin/env node
// scripts/check-capabilities-blocks.js
//
// Scans every .cloomc file in one or more directories (searched recursively).
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
//   node scripts/check-capabilities-blocks.js                   # scan simulator/examples (default)
//   node scripts/check-capabilities-blocks.js dir1 dir2 ...     # scan specific directories
//   node scripts/check-capabilities-blocks.js --help            # show this message
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

const ROOT = path.resolve(__dirname, '..');

// Collect directory arguments from the command line (positional, non-flag args).
const argDirs = process.argv.slice(2).filter(a => !a.startsWith('-'));

// Default to simulator/examples when no directories are provided.
const scanDirs = argDirs.length > 0
    ? argDirs.map(d => path.resolve(ROOT, d))
    : [path.join(ROOT, 'simulator', 'examples')];

// ── helpers ──────────────────────────────────────────────────────────────────

// Recursively collect all .cloomc files under a directory.
function collectCloomcFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectCloomcFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.cloomc')) {
            results.push(full);
        }
    }
    return results;
}

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

// Collect all .cloomc files across all scan directories, sorted for stable output.
const allFiles = [];
for (const dir of scanDirs) {
    const found = collectCloomcFiles(dir);
    allFiles.push(...found);
}
allFiles.sort();

// Deduplicate in case directories overlap.
const files = [...new Set(allFiles)];

let violations = 0;

for (const filepath of files) {
    const relpath = path.relative(ROOT, filepath);
    const src     = fs.readFileSync(filepath, 'utf8');

    const referenced = extractReferencedNames(src);
    if (referenced.size === 0) {
        console.log(`  ok   (no dot-notation)  ${relpath}`);
        continue;
    }

    const caps = parseCapabilities(src);

    const missing = [];
    for (const name of referenced) {
        if (!caps || !caps.has(name)) {
            missing.push(name);
        }
    }

    if (missing.length === 0) {
        console.log(`  ok   ${relpath}`);
    } else {
        console.error(`  FAIL ${relpath}`);
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
