---
name: Workspace typecheck and project references
description: Why a single artifact's typecheck reports phantom "cannot find module"/missing-property errors for a workspace lib, and the correct order to run checks after pulling or rebasing.
---

Run the **root** typecheck for the workspace, not an artifact's own typecheck script, whenever a shared lib may have changed. The root script builds the lib project references first and then typechecks each artifact; an artifact script alone skips that build.

**Why:** shared libs under `lib/` are TypeScript composite projects that emit declarations only, into an ignored `dist/`. When an artifact imports one, TypeScript resolves the import through that referenced project's declaration output. If the lib has never been built in this checkout, the import fails with `TS2307 cannot find module`, and every type derived from it collapses into a cascade of misleading "property does not exist on type X" errors in files that are perfectly correct. The real error hides at the top of the output — always read the head of a typecheck run, not just the tail.

**How to apply:** after a rebase or merge that brings in a new or changed shared lib, run `pnpm install` at the root first (a brand-new lib has no `node_modules` symlink yet, which breaks the dev server and vitest with "failed to resolve import"), then the root typecheck. Only after both are clean should a failure be treated as real. A lib that arrives with a merge is not broken code just because it fails to resolve on first run.
