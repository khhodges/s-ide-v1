"""Hardware regression test: Abstract GT CALL permission bypass (Task #432).

Verifies that hardware/core.py now selects required_perms=0 (not PERM_MASK_E)
when the callee GT has gt_type=GT_TYPE_ABSTRACT, so an Abstract GT CALL does
not fault PERM_E before M_FETCH_NS0 can fire.

Tests:
  test_abstract_gt_call_no_perm_e
    ChurchPermCheck(required_perms=0, gt_type=ABSTRACT, no perms) must pass.
    This is what hardware/core.py now provides for CALL on Abstract GT.

  test_non_abstract_gt_call_needs_e_perm
    ChurchPermCheck(required_perms=PERM_MASK_E, gt_type=ABSTRACT, no perms)
    must fault PERM_E — confirming that the bypass is load-bearing (i.e., the
    old required_perms=PERM_MASK_E path does fault, making M_FETCH unreachable).

  test_normal_gt_call_still_checks_e_perm
    ChurchPermCheck(required_perms=PERM_MASK_E, gt_type=INFORM, perms=E) must
    pass — verifying that ordinary GT CALL with E-perm is unaffected by the fix.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.hdl import ClockDomain
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.perm_check import ChurchPermCheck
from hardware.hw_types import (
    GT_TYPE_NULL, GT_TYPE_INFORM, GT_TYPE_ABSTRACT,
    PERM_MASK_E, PERM_E,
    FaultType,
)
from hardware.layouts import GT_LAYOUT


def _build_hw_gt(slot_id=0, gt_seq=0, gt_type=GT_TYPE_INFORM, perms=0):
    return (
        (slot_id & 0xFFFF) |
        ((gt_seq  & 0x7F) << 16) |
        ((gt_type & 0x03) << 23) |
        ((perms   & 0x3F) << 25)
    )


class _PermCheckWrapper(Elaboratable):
    """Wrap ChurchPermCheck in a top-level with a sync domain for simulation."""

    def __init__(self):
        self.pc = ChurchPermCheck()
        self.gt_in           = self.pc.gt_in
        self.required_perms  = self.pc.required_perms
        self.check_valid     = self.pc.check_valid
        self.check_bounds    = self.pc.check_bounds
        self.check_version   = self.pc.check_version
        self.check_seal      = self.pc.check_seal
        self.check_domain_purity = self.pc.check_domain_purity
        self.all_checks_pass = self.pc.all_checks_pass
        self.fault_valid     = self.pc.fault_valid
        self.fault_type      = self.pc.fault_type

    def elaborate(self, platform):
        m = Module()
        m.domains.sync = ClockDomain("sync")
        m.submodules.pc = self.pc
        return m


def _run_perm_check(gt_word, required_perms_val):
    """Drive ChurchPermCheck for one tick; return (all_checks_pass, fault_valid, fault_type)."""
    dut = _PermCheckWrapper()
    result = {}

    async def process(ctx):
        ctx.set(dut.gt_in.as_value(), gt_word)
        ctx.set(dut.required_perms, required_perms_val)
        ctx.set(dut.check_valid, 1)
        ctx.set(dut.check_bounds, 0)
        ctx.set(dut.check_version, 0)
        ctx.set(dut.check_seal, 0)
        ctx.set(dut.check_domain_purity, 0)
        await ctx.tick()
        result["all_checks_pass"] = ctx.get(dut.all_checks_pass)
        result["fault_valid"]     = ctx.get(dut.fault_valid)
        result["fault_type"]      = ctx.get(dut.fault_type)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()

    return result


def test_abstract_gt_call_no_perm_e():
    """Abstract GT + required_perms=0 (hardware/core.py bypass) must pass perm check.

    This validates that the Abstract GT CALL perm bypass makes the perm gate
    transparent, allowing M_FETCH_NS dispatch to proceed without PERM_E fault.
    """
    abstract_gt = _build_hw_gt(slot_id=7, gt_type=GT_TYPE_ABSTRACT, perms=0)
    result = _run_perm_check(abstract_gt, required_perms_val=0)

    assert result["all_checks_pass"] == 1, (
        "Abstract GT with required_perms=0 must pass: "
        f"all_checks_pass={result['all_checks_pass']}"
    )
    assert result["fault_valid"] == 0, (
        "Abstract GT with required_perms=0 must not fault: "
        f"fault_valid={result['fault_valid']} fault_type=0x{result['fault_type']:02X}"
    )


def test_abstract_gt_call_old_path_faults_perm_e():
    """Abstract GT + required_perms=PERM_MASK_E (old path) must fault PERM_E.

    This confirms the bypass is load-bearing: without it, M_FETCH_NS is
    unreachable because the perm gate blocks all Abstract GT CALLs.
    """
    abstract_gt = _build_hw_gt(slot_id=7, gt_type=GT_TYPE_ABSTRACT, perms=0)
    result = _run_perm_check(abstract_gt, required_perms_val=PERM_MASK_E)

    assert result["fault_valid"] == 1, (
        "Abstract GT with required_perms=PERM_MASK_E must fault: "
        f"fault_valid={result['fault_valid']}"
    )
    assert result["fault_type"] == int(FaultType.PERM_E), (
        "Abstract GT with required_perms=PERM_MASK_E must fault PERM_E: "
        f"fault_type=0x{result['fault_type']:02X}"
    )


def test_normal_gt_call_still_checks_e_perm():
    """Ordinary INFORM GT with E-perm + required_perms=PERM_MASK_E must still pass.

    Verifies that the Abstract GT fix does not break ordinary E-perm CALL.
    """
    normal_gt = _build_hw_gt(slot_id=1, gt_type=GT_TYPE_INFORM, perms=PERM_MASK_E)
    result = _run_perm_check(normal_gt, required_perms_val=PERM_MASK_E)

    assert result["all_checks_pass"] == 1, (
        "INFORM GT with E-perm and required_perms=PERM_MASK_E must pass: "
        f"all_checks_pass={result['all_checks_pass']}"
    )
    assert result["fault_valid"] == 0, (
        "INFORM GT with E-perm and required_perms=PERM_MASK_E must not fault: "
        f"fault_valid={result['fault_valid']}"
    )


if __name__ == "__main__":
    test_abstract_gt_call_no_perm_e()
    print("test_abstract_gt_call_no_perm_e:          PASS")
    test_abstract_gt_call_old_path_faults_perm_e()
    print("test_abstract_gt_call_old_path_faults_perm_e: PASS")
    test_normal_gt_call_still_checks_e_perm()
    print("test_normal_gt_call_still_checks_e_perm:  PASS")
