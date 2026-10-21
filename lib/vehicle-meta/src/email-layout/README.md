# Dealership email layout

Visual components adapted from the supplied Luxxy email template package 1.1.0 (19 October 2026), MIT licence included.

Only presentation components and their small pure helpers are used. The supplied strict orchestration/default copy is deliberately not installed: existing `email-templates.ts` retains the public contract, dealer copy, interpolation, reference filtering, facts, links and text alternative. No settings migration or sending behaviour change. `compatible-layout.ts` adapts validated presentation inputs; it neither fetches nor sends.

Local adaptations: preserve existing prose without injecting greetings/signoffs or attachment claims; keep all supplied fact rows, zero values and secure prose links; interpolate branding upstream; avoid repeating the same dealer heading; keep responsive typography and accessible table-based layout.

`legacy-email-templates.ts` freezes the previous renderer only for queued messages approved before this upgrade. New outbox validation records carry `layoutVersion: correspondence-v1`; missing markers use `legacy-v1`, unknown markers fail closed. No queued payload is rewritten, and retries still transport their original stored bytes.
