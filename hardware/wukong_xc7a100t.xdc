## QMTECH Wukong XC7A100T — Church Machine LED Flash Constraints
## Device: xc7a100tfgg676-1   (Artix-7, Speed Grade -1)
## Source:  QMTECH Wukong v1.1 schematic (verified pin assignments)
##
## Apply with: add_files -fileset constrs_1 wukong_xc7a100t.xdc

## ── System clock (50 MHz oscillator) ──────────────────────────────────────
set_property -dict { PACKAGE_PIN H4  IOSTANDARD LVCMOS33 } [get_ports { clk }];
create_clock -add -name sys_clk_pin -period 20.00 -waveform {0 10} [get_ports { clk }];

## ── User LEDs (active HIGH) ───────────────────────────────────────────────
## led[0] — D1 (J4):  solid ON while booting, then blinks ~1 Hz after boot
## led[1] — D2 (H6):  1 Hz heartbeat while booting, solid ON if fault latches
set_property -dict { PACKAGE_PIN J4  IOSTANDARD LVCMOS33 } [get_ports { led0 }];
set_property -dict { PACKAGE_PIN H6  IOSTANDARD LVCMOS33 } [get_ports { led1 }];

## ── Reset button (active LOW — reserved, constrained but not yet connected) ─
set_property -dict { PACKAGE_PIN T2  IOSTANDARD LVCMOS33 } [get_ports { rst_n }];

## ── Bitstream / configuration settings ────────────────────────────────────
set_property CFGBVS        VCCO [current_design];
set_property CONFIG_VOLTAGE 3.3  [current_design];

## ── False paths (async inputs to sync domain) ─────────────────────────────
set_false_path -from [get_ports { rst_n }];
