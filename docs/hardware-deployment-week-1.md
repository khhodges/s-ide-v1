# Hardware Deployment Plan — Week 1 (Tang Nano 20K FPGA)

**Status**: Hardware arrives tomorrow (day 0). Target: bootstrapped FPGA with first abstractions running by end of week (day 7).

---

## What's Ready TODAY

✅ **Amaranth HDL Core** — `hardware/core.py` (fully elaborated, no syntax errors)  
✅ **Tang Nano 20K Target** — `hardware/tang_nano_20k.py` (27 MHz clock, UART, 6 LEDs, button)  
✅ **Boot ROM** — `hardware/boot_rom.py` with instruction sequence (CHANGE → LOAD → TPERM → LAMBDA → CALL)  
✅ **Pin Constraints** — `hardware/tang_nano_20k.cst` (UART TX/RX, LEDs, button mapped)  
✅ **Build Toolchain** — yosys, nextpnr-himbaechel, gowin_pack, openFPGALoader (all installed)  
✅ **Makefile** — ready to synthesize and pack bitstream  
✅ **UART Drivers** — TX/RX for serial console (debug output)  

---

## What's NOT Ready (Minimal Scope)

🔴 **Abstract GT Hardware Validation** — Partially done in hw_types.py, needs validation in mLoad/mSave gates  
🔴 **Navana Abstraction** — NS entry writer; currently stubbed  
🔴 **MTBF Counter Logic** — Invocation tracking in NS entries  
🔴 **Local Peripheral Scanning** — Boot-time UART/LED/Button identification  

**Decision**: Use **simulation/hardcoded demo namespace** for Week 1 instead of live peripheral detection. We can add autonomous peripheral scanning in Week 2.

---

## Day-by-Day Deployment Schedule

### **Day 0 (Tomorrow) — Setup & First Synthesis**

**Morning (30 min)**
1. Unbox Tang Nano 20K, verify USB-C port and UART bridge (BL616)
2. Plug in via USB-C (should enumerate as /dev/ttyUSB0)
3. Test UART connectivity: `cat /dev/ttyUSB0` (should be silent at 115200 baud)

**Afternoon (2 hours)**
4. Run synthesis:
```bash
cd hardware
python3 gen_rtlil.py > church_tang_nano_20k.rtlil
yosys -m ghdl -p "read_rtlil church_tang_nano_20k.rtlil; synth_gowin -json church_tang_nano_20k.json"
```

**Expected Output**: `church_tang_nano_20k.json` (~500 KB, no errors)

5. **BLOCKER**: If synthesis fails:
   - Check for any hw_types.py errors (Abstract GT validation issues)
   - Verify all imports in core.py resolve
   - Run: `python3 -c "from hardware.core import ChurchCore; print('✓')"` to test module load

6. **If synthesis succeeds**: commit and note timing

---

### **Day 1 (Monday) — Place & Route**

**Morning (30 min)**
1. Run place-and-route:
```bash
cd hardware
make pnr
```

**Expected Output**: `church_tang_nano_20k_pnr.json` (~3–5 MB, timing report)

2. **Check timing report** for critical path violations:
   - Expected freq: 27 MHz → period 37 ns
   - If violated, note which paths (likely mLoad/mSave gates or GC wraparound logic)
   - If OK, proceed to packing

**Afternoon (2 hours)**
3. Pack bitstream:
```bash
cd hardware
make pack
```

**Expected Output**: `church_tang_nano_20k.fs` (~1–2 MB, binary bitstream)

4. **First Flash**:
```bash
cd hardware
make prog
```

**Expected Output**: "Programming successful" or openFPGALoader status

**Troubleshooting**:
- If `openFPGALoader` not found: `source /path/to/oss-cad-suite/environment`
- If USB device not found: `lsusb | grep -i gowin` (should show GW2AR device)
- If programming times out: Try `openFPGALoader -b tangnano20k --verbose church_tang_nano_20k.fs`

---

### **Day 2 (Tuesday) — UART Console & Boot Verification**

