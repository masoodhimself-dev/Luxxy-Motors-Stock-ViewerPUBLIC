---
name: OpenAPI codegen Zod compatibility
description: OpenAPI constraints must stay compatible with the workspace's generated Zod runtime.
---

Keep API-spec constraints compatible with the Zod version consumed by `@workspace/api-zod`; prefer existing numeric/string checks when generated helpers are not supported.

**Why:** The code generator can emit newer helper APIs for seemingly normal OpenAPI formats and integer constraints, while the workspace runtime may still use an older Zod major version.

**How to apply:** After changing `lib/api-spec/openapi.yaml`, verify operation paths/methods against the server routes, then run codegen and the library typecheck before building artifact packages; inspect generated Zod output if codegen typechecking fails. Generated runtime validators use operation-specific names such as `Update...Body` and `...Response`; generated client interfaces are types only and cannot be parsed at runtime.