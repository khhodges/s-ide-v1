"""Diagnostic: Full ChurchCore wired to SPRAM/BootROM but IDLE (no boot).
Tests whether the core logic itself crashes the RP2040, even without booting.
"""

from amaranth import *
from .uart_tx import DebugPrinter
from .core import ChurchCore
from .boot_rom import BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST
from .pico_ice import ICE40SPRAM, ICE40RGBLED


class UartTestTop(Elaboratable):
    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud
        self.uart_tx = Signal(init=1)
        self.led_r = Signal()
        self.led_g = Signal()
        self.led_b = Signal()
        self.push_button = Signal()
        self.uart_rx = Signal()

    def elaborate(self, platform):
        m = Module()

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug
        m.d.comb += self.uart_tx.eq(debug.tx)

        rgb = ICE40RGBLED()
        m.submodules.rgb = rgb

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        spram = ICE40SPRAM()
        m.submodules.spram = spram

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:11]),
            core.imem_data.eq(boot_rom.data),
        ]

        m.d.comb += spram.addr.eq(core.dmem_addr[2:16])
        m.d.comb += core.dmem_rd_data.eq(spram.rd_data)
        m.d.comb += [
            core.ns_rd_data.eq(Cat(spram.rd_data, C(0, 64))),
            core.clist_rd_data.eq(spram.rd_data),
        ]
        m.d.comb += [
            spram.wr_data.eq(core.dmem_wr_data),
            spram.wr_en.eq(core.dmem_wr_en),
        ]

        m.d.comb += core.boot_start.eq(0)
        m.d.comb += core.imem_valid.eq(0)
        m.d.comb += core.gc_start.eq(0)

        counter = Signal(32, init=0)
        delay_ctr = Signal(24)
        heartbeat = Signal()

        with m.FSM(name="diag_fsm"):
            with m.State("DELAY"):
                m.d.sync += delay_ctr.eq(delay_ctr + 1)
                with m.If(delay_ctr == (self.clk_freq // 4) - 1):
                    m.d.sync += [delay_ctr.eq(0), heartbeat.eq(~heartbeat)]
                    m.next = "SEND_HEX"

            with m.State("SEND_HEX"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(Cat(core.boot_state, core.fault_valid,
                                          core.fault, core.boot_complete,
                                          counter[:24])),
                        debug.send.eq(1),
                    ]
                    m.d.sync += counter.eq(counter + 1)
                    m.next = "WAIT_DONE"

            with m.State("WAIT_DONE"):
                with m.If(~debug.busy):
                    m.next = "DELAY"

        m.d.comb += [
            rgb.r.eq(core.fault_valid),
            rgb.g.eq(heartbeat),
            rgb.b.eq(0),
        ]
        m.d.comb += [
            self.led_r.eq(core.fault_valid),
            self.led_g.eq(heartbeat),
            self.led_b.eq(0),
        ]

        return m