**Morning (1 hour)**
1. Open UART serial monitor at 115200 baud:
```bash
picocom -b 115200 /dev/ttyUSB0
```
(or: `minicom -D /dev/ttyUSB0 -b 115200`)

2. Press RESET button on Tang Nano 20K
3. **Expected output**: 
   - Boot ROM execution trace (if debug output is enabled)
   - OR: silence (if boot code is running but not printing)

4. **Check LED status**:
   - All 6 LEDs should illuminate briefly during boot (part of initialization sequence in Boot.Abstr)
   - Then turn off (waiting for abstraction to return)

**If nothing appears**:
   - Check UART TX/RX are connected correctly (CST file verified; cross-check pin numbers)
   - Verify boot ROM code is being executed (use logic analyzer or manual LED test)
   - Check 27 MHz clock (oscilloscope on CLK input)

**Afternoon (2 hours)**
5. **Add debug output** to boot_rom.py if needed:
   - Add UART TX calls between major steps (CHANGE, LOAD, LAMBDA, CALL)
   - Re-synthesize and flash
   - Observe trace to verify which instruction is executing

6. **Target Milestone**: At least see LED flicker or UART boot message

---

### **Day 3 (Wednesday) — First Abstraction Entry (Salvation)**

**Goal**: Execute Salvation abstraction (loads GT, restricts permission, applies lambda, transitions to Navana)

**Morning (1 hour)**
1. Review boot ROM sequence in `boot_rom.py` lines 100–108 (CALL into Slot 4)
2. Create minimal Salvation code object:
   ```
   # Salvation abstraction (Slot 4)
   - LOAD CR0, CR6[0]   ; load a test GT from c-list[0]
   - TPERM CR0, #L      ; restrict to L permission only
   - LAMBDA CR0         ; (attempt lambda on a data object — should succeed)
   - (infinite loop or RETURN)
   ```

3. Compile Salvation to CLOOMC machine code (use CLOOMC compiler or inline hex)
4. Place compiled code in memory at Slot 4 location (demo namespace: 0x0400)
5. Update DEMO_NAMESPACE entry for Slot 4 with correct location/size/CRC

**Afternoon (3 hours)**
6. Re-synthesize, pack, flash, test via UART:
   ```bash
   cd hardware
   python3 gen_rtlil.py > church_tang_nano_20k.rtlil
   yosys -m ghdl -p "read_rtlil church_tang_nano_20k.rtlil; synth_gowin -json church_tang_nano_20k.json"
   make pnr pack prog
   ```

7. Monitor UART for:
   - Boot ROM trace → CALL Salvation (Slot 4)
   - Salvation code execution
   - RETURN back to boot epilogue
   - LED pattern or success message

8. **Target Milestone**: Boot ROM → Salvation → RETURN → Boot epilogue completes

---

### **Day 4 (Thursday) — Navana Transition**

**Goal**: After Salvation succeeds, transition control to Navana (NS entry manager)

**Morning (1 hour)**
1. Create stub Navana abstraction (Slot 5):
   - Methods: Init, Monitor (minimal)
   - For Week 1, Navana just monitors namespace and prints status via UART
   - Does not write entries yet (avoids complex CRC validation)

2. Update boot ROM to CALL Navana instead of looping

3. Add UART output in Navana to prove it's running

**Afternoon (2 hours)**
4. Compile Navana to machine code
5. Add Navana to DEMO_NAMESPACE
6. Synthesize, pack, flash, verify via UART

7. **Target Milestone**: Boot ROM → Salvation → Navana transition complete; Navana running

---

### **Day 5 (Friday) — Hardware Driver Stub (UART I/O)**

**Goal**: Call a simple UART abstraction from Navana to send/receive data

**Morning (2 hours)**
1. Create UART driver abstraction (Slot 11, Layer 2):
   - Single method: SendByte (S permission)
   - Takes DR0 as argument (byte to send)
   - Writes to UART TX register
   - Returns

