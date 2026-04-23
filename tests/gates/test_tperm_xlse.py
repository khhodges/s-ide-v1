"""
tests/test_tperm_xlse.py

Regression tests for the TPERM X⊕LSE domain-purity fault.

Architecture rule (simulator/simulator.js _execTperm, hardware/tperm.py CHECK state):
  result_perms = preset_mask ∩ GT.perms
  If result has both X and any of {L, S, E} → TPERM_RSV fault.
  This mirrors hardware: result_perms = new_perms & target_gt.perms.

Because no standard preset combines X with L/S/E, the tests inject custom
presets via sim.tpermPresetMasks (exposed for testability) using reserved
preset slots 11–14.

All tests run through the sim_tperm_xlse.js harness which boots the simulator,
preloads target CRs with crafted GTs, optionally injects a custom preset, and
runs a single TPERM instruction.
"""

import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_tperm_xlse.js")


def _run_harness():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, (
        f"TPERM X⊕LSE harness exited {proc.returncode}: {proc.stderr.decode()}")
    return {r["name"]: r for r in json.loads(proc.stdout.decode())}


@pytest.fixture(scope="module")
def results():
    return _run_harness()


class TestTpermXlseConflict:
    """Custom presets that produce X + {L,S,E} in the result must fault TPERM_RSV."""

    def test_T_XLSE1_x_and_L_faults(self, results):
        r = results["T_XLSE1_xL_conflict"]
        assert r.get("faulted"), (
            f"TPERM with result X+L should fault TPERM_RSV, got: {r}")
        assert r.get("faultCode") == "TPERM_RSV", (
            f"expected TPERM_RSV, got faultCode={r.get('faultCode')}: {r}")

    def test_T_XLSE2_x_and_S_faults(self, results):
        r = results["T_XLSE2_xS_conflict"]
        assert r.get("faulted"), (
            f"TPERM with result X+S should fault TPERM_RSV, got: {r}")
        assert r.get("faultCode") == "TPERM_RSV", (
            f"expected TPERM_RSV, got faultCode={r.get('faultCode')}: {r}")

    def test_T_XLSE3_x_and_E_faults(self, results):
        r = results["T_XLSE3_xE_conflict"]
        assert r.get("faulted"), (
            f"TPERM with result X+E should fault TPERM_RSV, got: {r}")
        assert r.get("faultCode") == "TPERM_RSV", (
            f"expected TPERM_RSV, got faultCode={r.get('faultCode')}: {r}")


class TestTpermXlseNoConflict:
    """Standard presets strip conflicting permissions — no fault expected."""

    def test_T_XLSE4_x_L_gt_via_X_preset_no_fault(self, results):
        r = results["T_XLSE4_xL_no_conflict_via_X_preset"]
        assert not r.get("faulted"), (
            f"TPERM [X] on X+L GT strips L from result — should not fault, got: {r}")

    def test_T_XLSE5_x_only_no_fault(self, results):
        r = results["T_XLSE5_x_only_no_conflict"]
        assert not r.get("faulted"), (
            f"TPERM [X] on X-only GT should not fault, got: {r}")
