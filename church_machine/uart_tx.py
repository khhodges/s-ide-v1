from amaranth import *


class UartTx(Elaboratable):
    """Simple UART transmitter — 8N1, active-high idle.

    Uses binary-encoded state machine for reliable iCE40 initialization.
    State 0 = IDLE (safe: iCE40 FFs init to 0).
    """

    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud

        self.data = Signal(8)
        self.start = Signal()
        self.busy = Signal()
        self.done = Signal()
        self.tx = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        divisor = int(self.clk_freq // self.baud)

        counter = Signal(range(divisor + 1))
        bit_pos = Signal(4)
        shift_reg = Signal(10)

        ST_IDLE = 0
        ST_TRANSMIT = 1
        ST_DONE = 2
        state = Signal(2)

        with m.Switch(state):
            with m.Case(ST_IDLE):
                m.d.comb += [
                    self.tx.eq(1),
                    self.busy.eq(0),
                    self.done.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += [
                        shift_reg.eq(Cat(C(0, 1), self.data, C(1, 1))),
                        counter.eq(0),
                        bit_pos.eq(0),
                        state.eq(ST_TRANSMIT),
                    ]

            with m.Case(ST_TRANSMIT):
                m.d.comb += [
                    self.tx.eq(shift_reg[0]),
                    self.busy.eq(1),
                    self.done.eq(0),
                ]
                with m.If(counter == divisor - 1):
                    m.d.sync += [
                        counter.eq(0),
                        shift_reg.eq(shift_reg >> 1),
                        bit_pos.eq(bit_pos + 1),
                    ]
                    with m.If(bit_pos == 9):
                        m.d.sync += state.eq(ST_DONE)
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

            with m.Case(ST_DONE):
                m.d.comb += [
                    self.tx.eq(1),
                    self.busy.eq(0),
                    self.done.eq(1),
                ]
                m.d.sync += state.eq(ST_IDLE)

        return m


class DebugPrinter(Elaboratable):
    """Sends hex-encoded register dumps over UART.

    Uses binary-encoded state machine and Array-based hex lookup
    for reliable iCE40 initialization (all FFs start at 0).
    """

    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud

        self.data = Signal(32)
        self.send = Signal()
        self.send_byte = Signal()
        self.byte_data = Signal(8)
        self.busy = Signal()
        self.tx = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        uart = UartTx(self.clk_freq, self.baud)
        m.submodules.uart = uart
        m.d.comb += self.tx.eq(uart.tx)

        HEX_CHARS = Array([C(ord(c), 8) for c in "0123456789ABCDEF"])

        data_reg = Signal(32)
        nibble_idx = Signal(4)
        byte_reg = Signal(8)
        hex_byte = Signal(8)

        nibble_val = Signal(4)
        m.d.comb += nibble_val.eq((data_reg >> (nibble_idx << 2)) & 0xF)
        m.d.comb += hex_byte.eq(HEX_CHARS[nibble_val])

        ST_IDLE      = 0
        ST_HEX_SEND  = 1
        ST_HEX_WAIT  = 2
        ST_SEND_NL   = 3
        ST_NL_WAIT   = 4
        ST_SEND_BYTE = 5
        ST_BYTE_WAIT = 6
        state = Signal(3)

        with m.Switch(state):
            with m.Case(ST_IDLE):
                m.d.comb += self.busy.eq(0)
                with m.If(self.send):
                    m.d.sync += [
                        data_reg.eq(self.data),
                        nibble_idx.eq(7),
                        state.eq(ST_HEX_SEND),
                    ]
                with m.Elif(self.send_byte):
                    m.d.sync += [
                        byte_reg.eq(self.byte_data),
                        state.eq(ST_SEND_BYTE),
                    ]

            with m.Case(ST_HEX_SEND):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(hex_byte),
                        uart.start.eq(1),
                    ]
                    m.d.sync += state.eq(ST_HEX_WAIT)

            with m.Case(ST_HEX_WAIT):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    with m.If(nibble_idx == 0):
                        m.d.sync += state.eq(ST_SEND_NL)
                    with m.Else():
                        m.d.sync += [
                            nibble_idx.eq(nibble_idx - 1),
                            state.eq(ST_HEX_SEND),
                        ]

            with m.Case(ST_SEND_NL):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(0x0A),
                        uart.start.eq(1),
                    ]
                    m.d.sync += state.eq(ST_NL_WAIT)

            with m.Case(ST_NL_WAIT):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    m.d.sync += state.eq(ST_IDLE)

            with m.Case(ST_SEND_BYTE):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(byte_reg),
                        uart.start.eq(1),
                    ]
                    m.d.sync += state.eq(ST_BYTE_WAIT)

            with m.Case(ST_BYTE_WAIT):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    m.d.sync += state.eq(ST_IDLE)

        return m
