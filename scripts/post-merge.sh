#!/bin/bash
set -e

# Runs automatically after a task merge, with stdin closed. Keep every step non-interactive.

# A merged task may bring new dependencies whose lockfile entry did not survive the merge,
# so do not insist on a frozen lockfile here.
pnpm install --no-frozen-lockfile

# --force: drizzle-kit prompts before destructive statements, and a prompt here would hang.
pnpm --filter @workspace/db run push-force
