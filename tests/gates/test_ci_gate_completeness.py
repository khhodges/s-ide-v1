"""CI gate completeness guard.

Parses .replit and asserts that every required test workflow:
  1. Exists as a named ``[[workflows.workflow]]`` block.
  2. Is referenced by the ``Project`` parallel workflow so it can be run
     via the Run button.

Tests are intentionally manual — ``isValidation = true`` has been removed
from all test workflows so they no longer fire automatically on merge.
Adding a new test workflow?  Add its name to REQUIRED_VALIDATIONS.
Removing one?  Remove it from the list (and justify the removal in the PR).
"""

import os
import re

ROOT   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPLIT = os.path.join(ROOT, '.replit')

REQUIRED_VALIDATIONS = [
    "check-stale-cr7",
    "e2e-tests",
    "assembler-tests",
    "lump-consistency",
    "fault-recovery-tests",
    "lump-binary-tests",
    "selftest-lump-runs",
]


def _parse_replit():
    with open(REPLIT, encoding='utf-8') as f:
        text = f.read()
    return text


def _workflow_blocks(text):
    """Return a dict mapping workflow name -> raw block text."""
    pattern = re.compile(
        r'\[\[workflows\.workflow\]\]\s*\n(.*?)(?=\[\[workflows\.workflow\]\]|\Z)',
        re.DOTALL,
    )
    blocks = {}
    for m in pattern.finditer(text):
        block = m.group(1)
        name_m = re.search(r'^name\s*=\s*"([^"]+)"', block, re.MULTILINE)
        if name_m:
            blocks[name_m.group(1)] = block
    return blocks


def _project_task_names(text):
    """Return the set of workflow names referenced in the Project parallel workflow."""
    project_m = re.search(
        r'\[\[workflows\.workflow\]\]\s*\nname\s*=\s*"Project".*?(?=\[\[workflows\.workflow\]\]|\Z)',
        text,
        re.DOTALL,
    )
    if not project_m:
        return set()
    block = project_m.group(0)
    return set(re.findall(r'args\s*=\s*"([^"]+)"', block))


def test_required_validations_are_defined():
    """Every required validation has a [[workflows.workflow]] block in .replit."""
    text = _parse_replit()
    blocks = _workflow_blocks(text)
    missing = [name for name in REQUIRED_VALIDATIONS if name not in blocks]
    assert not missing, (
        f'Required CI validations missing from .replit workflow definitions: {missing}'
    )


def test_no_workflow_has_is_validation_true():
    """No workflow should have isValidation = true — tests are manual-only."""
    text = _parse_replit()
    flagged = re.findall(r'isValidation\s*=\s*true', text)
    assert not flagged, (
        f'Found {len(flagged)} workflow(s) with isValidation = true. '
        'Tests must be manual — remove isValidation = true from all test workflows.'
    )


def test_required_validations_are_in_project_workflow():
    """Every required validation is referenced in the Project parallel workflow."""
    text = _parse_replit()
    project_tasks = _project_task_names(text)
    missing = [name for name in REQUIRED_VALIDATIONS if name not in project_tasks]
    assert not missing, (
        f'Required CI validations are not wired into the Project workflow: {missing}. '
        'Add [[workflows.workflow.tasks]] task = "workflow.run" / args = "<name>" '
        'under the Project workflow in .replit.'
    )
