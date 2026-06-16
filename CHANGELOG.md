# Changelog

## [0.6.4] - 2026-06-16

### Fixed

- **FFF service not loading** — Extension activation used `require("@ff-labs/fff-node")`
  which fails because the package is ESM-only (only `"import"` export, no `"require"`).
  The async `import()` fallback never resolved before tool registration, leaving
  `fffService` permanently `null`. Tool execution never loaded FFF.

  Fix: always create `FffService(undefined, agentDir)` during activation. The
  `tryLoadModule()` in the tool execution handler uses `await import()` which
  correctly loads the ESM-only package. The broken synchronous `require()` +
  orphaned `.then()` pattern is removed.
