'use strict';

/**
 * server/compile_worker.js — Node.js stdin→stdout compile worker
 *
 * Protocol
 * --------
 *   stdin:  one JSON object (the compile request)
 *   stdout: one JSON object (the compile response)
 *   exit:   always 0 — errors live in the JSON, not the exit code
 *
 * Request fields
 * --------------
 *   source           string   required  Raw source text
 *   language         string   optional  One of the 6 canonical values;
 *                                       auto-detected by the compiler when absent
 *   abstraction_name string   optional  Overrides the name detected from source
 *   namespace_hint   object   optional  {gt_type, allocation_words, clist_slots}
 *
 * Response (success)
 * ------------------
 *   ok           true
 *   language     string    detected or supplied language
 *   words        number[]  uint32 array — LUMP binary (big-endian words)
 *   lump_binary  string    base64-encoded LUMP binary (same data as words)
 *   warnings     string[]  soft / lazy-resolve messages; empty array when none
 *
 * Response (failure)
 * ------------------
 *   ok       false
 *   language string    detected or supplied language; '' when detection is impossible
 *   error    string    human-readable error description
 */

const path = require('path');

// ChurchAssembler must be a global before requiring the compiler so that
// compileAssembly()'s `typeof ChurchAssembler !== 'undefined'` guard passes.
global.ChurchAssembler = require(path.join(__dirname, '..', 'simulator', 'assembler.js'));

const CLOOMCCompiler = require(path.join(__dirname, '..', 'simulator', 'cloomc_compiler.js'));
const { buildLump }  = require(path.join(__dirname, '..', 'simulator', 'lump_builder.js'));

const LANG_MAP = {
    'english'    : 'compileEnglish',
    'javascript' : 'compileJS',
    'haskell'    : 'compileHaskell',
    'symbolic'   : 'compileSymbolic',
    'lambda'     : 'compileLambda',
    'assembly'   : 'compileAssembly',
};

const UNRESOLVED_PATTERNS = [
    /not in capabilities list/i,
    /not a known method/i,
    /unknown abstraction/i,
    /undeclared symbol/i,
    /no binding/i,
];

function isUnresolvedError(err) {
    const msg = err.message || '';
    return UNRESOLVED_PATTERNS.some(p => p.test(msg));
}

function wordsToBase64(words) {
    const buf = Buffer.alloc(words.length * 4);
    for (let i = 0; i < words.length; i++) {
        buf.writeUInt32BE(words[i] >>> 0, i * 4);
    }
    return buf.toString('base64');
}

function run(req) {
    const source          = req.source          || '';
    const language        = req.language         || '';
    const abstractionName = req.abstraction_name || null;
    const namespaceHint   = req.namespace_hint   || {};

    const compiler = new CLOOMCCompiler();

    let result;
    try {
        const method = LANG_MAP[language];
        if (method && typeof compiler[method] === 'function') {
            result = compiler[method](source, []);
        } else {
            result = compiler.compile(source, []);
        }
    } catch (ex) {
        const msg = `Internal compiler error: ${ex.message}`;
        return { ok: false, language: language || '', error: msg };
    }

    const detectedLang = result.language || language || 'assembly';
    const allErrors    = [...(result.errors   || [])];
    const allWarnings  = [...(result.warnings || [])];

    const hardErrors   = [];
    const warnMessages = [];

    for (const err of allErrors) {
        if (isUnresolvedError(err)) {
            warnMessages.push(err.message);
        } else {
            hardErrors.push(err);
        }
    }
    for (const w of allWarnings) {
        warnMessages.push(w.message != null ? w.message : String(w));
    }

    if (hardErrors.length > 0) {
        const msg = hardErrors
            .map(e => `Line ${e.line != null ? e.line : '?'}: ${e.message}`)
            .join('; ');
        return { ok: false, language: detectedLang, error: msg };
    }

    const { words } = buildLump(result, {
        allocationWords: namespaceHint.allocation_words,
    });

    return {
        ok:          true,
        language:    detectedLang,
        words:       Array.from(words),
        lump_binary: wordsToBase64(words),
        warnings:    warnMessages,
    };
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
    let req;
    try {
        req = JSON.parse(inputData);
    } catch (ex) {
        process.stdout.write(JSON.stringify({
            ok:       false,
            language: '',
            error:    'Invalid JSON request',
        }) + '\n');
        process.exit(0);
    }
    const resp = run(req);
    process.stdout.write(JSON.stringify(resp) + '\n');
    process.exit(0);
});
