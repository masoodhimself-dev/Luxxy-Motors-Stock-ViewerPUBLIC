---
name: Single-dealer architecture
description: Permanent project boundary separating dealership isolation from multi-source stock support.
---

This project represents exactly one dealership. Each additional dealership must use a separate application deployment, PostgreSQL database, and secrets/configuration. Do not reintroduce organizations, tenants, tenant-scoped keys, or shared-database multi-tenancy.

**Why:** The multi-tenant SaaS direction was explicitly cancelled in favor of operational and data isolation per dealership.

**How to apply:** Keep this project reusable as a single-dealer master template with onboarding-time dealership configuration. Multiple stock sources inside the one dealership project are allowed, but they must not become tenant abstractions.