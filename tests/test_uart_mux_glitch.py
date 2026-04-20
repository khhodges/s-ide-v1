"""
Simulation test: outform UART TX mux cannot glitch mid-byte (task #273).

The outform mux in tang_nano_20k.py guards uart_tx with:
    outform_uart_active = outform_busy | outform_uart.busy
    uart_tx = outform_uart.tx  if outform_uart_active else debug.tx

The critical boundary condition is when outform_busy drops to 0 (the FSM
has finished) but outform_uart.busy is still 1 (the UART is still clocking
out the last bit of the final byte).  Without the `| outform_uart.busy` term
the mux would switch mid-byte to debug.tx, corrupting the stream.

This test exercises the mux in isolation using a minimal synthetic harness
that reproduces the exact guard formula, then verifies all four combinations
of (outform_busy, outform_uart_busy) produce the correct uart_tx selection.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from amaranth import *
from amaranth.sim import Simulator


# ---------------------------------------------------------------------------
# Minimal harness — reproduces the mux formula from tang_nano_20k.py verbatim
# ---------------------------------------------------------------------------

class _UartMuxHarness(Elaboratable):
    """Combinatorial UART TX mux guard, isolated for unit testing.

    Implements:
        active  = outform_busy | outform_uart_busy
        uart_tx = outform_uart_tx if active else debug_tx
    """

    def __init__(self):
        self.outform_busy      = Signal()
        self.outform_uart_busy = Signal()
        self.outform_uart_tx   = Signal()
        self.debug_tx          = Signal()
        self.uart_tx           = Signal()

    def elaborate(self, platform):
        m = Module()
        m.domains += ClockDomain("sync")   # required by Simulator even for comb-only designs
        active = Signal(name="outform_uart_active")
        m.d.comb += active.eq(self.outform_busy | self.outform_uart_busy)
        with m.If(active):
            m.d.comb += self.uart_tx.eq(self.outform_uart_tx)
        with m.Else():
            m.d.comb += self.uart_tx.eq(self.debug_tx)
        return m


# ---------------------------------------------------------------------------
# Helper: run one combinatorial scenario
# ---------------------------------------------------------------------------

def _check_mux(outform_busy, outform_uart_busy,
               outform_uart_tx, debug_tx,
               expected_uart_tx):
    """Simulate one input combination and assert uart_tx == expected."""
    dut = _UartMuxHarness()
    result = {}

    async def testbench(ctx):
        ctx.set(dut.outform_busy,      outform_busy)
        ctx.set(dut.outform_uart_busy, outform_uart_busy)
        ctx.set(dut.outform_uart_tx,   outform_uart_tx)
        ctx.set(dut.debug_tx,          debug_tx)
        await ctx.tick()
        result["uart_tx"] = ctx.get(dut.uart_tx)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    label = (
        f"outform_busy={outform_busy} outform_uart_busy={outform_uart_busy} "
        f"outform_uart_tx={outform_uart_tx} debug_tx={debug_tx}"
    )
    assert result["uart_tx"] == expected_uart_tx, (
        f"uart_tx={result['uart_tx']} want {expected_uart_tx}  [{label}]"
    )


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

def test_outform_uart_mux_no_glitch_on_busy_flag_drop():
    """uart_tx follows outform_uart_tx whenever outform_uart_busy=1.

    Case A: outform_busy=1 and outform_uart_busy=1 — normal active transmission.
    Case B: outform_busy=0 and outform_uart_busy=1 — FSM finished but UART still
            clocking the last bit.  This is the glitch-prevention case: without
            the | outform_uart.busy guard the mux would switch to debug_tx here.
    Case C: outform_busy=0 and outform_uart_busy=0 — both idle, debug takes over.
    Case D: outform_busy=1 and outform_uart_busy=0 — FSM active but uart idle
            (waiting for next byte); outform_uart_tx still selected.

    For all cases where at least one of {outform_busy, outform_uart_busy} is 1,
    uart_tx must equal outform_uart_tx (set to 1); when both are 0, uart_tx must
    equal debug_tx (set to 0, with outform_uart_tx=1 to make the distinction clear).
    """
    # Case A — both high → outform_uart_tx
    _check_mux(outform_busy=1, outform_uart_busy=1,
               outform_uart_tx=1, debug_tx=0,
               expected_uart_tx=1)

    # Case B — FSM done, UART still sending last bit → must still use outform_uart_tx
    _check_mux(outform_busy=0, outform_uart_busy=1,
               outform_uart_tx=1, debug_tx=0,
               expected_uart_tx=1)

    # Case C — both idle → debug_tx (note outform_uart_tx=1 to make case visible)
    _check_mux(outform_busy=0, outform_uart_busy=0,
               outform_uart_tx=1, debug_tx=0,
               expected_uart_tx=0)

    # Case D — FSM active, uart between bytes → outform_uart_tx
    _check_mux(outform_busy=1, outform_uart_busy=0,
               outform_uart_tx=1, debug_tx=0,
               expected_uart_tx=1)

    print("PASS: outform UART mux guard holds across all four boundary cases.")
