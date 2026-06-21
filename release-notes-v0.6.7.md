# v0.6.7 — Fix module loading crash (round 2)

## Bug

The v0.6.6 fix (try-catch around `import()` of pi-coding-agent) was insufficient.
Two files had **top-level value imports** that compiled to synchronous `require()` calls,
executing during jiti module loading — before the factory's try-catch block.

## Affected files

- `src/tools/grep.ts` — `import { keyHint } from "@earendil-works/pi-coding-agent"`
- `src/render.ts` — `import { truncateToWidth } from "@earendil-works/pi-tui"`

These triggered the chain:
`require("@earendil-works/pi-coding-agent")` → pi-agent-core → `@earendil-works/pi-ai/base`
→ jiti can't resolve the subpath export → crash during module load

## Fix

- `grep.ts`: Replaced `keyHint` with inline fallback text
- `render.ts`: Replaced `truncateToWidth` with lazy `require()` inside helper function

Both are now evaluated at render time, not module load time.
