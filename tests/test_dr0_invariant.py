"""Simulator-level tests for the DR0 zero-register invariant (Task #318).

Exercises the JavaScript simulator directly via Node.js to verify that
sim.dr[0] === 0 after every instruction step, covering all major instruction
types:

  - IADD, ISUB, MCMP, BFEXT, BFINS, SHL, SHR, BRANCH  (Turing arithmetic)
  - DREAD  (data read through a capability-protected NS entry)
  - CALL → LED.Set / LED.Clear / LED.Toggle / LED.State
      (the signed-return path that was previously bypassed by _preserveDR0;
       DR0 must be zero and DR1 must carry the signed result)

All assertions are implemented in the JS harness
(tests/sim_dr0_invariant.js) which exits 0 on success and writes [PASS]
markers to stdout.  This Python wrapper runs the harness under pytest and
fails the test if the harness exits non-zero or emits no [PASS] lines.
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HARNESS = os.path.join(ROOT, "tests", "sim_dr0_invariant.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_dr0_invariant_harness():
    """Run the JS harness and assert all DR0-invariant checks pass."""
    result = subprocess.run(
        ["node", HARNESS],
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
            lines.append("stdout:\n" + stdout)
        if stderr:
            lines.append("stderr:\n" + stderr)
        pytest.fail(
            f"sim_dr0_invariant.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No [PASS] markers in harness output:\n{stdout}"

    pass_count = stdout.count("[PASS]")
    assert pass_count >= 17, (
        f"Expected at least 17 [PASS] markers, got {pass_count}:\n{stdout}"
    )
