---
name: Makefile tab rule
description: The edit tool silently converts tab characters to spaces in Makefile recipe lines, causing "missing separator" build failures.
---

## Rule

Never use the `edit` tool to modify a Makefile. Always use the `write` tool to rewrite the whole file.

**Why:** The `edit` tool converts leading tab characters to spaces in recipe lines. GNU make requires hard tab characters at the start of recipe lines; spaces produce `*** missing separator. Stop.` errors. The conversion is silent — the diff looks correct but the file is broken.

**How to apply:** Any time a Makefile needs editing, read it first with `read`, modify the content in memory, then overwrite with `write`. Confirm the recipe lines start with real tabs: `cat -A Makefile | grep -E "^\^I"` (shows `^I` for tabs).
