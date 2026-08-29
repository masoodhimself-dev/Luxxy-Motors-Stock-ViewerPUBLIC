---
name: Owned import-run retention
description: Why tenant-owned stock import runs must remain immutable while stock or change history references them.
---

Tenant-owned import runs must not be deleted while vehicles or change history reference them. Any future retention feature must explicitly reassign or archive references without clearing tenant or integration ownership.

**Why:** A legacy delete rule nulls an import-run reference. Applied through a composite tenant relationship, an unrestricted nulling action can also clear ownership columns and make valid stock disappear from scoped reads.

**How to apply:** Treat owned run deletion as restricted. When changing retention or audit cleanup, test both owned rows and legacy unowned rows, and prove dealer/integration ownership remains intact.