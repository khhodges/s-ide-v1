#!/usr/bin/env bash
# scripts/test_build_guard.sh
#
# Dry-run test for the bitstream build guards.
# Tests check_sapphire_patch_fresh.sh (mtime guard) and
# check_bram_init_zero.sh (INIT_0 guard) using synthetic fixtures.
#
# Runs entirely in a temp directory — no Efinity installation required.
# Exits 0 if all assertions pass, non-zero on the first failure.
#
# Usage (from repo root):
#   bash scripts/test_build_guard.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$REPO_ROOT/scripts"

PASS=0
FAIL=0
FAILED=()

# ── Colour helpers ───────────────────────────────────────────────────────────
_ok()   { printf '\033[0;32m  [PASS]\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
_fail() { printf '\033[0;31m  [FAIL]\033[0m %s\n' "$*" >&2; FAIL=$((FAIL+1)); FAILED+=("$*"); }

# ── assert_exit <expected> <actual> <label> ──────────────────────────────────
assert_exit() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [ "$actual" -eq "$expected" ]; then
        _ok "$label (exit $actual)"
    else
        _fail "$label — expected exit $expected, got $actual"
    fi
}

# ── assert_output_contains <pattern> <output> <label> ───────────────────────
assert_output_contains() {
    local pattern="$1"
    local output="$2"
    local label="$3"
    if echo "$output" | grep -qF "$pattern"; then
        _ok "$label (message contains: $pattern)"
    else
        _fail "$label — expected message containing '$pattern'"
        echo "    Actual output:" >&2
        echo "$output" | sed 's/^/    /' >&2
    fi
}

# ── Setup: temp workspace ────────────────────────────────────────────────────
TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build Guard Dry-Run Tests"
echo "  Temp workspace: $TMPDIR_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ════════════════════════════════════════════════════════════════════════════
# Section A: check_sapphire_patch_fresh.sh (mtime guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section A: check_sapphire_patch_fresh.sh (mtime guard)"
echo "  ─────────────────────────────────────────────────────"

FW_DIR="$TMPDIR_BASE/firmware"
mkdir -p "$FW_DIR"

# Create synthetic firmware sources
touch "$FW_DIR/main.c"
touch "$FW_DIR/main.h"
touch "$FW_DIR/link.ld"   # Not .c/.h — must be ignored

SAPPHIRE_V="$TMPDIR_BASE/sapphire.v"
touch "$SAPPHIRE_V"

# A1: sapphire.v is newer than firmware sources → should pass (exit 0)
sleep 0.05
touch "$SAPPHIRE_V"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" "$FW_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "A1: fresh patch — exit 0"
assert_output_contains "up-to-date" "$OUT" "A1: fresh patch — reports up-to-date"

# A2: a .c source is newer than sapphire.v → should fail (exit 1)
sleep 0.05
touch "$FW_DIR/main.c"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" "$FW_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "A2: stale patch (main.c newer) — exit 1"
assert_output_contains "Run: python3 scripts/patch_sapphire_init.py" "$OUT" "A2: stale patch — remediation hint"
assert_output_contains "GUARD FAIL" "$OUT" "A2: stale patch — GUARD FAIL header"

# A3: a .h source is newer than sapphire.v → should fail (exit 1)
sleep 0.05
touch "$SAPPHIRE_V"
sleep 0.05
touch "$FW_DIR/main.h"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" "$FW_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "A3: stale patch (main.h newer) — exit 1"
assert_output_contains "main.h" "$OUT" "A3: stale patch — lists offending file"

# A4: only link.ld is newer (not .c/.h) → should pass (exit 0)
sleep 0.05
touch "$SAPPHIRE_V"
sleep 0.05
touch "$FW_DIR/link.ld"
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" "$FW_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "A4: only non-C/H file newer — exit 0 (link.ld ignored)"

# A5: missing sapphire.v → should exit 2 (usage error)
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$TMPDIR_BASE/no_such_file.v" "$FW_DIR" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "A5: missing sapphire.v — exit 2"

