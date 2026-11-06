import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus, discoverAndLoadExtensions, type ExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

describe("tool backgrounds", () => {
	it.each([
		"claudecode",
		"default",
	])("refreshes %s backgrounds after theme and config changes through Pi's loader", async (style) => {
		const dir = mkdtempSync(join(tmpdir(), "pi-pretty-background-"));
		const events = createEventBus();
		let actual: unknown;
		let runtime: ExtensionRuntime | undefined;
		events.on("tool-backgrounds", (snapshots) => {
			actual = snapshots;
		});
		vi.stubEnv("PRETTY_CONFIG_DIR", dir);
		vi.stubEnv("PROBE_STYLE", style);

		try {
			const result = await discoverAndLoadExtensions(
				[fileURLToPath(new URL("./fixtures/tool-backgrounds.ts", import.meta.url))],
				dir,
				dir,
				events,
			);
			runtime = result.runtime;
			expect(result.errors).toStrictEqual([]);

			const expected = (base: string, error: string) => ({
				success: [`\x1b[48;2;${base}m${(style === "claudecode" ? " ✓ Read (a.ts)" : "Read").padEnd(24)}`],
				error: [`\x1b[48;2;${error}m${(style === "claudecode" ? " ✗ Read (a.ts)" : "Read").padEnd(24)}`],
			});
			expect(actual).toStrictEqual([
				expected("204;208;218", "230;233;239"),
				expected("49;50;68", "30;30;46"),
				expected("17;34;51", "68;85;102"),
				expected("119;136;153", "119;136;153"),
				expected("49;50;68", "30;30;46"),
			]);
		} finally {
			runtime?.invalidate();
			events.clear();
			vi.unstubAllEnvs();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
