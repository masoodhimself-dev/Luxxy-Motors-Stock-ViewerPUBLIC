---
name: OpenAPI codegen Zod compatibility
description: OpenAPI constraints must stay compatible with the workspace's generated Zod runtime.
---

Keep API-spec constraints compatible with the Zod version consumed by `@workspace/api-zod`; prefer existing numeric/string checks when generated helpers are not supported.

**Why:** The code generator can emit newer helper APIs for seemingly normal OpenAPI formats and integer constraints, while the workspace runtime may still use an older Zod major version.

**How to apply:** After changing `lib/api-spec/openapi.yaml`, run codegen and the library typecheck before building artifact packages; inspect generated Zod output if codegen typechecking fails.