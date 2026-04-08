# FPGA Resource Comparison: Full vs IoT Profile

## Target: Tang Nano 20K (GW2AR-LV18QN88C8/I7, 20,736 LUT4s, 27 MHz)

## Synthesis Results (Yosys synth_gowin)

| Cell Type | Full Profile | IoT Profile | Reduction |
|-----------|:---:|:---:|:---:|
| LUT4 | 4,713 | 3,435 | -27.1% |
| LUT3 | 1,496 | 702 | -53.1% |
| LUT2 | 841 | 661 | -21.4% |
| LUT1 | 819 | 932 | +13.8% |
| ALU | 1,455 | 1,218 | -16.3% |
| MUX2_LUT5 | 1,807 | 1,517 | -16.0% |
| MUX2_LUT6 | 576 | 546 | -5.2% |
| MUX2_LUT7 | 206 | 209 | +1.5% |
| MUX2_LUT8 | 66 | 59 | -10.6% |
| DFFRE | 2,799 | 1,916 | -31.5% |
| DFFE | 1,405 | 1,039 | -26.0% |
| DFF | 122 | 81 | -33.6% |
| DFFR | 23 | 23 | 0% |
| BRAM (SPX9) | 4 | 4 | 0% |
| BRAM (SDPX9B) | 1 | 1 | 0% |
| **Total Cells** | **16,380** | **12,376** | **-24.5%** |

## Key Metrics

| Metric | Full | IoT | Savings |
|--------|:---:|:---:|:---:|
| LUT4-equivalent (LUT4 + ALU) | 6,168 | 4,653 | -24.6% |
| GW2AR-18 LUT usage | 29.7% | 22.4% | -7.3pp |
| Total flip-flops | 4,349 | 3,059 | -29.7% |
| BRAM cells | 5 | 5 | 0% |
| Verilog file size | 1,545 KB | 904 KB | -41.5% |
| Verilog lines | 37,564 | 23,171 | -38.3% |
| Verilog modules | 36 | 22 | -38.9% |

## IoT Profile — Removed Units

| Unit | Purpose | FSM States | Status |
|------|---------|:---:|--------|
| ChurchGCUnit | Garbage collector (mark/sweep) | ~8 | Removed |
| ChurchLambda | Lambda closure creation | ~5 | Removed |
| ChurchChange | Thread context switch | ~8 | Removed |
| ChurchSwitch | Capability slot swap | ~8 | Removed |
| ChurchELoadCall | Fused load+call | ~6 | Removed |
| ChurchXLoadLambda | Fused load+lambda | ~6 | Removed |
| ChurchOutform | ZIP-compatible outform (~20 states) | ~20 | **Replaced** |
| ChurchOutformIoT | Lean tunnel-hunting outform (~9 states) | ~9 | **Added** |

## IoT Profile — Retained Units

- ChurchCore (with iot_profile guards)
- ChurchDecoder (excluded opcodes: LAMBDA, CHANGE, SWITCH, ELOADCALL, XLOADLAMBDA → FAULT_OPCODE)
- ChurchRegisters (full 16-CR + 16-DR register file)
- ChurchCall, ChurchReturn, ChurchLoad, ChurchSave
- ChurchTPerm, ChurchPermCheck
- ChurchCLoad, ChurchSharedMLoad (with NSGate + CRC-16)
- ChurchDRead, ChurchDWrite
- ChurchOutformIoT (lean 8-byte header, ~9 FSM states, CRC-32 preserved, tunnel hunting)
- BootRom, DebugPrinter, UartRx
- Full Turing ops: IADD, ISUB, SHL, SHR, BFEXT, BFINS, MCMP, BRANCH

## Headroom Analysis

| | Full | IoT |
|--|:---:|:---:|
| LUTs remaining | 14,568 (70.3%) | 16,083 (77.6%) |
| FFs remaining | ~16,387 (79.0%) | ~17,677 (85.3%) |
| Application headroom | Moderate | Generous |

The IoT profile frees ~1,515 additional LUTs and ~1,290 FFs compared to the full build, providing generous headroom for application-specific logic such as sensor interfaces, motor controllers, or custom protocol handlers.

## Build Commands

```bash
# Full profile
python -m hardware.gen_verilog build
yosys -p "read_verilog build/church_tang_nano_20k.v; synth_gowin -top top -json build/church_tang_nano_20k.json"
nextpnr-himbaechel --device GW2AR-LV18QN88C8/I7 --vopt family=GW2A-18C --vopt partname=GW2AR-LV18QN88C8/I7 --vopt cst=hardware/tang_nano_20k.cst --json build/church_tang_nano_20k.json

# IoT profile
python -m hardware.gen_verilog --iot build
yosys -p "read_verilog build/church_tang_nano_20k_iot.v; synth_gowin -top top -json build/church_tang_nano_20k_iot.json"
nextpnr-himbaechel --device GW2AR-LV18QN88C8/I7 --vopt family=GW2A-18C --vopt partname=GW2AR-LV18QN88C8/I7 --vopt cst=hardware/tang_nano_20k.cst --json build/church_tang_nano_20k_iot.json
```
