#!/bin/bash
# sync-to-github.sh — Push current HEAD to khhodges/cloomc-project on GitHub.
# Called automatically by scripts/post-merge.sh after every Replit task merge.
# Requires the GITHUB_PAT secret to be set in Replit Secrets (no expiry, repo scope).
#
# On success: records ok status to server/github-sync-status.json.
# On failure: records fail status and sends an immediate Resend alert email.
#
# Usage:
#   scripts/sync-to-github.sh            # fast code-only push (LFS skipped)
#   scripts/sync-to-github.sh --with-lfs # code push PLUS LFS object upload

WITH_LFS=0
for arg in "$@"; do
    case "$arg" in
        --with-lfs) WITH_LFS=1 ;;
        *) echo "sync-to-github: unknown argument '$arg'" >&2; exit 1 ;;
    esac
done

REPO="khhodges/cloomc-project"
REMOTE_NAME="github-sync"
REMOTE_URL="https://x-access-token:${GITHUB_PAT}@github.com/${REPO}.git"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

_record_status() {
    local status="$1"
    local error_msg="$2"
    if [ -f "server/github_sync_alert.py" ]; then
        python3 server/github_sync_alert.py "$status" "$BRANCH" "$HEAD_SHA" "$error_msg" || true
    fi
}

if [ -z "${GITHUB_PAT:-}" ]; then
    echo "sync-to-github: GITHUB_PAT secret is not set — skipping GitHub sync."
    echo "  Set a classic GitHub PAT with 'repo' scope and no expiry in Replit Secrets."
    _record_status "fail" "GITHUB_PAT secret is not set"
    exit 0
fi

# Add or update the github-sync remote (safe to re-run)
if git remote get-url "$REMOTE_NAME" &>/dev/null; then
    git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
else
    git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

if [ "$WITH_LFS" -eq 1 ]; then
    echo "sync-to-github: pushing ${BRANCH} (${HEAD_SHA}) + LFS objects → github.com/${REPO} ..."

    # Push regular git objects first
    PUSH_OUTPUT=$(GIT_LFS_SKIP_PUSH=1 GIT_TRACE=0 \
        git push "$REMOTE_NAME" "HEAD:refs/heads/${BRANCH}" --force 2>&1)
    PUSH_EXIT=$?
    echo "$PUSH_OUTPUT"

    if [ "$PUSH_EXIT" -ne 0 ]; then
        echo "sync-to-github: push FAILED (exit $PUSH_EXIT)."
        _record_status "fail" "$PUSH_OUTPUT"
        exit "$PUSH_EXIT"
    fi

    echo "sync-to-github: uploading LFS objects ..."
    LFS_OUTPUT=$(GIT_TRACE=0 git lfs push "$REMOTE_NAME" "HEAD" 2>&1)
    LFS_EXIT=$?
    echo "$LFS_OUTPUT"

    if [ "$LFS_EXIT" -ne 0 ]; then
        echo "sync-to-github: LFS upload FAILED (exit $LFS_EXIT)."
        _record_status "fail" "$LFS_OUTPUT"
        exit "$LFS_EXIT"
    fi

    echo "sync-to-github: push + LFS upload succeeded."
    _record_status "ok" ""
else
    # Disable LFS for this remote so we only push regular git objects.
    # LFS binaries are large; routine code sync doesn't need them.
    git config "remote.${REMOTE_NAME}.lfsurl" "https://github.com/${REPO}.git/info/lfs" 2>/dev/null || true
    git config "lfs.${REMOTE_URL}/info/lfs.locksverify" "false" 2>/dev/null || true

    echo "sync-to-github: pushing ${BRANCH} (${HEAD_SHA}) → github.com/${REPO} (LFS skipped) ..."

    # Capture both stdout+stderr and exit code from the push.
    PUSH_OUTPUT=$(
        GIT_LFS_SKIP_PUSH=1 \
        GIT_TRACE=0 \
            git -c "lfs.${REMOTE_URL}.locksverify=false" \
                push "$REMOTE_NAME" "HEAD:refs/heads/${BRANCH}" --force 2>&1
    )
    PUSH_EXIT=$?

    echo "$PUSH_OUTPUT"

    if [ "$PUSH_EXIT" -ne 0 ]; then
        echo "sync-to-github: push FAILED (exit $PUSH_EXIT)."
        _record_status "fail" "$PUSH_OUTPUT"
        exit "$PUSH_EXIT"
    fi

    echo "sync-to-github: push succeeded (LFS objects not uploaded; run with --with-lfs to include them)."
    _record_status "ok" ""
fi
