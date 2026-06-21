# Changelog

## [0.6.6] - 2026-06-21

### Fixed

- **Extension load failure via jiti CJS interop** — When pi loads `pi-pretty` as
  an extension, it uses jiti as the module loader. `pi-pretty`'s SDK fallback used
  synchronous `require("@earendil-works/pi-coding-agent")` which triggers jiti's
  CJS interop for ESM modules. The pi-ai package only has `"import"` conditions in
  its `exports` map for subpath exports like `./base`. CJS resolution can't match
  `"import"` conditions and falls back to legacy resolution — treating the main
  entry `./dist/index.js` as a directory and appending `/base`, resulting in:
  `Cannot find module '.../pi-ai/dist/index.js/base'`.

  Fix: replaced `require()` with `await import()` (dynamic ESM import), which
  correctly resolves ESM subpath exports through the package's `exports` map.
  The function signature was changed to `async` to support this.

## [0.6.5] - 2026-06-16

### Fixed

- **npm package missing dist/** — `.gitignore` excluded `dist/` from the published
  npm package (`dist/` is in `.gitignore`, which npm uses as `.npmignore` by default
  when no `.npmignore` exists). Pi could only see TypeScript source files, not compiled
  JavaScript. The extension loaded but FFF service never initialized.

  Fix: added `"files": ["dist/", "CHANGELOG.md", "src/"]` and `"main": "dist/index.js"`
  to package.json to explicitly include compiled output in the published package.

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
