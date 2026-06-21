---
name: app.py raw SQL pattern
description: server/app.py has no sqlite3 import — all DB access must use SQLAlchemy db.session; never _sqlite3.connect()
---

server/app.py uses SQLAlchemy exclusively for DB operations. It does NOT have `import sqlite3` or `_sqlite3` defined. Only `hardware/soc_combined/callhome_bridge.py` uses `import sqlite3 as _sqlite3`.

**Rule:** In any new Flask endpoint in app.py, use:
```python
row = db.session.execute(
    _sa_text("SELECT col FROM table WHERE uid=:uid"),
    {"uid": uid}
).fetchone()

db.session.execute(
    _sa_text("INSERT OR REPLACE INTO table (uid, col) VALUES (:uid, :val)"),
    {"uid": uid, "val": val}
)
db.session.commit()
```

Never write `_sqlite3.connect(db_path)` or `sqlite3.connect(...)` in app.py — it will NameError at runtime.

**Why:** app.py was written entirely against Flask-SQLAlchemy. `_sqlite3` is only imported in the bridge script for its own standalone use. Mixing native sqlite3 into app.py would bypass the ORM session lifecycle (transaction management, connection pooling, thread safety).

**How to apply:** Whenever adding a new raw-SQL table to app.py (e.g. device_lump_state), create it in the DB init block with `db.session.execute(_sa_text("CREATE TABLE IF NOT EXISTS ..."))`, then access it in endpoints via `db.session.execute(_sa_text(...), params)`.
