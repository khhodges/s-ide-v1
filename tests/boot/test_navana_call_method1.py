"""Regression test: CALL CR_navana, 1 dispatches correctly with no PRIVATE_METHOD fault.

Task #17 wired Navana.Init as method-table entry 1 in boot_rom.py by writing
_NAVANA_INIT_BODY_OFFSET (= 2) into FULL_ROM[_NAVANA_LUMP_WORD + 1].  Without
that write, memory[lump_base + 1] == 0 at runtime, which causes the simulator's
_execCall() hardware dispatch (simulator.js line 3239–3241) to raise
PRIVATE_METHOD and abort the call.

This test closes the automated coverage gap by:
  (a) Verifying the three Navana lump words in boot_rom.py FULL_ROM directly.
  (b) Driving the full simulator CALL path for CALL CR_navana, 1 and asserting:
        1. No PRIVATE_METHOD fault (and no other new fault).
        2. The method-table entry (memory[lump_base + 1]) is non-zero.
        3. The simulator PC lands on tableEntry after the call (= 2,
           the RETURN AL word at lump offset 2).

The JS harness (sim_navana_call_method1.js) boots the simulator with the
server-generated boot image, locates the Navana NS entry (NS slot 5) to find the
live lump base word address, injects the three Navana lump words from boot_rom.py
at that address (mirroring the hardware injection), constructs a valid Inform E-GT
for NS slot 5 using the live gt_seq from the NS table so mLoad passes, and calls
sim._execCall({crDst: 0, imm: 1}) to exercise the hardware method-table dispatch.
"""
import base64
import json
import os
import subprocess
import sys

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_navana_call_method1.js")

sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image  # noqa: E402


# ---------------------------------------------------------------------------
# Navana lump constants — mirror hardware/boot_rom.py
# ---------------------------------------------------------------------------

_NAVANA_LUMP_WORD        = 5 * 0x100 // 4   # = 320; ROM word index in FULL_ROM
_NAVANA_CW               = 2                 # code words: [1]=method table, [2]=body
_NAVANA_INIT_BODY_OFFSET = 2                 # lump-base-relative word offset to Init body

# Lump header: magic=0x1F, n_minus_6=0 (lumpSize=64), cw=2, cc=0
_NAVANA_LUMP_HEADER      = ((0x1F << 27) | (_NAVANA_CW << 10)) & 0xFFFFFFFF

# RETURN AL instruction: opcode=3 (RETURN), cond=0xE (AL in hw_types.CondCode)
_RETURN_AL               = ((3 << 27) | (0xE << 23)) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Fixture: default boot image (module-scoped for speed)
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


@pytest.fixture(scope="module")
def boot_image_b64():
    cfg = _default_cfg()
    img = generate_boot_image(cfg, LUMPS_DIR)
    return base64.b64encode(img).decode("ascii")


# ---------------------------------------------------------------------------
# Helper: run the JS harness and return (proc, stdout, stderr)
# ---------------------------------------------------------------------------

