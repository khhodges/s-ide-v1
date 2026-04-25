"""Unit-test regression suite for _computeReferencedCListSlots() (Task #546).

The analysis function is the heart of the POLA optimizer: it determines which
c-list slots are live so that unreferenced capabilities can be safely zeroed.
A mis-classification either silently removes a live capability (safety bug)
or fails to remove a dead one (privacy/authority leak).

All assertions live in the JS harness
  tests/simulator/sim_clist_analysis.js
which exits 0 when every case passes.  This Python wrapper runs it under
pytest so it integrates with the project's CI pipeline.

Covered edge cases (13 tests):
  - codeCount = 0 (null / empty code section)
  - Direct LOAD / SAVE / ELOADCALL / XLOADLAMBDA references via CR6
  - Alias register created by LOAD and used for indirect access
  - Non-CR6, non-alias source → nothing recorded
  - Alias register clobbered (re-loaded from CR6) before indirect use
  - Alias CR = 6 itself — subsequent CR6 accesses land in direct, not indirect
  - Slot present in both direct and indirect — indirect must NOT contain it
  - codeCount larger than memory.length — boundary guard, no crash
  - Non-tracked opcode via CR6 → ignored
  - SAVE / ELOADCALL do NOT promote crDst to alias
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_clist_analysis.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason='Node.js not available')
def test_clist_analysis_harness():
    """Run the JS harness and assert all c-list analysis checks pass."""
    result = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=30,
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
            'sim_clist_analysis.js exited with code {}\n'.format(result.returncode)
            + '\n'.join(lines)
        )

    assert '[PASS]' in stdout, 'No [PASS] markers in harness output:\n' + stdout

    pass_count = stdout.count('[PASS]')
    assert pass_count >= 13, (
        'Expected at least 13 [PASS] markers, got {}:\n{}'.format(pass_count, stdout)
    )