# A6: missing firmware dir → should exit 2 (usage error)
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" "$SAPPHIRE_V" "$TMPDIR_BASE/no_such_dir" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "A6: missing firmware dir — exit 2"

# A7: no arguments → should exit 2
OUT=$(bash "$SCRIPTS/check_sapphire_patch_fresh.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "A7: no arguments — exit 2"

# ════════════════════════════════════════════════════════════════════════════
# Section B: check_bram_init_zero.sh (INIT_0 guard)
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "  Section B: check_bram_init_zero.sh (INIT_0 guard)"
echo "  ─────────────────────────────────────────────────────"

MAP_DIR="$TMPDIR_BASE/outflow"
mkdir -p "$MAP_DIR"

# Helper: build a synthetic map.v with configurable INIT_0 values
# Arguments: <path> <lane0_val> <lane1_val> <lane2_val> <lane3_val>
# Use "0000000000000000000000000000000000000000000000000000000000000000" for zero
# Use "1a2b3c4d" (etc.) for non-zero (any non-zero substring)
make_map_v() {
    local path="$1"
    shift
    local vals=("$@")
    {
        echo "// Synthetic map.v for testing"
        for i in 0 1 2 3; do
            echo "EFX_RAM10 #(.INIT_0(\"${vals[$i]}\")) ram_symbol${i}__D\$g1_inst (.CLK());"
        done
    } > "$path"
}

ZERO64="0000000000000000000000000000000000000000000000000000000000000000"
NONZ64="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"

# B1: all lanes non-zero → should pass (exit 0)
make_map_v "$MAP_DIR/good.map.v" "$NONZ64" "$NONZ64" "$NONZ64" "$NONZ64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/good.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "B1: all lanes non-zero — exit 0"
assert_output_contains "Firmware confirmed embedded" "$OUT" "B1: non-zero — confirmed embedded message"

# B2: all lanes zero → should fail (exit 1)
make_map_v "$MAP_DIR/bad_all_zero.map.v" "$ZERO64" "$ZERO64" "$ZERO64" "$ZERO64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/bad_all_zero.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "B2: all lanes zero — exit 1"
assert_output_contains "Run: python3 scripts/patch_sapphire_init.py" "$OUT" "B2: all-zero — remediation hint"
assert_output_contains "GUARD FAIL" "$OUT" "B2: all-zero — GUARD FAIL header"

# B3: mixed — lane 0 non-zero, others zero → should pass (at least one non-zero)
make_map_v "$MAP_DIR/mixed.map.v" "$NONZ64" "$ZERO64" "$ZERO64" "$ZERO64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/mixed.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "B3: lane0 non-zero only — exit 0 (partial non-zero is OK)"

# B4: map.v without EFX_RAM10 ram_symbol instances → should exit 2 (inconclusive)
echo "// empty map.v" > "$MAP_DIR/empty.map.v"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/empty.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B4: no EFX_RAM10 instances — exit 2 (inconclusive)"

# B5: missing map.v → should exit 2
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$TMPDIR_BASE/no_such.map.v" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B5: missing map.v — exit 2"

# B6: no arguments → should exit 2
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" 2>&1) && RC=$? || RC=$?
assert_exit 2 "$RC" "B6: no arguments — exit 2"

# B7: all-zero INIT_0 — output must NOT contain remediation hint when lanes are non-zero
make_map_v "$MAP_DIR/nonzero.map.v" "$NONZ64" "$NONZ64" "$NONZ64" "$NONZ64"
OUT=$(bash "$SCRIPTS/check_bram_init_zero.sh" "$MAP_DIR/nonzero.map.v" 2>&1) && RC=$? || RC=$?
if echo "$OUT" | grep -qF "patch_sapphire_init.py"; then
    _fail "B7: non-zero lanes — remediation hint should NOT appear in passing output"
else
    _ok "B7: non-zero lanes — remediation hint absent (correct)"
fi

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
    echo "  ALL BUILD GUARD TESTS PASSED ($PASS assertions)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
else
    echo "  RESULTS: $PASS passed, $FAIL failed"
    echo ""
    echo "  FAILED:"
    for f in "${FAILED[@]}"; do
        echo "    ✘  $f"
    done
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
