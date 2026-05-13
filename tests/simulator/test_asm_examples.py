"""tests/simulator/test_asm_examples.py

Regression test for Task #1042.

Verifies that every built-in Assembly example in simulator/app-run.js
assembles without errors when passed through ChurchAssembler.assemble().

This catches privilege-zone mistakes (e.g. writing to CR12–CR15), unknown
label references, out-of-range immediates, and any other assembler-level
error that would silently break an example visible to students.

All assertions live in the JS harness
(tests/simulator/sim_asm_examples.js) which exits 0 on success.
This Python wrapper runs it under pytest so it participates in the
CI test suite alongside the lump consistency gate.
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_asm_examples.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason='Node.js not available')
def test_all_assembly_examples_assemble_cleanly():
    """Every built-in Assembly example must assemble with zero errors."""
    result = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=60,
    )
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    if result.returncode != 0 or stderr:
        lines = []
        if stdout:
            lines.append('stdout:\n' + stdout)
        if stderr:
            lines.append('stderr:\n' + stderr)
        pytest.fail(
            'sim_asm_examples.js reported assembler errors in one or more examples.\n'
            + '\n'.join(lines)
        )

    assert '[PASS]' in stdout, f'No [PASS] markers in harness output:\n{stdout}'

    # Parse the total example count emitted by the harness on the first line
    # ("TOTAL_EXAMPLES=N") so the assertion stays correct if examples are added
    # or removed without needing to update a hardcoded number here.
    total = None
    for line in stdout.splitlines():
        if line.startswith('TOTAL_EXAMPLES='):
            try:
                total = int(line.split('=', 1)[1])
            except ValueError:
                pass
            break

    pass_count = stdout.count('[PASS]')

    if total is not None:
        assert pass_count == total, (
            f'Expected {total} [PASS] markers (one per example), '
            f'got {pass_count}:\n{stdout}'
        )
    else:
        # Fallback: if the harness format changes, require at least one pass.
        assert pass_count >= 1, f'No [PASS] markers in harness output:\n{stdout}'
