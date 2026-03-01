"""Minimal UART test for pico-ice — sends 'H' repeatedly, blinks green LED."""

from amaranth import *


class UartTest(Elaboratable):
    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud

        self.uart_tx = Signal(init=1)
        self.uart_rx = Signal()
        self.push_button = Signal(init=1)
        self.led_r = Signal()
        self.led_g = Signal()
        self.led_b = Signal()

    def elaborate(self, platform):
        m = Module()

        divisor = int(self.clk_freq // self.baud)

        tx_counter = Signal(range(divisor + 1))
        tx_bit_pos = Signal(4)
        tx_shift = Signal(10)
        tx_state = Signal(2)
        tx_busy = Signal()

        ST_IDLE = 0
        ST_TX = 1
        ST_DONE = 2

        with m.Switch(tx_state):
            with m.Case(ST_IDLE):
                m.d.comb += [self.uart_tx.eq(1), tx_busy.eq(0)]
            with m.Case(ST_TX):
                m.d.comb += [self.uart_tx.eq(tx_shift[0]), tx_busy.eq(1)]
                with m.If(tx_counter == divisor - 1):
                    m.d.sync += [
                        tx_counter.eq(0),
                        tx_shift.eq(tx_shift >> 1),
                        tx_bit_pos.eq(tx_bit_pos + 1),
                    ]
                    with m.If(tx_bit_pos == 9):
                        m.d.sync += tx_state.eq(ST_DONE)
                with m.Else():
                    m.d.sync += tx_counter.eq(tx_counter + 1)
            with m.Case(ST_DONE):
                m.d.comb += [self.uart_tx.eq(1), tx_busy.eq(0)]
                m.d.sync += tx_state.eq(ST_IDLE)

        delay = Signal(24)
        m.d.sync += delay.eq(delay + 1)

        blink = Signal()
        m.d.comb += blink.eq(delay[23])
        m.d.comb += self.led_g.eq(blink)
        m.d.comb += self.led_r.eq(0)
        m.d.comb += self.led_b.eq(0)

        send_trigger = Signal()
        prev_blink = Signal()
        m.d.sync += prev_blink.eq(blink)
        m.d.comb += send_trigger.eq(blink & ~prev_blink)

        with m.If(send_trigger & ~tx_busy):
            m.d.sync += [
                tx_shift.eq(Cat(C(0, 1), C(ord('H'), 8), C(1, 1))),
                tx_counter.eq(0),
                tx_bit_pos.eq(0),
                tx_state.eq(ST_TX),
            ]

        return m
