"""
tests/server/test_boot_config_validation.py

Automated test coverage for _validate_step2 — specifically the
physAddr-vs-board-RAM ceiling checks introduced in Task #1183.

Tests cover:
  - Lump within range (no error)
  - Lump ending exactly at the board RAM ceiling (no error — boundary is inclusive)
  - Lump extending one word past the ceiling (error)
  - Error message content for out-of-range cases
  - Two board profiles: Tang Nano 20K (16 384 words) and Wukong XC7A100T (131 072 words)
  - General _validate_step2 input-validation guards
"""

import os
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import (
    HARDWARE_PROFILES,
    FREE_SLOT_SIZE,
    _validate_step2,
)

# ---------------------------------------------------------------------------
# Test constants
# ---------------------------------------------------------------------------

LUMP_SIZE = 64  # words — used for all resident test lumps
NS_SLOT = 5     # not in RESERVED_NS_SLOTS (0-3, 11-15)

FAKE_CATALOG_ENTRY = {
    "abstraction": "TestLump",
    "nsSlot": NS_SLOT,
    "lumpSize": LUMP_SIZE,
    "token": "deadbeef",
}

# foundation_end = namespaceLumpWords + threadLumpWords + FREE_SLOT_SIZE + BOOT_ABSTR_DEFAULT_SIZE
# With ns_lump=64, thread_lump=256, FREE_SLOT_SIZE=64, BOOT_ABSTR_DEFAULT_SIZE=64 → 448
FOUNDATION_END = 64 + 256 + FREE_SLOT_SIZE + 64  # 448


def _fake_catalog():
    return [FAKE_CATALOG_ENTRY]


def _make_step1(total_ns_words, ns_lump=64, thread_lump=256):
    return {
        "totalNamespaceWords": total_ns_words,
        "namespaceLumpWords": ns_lump,
        "threadLumpWords": thread_lump,
    }