def _run_harness(boot_image_b64):
    envelope = json.dumps({
        "imageBase64":    boot_image_b64,
        "config":         _default_cfg(),
        "navanaLumpWords": [
            _NAVANA_LUMP_HEADER,       # word 0: lump header
            _NAVANA_INIT_BODY_OFFSET,  # word 1: method_table[1] → Init body offset
            _RETURN_AL,                # word 2: Init body = RETURN AL
        ],
    })
    proc = subprocess.run(
        ["node", HARNESS],
        input=envelope.encode("utf-8"),
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()
    return proc, stdout, stderr


# ---------------------------------------------------------------------------
# Tests (a): verify Navana lump words in boot_rom.py FULL_ROM directly
# ---------------------------------------------------------------------------

def test_navana_full_rom_lump_header():
    """FULL_ROM[_NAVANA_LUMP_WORD] has the expected Navana lump header.

    Checks that boot_rom.py still injects the magic=0x1F lump header at the
    Navana lump base in FULL_ROM.  A regression here means the hardware ROM
    lost its Navana lump and a real FPGA would fault on CALL CR_navana.
    """
    from hardware.boot_rom import FULL_ROM  # noqa: PLC0415
    header = FULL_ROM[_NAVANA_LUMP_WORD]
    magic = (header >> 27) & 0x1F
    assert magic == 0x1F, (
        f"FULL_ROM[{_NAVANA_LUMP_WORD}] (Navana lump header) magic = "
        f"0x{magic:02X}, expected 0x1F — boot_rom.py Navana lump header "
        f"injection (Task #17) may have been removed or overwritten"
    )
    assert header == _NAVANA_LUMP_HEADER, (
        f"FULL_ROM[{_NAVANA_LUMP_WORD}] = 0x{header:08X}, "
        f"expected 0x{_NAVANA_LUMP_HEADER:08X} (magic=0x1F, cw={_NAVANA_CW})"
    )


def test_navana_full_rom_method_table_entry1():
    """FULL_ROM[_NAVANA_LUMP_WORD + 1] is _NAVANA_INIT_BODY_OFFSET (= 2).

    This is the word that the hardware method-table dispatch reads when CALL
    CR_navana, 1 is executed.  A value of 0 would trigger PRIVATE_METHOD.
    Verifies that Task #17's method-table wiring is intact in boot_rom.py.
    """
    from hardware.boot_rom import FULL_ROM  # noqa: PLC0415
    entry = FULL_ROM[_NAVANA_LUMP_WORD + 1]
    assert entry != 0, (
        f"FULL_ROM[{_NAVANA_LUMP_WORD + 1}] (Navana method_table[1]) == 0 — "
        f"CALL CR_navana, 1 would PRIVATE_METHOD fault on hardware. "
        f"boot_rom.py Navana lump injection (Task #17) appears missing."
    )
    assert entry == _NAVANA_INIT_BODY_OFFSET, (
        f"FULL_ROM[{_NAVANA_LUMP_WORD + 1}] = {entry}, "
        f"expected {_NAVANA_INIT_BODY_OFFSET} (_NAVANA_INIT_BODY_OFFSET)"
    )


def test_navana_full_rom_init_body_is_return():
    """FULL_ROM[_NAVANA_LUMP_WORD + 2] is a RETURN AL instruction.

    The Init body at lump word 2 must be RETURN AL (opcode=3, cond=0xF).
    A regression here means the hardware CALL CR_navana, 1 would jump to a
    non-RETURN instruction instead of returning to the caller.
    """
    from hardware.boot_rom import FULL_ROM  # noqa: PLC0415
    body = FULL_ROM[_NAVANA_LUMP_WORD + 2]
    assert body == _RETURN_AL, (
        f"FULL_ROM[{_NAVANA_LUMP_WORD + 2}] = 0x{body:08X}, "
        f"expected 0x{_RETURN_AL:08X} (RETURN AL). "
        f"opcode={(body >> 27) & 0x1F}, cond={(body >> 23) & 0xF}"
    )


# ---------------------------------------------------------------------------
# Tests (b): full simulator CALL path via JS harness
# ---------------------------------------------------------------------------

def test_call_navana_method1_no_fault(boot_image_b64):
    """CALL CR_navana, 1 produces no fault after Navana lump injection.

    This is the primary simulator regression test for Task #17 / Task #892.

    The JS harness boots the full simulator, injects the three Navana lump
    words from boot_rom.py at the Navana lump base address in simulator
    memory, and calls sim._execCall() with method index 1.  The hardware
    method-table dispatch in simulator.js reads memory[lump_base + 1]; if
    that word is 0 (as it would be without the Task #17 injection), the
    PRIVATE_METHOD fault fires and the call is aborted.

    Passing here confirms that with the injection in place, no PRIVATE_METHOD
    fault (and no other new fault) occurs during CALL CR_navana, 1.
    """
    proc, stdout, stderr = _run_harness(boot_image_b64)

    assert proc.returncode == 0, (
        f"sim_navana_call_method1.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\n"
            f"stdout: {stdout}\nstderr: {stderr}"
        )

    assert data.get("ok") is True, (
        f"CALL CR_navana, 1 produced an unexpected fault in simulator.\n"
        f"message:     {data.get('message')!r}\n"
        f"newFaults:   {data.get('newFaults')}\n"
        f"tableEntry:  {data.get('tableEntryHex')}\n"
        f"pcAfterCall: {data.get('pcAfterCall')}\n"
        f"full stdout: {stdout}"
    )
    assert not data.get("privateMethodFault"), (
        f"PRIVATE_METHOD fault was raised for CALL CR_navana, 1. "
        f"Navana method_table[1] may be zero in the injected lump words."
    )
    assert not data.get("anyNewFault"), (
        f"Unexpected fault during CALL CR_navana, 1: {data.get('newFaults')}"
    )


def test_call_navana_method1_table_entry_nonzero(boot_image_b64):
    """Navana method-table entry 1 is non-zero after lump injection.

    Confirms that the injected lump words (mirroring boot_rom.py) make
    memory[lump_base + 1] non-zero so the hardware dispatch does not fault.
    """
    proc, stdout, stderr = _run_harness(boot_image_b64)

    assert proc.returncode == 0, (
        f"sim_navana_call_method1.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(f"Non-JSON output: {exc}\nstdout: {stdout}")

    table_entry = data.get("tableEntry", 0)
    assert table_entry != 0, (
        f"Navana method_table[1] (memory[lump_base + 1]) == 0 after injection — "
        f"the injected lump words did not reach the simulator memory. "
        f"lumpBaseWord={data.get('lumpBaseWord')}"
    )
    assert table_entry == _NAVANA_INIT_BODY_OFFSET, (
        f"Navana method_table[1] = {table_entry}, "
        f"expected {_NAVANA_INIT_BODY_OFFSET} (_NAVANA_INIT_BODY_OFFSET)"
    )


def test_call_navana_method1_boot_image_does_not_embed_lump(boot_image_b64):
    """Server-generated boot image leaves Navana's method_table[1] as zero.

    This is a boot-image drift detector.  The server-generated boot image
    (generate_boot_image) routes Navana through the software abstraction
    layer and does NOT embed the hardware lump body at the Navana lump base.
    Consequently, memory[lump_base + 1] == 0 before the harness injects the
    boot_rom.py lump words.

    If this assertion fails it means the server boot image has started
    embedding the Navana lump inline.  The injection in the harness would
    then be a no-op and the companion CALL tests would pass for a different
    reason.  Update the test strategy accordingly if that happens.
    """
    proc, stdout, stderr = _run_harness(boot_image_b64)

    assert proc.returncode == 0, (
        f"sim_navana_call_method1.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(f"Non-JSON output: {exc}\nstdout: {stdout}")

    pre = data.get("preInjectionTableEntry", -1)
    assert pre == 0, (
        f"Pre-injection memory[lump_base + 1] = {pre} (non-zero): "
        f"the server-generated boot image now embeds Navana lump words at "
        f"lumpBaseWord={data.get('lumpBaseWord')}. "
        f"The harness injection is no longer needed — review the test strategy."
    )


def test_call_navana_method1_pc_lands_on_return_offset(boot_image_b64):
    """PC after CALL CR_navana, 1 equals _NAVANA_INIT_BODY_OFFSET (= 2).

    Hardware sets pc = tableEntry for method index > 0 (simulator.js line
    3243).  Since method_table[1] = 2 and lump word 2 holds the RETURN AL
    instruction, the PC must be 2 after the call — confirming the dispatch
    landed on the Init body, not on an arbitrary or zeroed word.
    """
    proc, stdout, stderr = _run_harness(boot_image_b64)

    assert proc.returncode == 0, (
        f"sim_navana_call_method1.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(f"Non-JSON output: {exc}\nstdout: {stdout}")

    pc_after = data.get("pcAfterCall")
    assert pc_after == _NAVANA_INIT_BODY_OFFSET, (
        f"PC after CALL CR_navana, 1 = {pc_after}, "
        f"expected {_NAVANA_INIT_BODY_OFFSET} (_NAVANA_INIT_BODY_OFFSET). "
        f"tableEntry={data.get('tableEntryHex')}, "
        f"newFaults={data.get('newFaults')}"
    )
