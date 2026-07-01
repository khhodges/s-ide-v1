from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import COND_FLAGS_LAYOUT


class CMCapDecoder(Elaboratable):
    def __init__(self):
        self.instruction = Signal(32)
        self.instr_valid = Signal()

        self.ctmm_opcode = Signal(7)
        self.rd = Signal(5)
        self.rs1 = Signal(5)
        self.rs2 = Signal(5)
        self.funct3 = Signal(3)
        self.funct7 = Signal(7)
        self.imm_i = Signal(signed(12))
        self.imm_s = Signal(signed(12))
        self.imm_b = Signal(signed(13))
        self.imm_u = Signal(signed(32))
        self.imm_j = Signal(signed(21))

        self.is_ctmm_op = Signal()
        self.is_church_op = Signal()
        self.church_op = Signal(4)    # 4-bit: bit[3]=instr[11](rd[4]); bits[2:0]=funct3
        self.cr_dst = Signal(4)
        self.cr_src = Signal(4)
        self.cap_index = Signal(12)
        self.tperm_preset = Signal(4)
        self.call_mask = Signal(12)
        self.switch_target = Signal(4)

        # ELOADCALL / XLOADLAMBDA decode outputs (mirrors hardware/decoder.py field names)
        self.is_eloadcall       = Signal()
        self.is_xloadlambda     = Signal()
        # ELOADCALL uses R-type encoding to carry a full 7-bit method index:
        #   funct7[6:0] (instr[31:25]) = method_index  — matches native decoder's 7-bit field
        #   rs2[4:0]    (instr[24:20]) = c-list row     — 5 bits (0-31 rows)
        # This replaces the former I-type split (imm12[11:8] = 4-bit method_index, max 16
        # methods) which silently truncated abstractions with more than 16 method entries.
        self.eloadcall_row          = Signal(5)   # rs2   = instr[24:20] — c-list row (0-31)
        self.eloadcall_method_index = Signal(7)   # funct7 = instr[31:25] — method index (0-127)

        self.fault = Signal(4)
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        instr = self.instruction

        m.d.comb += [
            self.ctmm_opcode.eq(instr[0:7]),
            self.rd.eq(instr[7:12]),
            self.funct3.eq(instr[12:15]),
            self.rs1.eq(instr[15:20]),
            self.rs2.eq(instr[20:25]),
            self.funct7.eq(instr[25:32]),
        ]

        m.d.comb += self.imm_i.eq(instr[20:32])
        m.d.comb += self.imm_s.eq(Cat(instr[7:12], instr[25:32]))
        m.d.comb += self.imm_b.eq(Cat(
            Const(0, 1),
            instr[8:12],
            instr[25:31],
            instr[7],
            instr[31],
        ))
        m.d.comb += self.imm_u.eq(Cat(Const(0, 12), instr[12:32]))
        m.d.comb += self.imm_j.eq(Cat(
            Const(0, 1),
            instr[21:31],
            instr[20],
            instr[12:20],
            instr[31],
        ))

        opcode = self.ctmm_opcode

        is_standard_ctmm = Signal()
        m.d.comb += is_standard_ctmm.eq(
            (opcode == CMOpcode.LUI) |
            (opcode == CMOpcode.AUIPC) |
            (opcode == CMOpcode.JAL) |
            (opcode == CMOpcode.JALR) |
            (opcode == CMOpcode.BRANCH) |
            (opcode == CMOpcode.LOAD) |
            (opcode == CMOpcode.STORE) |
            (opcode == CMOpcode.ARITHI) |
            (opcode == CMOpcode.ARITH) |
            (opcode == CMOpcode.FENCE) |
            (opcode == CMOpcode.SYSTEM)
        )

        is_custom0 = Signal()
        m.d.comb += is_custom0.eq(opcode == CHURCH_CUSTOM0)

        m.d.comb += [
            self.is_ctmm_op.eq(is_standard_ctmm & self.instr_valid),
            self.is_church_op.eq(is_custom0 & self.instr_valid),
        ]

        # Church opcode: funct3 [14:12] carries the lower 3 bits; rd[4] = instr[11]
        # carries bit 3.  Opcodes 0-7 (LOAD..LAMBDA): instr[11]=0.
        # Opcodes 8-9 (ELOADCALL, XLOADLAMBDA): instr[11]=1, funct3=0 or 1 respectively.
        # cr_dst uses only instr[10:7] (4 bits), so instr[11] is free for this purpose.
        church_op_4b = Cat(instr[12:15], instr[11])

        m.d.comb += [
            self.church_op.eq(church_op_4b),
            self.cr_dst.eq(instr[7:11]),
            self.cr_src.eq(instr[15:19]),
            self.cap_index.eq(Cat(instr[20:25], instr[25:32])),
            self.tperm_preset.eq(instr[20:24]),   # TODO: field is 4 bits; B-modifier (bit 4 of 5-bit preset) is decoded by the assembler and simulator but is NOT synthesised to silicon — hardware ignores bit 4 until the preset field is widened to 5 bits in a future revision
            self.call_mask.eq(Cat(instr[20:25], instr[25:32])),
            self.switch_target.eq(instr[20:24]),
        ]

        # ELOADCALL / XLOADLAMBDA per-opcode decode signals
        m.d.comb += [
            self.is_eloadcall.eq(
                is_custom0 & self.instr_valid &
                (church_op_4b == ChurchOpcode.ELOADCALL)
            ),
            self.is_xloadlambda.eq(
                is_custom0 & self.instr_valid &
                (church_op_4b == ChurchOpcode.XLOADLAMBDA)
            ),
            # R-type decode for ELOADCALL:
            #   rs2[4:0]    = instr[24:20] → c-list row (5 bits, 0-31)
            #   funct7[6:0] = instr[31:25] → method index (7 bits, 0-127)
            # Matches the native decoder's 7-bit method_index field; eliminates
            # the former 4-bit I-type truncation that silently dropped methods > 15.
            self.eloadcall_row.eq(instr[20:25]),
            self.eloadcall_method_index.eq(instr[25:32]),
        ]

        m.d.comb += [
            self.fault_valid.eq(0),
            self.fault.eq(FaultType.NONE),
        ]

        with m.If(self.instr_valid):
            with m.If(~is_standard_ctmm & ~is_custom0):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault.eq(FaultType.INVALID_OP),
                ]

        return m
