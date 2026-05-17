#!/usr/bin/env node
// scripts/build_selftest_lump.js
//
// Assembles simulator/examples/post_flash_selftest.cloomc using the production
// ChurchAssembler (simulator/assembler.js), packs the result into a valid LUMP
// binary, and writes:
//
//   server/lumps/<token>.lump   — binary (big-endian 32-bit words)
//   server/lumps/<token>.json   — sidecar metadata
//
// The token is the CRC-32 of all binary bytes, lower-cased 8-hex-char string.
// The manifest.json entry is printed to stdout for manual insertion or patch.
//
// C-List (cc=8) — tail of the lump, slots 0..7:
//   Slot 0  0x00000000       unused (reserved)
//   Slot 1  0x48800001  E    Boot.Thread   (NS slot 1)  — Church domain enter
//   Slot 2  0x48800006  E    Mint          (NS slot 6)  — GT lifecycle manager
//   Slot 3  0x48800003  E    Boot.Abstr    (NS slot 3)  — Section I/J/K/L TPERM E tests
//   Slot 4  0x48800004  E    Salvation     (NS slot 4)  — Church domain enter
//   Slot 5  0x48800005  E    Navana        (NS slot 5)  — Church domain enter
//   Slot 6  0x00000000       unused (reserved)
//   Slot 7  0x40800001  X    Boot.Nucs     (NS slot 1)  — Turing domain; Section I/J TPERM X tests
//
// Usage:
//   node scripts/build_selftest_lump.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const ASSEMBLER   = path.join(ROOT, 'simulator', 'assembler.js');
const SOURCE      = path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc');
const LUMPS_DIR   = path.join(ROOT, 'server', 'lumps');
const MANIFEST    = path.join(LUMPS_DIR, 'manifest.json');

// ── Minimal browser stubs so assembler.js loads in Node.js ──────────────────
global.localStorage = {
    _store: {},
    getItem(k)    { return this._store[k] !== undefined ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
};

// Execute assembler.js in this process context
const asmSrc = fs.readFileSync(ASSEMBLER, 'utf8');
// Wrap in IIFE to avoid top-level conflicts
const vm = require('vm');
vm.runInThisContext(asmSrc, { filename: 'assembler.js' });

if (typeof ChurchAssembler === 'undefined') {
    console.error('ERROR: ChurchAssembler not found after loading assembler.js');
    process.exit(1);
}

// ── Assemble the source ──────────────────────────────────────────────────────
const source = fs.readFileSync(SOURCE, 'utf8');
const asm    = new ChurchAssembler();
const result = asm.assemble(source);

if (result.errors.length > 0) {
    console.error('Assembly errors:');
    for (const e of result.errors) {
        console.error(`  Line ${e.line}: ${e.message}`);
    }
    process.exit(1);
}

const words = result.words;
console.log(`Assembled ${words.length} instruction words.`);

// ── C-List definition ─────────────────────────────────────────────────────────
//
// cc=8 slots placed at the lump TAIL (words lumpSize-cc .. lumpSize-1).
// Preserving these values on every recompile is the purpose of this script.
//
// GT format: magic(5)|n(4)|...|perm(8)  — see ISA reference for full encoding.
//
const CLIST = [
    // slot  GT value      name           grants  NS slot  note
    { gt: 0x00000000 }, // 0  null        —       —        reserved
    { gt: 0x48800001 }, // 1  Boot.Thread E       1        Church domain enter
    { gt: 0x48800006 }, // 2  Mint        E       6        GT lifecycle manager
    { gt: 0x48800003 }, // 3  Boot.Abstr  E       3        TPERM E tests (Sections I/J/K/L)
    { gt: 0x48800004 }, // 4  Salvation   E       4        Church domain enter
    { gt: 0x48800005 }, // 5  Navana      E       5        Church domain enter
    { gt: 0x00000000 }, // 6  null        —       —        reserved
    { gt: 0x40800001 }, // 7  Boot.Nucs   X       1        Turing domain; TPERM X tests (Sections I/J)
];

// ── Pack LUMP binary ─────────────────────────────────────────────────────────
//
// Layout (all big-endian 32-bit words):
//   Word 0           : header  — magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
//   Words 1..cw      : instruction words
//   Words cw+1..     : zero-pad
//   Words lumpSize-cc..lumpSize-1 : c-list (cc GT words, at lump tail)
//
// cw  = instruction word count (len(words))
// cc  = 8  (8 GT slots at lump tail; see CLIST above)
// typ = 0  (standard lump, not thread/outform)
// lump_size = next power-of-2 >= (1 + cw + cc)

const cw = words.length;
const cc = CLIST.length;   // 8
const totalNeeded = 1 + cw + cc;

let lumpSize = 64;
while (lumpSize < totalNeeded) lumpSize *= 2;

const n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;

// Validate fields fit
if (n_minus_6 < 0 || n_minus_6 > 15)  { console.error('n_minus_6 out of range:', n_minus_6); process.exit(1); }
if (cw < 0    || cw    > 0x1FFF)       { console.error('cw out of range:', cw); process.exit(1); }
if (cc < 0    || cc    > 0xFF)         { console.error('cc out of range:', cc); process.exit(1); }

const headerWord = (
    (0x1F               << 27) |
    ((n_minus_6 & 0xF)  << 23) |
    ((cw        & 0x1FFF) << 10) |
    ((0         & 0x3)  <<  8) |  // typ=0
    (cc & 0xFF)
) >>> 0;

const padded = new Uint32Array(lumpSize);
padded[0] = headerWord;
for (let i = 0; i < cw; i++) padded[1 + i] = words[i] >>> 0;

// Write c-list GT values at the lump tail (words lumpSize-cc .. lumpSize-1)
const clistBase = lumpSize - cc;
for (let i = 0; i < CLIST.length; i++) {
    padded[clistBase + i] = CLIST[i].gt >>> 0;
}

console.log(`LUMP header: 0x${headerWord.toString(16).toUpperCase().padStart(8,'0')}`);
console.log(`  n_minus_6=${n_minus_6} → lump_size=${lumpSize}`);
console.log(`  cw=${cw}  cc=${cc}  typ=0`);
console.log(`  c-list base word index: ${clistBase}`);

// ── Convert to big-endian bytes ──────────────────────────────────────────────
const bytes = Buffer.alloc(lumpSize * 4);
for (let i = 0; i < lumpSize; i++) {
    bytes.writeUInt32BE(padded[i] >>> 0, i * 4);
}

// ── Compute CRC-32 for the token ─────────────────────────────────────────────
// Standard CRC-32 (IEEE 802.3 polynomial 0xEDB88320)
function crc32(buf) {
    const table = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            t[n] = c;
        }
        return t;
    })();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const token = crc32(bytes).toString(16).toLowerCase().padStart(8, '0');
