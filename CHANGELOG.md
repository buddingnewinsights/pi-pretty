# Changelog

## [0.6.9] - 2026-06-21

### Fixed

- **Published extension crash on Pi session start/resume** — `multi-grep` imports
  `Type` from `typebox` at module load time, so the built extension executes
  `require("typebox")` while Pi loads `dist/index.js`. The package did not declare
  `typebox` as a runtime dependency, so clean published installs could crash before
  session handlers ran.

  Fix: added `typebox` as a direct dependency and refreshed the lockfile so clean
  extension installs include the module.

## [0.6.8] - 2026-06-21

### Fixed

- **Tool registration crash when pi-tui not aliased** — Every tool file had an
  **IIFE** that eagerly called `require("@earendil-works/pi-tui")` during tool
  registration. In pi installations that don't alias pi-tui (e.g. `pikit` project),
  this crashed the extension before it could load.

  Fix: introduced `src/tui-text.ts` with a lazy `resolveTextCtor()` function that
  catches the missing-module error and returns a no-op stub Text class. All six
  tool files (`bash.ts`, `find.ts`, `grep.ts`, `ls.ts`, `multi-grep.ts`,
  `read.ts`) now use this instead of the eager IIFE.

## [0.6.7] - 2026-06-21

### Fixed

- **Module loading crash before factory execution** — The v0.6.6 fix wrapped
  `import("@earendil-works/pi-coding-agent")` in a try-catch block inside the
  extension factory, but two files (`src/tools/grep.ts` and `src/render.ts`) had
  **top-level value imports** from `@earendil-works/pi-coding-agent` (`keyHint`)
  and `@earendil-works/pi-tui` (`truncateToWidth`). These compiled to top-level
  `require()` calls that executed during **jiti module loading** (before the
  factory), causing the extension to crash before the try-catch could fire.

  Fix:
  - `grep.ts`: replaced `import { keyHint }` with inline fallback text
  - `render.ts`: replaced `import { truncateToWidth }` with lazy `require()`
    inside a helper function (avoids top-level evaluation)

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
