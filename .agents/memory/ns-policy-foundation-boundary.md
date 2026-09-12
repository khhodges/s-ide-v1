---
name: Namespace policy foundation boundary
description: Distinguishes foundational/MMIO Namespace slots from catalog LUMP slots when validating resident build policies.
---

Only Boot.NS and Boot.Thread are foundational RAM slots. UART, LED, BTN, TIMER, and M_BIT are separate MMIO slots. Catalog LUMPs at slots 6–10, including SelfTest and WukongCallHome, may legitimately have Resident/Lazy build policies and must not be rejected as reserved. Their policy belongs in slotRules, not resident step2 rows, because boot layout owns their physical addresses.

**Why:** Treating the entire built-in catalog range as reserved caused Namespace saves to commit successfully but fail while saving the next-build configuration for resident slot 6.

**How to apply:** Keep foundational/MMIO reservation checks separate from catalog membership checks. A catalog slot's policy is saved through slotRules; only a genuinely user-placed resident row needs a physAddr and placement validation.