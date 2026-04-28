"""
tests/gates/test_cr14_first_activation.py

Regression test for Task #667: CHANGE CR14/CR15 first-activation must
synthesise a valid R+X Golden Token instead of writing the raw thread-lump
header word into the code register.

Root cause (pre-fix):
    _execChange first-activation path called
        _writeCR(d.crDst, gt, entry)
    where gt = memory[entry.word0_location] — the lump header (magic+cc+cw),
    not a valid GT.  Writing it into CR14.word0 would cause every subsequent
    mLoad(cr14GT, ...) to fail with a bogus NS index or version mismatch.

Fix:
    Synthesise a valid R+X GT from the NS entry's gt_seq and targetIdx,
    matching the B:07 NUC_CODE boot ROM pattern, instead of using the raw
    lump header word.

Phase 1 — CHANGE CR14 first-activation:
    Boot the simulator, inject CHANGE CR14 (crSrc=12, imm=1) at PC=0 in
    the code lump, call step(), then check:
      (a) No fault fires during the CHANGE.
      (b) CR14.word0 has R=1 and X=1 (valid code GT).
      (c) CR14.word0 != the raw lump header word (confirms the fix path).

Phase 2 — instruction fetch from the switched-in thread:
    After the CHANGE the CPU is in slot 1 at PC=0, with CR14 pointing at
    the thread lump (NS slot 1).  A cond=NV placeholder is written at the
    fetch address and step() is called once more.  The critical path is
    _fetchInstruction's mLoad(cr14GT, 'X', 14, fetchAddr); with the raw
    lump header in CR14 this would raise a VERSION fault.  Assert no
    VERSION / BOUNDS / NULL_CAP fault fires on the second step.
"""

import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_cr14_first_activation.js")


@pytest.fixture(scope="module")
def result():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, (
        f"harness exited {proc.returncode}: {proc.stderr.decode()}"
    )
    return json.loads(proc.stdout.decode())


class TestCR14FirstActivation:
    def test_no_fault_on_change_cr14(self, result):
        assert not result.get("faulted"), (
            f"CHANGE CR14 first-activation should not fault; "
            f"got faultCode={result.get('faultCode')}, "
            f"faultMsg={result.get('faultMsg')}"
        )

    def test_cr14_has_r_permission(self, result):
        assert result.get("cr14HasR"), (
            f"CR14.word0 after first-activation should have R=1 (valid code GT); "
            f"got cr14Word0={result.get('cr14Word0Hex')}"
        )

    def test_cr14_has_x_permission(self, result):
        assert result.get("cr14HasX"), (
            f"CR14.word0 after first-activation should have X=1 (valid code GT); "
            f"got cr14Word0={result.get('cr14Word0Hex')}"
        )

    def test_cr14_is_not_raw_lump_header(self, result):
        assert result.get("cr14NotLumpHeader"), (
            f"CR14.word0 must not equal the raw lump header word "
            f"(magic+cc+cw is not a valid GT); "
            f"cr14Word0={result.get('cr14Word0Hex')}, "
            f"rawLumpHeader={result.get('rawLumpHeaderHex')}"
        )

    def test_cr14_is_rx_gt(self, result):
        assert result.get("cr14IsRX"), (
            f"CR14.word0 must be a valid R+X GT after first-activation; "
            f"cr14Word0={result.get('cr14Word0Hex')}, "
            f"rawLumpHeader={result.get('rawLumpHeaderHex')}"
        )

    def test_no_version_or_bounds_fault_on_instruction_fetch(self, result):
        """After the context switch the CPU fetches the first instruction via
        _fetchInstruction → mLoad(cr14GT, 'X', 14, fetchAddr).  With the old
        (broken) lump-header GT this mLoad would raise VERSION.  Assert that
        neither VERSION nor BOUNDS nor NULL_CAP fires on the second step."""
        assert result.get("phase2Faulted") is not None, (
            "Phase 2 did not run (Phase 1 may have faulted)"
        )
        assert not result.get("phase2VersionOrBoundsFault"), (
            f"Instruction fetch from switched-in thread raised a "
            f"VERSION/BOUNDS/NULL_CAP fault — CR14 GT is invalid; "
            f"phase2FaultCode={result.get('phase2FaultCode')}, "
            f"phase2FaultMsg={result.get('phase2FaultMsg')}"
        )
