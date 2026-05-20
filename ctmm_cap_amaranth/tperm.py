from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class CMCapTperm(Elaboratable):
    def __init__(self):
        self.tperm_start = Signal()
        self.cr_target = Signal(4)   # CRd — target CR to attenuate (or compare for EXACT)
        self.cr_src    = Signal(4)   # CRs — reference CR for EXACT mode
        self.preset = Signal(4)

        # FRAME preset input: 1 if a real return frame exists on the call stack
        # (i.e. RETURN would not underflow into the boot sentinel).
        self.stack_has_frame = Signal()

        self.tperm_busy = Signal()
        self.tperm_complete = Signal()
        self.tperm_fault = Signal()
        self.fault_type = Signal(4)

        # Z-flag result latched on the cycle before COMPLETE.
        # Semantics by path:
        #   permission preset (APPLY)  → 1 (can_only_reduce was true to reach APPLY)
        #   EXACT (CHECK_EXACT)        → 1 (word0s matched; mismatch takes FAULT path)
        #   FRAME (CHECK_FRAME)        → stack_has_frame (1 if real return frame exists)
        # Valid only when tperm_complete is high.
        self.tperm_z_result = Signal()

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

    def elaborate(self, platform):
        m = Module()

        target_cap = Signal(CAP_REG_LAYOUT)
        target_view = View(CAP_REG_LAYOUT, target_cap)
        target_gt = View(GT_LAYOUT, target_view.word0_gt)

        ref_cap = Signal(CAP_REG_LAYOUT)           # latched for EXACT comparison
        ref_view = View(CAP_REG_LAYOUT, ref_cap)

        preset_reg = Signal(4)
        fault_flag = Signal()
        fault_latched = Signal(4)
        z_result_reg = Signal()   # latched Z value, forwarded to tperm_z_result on COMPLETE

        new_perms = Signal(6)
        is_reserved = Signal()
        is_exact = Signal()   # preset == TpermPreset.EXACT
        is_frame  = Signal()  # preset == TpermPreset.FRAME

        # Decode target GT dom+perm[2:0] → 6-bit logical perms.
        target_logical = Signal(6)
        m.d.comb += target_logical.eq(
            Mux(target_gt.dom,
                Cat(C(0, 3), target_gt.perm),   # Church: perm → [5:3]
                Cat(target_gt.perm, C(0, 3))    # Turing: perm → [2:0]
            )
        )

        with m.Switch(preset_reg):
            with m.Case(TpermPreset.CLEAR):
                m.d.comb += new_perms.eq(0)
            with m.Case(TpermPreset.R):
                m.d.comb += new_perms.eq(PERM_MASK_R)
            with m.Case(TpermPreset.RW):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W)
            with m.Case(TpermPreset.X):
                m.d.comb += new_perms.eq(PERM_MASK_X)
            with m.Case(TpermPreset.RX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_X)
            with m.Case(TpermPreset.RWX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
            with m.Case(TpermPreset.L):
                m.d.comb += new_perms.eq(PERM_MASK_L)
            with m.Case(TpermPreset.S):
                m.d.comb += new_perms.eq(PERM_MASK_S)
            with m.Case(TpermPreset.E):
                m.d.comb += new_perms.eq(PERM_MASK_E)
            with m.Case(TpermPreset.LS):
                m.d.comb += new_perms.eq(PERM_MASK_L | PERM_MASK_S)
            with m.Case(TpermPreset.EXACT):
                m.d.comb += [new_perms.eq(0), is_exact.eq(1)]
            with m.Case(TpermPreset.FRAME):
                m.d.comb += [new_perms.eq(0), is_frame.eq(1)]
            with m.Default():
                m.d.comb += [new_perms.eq(0), is_reserved.eq(1)]

        can_only_reduce = Signal()
        m.d.comb += can_only_reduce.eq((new_perms & target_logical) == new_perms)

        with m.FSM(name="tperm") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.tperm_start):
                    m.d.sync += preset_reg.eq(self.preset)
                    m.next = "READ_CR"

            with m.State("READ_CR"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_target)
                m.d.sync += target_cap.eq(self.cr_rd_data)
                m.next = "CHECK"

            with m.State("CHECK"):
                with m.If(is_reserved):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.TPERM_RSV)]
                    m.next = "FAULT"
                with m.Elif(is_exact):
                    m.next = "READ_CR2"
                with m.Elif(is_frame):
                    m.next = "CHECK_FRAME"
                with m.Elif(~can_only_reduce):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.DOMAIN_PURITY)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "APPLY"

            with m.State("CHECK_FRAME"):
                # FRAME: Z=1 if a real return frame exists (RETURN would not underflow).
                # stack_has_frame is driven externally: 1 when STO < sp_max.
                # No CR is read or written; cr_target is ignored.
                m.d.sync += z_result_reg.eq(self.stack_has_frame)
                m.next = "COMPLETE"

            with m.State("READ_CR2"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.d.sync += ref_cap.eq(self.cr_rd_data)
                m.next = "CHECK_EXACT"

            with m.State("CHECK_EXACT"):
                with m.If(target_view.word0_gt != ref_view.word0_gt):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.BIND)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += z_result_reg.eq(1)
                    m.next = "COMPLETE"

            with m.State("APPLY"):
                # Reached only when can_only_reduce=1 → Z=1.
                m.d.sync += z_result_reg.eq(1)
                # Encode result logical perms back to dom+perm format.
                result_logical = Signal(6)
                result_dom = Signal()
                result_perm3 = Signal(3)
                m.d.comb += result_logical.eq(new_perms & target_logical)
                m.d.comb += result_dom.eq(
                    result_logical[PERM_L] | result_logical[PERM_S] | result_logical[PERM_E]
                )
                m.d.comb += result_perm3.eq(
                    Mux(result_dom, result_logical[3:6], result_logical[0:3])
                )

                result_cap = Signal(CAP_REG_LAYOUT)
                result_view = View(CAP_REG_LAYOUT, result_cap)
                result_gt = View(GT_LAYOUT, result_view.word0_gt)
                m.d.comb += [
                    result_cap.eq(target_cap),
                    result_gt.dom.eq(result_dom),
                    result_gt.perm.eq(result_perm3),
                    self.cr_wr_addr.eq(self.cr_target),
                    self.cr_wr_data.eq(result_cap),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.tperm_busy.eq(~fsm.ongoing("IDLE")),
            self.tperm_complete.eq(fsm.ongoing("COMPLETE")),
            self.tperm_fault.eq(fault_flag),
            self.fault_type.eq(fault_latched),
            self.tperm_z_result.eq(z_result_reg),
        ]

        return m
