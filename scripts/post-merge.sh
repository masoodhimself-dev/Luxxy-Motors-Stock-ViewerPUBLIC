#!/bin/bash
set -e

# Runs automatically after a task merge, with stdin closed. Keep every step non-interactive.

# A merge must never change a shared database. Schema changes are reviewed SQL
# migrations, applied separately against an explicitly selected database.
pnpm install --frozen-lockfile