console.log(`Token (CRC-32 of binary): ${token}`);

// ── Write .lump binary ───────────────────────────────────────────────────────
const lumpPath    = path.join(LUMPS_DIR, `${token}.lump`);
const sidecarPath = path.join(LUMPS_DIR, `${token}.json`);

fs.writeFileSync(lumpPath, bytes);
console.log(`Written: ${lumpPath} (${bytes.length} bytes)`);

// ── Write sidecar .json ───────────────────────────────────────────────────────
const capabilities = [
    { name: 'null',         grants: [],    gt: '0x00000000',                  note: 'unused (slot 0 reserved)' },
    { name: 'Boot.Thread',  grants: ['E'], gt: '0x48800001', ns_slot: 1,      note: 'Boot.Thread E-GT — Church domain enter' },
    { name: 'Mint',         grants: ['E'], gt: '0x48800006', ns_slot: 6,      note: 'Mint E-GT — Church domain enter; GT lifecycle manager (NS slot 2 freed, Mint fills this position)' },
    { name: 'Boot.Abstr',   grants: ['E'], gt: '0x48800003', ns_slot: 3,      note: 'Boot.Abstr E-GT — Church domain enter; Section I/J/K/L TPERM E tests' },
    { name: 'Salvation',    grants: ['E'], gt: '0x48800004', ns_slot: 4,      note: 'Salvation E-GT — Church domain enter' },
    { name: 'Navana',       grants: ['E'], gt: '0x48800005', ns_slot: 5,      note: 'Navana E-GT — Church domain enter' },
    { name: 'null',         grants: [],    gt: '0x00000000',                  note: 'unused (slot 6 reserved)' },
    { name: 'Boot.Nucs',    grants: ['X'], gt: '0x40800001', ns_slot: 1,      note: 'Boot.Nucs X-GT (nucleus execute) — Turing domain; Section I/J TPERM X tests' },
];

const sidecar = {
    token,
    abstraction: 'PostFlashSelftest',
    ns_slot: null,
    ns_slot_policy: 'dynamic',
    lump_size: lumpSize,
    typ: 0,
    content_type: 'code',
    cw,
    cc,
    profile: 'IoT',
    language: 'assembly',
    description: 'Post-Flash Exhaustive Self-Test — 81 hardware correctness tests (DR independence, ALU, shifts, branches, BFEXT/BFINS, TPERM, CHANGE, LOAD). DR0=0 on full pass, DR0=N on first failure.',
    capabilities,
    grants: ['E'],
    author: 'Church Machine',
    version: '1.1',
    lump_version: 0,
};

fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
console.log(`Written: ${sidecarPath}`);

// ── Print c-list note ─────────────────────────────────────────────────────────
console.log('\nC-List GT slot assignments (cc=8, tail-packed):');
const slotNames = [
    'null (reserved)',
    'Boot.Thread  E  NS-slot 1  — Church domain enter',
    'Mint         E  NS-slot 6  — GT lifecycle manager',
    'Boot.Abstr   E  NS-slot 3  — Section I/J/K/L TPERM E tests',
    'Salvation    E  NS-slot 4  — Church domain enter',
    'Navana       E  NS-slot 5  — Church domain enter',
    'null (reserved)',
    'Boot.Nucs    X  NS-slot 1  — Turing domain; Section I/J TPERM X tests',
];
for (let i = 0; i < CLIST.length; i++) {
    const gt = '0x' + CLIST[i].gt.toString(16).padStart(8, '0');
    console.log(`  slot ${i}  ${gt}  ${slotNames[i]}`);
}

// ── Suggest manifest entry ───────────────────────────────────────────────────
const manifestEntry = {
    token,
    abstraction: 'PostFlashSelftest',
    ns_slot: null,
    ns_slot_policy: 'dynamic',
    variant_group: null,
    lump_size: lumpSize,
    cw,
    cc,
    grants: ['E'],
    lump_version: 0,
};

console.log('\nManifest entry to add to server/lumps/manifest.json:');
console.log(JSON.stringify(manifestEntry, null, 4));

// ── Optionally update manifest.json automatically ─────────────────────────────
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existing = manifest.find(e => e.abstraction === 'PostFlashSelftest');
if (existing) {
    console.log('\nExisting PostFlashSelftest entry found — removing it before update.');
    const idx = manifest.indexOf(existing);
    manifest.splice(idx, 1);
}
manifest.push(manifestEntry);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
console.log(`Updated: ${MANIFEST}`);

console.log('\nDone. Run python -m pytest tests/lump/test_lump_consistency.py -v to verify.');
