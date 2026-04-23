"""Hardware (Amaranth) tests for Abstract GT detection in DREAD, DWRITE, and mLoad.

Task #430: Verify that gt_type=0b11 (ABSTRACT) causes the correct INVALID_OP
fault in each Turing-domain data-access unit, preventing accidental lump loads
or memory bus traffic to the Abstract Manager address space.

test_dread_abstract_gt_faults_invalid_op
  ChurchDRead on a CR holding an Abstract GT must fault INVALID_OP, not PERM_R.

test_dwrite_abstract_gt_faults_invalid_op
  ChurchDWrite on a CR holding an Abstract GT must fault INVALID_OP, not PERM_W.

test_mload_abstract_gt_in_clist_faults_invalid_op
  ChurchMLoad reading a c-list slot that contains an Abstract GT must fault
  INVALID_OP at FETCH_GT, before touching the NS table.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.dread import ChurchDRead
from hardware.dwrite import ChurchDWrite
from hardware.mload import ChurchMLoad
from hardware.hw_types import (
    GT_TYPE_NULL, GT_TYPE_INFORM, GT_TYPE_ABSTRACT,
    PERM_MASK_R, PERM_MASK_W, PERM_MASK_L,
    FaultType,
)
from hardware.layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT

MAX_TICKS = 50


def _build_hw_gt(slot_id=0, gt_seq=0, gt_type=GT_TYPE_INFORM, perms=0, b_flag=0):
    """Assemble a 32-bit GT word using the hardware GT_LAYOUT bit positions.

    Layout (hardware/layouts.py GT_LAYOUT):
      [15:0]  = slot_id   [22:16] = gt_seq   [24:23] = gt_type
      [30:25] = perms     [31]    = b_flag
    """
    return (
        (slot_id & 0xFFFF) |
        ((gt_seq  & 0x7F) << 16) |
        ((gt_type & 0x03) << 23) |
        ((perms   & 0x3F) << 25) |
        ((b_flag  & 0x01) << 31)
    )


def _build_abstract_hw_gt(ab_type=0, r=1, w=1, gt_seq=0, ab_data=0):
    """Build an Abstract GT word (type=0b11) in the hardware GT_LAYOUT format.

    Layout mirrors boot_image.create_abstract_gt():
      [31:27]=ab_type  [26]=R  [25]=W  [24:23]=0b11  [22:16]=gt_seq  [15:0]=ab_data
    """
    return (
        ((ab_type & 0x1F) << 27) |
        ((r & 0x1)        << 26) |
        ((w & 0x1)        << 25) |
        (0b11             << 23) |
        ((gt_seq  & 0x7F) << 16) |
        (ab_data & 0xFFFF)
    )


def _pack_cap_reg(gt_word, location=0x1000, limit_words=63):
    """Pack a 96-bit CAP_REG_LAYOUT integer value.

    CAP_REG_LAYOUT (hardware/layouts.py):
      word0_gt[31:0]       = bits  31:0   (GT word)
      word1_location[31:0] = bits  63:32  (base byte address)
      word2_w2[31:0]       = bits  95:64  (limit / gt_seq / flags)
    """
    w2 = limit_words & 0x1FFFFF
    return (gt_word & 0xFFFFFFFF) | ((location & 0xFFFFFFFF) << 32) | (w2 << 64)


def test_dread_abstract_gt_faults_invalid_op():
    """ChurchDRead must fault INVALID_OP when the source CR holds an Abstract GT.

    The PERM_CHECK state is one clock cycle: fault is combinatorial during that
    cycle.  The testbench checks dut.fault every cycle starting from the first
    tick after start is asserted.
    """
    dut = ChurchDRead()

    abstract_gt   = _build_abstract_hw_gt(ab_type=0, r=1, w=1, ab_data=0x0101)
    cap_reg_value = _pack_cap_reg(abstract_gt, location=0x1000, limit_words=63)

    fault_seen    = False
    fault_type_v  = None

    async def process(ctx):
        nonlocal fault_seen, fault_type_v
        ctx.set(dut.cr_rd_data.as_value(), cap_reg_value)
        ctx.set(dut.cr_src, 1)
        ctx.set(dut.dr_dst, 2)
        ctx.set(dut.imm, 0)

        for _ in range(MAX_TICKS):
            ctx.set(dut.start, 1)
            await ctx.tick()
            ctx.set(dut.start, 0)
            if ctx.get(dut.fault):
                fault_seen   = True
                fault_type_v = ctx.get(dut.fault_type)
                break
            for __ in range(MAX_TICKS):
                await ctx.tick()
                if ctx.get(dut.fault):
                    fault_seen   = True
                    fault_type_v = ctx.get(dut.fault_type)
                    return
                if not ctx.get(dut.busy):
                    break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/dread_abstract_gt.vcd"):
        sim.run()

    assert fault_seen, "ChurchDRead on Abstract GT did not raise a fault"
    assert fault_type_v == FaultType.INVALID_OP, (
        f"Expected INVALID_OP ({FaultType.INVALID_OP}), got {fault_type_v}"
    )


def test_dwrite_abstract_gt_faults_invalid_op():
    """ChurchDWrite must fault INVALID_OP when the source CR holds an Abstract GT."""
    dut = ChurchDWrite()

    abstract_gt   = _build_abstract_hw_gt(ab_type=0, r=1, w=1, ab_data=0x0102)
    cap_reg_value = _pack_cap_reg(abstract_gt, location=0x1000, limit_words=63)

    fault_seen   = False
    fault_type_v = None

    async def process(ctx):
        nonlocal fault_seen, fault_type_v
        ctx.set(dut.cr_rd_data.as_value(), cap_reg_value)
        ctx.set(dut.cr_src, 1)
        ctx.set(dut.dr_src, 3)
        ctx.set(dut.imm, 0)

        for _ in range(MAX_TICKS):
            ctx.set(dut.start, 1)
            await ctx.tick()
            ctx.set(dut.start, 0)
            if ctx.get(dut.fault):
                fault_seen   = True
                fault_type_v = ctx.get(dut.fault_type)
                break
            for __ in range(MAX_TICKS):
                await ctx.tick()
                if ctx.get(dut.fault):
                    fault_seen   = True
                    fault_type_v = ctx.get(dut.fault_type)
                    return
                if not ctx.get(dut.busy):
                    break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/dwrite_abstract_gt.vcd"):
        sim.run()

    assert fault_seen, "ChurchDWrite on Abstract GT did not raise a fault"
    assert fault_type_v == FaultType.INVALID_OP, (
        f"Expected INVALID_OP ({FaultType.INVALID_OP}), got {fault_type_v}"
    )


def test_mload_abstract_gt_in_clist_faults_invalid_op():
    """ChurchMLoad must fault INVALID_OP when the c-list slot holds an Abstract GT.

    The c-list capability is loaded from CR with gt_type=INFORM and L-perm.
    The c-list slot itself contains an Abstract GT word.  ChurchMLoad must
    detect gt_type=0b11 at FETCH_GT and fault with INVALID_OP rather than
    proceeding to the NS table lookup.
    """
    dut = ChurchMLoad()

    NS_BASE    = 0x0000
    CLIST_BASE = 0x2000
    NS_LIMIT   = 63
    CLIST_LIMIT = 63

    src_gt_word = _build_hw_gt(slot_id=7, gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L)
    src_cap_reg = _pack_cap_reg(src_gt_word, location=CLIST_BASE, limit_words=CLIST_LIMIT)

    ns_gt_word  = _build_hw_gt(slot_id=0, gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L)
    ns_cap_reg  = _pack_cap_reg(ns_gt_word, location=NS_BASE, limit_words=NS_LIMIT)

    abstract_clist_gt = _build_abstract_hw_gt(ab_type=0, r=1, w=1, ab_data=0x0101)

    fault_seen   = False
    fault_type_v = None

    async def process(ctx):
        nonlocal fault_seen, fault_type_v
        ctx.set(dut.cr15_namespace.as_value(), ns_cap_reg)
        ctx.set(dut.cr_rd_data.as_value(), src_cap_reg)
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        await ctx.tick()

        ctx.set(dut.sub_start, 1)
        ctx.set(dut.sub_cr_src, 6)
        ctx.set(dut.sub_cr_dst, 7)
        ctx.set(dut.sub_index, 0)
        ctx.set(dut.sub_direct, 0)
        ctx.set(dut.sub_m_elevated, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)

        for _ in range(MAX_TICKS):
            await ctx.tick()
            if ctx.get(dut.sub_fault):
                fault_seen   = True
                fault_type_v = ctx.get(dut.sub_fault_type)
                break
            if ctx.get(dut.sub_done):
                break
            if ctx.get(dut.mem_rd_en):
                ctx.set(dut.mem_rd_data, abstract_clist_gt)
                ctx.set(dut.mem_rd_valid, 1)
                await ctx.tick()
                ctx.set(dut.mem_rd_valid, 0)
                if ctx.get(dut.sub_fault):
                    fault_seen   = True
                    fault_type_v = ctx.get(dut.sub_fault_type)
                break

        for _ in range(MAX_TICKS):
            await ctx.tick()
            if ctx.get(dut.sub_fault):
                fault_seen   = True
                fault_type_v = ctx.get(dut.sub_fault_type)
                break
            if ctx.get(dut.sub_done):
                break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/mload_abstract_gt.vcd"):
        sim.run()

    assert fault_seen, "ChurchMLoad did not fault on Abstract GT in c-list slot"
    assert fault_type_v == FaultType.INVALID_OP, (
        f"Expected INVALID_OP ({FaultType.INVALID_OP}), got {fault_type_v}"
    )
