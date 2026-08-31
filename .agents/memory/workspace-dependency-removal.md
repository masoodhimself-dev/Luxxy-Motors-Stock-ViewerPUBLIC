---
name: Workspace dependency removal
description: Removing a dependency from a nested pnpm workspace package may need explicit manifest and lockfile verification.
---

When removing a dependency from an artifact package, verify that the artifact's own package.json and the workspace lockfile no longer contain it; a generic package-tool removal can report success without changing the nested package manifest.

**Why:** The workspace contains multiple package manifests, while package tooling may operate at the workspace root unless the target package is explicit.

**How to apply:** After any dependency removal, search the target package manifest and lockfile for the package name, then synchronize the lockfile before typechecking.