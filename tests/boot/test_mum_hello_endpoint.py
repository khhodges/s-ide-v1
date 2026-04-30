"""Server-side regression test: POST /mum/hello returns the canonical
Hello-Mum greeting response.

Verifies that the Stage 4 bridge endpoint:
  - Returns HTTP 200
  - Returns ok=True
  - Returns result=0x48454C4C ('HELL')
  - Returns tunnel='online'

This catches regressions in the mum_hello() view function (app.py) and
ensures the Tunnel bridge endpoint is reachable and returns the correct
response structure that the simulator UI and Keystone.Hello() dispatch expect.
"""
import pytest


ROOT_GREET = 0x48454C4C


@pytest.fixture(scope="module")
def client():
    from server.app import app  # noqa: E402 — deferred to avoid side-effects at import
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_mum_hello_returns_ok_true(client):
    """POST /mum/hello returns HTTP 200 with ok=True."""
    resp = client.post("/mum/hello", content_type="application/json", data="{}")
    assert resp.status_code == 200, (
        f"POST /mum/hello returned HTTP {resp.status_code}, expected 200"
    )
    data = resp.get_json()
    assert data is not None, "POST /mum/hello did not return a JSON body"
    assert data.get("ok") is True, (
        f"POST /mum/hello returned ok={data.get('ok')!r}, expected True"
    )


def test_mum_hello_returns_greet_response(client):
    """POST /mum/hello returns result=0x48454C4C ('HELL')."""
    resp = client.post("/mum/hello", content_type="application/json", data="{}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data is not None, "POST /mum/hello did not return a JSON body"
    assert data.get("result") == ROOT_GREET, (
        f"POST /mum/hello result=0x{data.get('result', 0):08X}, "
        f"expected 0x{ROOT_GREET:08X} (GREET_RESPONSE)"
    )


def test_mum_hello_returns_tunnel_online(client):
    """POST /mum/hello returns tunnel='online' signalling the bridge is live."""
    resp = client.post("/mum/hello", content_type="application/json", data="{}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data is not None, "POST /mum/hello did not return a JSON body"
    assert data.get("tunnel") == "online", (
        f"POST /mum/hello tunnel={data.get('tunnel')!r}, expected 'online'"
    )


def test_mum_hello_full_roundtrip(client):
    """POST /mum/hello returns a complete response matching the expected contract.

    Combines all field checks into one round-trip assertion:
      ok=True, result=0x48454C4C, tunnel='online'

    This is the canonical integration point for the Hello-Mum flow: the
    simulator calls this endpoint after Keystone.Hello() dispatches through
    Tunnel.Call, and expects exactly these fields back to confirm the greeting.
    """
    resp = client.post("/mum/hello", content_type="application/json", data="{}")
    assert resp.status_code == 200, (
        f"POST /mum/hello returned HTTP {resp.status_code}, expected 200"
    )
    data = resp.get_json()
    assert data is not None, "POST /mum/hello did not return a JSON body"

    assert data.get("ok") is True, (
        f"ok={data.get('ok')!r} — expected True"
    )
    assert data.get("result") == ROOT_GREET, (
        f"result=0x{data.get('result', 0):08X} — expected 0x{ROOT_GREET:08X}"
    )
    assert data.get("tunnel") == "online", (
        f"tunnel={data.get('tunnel')!r} — expected 'online'"
    )
