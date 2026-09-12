---
name: Wukong poll rejection containment
description: Async hardware polling must contain state-update failures as well as network failures.
---

The Wukong hardware poll runs from `setInterval` as an async callback. Every operation in the callback, including connection-state observers, DOM updates, and health-banner state changes, must be inside one outer rejection boundary.

**Why:** An exception after a successful fetch is still an unhandled promise rejection when the callback is invoked by `setInterval`; the browser artifact monitor can terminate the IDE even though the network guards appear correct.

**How to apply:** Keep narrow fetch guards for expected transport failures, then retain a final outer `try/catch` around the complete poll cycle. Do not rely on `setInterval` to observe or handle a returned promise.