"""
tests/test_privilege_fence_cr12_15.py

Regression tests for the CR12–CR15 privilege fence added in Task #7.

Architecture rules under test (simulator/simulator.js ~line 2048):
  1. Normal instructions (opcodes 0–9 except CHANGE=4) may not write CR12–CR15
     via crDst → PRIV_REG fault.
  2. Instructions with a CR source operand (opcodes 0,1,5,8,9,10,11) may not
     read CR12–CR15 as crSrc → PRIV_REG fault.
     Exception: DREAD (10) and DWRITE (11) may name CR14 as source.
  3. CHANGE (opcode 4) is exempt from the decode fence; instead _execChange
     requires crDst ∈ {12,13,14,15} — anything else → PRIV_REG.
  4. CHANGE CR12/CR13 (system-wide) completes without a context switch.
  5. DWRITE with CR14 source fails with PERMISSION (not PRIV_REG) because
     CR14 holds code (X-only); W is intentionally absent.

All tests boot the simulator once, inject a single instruction word at PC=0,
execute one step(), and assert the expected fault (or non-fault) outcome.
"""

import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_priv_fence.js")


def _run(scenarios):
    data = json.dumps(scenarios)
    proc = subprocess.run(
        ["node", HARNESS],
        input=data.encode(),
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, f"harness exited {proc.returncode}: {proc.stderr.decode()}"
    return {r["name"]: r for r in json.loads(proc.stdout.decode())}


# Church Hardware Address Range constants (mirrors simulator/simulator.js and hw_types.py).
# Used to build authority-cap preloads for T8 / T11.
#
# GT word layout as decoded by simulator.js parseGT():
#   bits [15: 0]  slot_id   (index into NS table)
#   bits [22:16]  gt_seq    (version counter)
#   bits [24:23]  gt_type   (0b01 = Inform)
#   bits [31:25]  permBits  ordered: R(0) W(1) X(2) L(3) S(4) E(5) B(6)
#                           → S is at permBits bit 4 → gt32 bit 29
#
# NOTE: The simulator's perm-bit ordering differs from hardware GT_LAYOUT.
#       Use the simulator ordering here since these constants feed JS tests.
#
# Inform-type GT with no perms, slot_id=1 (Boot.Thread), gt_seq=0:
#   = (0b01 << 23) | 1 = 0x00800001
#
# Add S-perm (permBits bit 4 → gt32 bit 29):
#   = 0x00800001 | (1 << 29) = 0x20800001
#
_GT_INFORM_NO_PERM_SLOT1  = 0x00800001   # Inform, slot_id=1, no perms
_GT_INFORM_S_PERM_SLOT1   = 0x20800001   # Inform, slot_id=1, S-perm only (bit 29)
_CR_PORT_CR12              = 0xFFFFFF0C   # CHANGE CR12 authority port address

SCENARIOS = [
    # opcode, crDst, crSrc, imm, name
    # T1: LOAD (opcode=0, Church) with crDst=12  → PRIV_REG (crDst fence)
    dict(name="T1_LOAD_crDst12",   opcode=0,  crDst=12, crSrc=0,  imm=0),
    # T2: LOAD (opcode=0, Church) with crDst=15  → PRIV_REG (crDst fence)
    dict(name="T2_LOAD_crDst15",   opcode=0,  crDst=15, crSrc=0,  imm=0),
    # T3: SAVE (opcode=1) with crSrc=13          → PRIV_REG (crSrc fence)
    dict(name="T3_SAVE_crSrc13",   opcode=1,  crDst=0,  crSrc=13, imm=0),
    # T4: DREAD (opcode=10) with crSrc=13        → PRIV_REG (not CR14)
    dict(name="T4_DREAD_crSrc13",  opcode=10, crDst=0,  crSrc=13, imm=0),
    # T5: DREAD (opcode=10) with crSrc=14        → NO PRIV_REG (CR14 exception)
    dict(name="T5_DREAD_crSrc14",  opcode=10, crDst=0,  crSrc=14, imm=0),
    # T6: DWRITE (opcode=11) with crSrc=14       → PERMISSION fault (not PRIV_REG;
    #     CR14 is X-only so DWRITE's W check fires; decode fence is passed)
    dict(name="T6_DWRITE_crSrc14", opcode=11, crDst=0,  crSrc=14, imm=0),
    # T7: CHANGE (opcode=4) crDst=0 (< 12)       → PRIV_REG from _execChange
    dict(name="T7_CHANGE_crDst0",  opcode=4,  crDst=0,  crSrc=0,  imm=0),
    # T8: CHANGE (opcode=4) crDst=12, crSrc=0, imm=1
    #     → success (system-wide, no ctx switch).
    #     Authority check requires source cap to have S-perm and location=CR_PORT_CR12.
    #     Preload CR0 with an S-perm Inform GT (slot_id=1, gt_seq=0) and
    #     word1=0xFFFFFF0C so both authority conditions pass.
    dict(name="T8_CHANGE_CR12_ok", opcode=4, crDst=12, crSrc=0, imm=1,
         preloadCaps=[{"cr": 0, "word0": _GT_INFORM_S_PERM_SLOT1,
                       "word1": _CR_PORT_CR12}]),
    # T9: CHANGE crDst=14 (per-thread context switch) → decode fence passed (no PRIV_REG);
    #     _execChange enters save/restore path.  crSrc=12 (thread stack GT) does not
    #     carry L-perm so PERM_L fires — confirming the save path was reached, not the fence.
    dict(name="T9_CHANGE_CR14_fence_pass", opcode=4, crDst=14, crSrc=12, imm=0),
    # T10: CHANGE crDst=15 (per-thread namespace root) → same: decode fence passed.
    dict(name="T10_CHANGE_CR15_fence_pass", opcode=4, crDst=15, crSrc=12, imm=0),
    # T11: CHANGE CR12 with no S-perm on source cap → PERM_S fault.
    #     Preload CR0 with an Inform GT at slot 1 but carrying no permissions.
    #     The authority check fires (not M-elevated) and rejects the operation.
    dict(name="T11_CHANGE_CR12_no_authority", opcode=4, crDst=12, crSrc=0, imm=1,
         preloadCaps=[{"cr": 0, "word0": _GT_INFORM_NO_PERM_SLOT1,
                       "word1": _CR_PORT_CR12}]),
]


@pytest.fixture(scope="module")
def results():
    return _run(SCENARIOS)


class TestPrivFencecrDst:
    def test_T1_load_crDst12_priv_reg(self, results):
        r = results["T1_LOAD_crDst12"]
        assert r.get("privFault"), f"expected PRIV_REG, got: {r}"

    def test_T2_load_crDst15_priv_reg(self, results):
        r = results["T2_LOAD_crDst15"]
        assert r.get("privFault"), f"expected PRIV_REG, got: {r}"


class TestPrivFenceCrSrc:
    def test_T3_save_crSrc13_priv_reg(self, results):
        r = results["T3_SAVE_crSrc13"]
        assert r.get("privFault"), f"expected PRIV_REG, got: {r}"

    def test_T4_dread_crSrc13_priv_reg(self, results):
        r = results["T4_DREAD_crSrc13"]
        assert r.get("privFault"), f"expected PRIV_REG, got: {r}"

    def test_T5_dread_crSrc14_no_priv_reg(self, results):
        r = results["T5_DREAD_crSrc14"]
        assert not r.get("privFault"), (
            f"DREAD CR14 should pass privilege fence but got: {r}")

    def test_T6_dwrite_crSrc14_perm_not_priv(self, results):
        r = results["T6_DWRITE_crSrc14"]
        assert not r.get("privFault"), (
            f"DWRITE CR14 decode fence passed but PRIV_REG fired: {r}")
        assert r.get("faultCode") == "PERMISSION", (
            f"expected PERMISSION fault (W absent on code lump), got: {r}")


class TestChangePrivilege:
    def test_T7_change_crDst0_priv_reg(self, results):
        r = results["T7_CHANGE_crDst0"]
        assert r.get("privFault"), (
            f"CHANGE crDst<12 should PRIV_REG in _execChange, got: {r}")

    def test_T8_change_CR12_ok(self, results):
        r = results["T8_CHANGE_CR12_ok"]
        assert not r.get("faulted"), (
            f"CHANGE CR12 system-wide should succeed, got: {r}")

    def test_T9_change_CR14_decode_fence_not_PRIV_REG(self, results):
        r = results["T9_CHANGE_CR14_fence_pass"]
        assert not r.get("privFault"), (
            f"CHANGE crDst=14 should pass decode fence (no PRIV_REG), got: {r}")
        assert r.get("faultCode") != "PRIV_REG", (
            f"faultCode must not be PRIV_REG; _execChange save path was reached, got: {r}")

    def test_T10_change_CR15_decode_fence_not_PRIV_REG(self, results):
        r = results["T10_CHANGE_CR15_fence_pass"]
        assert not r.get("privFault"), (
            f"CHANGE crDst=15 should pass decode fence (no PRIV_REG), got: {r}")
        assert r.get("faultCode") != "PRIV_REG", (
            f"faultCode must not be PRIV_REG; _execChange save path was reached, got: {r}")

    def test_T11_change_CR12_no_authority(self, results):
        r = results["T11_CHANGE_CR12_no_authority"]
        assert r.get("faulted"), (
            f"CHANGE CR12 without S-perm authority should fault, got: {r}")
        assert r.get("faultCode") == "PERM_S", (
            f"expected PERM_S fault (S-perm absent), got faultCode={r.get('faultCode')}: {r}")
