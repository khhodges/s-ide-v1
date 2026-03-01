"""Minimal UART test design for pico-ice — sends HELLO repeatedly.
No Church core, no boot ROM. Just a UART TX on pin 25 driving "HELLO\r\n" in a loop.
If this produces output on ttyACM1, the UART path works and the bug is in core/boot logic.
"""

from amaranth import *
from .uart_tx import UartTx


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

        uart = UartTx(self.clk_freq, self.baud)
        m.submodules.uart = uart
        m.d.comb += self.uart_tx.eq(uart.tx)

        MSG = Array([C(ord(c), 8) for c in "HELLO\r\n"])
        msg_idx = Signal(range(len(MSG) + 1))
        msg_byte = Signal(8)
        m.d.comb += msg_byte.eq(MSG[msg_idx])

        delay_ctr = Signal(24)
        heartbeat = Signal()

        with m.FSM(name="test_fsm"):
            with m.State("DELAY"):
                m.d.sync += delay_ctr.eq(delay_ctr + 1)
                with m.If(delay_ctr == (self.clk_freq // 2) - 1):
                    m.d.sync += [delay_ctr.eq(0), msg_idx.eq(0), heartbeat.eq(~heartbeat)]
                    m.next = "SEND"

            with m.State("SEND"):
                with m.If(~uart.busy):
                    with m.If(msg_idx < len(MSG)):
                        m.d.comb += [
                            uart.data.eq(msg_byte),
                            uart.start.eq(1),
                        ]
                        m.d.sync += msg_idx.eq(msg_idx + 1)
                    with m.Else():
                        m.next = "DELAY"

        m.d.comb += [
            self.led_g.eq(heartbeat),
            self.led_r.eq(0),
            self.led_b.eq(0),
        ]

        return m
