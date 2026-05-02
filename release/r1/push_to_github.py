#!/usr/bin/env python3
"""
Upload Release 1 PDFs to GitHub via the Contents API.
Handles files too large for shell $(...) by writing JSON to a temp file.
"""
import base64, json, os, sys, urllib.request, urllib.error

PAT    = os.environ.get("GITHUB_PAT", "")
REPO   = "khhodges/cloomc-project"
BRANCH = "main"
BASE   = os.path.dirname(os.path.abspath(__file__))

PDFS = sorted(f for f in os.listdir(BASE) if f.startswith("ctmm-r1-") and f.endswith(".pdf"))

def api(method, path, body=None):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {PAT}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r), r.status
    except urllib.error.HTTPError as e:
        return json.load(e), e.code

def get_sha(path):
    result, status = api("GET", path)
    if status == 200:
        return result.get("sha")
    return None

passed, failed = 0, 0

for fname in PDFS:
    local = os.path.join(BASE, fname)
    remote_path = f"release/r1/{fname}"

    with open(local, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode()

    sha = get_sha(remote_path)
    payload = {
        "message": f"Release 1: {'update' if sha else 'add'} {fname}",
        "content": content_b64,
        "branch": BRANCH,
    }
    if sha:
        payload["sha"] = sha

    result, status = api("PUT", remote_path, payload)

    if status in (200, 201):
        size_kb = os.path.getsize(local) // 1024
        action = "updated" if sha else "created"
        print(f"  OK  {fname}  ({size_kb} KB) — {action}")
        passed += 1
    else:
        msg = result.get("message", str(result))
        print(f"  FAIL  {fname}  [{status}] {msg}")
        failed += 1

print(f"\n{'='*60}")
print(f"Uploaded: {passed}   Failed: {failed}")
print(f"https://github.com/{REPO}/tree/{BRANCH}/release/r1")
sys.exit(1 if failed else 0)
