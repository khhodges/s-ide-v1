#!/usr/bin/env python3
"""
scripts/check_sha32_collisions.py

Collision-detection scan for sha32 (token_32) values across all known OGTs.

sha32(ogt) = first 4 bytes of SHA-256(ogt) as big-endian uint32.
The 4-byte truncation gives a 1-in-2^32 collision probability per pair.
This script asserts no two OGTs in the known set share the same token_32.

Usage:
    python3 scripts/check_sha32_collisions.py        # scan + assert
    python3 scripts/check_sha32_collisions.py --table # print table only

Exit 0: no collisions found.
Exit 1: collision detected (fatal — stop the build).
"""

import sys
import hashlib
import struct

# ---------------------------------------------------------------------------
# Complete list of known OGTs.
# Add new OGTs here as abstractions are defined.
# ---------------------------------------------------------------------------

KNOWN_OGTS = [
    # Core abstractions (always present in every board manifest)
    "global.Core.BoardIdentity.boot",
    "global.Core.Heartbeat.boot",
    "global.Core.FaultReporter.boot",
    "global.Core.PerfReporter.boot",
    "global.Core.LumpLoader.boot",
    "global.Core.TraceEmitter.boot",
    "global.Core.NSInspector.boot",
    "global.Core.MediaConsumer.boot",
    "global.Core.BrowseClient.boot",

    # IDE-side GTs (held by bridge/server — checked for cross-set collisions)
    "CM.IDE.TraceReceiver",
    "CM.IDE.LumpServer",
    "CM.IDE.NSAuthority",
    "CM.IDE.MediaServer",
    "CM.IDE.BrowseProxy",
]


def sha32(ogt: str) -> int:
    d = hashlib.sha256(ogt.encode("utf-8")).digest()
    return struct.unpack(">I", d[:4])[0]


def main():
    table_only = "--table" in sys.argv

    token_map: dict[int, str] = {}
    collisions: list[tuple[str, str, int]] = []

    rows = []
    for ogt in KNOWN_OGTS:
        t = sha32(ogt)
        rows.append((t, ogt))
        if t in token_map:
            collisions.append((token_map[t], ogt, t))
        else:
            token_map[t] = ogt

    # Print table
    print(f"{'token_32':<12}  OGT")
    print("-" * 72)
    for t, ogt in sorted(rows, key=lambda r: r[0]):
        print(f"0x{t:08x}  {ogt}")

    print()
    print(f"{len(rows)} OGTs scanned.")

    if collisions:
        print(f"\nCOLLISION DETECTED ({len(collisions)} pair(s)):")
        for a, b, t in collisions:
            print(f"  0x{t:08x}  {a!r}  ==  {b!r}")
        if not table_only:
            sys.exit(1)
    else:
        print("No collisions. All token_32 values are distinct.")


if __name__ == "__main__":
    main()