def _make_step2(phys_addr, resident=True, lump_size=LUMP_SIZE):
    return {
        "lumps": [
            {
                "nsSlot": NS_SLOT,
                "resident": resident,
                "physAddr": phys_addr,
                "lumpSize": lump_size,
            }
        ]
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_catalog_and_lumps_dir(tmp_path):
    """
    Patch _load_lump_catalog to return a predictable single-entry catalog and
    point LUMPS_DIR at a tmp directory that contains no 00000300.lump so
    _validate_step2 always falls back to BOOT_ABSTR_DEFAULT_SIZE (64 words).
    """
    with (
        patch.object(_app_module, "_load_lump_catalog", side_effect=_fake_catalog),
        patch.object(_app_module, "LUMPS_DIR", str(tmp_path)),
    ):
        yield


# ---------------------------------------------------------------------------
# Tang Nano 20K — board RAM ceiling = 16 384 words
# ---------------------------------------------------------------------------

TANG_BOARD = "tang-nano-20k"
TANG_RAM = HARDWARE_PROFILES[TANG_BOARD]["totalRamWords"]  # 16 384

# Set totalNamespaceWords large enough that usable_end (= total - 0x300) > TANG_RAM,
# so the board-RAM check is always the binding constraint in these tests.
_NS_TABLE_RESERVE = 0x300  # 768 words
TANG_TOTAL_NS = TANG_RAM + _NS_TABLE_RESERVE + 512  # 17 664


class TestTangNano20kBoardRamCeiling:
    """physAddr-vs-board-RAM ceiling checks for the Tang Nano 20K."""

    def _step1(self):
        return _make_step1(TANG_TOTAL_NS, ns_lump=64, thread_lump=256)

    def test_within_range_passes(self):
        """Lump comfortably inside board RAM → no error."""
        phys = TANG_RAM - LUMP_SIZE - 10  # ends 10 words before ceiling
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_exactly_at_ceiling_passes(self):
        """Lump whose last word is the final board RAM word → allowed (not strictly >)."""
        phys = TANG_RAM - LUMP_SIZE  # phys + LUMP_SIZE == TANG_RAM exactly
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_one_word_past_ceiling_fails(self):
        """Lump extending one word past the board RAM ceiling → validation error."""
        phys = TANG_RAM - LUMP_SIZE + 1  # phys + LUMP_SIZE == TANG_RAM + 1
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is not None, "expected a validation error but got None"
        assert "board RAM limit" in err, f"unexpected error text: {err!r}"
        assert str(TANG_RAM) in err, f"board RAM word count not in error: {err!r}"

    def test_error_names_the_board_label(self):
        """Out-of-range error message includes the human-readable board label."""
        phys = TANG_RAM  # lump starts at the ceiling — definitely past it
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is not None
        label = HARDWARE_PROFILES[TANG_BOARD]["label"]
        assert label in err, f"board label not in error: {err!r}"

    def test_error_names_the_abstraction(self):
        """Out-of-range error message includes the abstraction name."""
        phys = TANG_RAM
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is not None
        assert FAKE_CATALOG_ENTRY["abstraction"] in err, (
            f"abstraction name not in error: {err!r}"
        )


# ---------------------------------------------------------------------------
# Wukong XC7A100T — board RAM ceiling = 131 072 words
# ---------------------------------------------------------------------------

WUKONG_BOARD = "wukong-xc7a100t"
WUKONG_RAM = HARDWARE_PROFILES[WUKONG_BOARD]["totalRamWords"]  # 131 072

WUKONG_TOTAL_NS = WUKONG_RAM + _NS_TABLE_RESERVE + 512  # 132 352


class TestWukongXC7A100TBoardRamCeiling:
    """physAddr-vs-board-RAM ceiling checks for the QMTECH Wukong Artix-7 XC7A100T."""

    def _step1(self):
        return _make_step1(WUKONG_TOTAL_NS, ns_lump=64, thread_lump=256)

    def test_within_range_passes(self):
        """Lump comfortably inside board RAM → no error."""
        phys = WUKONG_RAM - LUMP_SIZE - 100
        err = _validate_step2(_make_step2(phys), self._step1(), WUKONG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_exactly_at_ceiling_passes(self):
        """Lump whose last word is the final board RAM word → allowed."""
        phys = WUKONG_RAM - LUMP_SIZE
        err = _validate_step2(_make_step2(phys), self._step1(), WUKONG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_one_word_past_ceiling_fails(self):
        """Lump extending one word past the board RAM ceiling → validation error."""
        phys = WUKONG_RAM - LUMP_SIZE + 1
        err = _validate_step2(_make_step2(phys), self._step1(), WUKONG_BOARD)
        assert err is not None, "expected a validation error but got None"
        assert "board RAM limit" in err, f"unexpected error text: {err!r}"
        assert str(WUKONG_RAM) in err, f"board RAM word count not in error: {err!r}"

    def test_error_names_the_board_label(self):
        """Out-of-range error message includes the human-readable board label."""
        phys = WUKONG_RAM
        err = _validate_step2(_make_step2(phys), self._step1(), WUKONG_BOARD)
        assert err is not None
        label = HARDWARE_PROFILES[WUKONG_BOARD]["label"]
        assert label in err, f"board label not in error: {err!r}"

    def test_error_names_the_abstraction(self):
        """Out-of-range error message includes the abstraction name."""
        phys = WUKONG_RAM
        err = _validate_step2(_make_step2(phys), self._step1(), WUKONG_BOARD)
        assert err is not None
        assert FAKE_CATALOG_ENTRY["abstraction"] in err, (
            f"abstraction name not in error: {err!r}"
        )


# ---------------------------------------------------------------------------
# General _validate_step2 input validation
# ---------------------------------------------------------------------------

class TestValidateStep2General:
    """Tests for the input-validation guards that are board-profile agnostic."""

    def _step1(self):
        return _make_step1(TANG_TOTAL_NS)

    def test_none_step2_returns_none(self):
        """None step2 is a valid no-op (feature not configured)."""
        assert _validate_step2(None, self._step1(), TANG_BOARD) is None

    def test_non_dict_step2_returns_error(self):
        err = _validate_step2("bad-type", self._step1(), TANG_BOARD)
        assert err is not None
        assert "object" in err

    def test_empty_lumps_list_passes(self):
        assert _validate_step2({"lumps": []}, self._step1(), TANG_BOARD) is None

    def test_lazy_lump_needs_no_phys_addr(self):
        """Lazy entries (resident=False) need only nsSlot — no physAddr required."""
        step2 = {"lumps": [{"nsSlot": NS_SLOT, "resident": False}]}
        err = _validate_step2(step2, self._step1(), TANG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_reserved_slot_rejected(self):
        """NS slots 0-3 are foundational and cannot host a resident lump."""
        step2 = {
            "lumps": [{"nsSlot": 0, "resident": True, "physAddr": 500, "lumpSize": 64}]
        }
        err = _validate_step2(step2, self._step1(), TANG_BOARD)
        assert err is not None
        assert "reserved" in err

    def test_duplicate_ns_slot_rejected(self):
        """Two entries for the same NS slot → duplicate error."""
        step2 = {
            "lumps": [
                {"nsSlot": NS_SLOT, "resident": False},
                {"nsSlot": NS_SLOT, "resident": False},
            ]
        }
        err = _validate_step2(step2, self._step1(), TANG_BOARD)
        assert err is not None
        assert "duplicate" in err

    def test_phys_addr_inside_foundation_rejected(self):
        """physAddr that overlaps the foundational footprint → error."""
        phys = FOUNDATION_END - 1  # one word before the end of the foundation
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is not None
        assert "foundational" in err

    def test_phys_addr_at_foundation_boundary_passes(self):
        """physAddr exactly equal to foundation_end → first valid placement."""
        phys = FOUNDATION_END  # not inside, not past board ceiling
        err = _validate_step2(_make_step2(phys), self._step1(), TANG_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_resident_lump_missing_phys_addr_rejected(self):
        """Resident lump with no physAddr field → error."""
        step2 = {"lumps": [{"nsSlot": NS_SLOT, "resident": True, "lumpSize": 64}]}
        err = _validate_step2(step2, self._step1(), TANG_BOARD)
        assert err is not None
        assert "physAddr" in err or "non-negative" in err

    def test_overlapping_resident_lumps_rejected(self):
        """Two resident lumps whose address ranges overlap → collision error."""
        entry_a = {
            "nsSlot": NS_SLOT,
            "resident": True,
            "physAddr": FOUNDATION_END,
            "lumpSize": LUMP_SIZE,
        }
        entry_b = {
            "nsSlot": 6,
            "resident": True,
            "physAddr": FOUNDATION_END + LUMP_SIZE - 1,
            "lumpSize": LUMP_SIZE,
        }
        # Add ns_slot 6 to the fake catalog so duplicate-catalog check passes.
        extended_catalog = [
            FAKE_CATALOG_ENTRY,
            {"abstraction": "OtherLump", "nsSlot": 6, "lumpSize": LUMP_SIZE, "token": "aabbccdd"},
        ]
        with patch.object(_app_module, "_load_lump_catalog", return_value=extended_catalog):
            err = _validate_step2({"lumps": [entry_a, entry_b]}, self._step1(), TANG_BOARD)
        assert err is not None
        assert "overlap" in err