2. Compile to machine code
3. Add to DEMO_NAMESPACE
4. Update Navana.Init to register UART driver GT in a test c-list

**Afternoon (2 hours)**
5. Test full chain:
   - Boot ROM → Salvation → Navana.Init
   - Navana calls UART.SendByte to print status message
   - UART driver writes to TX → visible on serial console

6. Synthesize, pack, flash

7. **Target Milestone**: UART driver callable from Navana; "Hello from CTMM" prints to console

---

### **Day 6 (Saturday) — LED & Button Driver Stubs**

**Goal**: Add simple LED and Button abstractions; call from Navana

**Morning (2 hours)**
1. Create LED driver abstraction (Slot 12):
   - Method: SetPattern (S permission)
   - Takes DR0 as 6-bit LED mask (0x00–0x3F)
   - Writes to LED GPIO register
   - Returns

2. Create Button driver abstraction (Slot 13):
   - Method: Read (L permission)
   - Returns button state in DR0 (0=not pressed, 1=pressed)

3. Compile both to machine code

**Afternoon (2 hours)**
4. Add to DEMO_NAMESPACE
5. Update Navana to:
   - Call LED.SetPattern(0x0A) → alternating LED pattern
   - Call Button.Read() → poll button state
   - Print results to UART

6. Synthesize, pack, flash
7. Press button on Tang Nano 20K; observe LED pattern changes and UART output

8. **Target Milestone**: LED + Button drivers functional; interactive GPIO control

---

### **Day 7 (Sunday) — Integration Test & Documentation**

**Goal**: Full integration: Boot → Salvation → Navana → UART + LED + Button all working

**Morning (1 hour)**
1. Create comprehensive test sequence in Navana:
   ```
   Init ←
     |
     +→ Register UART driver (Slot 11)
     +→ Register LED driver (Slot 12)
     +→ Register Button driver (Slot 13)
     |
     Loop (forever):
       ├─ Print "CTMM running" via UART.SendByte
       ├─ Call LED.SetPattern(0x15) [pattern A]
       ├─ Wait 1 second (Timer not yet implemented; use tight loop)
       ├─ Call LED.SetPattern(0x2A) [pattern B]
       ├─ Call Button.Read()
       ├─ If button pressed: Print "Button!" via UART
       └─ Repeat
   ```

2. Synthesize, pack, flash

**Afternoon (2 hours)**
3. **Full Hardware Test**:
   - Open UART console (115200 baud)
   - Power on Tang Nano 20K
   - Observe: Boot trace → Salvation → Navana → LED patterns alternating
   - Press button → "Button!" appears in UART console
   - All 6 LEDs blink in pattern

4. **Documentation**:
   - Create `docs/hardware-week-1-results.md` with:
     - Boot ROM execution trace (copy from UART log)
     - LED/button test results
     - Synthesis/place-and-route timing
     - Known issues / next steps
   - Commit all code changes
   - Note which abstractions are hardware-verified

5. **End-of-Week Checkpoint**:
   - ✅ FPGA programmed and running
   - ✅ Boot ROM verified
   - ✅ Salvation abstraction working
   - ✅ Navana running
   - ✅ UART driver functional (sends data)
   - ✅ LED driver functional (controls GPIO)
   - ✅ Button driver functional (reads GPIO)
   - ✅ Full integration tested

---

## Critical Blockers & Fallbacks

| Blocker | Impact | Fallback |
|---------|--------|----------|
| Synthesis fails (hw_types error) | Cannot build bitstream | Check Abstract GT encoding; disable Abstract type for Week 1 |
| Place-and-route timing fails (27 MHz unreachable) | Cannot flash | Lower target freq to 13.5 MHz; reduce pipelining |
| UART output never appears | Cannot debug | Assume boot is running but silent; use LED blink as "alive" indicator |
| Navana doesn't execute | Core abstraction mechanism broken | Roll back to Salvation loop; verify CALL/RETURN in isolation |
| Driver abstraction call fails | No I/O access | Check GT permission bits; verify TPERM restriction logic |

