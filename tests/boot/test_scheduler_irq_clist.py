"""Boot-image test: Scheduler.IRQ c-list authority caps (Task #1525).

Two layers of verification:

  1. Constants layer — SCHEDULER_IRQ_CLIST in hardware/boot_rom.py defines
     four E-perm GTs pointing at NS slots 19–22 (CR12_PORT_CAP, CR13_PORT_CAP,
     CR12_MBIT_CAP, CR13_MBIT_CAP).

  2. Generated image layer — generate_boot_image() writes those same four GTs
     into the Scheduler lump (NS slot 8) c-list tail at the correct word offsets.

The four GTs give Scheduler.IRQ delegate access to the S-perm authority objects
that govern CHANGE CR12/CR13 and M-bit installation.  Without them the IRQ
handler cannot switch thread stacks or update the interrupt vector.

GT word layout (new dom+perm encoding):
    [31]    b_flag  = 0
    [30:28] perm3   = 0b100  (E-perm; Church domain)
    [27]    dom     = 1      (Church)
    [26]    spare   = 0
    [25]    f_flag  = 0
    [24:23] gt_type = 0b01   (Inform)
    [22:16] gt_seq  = 0
    [15:0]  slot_id = 19/20/21/22
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from hardware.boot_rom import (  # noqa: E402
    SCHEDULER_IRQ_CLIST,
    CHURCH_HW_CR12_PORT_SLOT,
    CHURCH_HW_CR13_PORT_SLOT,
    CHURCH_HW_CR12_MBIT_SLOT,
    CHURCH_HW_CR13_MBIT_SLOT,
)
from hardware.hw_types import (  # noqa: E402
    GT_TYPE_INFORM,
    PERM_MASK_E,
    gt_encode_perm,
)
from server.boot_image import (  # noqa: E402
    generate_boot_image,
    NS_ENTRY_WORDS,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

SCHEDULER_NS_SLOT = 8   # Scheduler's NS slot index


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _decode_gt(word):
    """Decode a 32-bit GT word into its component fields."""
    word = word & 0xFFFFFFFF
    return {
        "b_flag":  (word >> 31) & 0x1,
        "perm3":   (word >> 28) & 0x7,
        "dom":     (word >> 27) & 0x1,
        "f_flag":  (word >> 25) & 0x1,
        "gt_type": (word >> 23) & 0x3,
        "gt_seq":  (word >> 16) & 0x7F,
        "slot_id":  word        & 0xFFFF,
    }


def _expected_e_perm_gt(slot_id):
    """Build the expected E-perm Inform GT word for the given NS slot."""
    dom, perm3 = gt_encode_perm(PERM_MASK_E)
    return (
        (perm3        << 28)
        | (dom        << 27)
        | (GT_TYPE_INFORM << 23)
        | (slot_id & 0xFFFF)
    ) & 0xFFFFFFFF


def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def boot_words():
    """Generate a default boot image and return as a list of 32-bit words."""
    img = generate_boot_image(_default_cfg(), LUMPS_DIR)
    total = 16384
    assert len(img) == total * 4
    return list(struct.unpack(f"<{total}I", img))


# ---------------------------------------------------------------------------
# Part 1 — SCHEDULER_IRQ_CLIST constant validation
# ---------------------------------------------------------------------------

def test_scheduler_irq_clist_length():
    """SCHEDULER_IRQ_CLIST has exactly 4 entries (cc = 4)."""
    assert len(SCHEDULER_IRQ_CLIST) == 4, (
        f"Expected cc=4 entries, got {len(SCHEDULER_IRQ_CLIST)}.  "
        "Add/remove GTs so the list has exactly one entry per authority cap."
    )


@pytest.mark.parametrize("idx,expected_slot,name", [
    (0, CHURCH_HW_CR12_PORT_SLOT, "CR12_PORT_CAP"),
    (1, CHURCH_HW_CR13_PORT_SLOT, "CR13_PORT_CAP"),
    (2, CHURCH_HW_CR12_MBIT_SLOT, "CR12_MBIT_CAP"),
    (3, CHURCH_HW_CR13_MBIT_SLOT, "CR13_MBIT_CAP"),
])
def test_scheduler_irq_clist_slot_id(idx, expected_slot, name):
    """SCHEDULER_IRQ_CLIST[idx] references the correct NS slot."""
    gt = _decode_gt(SCHEDULER_IRQ_CLIST[idx])
    assert gt["slot_id"] == expected_slot, (
        f"SCHEDULER_IRQ_CLIST[{idx}] ({name}): slot_id={gt['slot_id']}, "
        f"expected {expected_slot} (NS slot for {name}).\n"
        "  Update the make_gt() call in hardware/boot_rom.py."
    )


@pytest.mark.parametrize("idx,name", [
    (0, "CR12_PORT_CAP"),
    (1, "CR13_PORT_CAP"),
    (2, "CR12_MBIT_CAP"),
    (3, "CR13_MBIT_CAP"),
])
def test_scheduler_irq_clist_e_perm(idx, name):
    """SCHEDULER_IRQ_CLIST[idx] carries E-perm (Church domain, perm3=0b100)."""
    gt = _decode_gt(SCHEDULER_IRQ_CLIST[idx])
    assert gt["dom"] == 1, (
        f"SCHEDULER_IRQ_CLIST[{idx}] ({name}): dom={gt['dom']}, expected 1 (Church).\n"
        "  E-perm requires dom=1; use PERM_MASK_E in the make_gt() call."
    )
    expected_dom, expected_perm3 = gt_encode_perm(PERM_MASK_E)
    assert gt["perm3"] == expected_perm3, (
        f"SCHEDULER_IRQ_CLIST[{idx}] ({name}): perm3={gt['perm3']:#05b}, "
        f"expected {expected_perm3:#05b} (E-perm = 0b100).\n"
        "  Check PERM_MASK_E is passed to make_gt()."
    )


@pytest.mark.parametrize("idx,name", [
    (0, "CR12_PORT_CAP"),
    (1, "CR13_PORT_CAP"),
    (2, "CR12_MBIT_CAP"),
    (3, "CR13_MBIT_CAP"),
])
def test_scheduler_irq_clist_inform_type(idx, name):
    """SCHEDULER_IRQ_CLIST[idx] is an Inform GT (gt_type=0b01)."""
    gt = _decode_gt(SCHEDULER_IRQ_CLIST[idx])
    assert gt["gt_type"] == GT_TYPE_INFORM, (
        f"SCHEDULER_IRQ_CLIST[{idx}] ({name}): gt_type={gt['gt_type']}, "
        f"expected {GT_TYPE_INFORM} (Inform).\n"
        "  Pass GT_TYPE_INFORM as the first argument to make_gt()."
    )


@pytest.mark.parametrize("idx,slot_id,name", [
    (0, CHURCH_HW_CR12_PORT_SLOT, "CR12_PORT_CAP"),
    (1, CHURCH_HW_CR13_PORT_SLOT, "CR13_PORT_CAP"),
    (2, CHURCH_HW_CR12_MBIT_SLOT, "CR12_MBIT_CAP"),
    (3, CHURCH_HW_CR13_MBIT_SLOT, "CR13_MBIT_CAP"),
])
def test_scheduler_irq_clist_raw_word(idx, slot_id, name):
    """SCHEDULER_IRQ_CLIST[idx] equals the fully-encoded E-perm Inform GT."""
    expected = _expected_e_perm_gt(slot_id)
    actual   = SCHEDULER_IRQ_CLIST[idx] & 0xFFFFFFFF
    assert actual == expected, (
        f"SCHEDULER_IRQ_CLIST[{idx}] ({name}): "
        f"0x{actual:08X} != expected 0x{expected:08X}.\n"
        f"  Expected: E-perm Inform GT → NS slot {slot_id}.\n"
        "  Regenerate with make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id, 0)."
    )


# ---------------------------------------------------------------------------
# Part 2 — Generated boot image: Scheduler lump (NS slot 8) c-list
#
# Confirms that generate_boot_image() writes the authority-cap GTs into the
# Scheduler lump's c-list tail at the correct word offsets within the image.
#
# Layout (64-word lump, cc=6 after Task #1525):
#   Clist indices 0-1: Thread E (slot 45) and Memory E (slot 7)  [pre-existing]
#   Clist indices 2-5: CR12_PORT E (slot 19), CR13_PORT E (slot 20),
#                      CR12_MBIT E (slot 21), CR13_MBIT E (slot 22)  [Task #1525]
# ---------------------------------------------------------------------------

def _scheduler_lump_base(boot_words_list):
    """Return the word offset in boot_words_list where the Scheduler lump begins."""
    total = len(boot_words_list)
    ns_table_base = None
    for i in range(1, min(2048, total) + 1):
        if boot_words_list[total - i] == 0xB0070563:
            ns_table_base = total - i + 1
            break
    assert ns_table_base is not None, "BOOT_IMAGE_FORMAT_TAG not found in image"
    sched_ns_base = ns_table_base + SCHEDULER_NS_SLOT * NS_ENTRY_WORDS
    return boot_words_list[sched_ns_base]   # word0_location = lump base word address


def _scheduler_lump_cc(boot_words_list, lump_base):
    """Return the cc field from the Scheduler lump header at lump_base."""
    hdr = boot_words_list[lump_base]
    return hdr & 0xFF


def _scheduler_clist_word(boot_words_list, lump_base, cc, idx):
    """Return the GT word at c-list offset idx inside the Scheduler lump."""
    lump_size = 64   # SLOT_SIZE — the default 64-word allocation
    return boot_words_list[lump_base + lump_size - cc + idx]


def test_scheduler_lump_cc_is_6(boot_words):
    """Scheduler lump (NS slot 8) has cc=6 after adding the four authority-cap GTs."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    assert cc == 6, (
        f"Scheduler lump at word {lump_base}: cc={cc}, expected 6 "
        "(Thread E + Memory E + 4 authority-cap GTs).\n"
        "  Check SERVICE_CLIST_DEFS slot 8 in server/boot_image.py."
    )


