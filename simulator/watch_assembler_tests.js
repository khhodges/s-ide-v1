const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WATCH_FILES = [
  path.resolve(__dirname, 'assembler.js'),
  path.resolve(__dirname, 'assembler_test.js'),
];

let running = false;
let pending = false;
let debounceTimer = null;

function runTests() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;

  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Running assembler tests...`);

  const child = spawn('node', [path.resolve(__dirname, 'assembler_test.js')], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });

  child.on('close', (code) => {
    const ts = new Date().toISOString();
    if (code === 0) {
      console.log(`[${ts}] Tests passed.`);
    } else {
      console.log(`[${ts}] Tests FAILED (exit code ${code}).`);
    }
    running = false;
    if (pending) {
      runTests();
    }
  });
}

function onChange(filename) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log(`\nChange detected in: ${filename}`);
    runTests();
  }, 200);
}

for (const file of WATCH_FILES) {
  if (!fs.existsSync(file)) {
    console.warn(`Warning: watch target does not exist: ${file}`);
    continue;
  }
  fs.watch(file, (eventType) => {
    onChange(path.basename(file));
  });
  console.log(`Watching: ${file}`);
}

console.log('Assembler test watcher started. Running tests now...\n');
runTests();
