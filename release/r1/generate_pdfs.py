#!/usr/bin/env python3
"""
CTMM Release 1 — PDF generation script
Converts markdown docs → styled PDFs via pandoc + weasyprint
"""

import subprocess
import sys
import os
from pathlib import Path

BASE  = Path(__file__).parent.parent.parent
DOCS  = BASE / "docs"
OUT   = Path(__file__).parent
CSS   = OUT / "ctmm-pdf.css"

DATE  = "May 2026"
AUTHOR = "Kenneth J Hamer-Hodges"

RELEASE = [
    # (source_md, output_stem, title, category)

    # ── Hardware Specification ────────────────────────────────────────────────
    ("isa_reference.md",
     "ctmm-r1-01-isa-reference",
     "CTMM ISA Reference — Release 1",
     "Hardware Specification"),

    ("isa_encoding.md",
     "ctmm-r1-02-isa-encoding",
     "CTMM ISA Encoding — Release 1",
     "Hardware Specification"),

    ("architecture.md",
     "ctmm-r1-03-architecture",
     "CTMM Architecture Overview — Release 1",
     "Hardware Specification"),

    ("church-instructions.md",
     "ctmm-r1-04-church-instructions",
     "Church Instructions — Release 1",
     "Hardware Specification"),

    ("instruction-set.md",
     "ctmm-r1-05-instruction-set",
     "Full Instruction Set — Release 1",
     "Hardware Specification"),

    # ── Security & Capabilities ───────────────────────────────────────────────
    ("golden-tokens.md",
     "ctmm-r1-06-golden-tokens",
     "Golden Tokens — Release 1",
     "Security & Capabilities"),

    ("abstract-gt.md",
     "ctmm-r1-07-abstract-gt",
     "Abstract Golden Token — Release 1",
     "Security & Capabilities"),

    ("namespace-security.md",
     "ctmm-r1-08-namespace-security",
     "Namespace Security — Release 1",
     "Security & Capabilities"),

    ("mint.md",
     "ctmm-r1-09-mint",
     "Mint & PassKey Issuance — Release 1",
     "Security & Capabilities"),

    ("mload.md",
     "ctmm-r1-10-mload",
     "Machine Load (mLoad) — Release 1",
     "Security & Capabilities"),

    ("switch-lifecycle.md",
     "ctmm-r1-11-switch-lifecycle",
     "SWITCH Lifecycle & PassKey Install — Release 1",
     "Security & Capabilities"),

    # ── Boot Sequence ─────────────────────────────────────────────────────────
    ("boot-rom-layout.md",
     "ctmm-r1-12-boot-rom-layout",
     "Boot ROM Layout — Release 1",
     "Boot Sequence"),

    ("boot-permission-rules.md",
     "ctmm-r1-13-boot-permission-rules",
     "Boot Permission Rules — Release 1",
     "Boot Sequence"),

    # ── Conformance ───────────────────────────────────────────────────────────
    ("HARDWARE-DEVIATIONS.md",
     "ctmm-r1-14-hardware-deviations",
     "Hardware Deviations — All Closed — Release 1",
     "Conformance"),
]


def run_pandoc(src_path: Path, out_path: Path, title: str, category: str) -> bool:
    meta_block = f"""---
title: "{title}"
subtitle: "Church-Turing Meta-Machine"
author: "{AUTHOR}"
date: "{DATE}"
---

"""
    # Write temp file with prepended YAML front-matter
    tmp = out_path.with_suffix(".tmp.md")
    tmp.write_text(meta_block + src_path.read_text(encoding="utf-8"), encoding="utf-8")

    cmd = [
        "pandoc",
        str(tmp),
        "--pdf-engine=weasyprint",
        f"--css={CSS}",
        "--standalone",
        "-V", f"title={title}",
        "-o", str(out_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    tmp.unlink(missing_ok=True)

    if result.returncode == 0:
        size_kb = out_path.stat().st_size // 1024
        print(f"  OK  {out_path.name}  ({size_kb} KB)")
        return True
    else:
        print(f"  FAIL {out_path.name}")
        if result.stderr.strip():
            for line in result.stderr.strip().splitlines()[-6:]:
                print(f"       {line}")
        return False


def main():
    passed = 0
    failed = 0
    current_cat = None

    for (src_name, stem, title, category) in RELEASE:
        src = DOCS / src_name
        if not src.exists():
            print(f"  SKIP {src_name} — file not found")
            continue

        if category != current_cat:
            current_cat = category
            print(f"\n── {category} {'─' * (55 - len(category))}")

        out = OUT / f"{stem}.pdf"
        ok = run_pandoc(src, out, title, category)
        if ok:
            passed += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"Release 1 PDFs: {passed} generated, {failed} failed")
    print(f"Output directory: {OUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