---

## What NOT to Do This Week

🚫 Don't try to implement **full Navana** with NS entry writer (too complex for Week 1)  
🚫 Don't try to implement **MTBF counters** (requires NS entry extension)  
🚫 Don't try to implement **Scheduler/threading** (blocks on CHANGE verification)  
🚫 Don't try to implement **Home Base tunnel** (network complexity)  
🚫 Don't implement **local peripheral scanning** (needs working Navana first)  

**Focus**: Boot → Salvation → Navana → simple driver abstraction chain. That's it.

---

## Expected Codebase Changes (Week 1)

| File | Changes | Lines |
|------|---------|-------|
| `hardware/boot_rom.py` | Debug output, Salvation/Navana stubs | +50 |
| `hardware/tang_nano_20k.py` | None (already complete) | — |
| `hardware/core.py` | None (already complete) | — |
| `hardware/hw_types.py` | Validate Abstract GT if needed | +10 |
| New: `hardware/abstractions/` | Salvation.py, Navana.py, UART.py, LED.py, Button.py | +300 |
| New: `docs/hardware-week-1-results.md` | Test results, UART logs, timing | +50 |

**Total new code**: ~400 lines (abstractions + test harness)

---

## Success Criteria for End of Week 1

- [ ] FPGA programs without errors
- [ ] Boot ROM executes (LED flicker or UART output)
- [ ] Salvation abstraction CALL succeeds and RETURN completes
- [ ] Navana boots and initializes drivers
- [ ] UART driver sends "Hello from CTMM" to console
- [ ] LED driver controls LED pattern (alternating 6 LEDs)
- [ ] Button driver reads button state from UART console
- [ ] Full integration test runs in a loop (LED + button + UART interactive)
- [ ] UART log saved and committed
- [ ] All code changes committed with clear messages

---

## Timeline Summary

| Day | Task | Duration | Checkpoint |
|-----|------|----------|-----------|
| 0 | Setup, first synthesis | 2h | JSON generated |
| 1 | Place & route, pack, flash | 2h | .fs bitstream programmed |
| 2 | UART console, boot verify | 3h | LED/UART response |
| 3 | Salvation abstraction | 4h | Boot → Salvation → RETURN |
| 4 | Navana transition | 3h | Navana running |
| 5 | UART driver | 4h | Prints to console |
| 6 | LED + Button drivers | 4h | Interactive GPIO control |
| 7 | Integration + docs | 3h | Full test loop, committed |
| **TOTAL** | **Full hardware deployment** | **~25h** | **FPGA running, 4 abstractions** |

---

## Next Steps (Week 2 & Beyond)

✅ Week 1: Boot → Salvation → Navana → drivers on real hardware  
→ Week 2: Local peripheral autonomous scanning (boot probes UART/LED/Button)  
→ Week 3: Mint GT lifecycle (create, revoke, transfer abstractions)  
→ Week 4: Scheduler (thread spawn/yield/wait)  
→ Weeks 5–6: Home Base Tunnel (network gateway)  
→ Weeks 7+: Full system per abstraction roadmap

---

## Quick Reference: Build Command

```bash
# Complete build (synth + PnR + pack + prog)
cd hardware
python3 gen_rtlil.py > church_tang_nano_20k.rtlil && \
  yosys -m ghdl -p "read_rtlil church_tang_nano_20k.rtlil; synth_gowin -json church_tang_nano_20k.json" && \
  nextpnr-himbaechel --device GW2AR-LV18QN88C8/I7 --json church_tang_nano_20k.json --write church_tang_nano_20k_pnr.json -o family=GW2A-18C -o cst=tang_nano_20k.cst --freq 27 && \
  gowin_pack -d GW2A-18C -o church_tang_nano_20k.fs church_tang_nano_20k_pnr.json && \
  openFPGALoader -b tangnano20k church_tang_nano_20k.fs
```

Or simply: `cd hardware && make pnr pack prog`
