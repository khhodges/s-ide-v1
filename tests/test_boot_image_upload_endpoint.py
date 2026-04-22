"""End-to-end tests for POST /api/boot-image/upload.

Task #389: The endpoint validates images before saving, but there were no
automated tests covering this path.  This module exercises two cases
against the Flask test client:

  1. A boot image that has the correct format-version tag but a zeroed
     mandatory NS slot (slot 0) — must return 400 with "mandatory NS slot"
     in the error message.

  2. A well-formed image produced by generate_boot_image() — must return 200
     with ok=True.

Neither case requires a saved boot-config.json on disk; the invalid-image
case is crafted purely in memory, and the valid-image case generates the
image at test time from a default config.
"""
import base64
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    BOOT_IMAGE_FORMAT_TAG,
    generate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
            "abstractionLumpWords":  256,
        },
    }


def _zero_ns_slot(image_bytes, cfg, slot):
    """Return a copy of image_bytes with word0 and word1 of NS slot zeroed."""
    total = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base = total - NS_TABLE_RESERVE
    slot_base = ns_table_base + slot * NS_ENTRY_WORDS
    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[slot_base]     = 0
    words[slot_base + 1] = 0
    return struct.pack(f"<{total}I", *words)


def _to_b64(image_bytes):
    return base64.b64encode(image_bytes).decode("ascii")


@pytest.fixture(scope="module")
def client():
    from server.app import app  # noqa: E402 — deferred to avoid side-effects at import
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_upload_bad_boot_image_returns_400_mandatory_ns_slot(client):
    """POST a boot image with a zeroed mandatory NS slot — expect 400 with
    an error message that mentions 'mandatory NS slot'."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    bad_image = _zero_ns_slot(image, cfg, slot=0)

    resp = client.post(
        "/api/boot-image/upload",
        json={"data_b64": _to_b64(bad_image)},
    )

    assert resp.status_code == 400, (
        f"Expected 400 for image with zeroed NS slot 0, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert body.get("ok") is False, f"Expected ok=false in error response, got {body}"
    error_msg = body.get("error", "")
    assert "mandatory NS slot" in error_msg, (
        f"Expected 'mandatory NS slot' in error message, got: {error_msg!r}"
    )


def test_upload_valid_boot_image_returns_200(client):
    """POST a well-formed boot image produced by generate_boot_image() — expect 200."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    resp = client.post(
        "/api/boot-image/upload",
        json={"data_b64": _to_b64(image)},
    )

    assert resp.status_code == 200, (
        f"Expected 200 for a valid boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert body.get("ok") is True, f"Expected ok=true in success response, got {body}"
    assert body.get("bytes") == len(image), (
        f"Response 'bytes' field {body.get('bytes')} != image length {len(image)}"
    )
    assert body.get("words") == len(image) // 4, (
        f"Response 'words' field {body.get('words')} != {len(image) // 4}"
    )
