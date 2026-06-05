# church_soc_cm.sdc — Timing constraints for Ti60F225 combined SoC+CM bitstream
#
# 50 MHz crystal at GPIOL_P_18.
# create_clock is required for efx_pnr to auto-promote the clk signal onto
# the global CLKMUX clock network.  Without it, P&R treats 'clk' as a
# regular high-fanout signal and routes it through local fabric only, which
# does not reach all quadrants → Sapphire SoC ClockDomainGenerator stalls →
# io_systemReset never deasserts → LED0 stays OFF and UART is silent.

# PLL_TL0: 25 MHz → VCO 500 MHz → 50 MHz output (period 20 ns).
# The Sapphire SoC's internal PLL doubles this to 100 MHz for the CPU.
# CLOCKDIV=53 in firmware → 230400 baud at 100 MHz CPU clock.
create_clock -name clk -period 20.0 [get_nets clk]
