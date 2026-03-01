"""Diagnostic UART test for pico-ice — includes full Church Machine
hardware but bypasses the debug FSM with a simple counter-based UART output.
Tests whether UART works when all Church Machine components are present.
"""

from amaranth import *
from .uart_tx import UartTx, DebugPrinter
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
        m.d.comb += core.imem_valid.eq(0)
        m.d.comb += core.boot_start.eq(0)
        m.d.comb += core.gc_start.eq(0)

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom
        m.d.comb += boot_rom.addr.eq(0)

        spram = ICE40SPRAM()
        m.submodules.spram = spram
        m.d.comb += [spram.addr.eq(0), spram.wr_data.eq(0), spram.wr_en.eq(0)]

        m.d.comb += core.dmem_rd_data.eq(0)
        m.d.comb += core.imem_data.eq(0)
        m.d.comb += core.ns_rd_data.eq(0)
        m.d.comb += core.clist_rd_data.eq(0)

        counter = Signal(8, init=0)
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
                        debug.data.eq(counter),
                        debug.send.eq(1),
                    ]
                    m.d.sync += counter.eq(counter + 1)
                    m.next = "WAIT_DONE"

            with m.State("WAIT_DONE"):
                with m.If(~debug.busy):
                    m.next = "DELAY"

        m.d.comb += [
            rgb.r.eq(0),
            rgb.g.eq(heartbeat),
            rgb.b.eq(0),
        ]

        m.d.comb += [
            self.led_r.eq(0),
            self.led_g.eq(heartbeat),
            self.led_b.eq(0),
        ]

        return m
