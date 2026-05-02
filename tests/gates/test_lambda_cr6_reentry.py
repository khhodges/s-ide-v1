"""
tests/gates/test_lambda_cr6_reentry.py

Regression tests for the D-9 idempotent re-entry rule (hardware/core.py
nested_lambda_fault signal, lines ~343-353 and ~2003-2007):

  LAMBDA CR6 (CR_CLIST) while lambda_active=1  → idempotent, no fault.
  LAMBDA CRn (n≠6)      while lambda_active=1  → INVALID_OP fault.

Both behaviours are exercised via the sim_lambda_cr6_reentry.js harness which
boots the JavaScript simulator, forces lambdaActive=true, injects a LAMBDA
instruction targeting either CR6 or another CR, and steps once.
"""

import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_lambda_cr6_reentry.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.fixture(scope="module")
def results():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=60,
        cwd=ROOT,
    )
    assert proc.returncode == 0, (
        f"sim_lambda_cr6_reentry.js exited {proc.returncode}: "
        f"{proc.stderr.decode()}"
    )
    return {r["name"]: r for r in json.loads(proc.stdout.decode())}


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
class TestLambdaCR6ReentryWhileActive:
    """LAMBDA CR6 while lambda_active=1 is idempotent and must not fault."""

    def test_cr6_reentry_no_fault(self, results):
        r = results["CR6_reentry_while_active_no_fault"]
        assert not r.get("faulted"), (
            "LAMBDA CR6 while lambda_active=1 should be idempotent (no fault), "
            f"but got faultCode={r.get('faultCode')!r}: {r.get('faultMsg')!r}"
        )

    def test_cr6_reentry_no_invalid_op(self, results):
        r = results["CR6_reentry_while_active_no_fault"]
        assert r.get("faultCode") != "INVALID_OP", (
            "LAMBDA CR6 (CR_CLIST) re-entry while active must NOT raise "
            f"INVALID_OP, got: {r}"
        )


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
class TestNestedLambdaNonCR6FaultsInvalidOp:
    """LAMBDA CRn (n≠6) while lambda_active=1 must raise INVALID_OP."""

    def test_cr0_nested_lambda_faults_invalid_op(self, results):
        r = results["CR0_nested_lambda_while_active_INVALID_OP"]
        assert r.get("faulted"), (
            "LAMBDA CR0 while lambda_active=1 should fault INVALID_OP, "
            f"but no fault was raised: {r}"
        )
        assert r.get("faultCode") == "INVALID_OP", (
            f"Expected INVALID_OP for LAMBDA CR0 while active, "
            f"got faultCode={r.get('faultCode')!r}: {r}"
        )

    def test_cr5_nested_lambda_faults_invalid_op(self, results):
        r = results["CR5_nested_lambda_while_active_INVALID_OP"]
        assert r.get("faulted"), (
            "LAMBDA CR5 while lambda_active=1 should fault INVALID_OP, "
            f"but no fault was raised: {r}"
        )
        assert r.get("faultCode") == "INVALID_OP", (
            f"Expected INVALID_OP for LAMBDA CR5 while active, "
            f"got faultCode={r.get('faultCode')!r}: {r}"
        )
