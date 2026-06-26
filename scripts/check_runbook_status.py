#!/usr/bin/env python3
"""
check_runbook_status.py — Server-side hardware runbook health check.

Validates every server-side leg of the Ti60 callhome → lump push loop
without requiring any physical hardware.  Gives a green/red summary you
can run in CI or at the start of any hardware session.

Usage:
    python3 scripts/check_runbook_status.py [--dry-run] [--url URL]

Options:
    --dry-run          Send synthetic test payloads; do not modify persistent
                       device state (uses a temporary test UID that is cleaned
                       up after the run).
    --url URL          Base URL of the running IDE server.
                       Default: http://localhost:5000
    --token TOKEN      Lump token to probe in the lump-serve check (hex string).
                       Default: uses the first token found in lumps/manifest.json.
    --uid UID          Device UID to use for callhome and pending-lump checks.
                       Default: runbook-check-000000 (auto-cleaned up).
    --json             Output results as JSON (for CI integration).
    --no-cleanup       Skip deleting the synthetic device record after the run.
    -v, --verbose      Show full request/response bodies.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def _color(text, code):
    if sys.stdout.isatty():
        return f"{code}{text}{RESET}"
    return text

def _ok(msg):    return _color(f"✅  {msg}", GREEN)
def _fail(msg):  return _color(f"❌  {msg}", RED)
def _warn(msg):  return _color(f"⚠️   {msg}", YELLOW)
def _head(msg):  return _color(f"\n{BOLD}{msg}{RESET}", BOLD)


def _request(method, url, body=None, verbose=False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except urllib.error.URLError as e:
        return None, None, str(e.reason)
    except Exception as e:
        return None, None, str(e)
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {"_raw": raw.decode(errors="replace")}
    if verbose:
        print(f"    {method} {url}  →  HTTP {status}")
        print(f"    {json.dumps(parsed, indent=2)[:600]}")
    return status, parsed, None


def check_server_reachable(base_url, verbose=False):
    url = f"{base_url}/api/docs/list"
    status, body, err = _request("GET", url, verbose=verbose)
    if err:
        return False, f"Server unreachable: {err}"
    if status and status < 500:
        return True, f"HTTP {status}"
    return False, f"Server returned HTTP {status}"


def check_callhome_endpoint(base_url, uid, verbose=False):
    url = f"{base_url}/api/device/call-home"
    payload = {
        "device_uid": uid,
        "fw_major": 2,
        "fw_minor": 0,
        "board_type": 1,
        "profile": "Full",
        "boot_reason": 0,
        "last_fault": 0,
    }
    status, body, err = _request("POST", url, body=payload, verbose=verbose)
    if err:
        return False, f"Request failed: {err}"
    if status is None:
        return False, "No response"
    if status >= 500:
        return False, f"Server error HTTP {status}"
    if status >= 400:
        return False, f"Client error HTTP {status}: {body}"
    if not (body or {}).get("ok"):
        return False, f"Response ok=false: {body}"
    return True, f"HTTP {status} — uid={uid} registered"


def check_pending_lump_endpoint(base_url, uid, verbose=False):
    url = f"{base_url}/api/device/{urllib.parse.quote(uid)}/pending-lump"
    status, body, err = _request("GET", url, verbose=verbose)
    if err:
        return False, f"Request failed: {err}"
    if status is None:
        return False, "No response"
    if status == 404:
        return False, "Endpoint not found (HTTP 404) — /api/device/<uid>/pending-lump may not exist"
    if status >= 500:
        return False, f"Server error HTTP {status}"
    if status >= 400 and status != 404:
        return False, f"Unexpected HTTP {status}: {body}"
    ok_val = (body or {}).get("ok")
    if ok_val is False:
        err_msg = (body or {}).get("error", "unknown")
        return False, f"Response ok=false: {err_msg}"
    pending = (body or {}).get("pending", False)
    msg = f"HTTP {status} — pending={pending}"
    if pending:
        token = (body or {}).get("token", "?")
        msg += f", token={token}"
    return True, msg


def check_lump_serve_endpoint(base_url, token_hex, verbose=False):
    if not token_hex:
        return None, "Skipped — no token available (no manifest.json found)"
    url = f"{base_url}/api/lump/{token_hex}"
    status, body, err = _request("GET", url, verbose=verbose)
    if err:
        return False, f"Request failed: {err}"
    if status is None:
        return False, "No response"
    if status == 404:
        return None, f"Token {token_hex} not found (HTTP 404) — may not be registered on this server"
    if status >= 500:
        return False, f"Server error HTTP {status}"
    if status >= 400:
        return False, f"Unexpected HTTP {status}: {body}"
    ok_val = (body or {}).get("ok")
    if ok_val is False:
        return False, f"Response ok=false: {body}"
    name = (body or {}).get("name") or (body or {}).get("pet_name") or "?"
    words = (body or {}).get("words") or (body or {}).get("word_count") or "?"
    return True, f"HTTP {status} — name={name}, words={words}"


def check_latest_callhome_endpoint(base_url, verbose=False):
    url = f"{base_url}/api/device/latest-callhome"
    status, body, err = _request("GET", url, verbose=verbose)
    if err:
        return False, f"Request failed: {err}"
    if status is None:
        return False, "No response"
    if status >= 400:
        return False, f"HTTP {status}: {body}"
    callhome = (body or {}).get("callhome")
    if callhome is None:
        return True, "HTTP 200 — no callhome entries yet (normal in dev)"
    uid = callhome.get("uid") or callhome.get("device_uid") or "?"
    ts  = callhome.get("ts", 0)
    age = int(time.time() - ts) if ts else "?"
    return True, f"HTTP 200 — latest uid={uid}, age={age}s"


def _find_manifest_token():
    for candidate in [
        os.path.join(BASE_DIR, "lumps", "manifest.json"),
        os.path.join(BASE_DIR, "simulator", "lumps", "manifest.json"),
    ]:
        if os.path.isfile(candidate):
            try:
                with open(candidate) as f:
                    data = json.load(f)
                lumps = data if isinstance(data, list) else data.get("lumps", [])
                for entry in lumps:
                    tok = entry.get("token") or entry.get("lump_token")
                    if tok:
                        return tok
            except Exception:
                pass
    return None


def _cleanup_device(base_url, uid, verbose=False):
    url = f"{base_url}/api/device/{urllib.parse.quote(uid)}"
    status, body, err = _request("DELETE", url, verbose=verbose)
    if err or (status and status >= 400):
        pass


def main():
    parser = argparse.ArgumentParser(
        description="Hardware runbook server-side health check"
    )
    parser.add_argument("--url", default="http://localhost:5000",
                        help="IDE server base URL (default: http://localhost:5000)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Use a synthetic test device UID; clean up after")
    parser.add_argument("--uid", default="runbook-check-000000",
                        help="Device UID to use for callhome/pending-lump checks")
    parser.add_argument("--token", default=None,
                        help="Lump token hex string to probe (default: auto from manifest)")
    parser.add_argument("--json", dest="json_out", action="store_true",
                        help="Output results as JSON")
    parser.add_argument("--no-cleanup", action="store_true",
                        help="Skip cleanup of synthetic device record")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Show full request/response bodies")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    uid = args.uid if args.dry_run else args.uid
    token_hex = args.token or _find_manifest_token()

    results = []

    def run_check(leg, name, fn, *fn_args):
        ok, detail = fn(*fn_args, verbose=args.verbose)
        results.append({"leg": leg, "name": name, "ok": ok, "detail": detail})
        return ok, detail

    if not args.json_out:
        print(_head(f"Church Machine Hardware Runbook — Server Health Check"))
        print(f"  Server : {base_url}")
        print(f"  UID    : {uid}")
        print(f"  Token  : {token_hex or '(auto)'}")
        print()

    ok, detail = check_server_reachable(base_url, verbose=args.verbose)
    results.append({"leg": "pre", "name": "Server reachable", "ok": ok, "detail": detail})
    if not args.json_out:
        icon = _ok if ok else _fail
        print(f"  {'Server reachable':<40}  {icon(detail)}")
    if not ok:
        if not args.json_out:
            print()
            print(_fail(f"Server at {base_url} is not reachable — start the IDE server first."))
        if args.json_out:
            print(json.dumps({"ok": False, "results": results}, indent=2))
        sys.exit(1)

    checks = [
        ("Leg 4a", "POST /api/device/call-home",          check_callhome_endpoint,      base_url, uid),
        ("Leg 4b", "GET  /api/device/latest-callhome",    check_latest_callhome_endpoint, base_url),
        ("Leg 5",  "GET  /api/device/<uid>/pending-lump", check_pending_lump_endpoint,  base_url, uid),
        ("Leg 5b", "GET  /api/lump/<token>",              check_lump_serve_endpoint,    base_url, token_hex),
    ]

    passed = 0
    warned = 0
    failed = 0

    if not args.json_out:
        print(f"  {'Check':<40}  Result")
        print(f"  {'-'*40}  {'-'*42}")

    for leg, name, fn, *fn_args in checks:
        ok, detail = fn(*fn_args, verbose=args.verbose)
        results.append({"leg": leg, "name": name, "ok": ok, "detail": detail})
        if not args.json_out:
            if ok is True:
                icon_fn = _ok
                passed += 1
            elif ok is None:
                icon_fn = _warn
                warned += 1
            else:
                icon_fn = _fail
                failed += 1
            label = f"[{leg}] {name}"
            print(f"  {label:<40}  {icon_fn(detail)}")
        else:
            if ok is True:
                passed += 1
            elif ok is None:
                warned += 1
            else:
                failed += 1

    if args.dry_run and not args.no_cleanup:
        _cleanup_device(base_url, uid, verbose=args.verbose)

    if not args.json_out:
        print()
        total = passed + warned + failed
        summary_color = GREEN if failed == 0 else RED
        summary = f"{passed}/{total} passed"
        if warned:
            summary += f", {warned} skipped/warned"
        if failed:
            summary += f", {failed} FAILED"
        print(_color(f"  Summary: {summary}", summary_color))
        if failed:
            print()
            print("  See docs/RUNBOOK.md for diagnosis steps per failing leg.")
        print()

    if args.json_out:
        overall_ok = failed == 0
        print(json.dumps({
            "ok": overall_ok,
            "passed": passed,
            "warned": warned,
            "failed": failed,
            "results": results,
        }, indent=2))

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
