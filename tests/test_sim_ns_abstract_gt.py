"""Simulator-level tests for NS slot word3 Abstract GT (Task #322).

Exercises the JavaScript simulator directly via Node.js to verify:
  1. getNSTableMemoryDump() exposes word3 (abstract_gt) as raw[3] on every
     NS entry — confirming the 4-word entry format is reflected in dump output.
  2. _writeCR gates word3 on mElevation: the capability register receives the
     abstract_gt value only when M-elevated; user-mode always reads 0.

These properties complement the Amaranth hardware tests in
test_ns_abstract_gt.py and the binary-match checks in
test_boot_image_matches_simulator.py.
"""

import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HARNESS = os.path.join(ROOT, "tests", "sim_ns_w3_check.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_sim_ns_abstract_gt_harness():
    """Run the JS harness; fail if it exits non-zero or writes to stderr."""
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
            f"sim_ns_w3_check.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
