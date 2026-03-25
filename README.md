# pi-pretty

A [pi](https://pi.dev) extension that enhances built-in tool output with **syntax highlighting**, **file-type icons**, **tree views**, and **colored status indicators** — all rendered directly in your terminal.

> **Status:** Early release.

> Companion to [@heyhuynhgiabuu/pi-diff](https://github.com/heyhuynhgiabuu/pi-diff) which handles `write`/`edit` diffs.

## Features

| Tool | Enhancement |
|------|-------------|
| **read** | Syntax-highlighted file content with line numbers (190+ languages via Shiki) |
| **bash** | Colored exit status (`✓ exit 0` / `✗ exit 1`), line count |
| **ls** | Tree-view directory listing with file-type icons (📁🟦🐍🦀…) |
| **find** | Grouped results by directory with file-type icons |
| **grep** | Highlighted pattern matches with file headers and line numbers |

## Install

```bash
pi install npm:@heyhuynhgiabuu/pi-pretty
```

Or load directly for development:

```bash
pi -e ./src/index.ts
```

## How It Works

pi-pretty wraps the built-in SDK tools (`createReadTool`, `createBashTool`, `createLsTool`, `createFindTool`, `createGrepTool`). For each tool:

1. **Delegates** to the original `execute()` — no behavior changes
2. **Attaches metadata** to `result.details` for custom rendering
3. **Renders** enhanced output via `renderCall` / `renderResult`

The agent sees the same tool results. Only the TUI display changes.

## Configuration

All settings via environment variables. Add to your shell profile or `.envrc`:

### Theme

| Variable | Default | Description |
|----------|---------|-------------|
| `PRETTY_THEME` | `github-dark` | Shiki theme for syntax highlighting |

### Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `PRETTY_MAX_HL_CHARS` | `80000` | Skip syntax highlighting above this |
| `PRETTY_MAX_PREVIEW_LINES` | `80` | Max lines shown in rendered output |
| `PRETTY_CACHE_LIMIT` | `128` | LRU cache entries for highlighted blocks |

### Example `.envrc`

```bash
export PRETTY_THEME="catppuccin-mocha"
export PRETTY_MAX_PREVIEW_LINES=120
```

## Tool Details

### `read` — Syntax Highlighting

When the agent reads a file, pi-pretty renders it with:
- Shiki syntax highlighting (190+ languages, auto-detected from extension)
- Line numbers in a left gutter
- Long lines truncated with `›` indicator
- Respects `offset` and `limit` parameters

### `bash` — Exit Status

Bash command results show:
- `✓ exit 0` in green for success
- `✗ exit 1` in red for failure
- `⚡ killed` in yellow for terminated processes
- Line count for multi-line output

### `ls` — Tree View

Directory listings rendered as:
```
  3 entries
  ├── 📁 src
  ├── 📦 package.json
  └── 📖 README.md
```

File-type icons auto-detected from extension and filename.

### `find` — Grouped Results

Find results grouped by directory:
```
  5 files
  📁 src/
    ├── 🟦 index.ts
    └── 🟦 utils.ts
  📁 test/
    ├── 🟦 index.test.ts
    └── 🟦 utils.test.ts
```

### `grep` — Highlighted Matches

Grep results with file headers and matched text highlighted:
```
  3 matches
  🟦 src/index.ts
    12 │ const result = await createReadTool(cwd);
    45 │ export function createReadTool(path: string) {

  🟦 src/utils.ts
    8  │ import { createReadTool } from "./index";
```

## File-Type Icons

| Icon | Extensions |
|------|-----------|
| 🟦 | `.ts`, `.tsx`, `tsconfig.json` |
| 🟨 | `.js`, `.jsx`, `.mjs`, `.cjs` |
| 🐍 | `.py`, `pyproject.toml` |
| 🦀 | `.rs`, `Cargo.toml` |
| 🔵 | `.go`, `go.mod` |
| ☕ | `.java` |
| 🍊 | `.swift` |
| 💎 | `.rb` |
| 🌐 | `.html` |
| 🎨 | `.css`, `.scss`, `.less` |
| 📋 | `.json`, `.yaml`, `.toml` |
| 📝 | `.md`, `.mdx` |
| 🐚 | `.sh`, `.bash`, `.zsh` |
| 🖼️ | `.png`, `.jpg`, `.svg`, `.webp` |
| 📦 | `package.json` |
| 🐳 | `Dockerfile` |
| 🔐 | `.env`, `.envrc` |
| 📖 | `README.md` |
| ⚖️ | `LICENSE` |

## Architecture

```
src/
└── index.ts    # Extension entry — wraps read/bash/ls/find/grep with pretty rendering
```

### Key internals

| Component | Purpose |
|-----------|---------|
| `hlBlock()` | Shiki ANSI highlighting with LRU cache |
| `renderFileContent()` | Line-numbered syntax-highlighted file display |
| `renderBashOutput()` | Colored exit status + stderr detection |
| `renderTree()` | Tree-view with connectors and file icons |
| `renderFindResults()` | Directory-grouped file list with icons |
| `renderGrepResults()` | Pattern-highlighted matches with file headers |
| `fileIcon()` | Extension → emoji icon mapper |
| `lang()` | Extension → Shiki language mapper |

## Development

```bash
git clone https://github.com/heyhuynhgiabuu/pi-pretty.git
cd pi-pretty
npm install
npm run typecheck
npm run lint
npm test
```

### Load in pi for testing

```bash
pi -e ./src/index.ts
```

## Related

- [@heyhuynhgiabuu/pi-diff](https://github.com/heyhuynhgiabuu/pi-diff) — Syntax-highlighted diffs for `write`/`edit` tools

## License

MIT — [huynhgiabuu](https://github.com/heyhuynhgiabuu)
