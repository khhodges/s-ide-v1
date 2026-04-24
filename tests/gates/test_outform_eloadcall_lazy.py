"""Simulator-level regression tests for Mode 2 (Outform) lazy load via ELOADCALL.

Exercises the JavaScript simulator via Node.js to verify:

  1. ELOADCALL on a c-list slot whose GT carries type=2 (Outform) triggers the
     Mode 2 lazy loader (_dispatchLoaderLoad) inside _execEloadcall before the
     TPERM and CALL phases execute, installs the lump, and promotes the in-flight
     slot GT from Outform→Inform so the instruction completes without fault.
     (Task #464)

  2. ELOADCALL on a c-list slot with a plain Inform GT (type=1) does NOT trigger
     the Mode 2 path — the instruction proceeds normally.
     (Task #464)

  3. Repeated ELOADCALL from a stale Outform c-list slot (lump already installed
     after the first call) still completes without fault on every subsequent call.
     (Task #464)
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_outform_eloadcall_lazy.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_outform_eloadcall_lazy():
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
            f"sim_outform_eloadcall_lazy.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