@pytest.mark.parametrize("clist_idx,expected_slot,name", [
    (2, CHURCH_HW_CR12_PORT_SLOT, "CR12_PORT_CAP"),
    (3, CHURCH_HW_CR13_PORT_SLOT, "CR13_PORT_CAP"),
    (4, CHURCH_HW_CR12_MBIT_SLOT, "CR12_MBIT_CAP"),
    (5, CHURCH_HW_CR13_MBIT_SLOT, "CR13_MBIT_CAP"),
])
def test_scheduler_lump_authority_cap_slot_id(boot_words, clist_idx, expected_slot, name):
    """Generated Scheduler lump c-list[clist_idx] references NS slot expected_slot."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    word = _scheduler_clist_word(boot_words, lump_base, cc, clist_idx)
    gt = _decode_gt(word)
    assert gt["slot_id"] == expected_slot, (
        f"Scheduler lump c-list[{clist_idx}] ({name}): slot_id={gt['slot_id']}, "
        f"expected {expected_slot}.\n"
        "  Check SERVICE_CLIST_DEFS slot 8 in server/boot_image.py."
    )


@pytest.mark.parametrize("clist_idx,name", [
    (2, "CR12_PORT_CAP"),
    (3, "CR13_PORT_CAP"),
    (4, "CR12_MBIT_CAP"),
    (5, "CR13_MBIT_CAP"),
])
def test_scheduler_lump_authority_cap_e_perm(boot_words, clist_idx, name):
    """Generated Scheduler lump c-list[clist_idx] carries E-perm (Church, perm3=0b100)."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    word = _scheduler_clist_word(boot_words, lump_base, cc, clist_idx)
    gt = _decode_gt(word)
    _, expected_perm3 = gt_encode_perm(PERM_MASK_E)
    assert gt["dom"] == 1, (
        f"Scheduler lump c-list[{clist_idx}] ({name}): dom={gt['dom']}, expected 1 (Church)."
    )
    assert gt["perm3"] == expected_perm3, (
        f"Scheduler lump c-list[{clist_idx}] ({name}): perm3={gt['perm3']:#05b}, "
        f"expected {expected_perm3:#05b} (E-perm)."
    )


@pytest.mark.parametrize("clist_idx,slot_id,name", [
    (2, CHURCH_HW_CR12_PORT_SLOT, "CR12_PORT_CAP"),
    (3, CHURCH_HW_CR13_PORT_SLOT, "CR13_PORT_CAP"),
    (4, CHURCH_HW_CR12_MBIT_SLOT, "CR12_MBIT_CAP"),
    (5, CHURCH_HW_CR13_MBIT_SLOT, "CR13_MBIT_CAP"),
])
def test_scheduler_lump_authority_cap_raw_word(boot_words, clist_idx, slot_id, name):
    """Generated Scheduler lump c-list[clist_idx] has the correct full 32-bit GT word."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    actual   = _scheduler_clist_word(boot_words, lump_base, cc, clist_idx) & 0xFFFFFFFF
    expected = _expected_e_perm_gt(slot_id)
    assert actual == expected, (
        f"Scheduler lump c-list[{clist_idx}] ({name}): "
        f"0x{actual:08X} != expected 0x{expected:08X}.\n"
        f"  Expected E-perm Inform GT → NS slot {slot_id}."
    )
