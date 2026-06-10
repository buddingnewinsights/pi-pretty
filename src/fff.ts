/**
 * pi-pretty: FFF lifecycle management.
 *
 * Manages the FFF file finder lifecycle: create, wait for scan, destroy.
 * Tools check `isAvailable` and use `finder` directly for search operations.
 * Graceful fallback: if FFF is not installed or fails, tools degrade to SDK.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { FileFinder as FffFileFinder, GrepCursor } from "@ff-labs/fff-node";

// ---------------------------------------------------------------------------
// Cursor store — pagination cursors for grep
// ---------------------------------------------------------------------------

export class CursorStore {
	private cursors = new Map<string, GrepCursor>();
	private counter = 0;
	private maxSize: number;

	constructor(maxSize = 200) {
		this.maxSize = maxSize;
	}

	store(cursor: GrepCursor): string {
		const id = `fff_c${++this.counter}`;
		this.cursors.set(id, cursor);
		if (this.cursors.size > this.maxSize) {
			const first = this.cursors.keys().next().value;
			if (first) this.cursors.delete(first);
		}
		return id;
	}

	get(id: string): GrepCursor | undefined {
		return this.cursors.get(id);
	}

	get size(): number {
		return this.cursors.size;
	}
}

// ---------------------------------------------------------------------------
// FffService — wraps a single FileFinder instance
// ---------------------------------------------------------------------------

export class FffService {
	finder: FffFileFinder | null = null;
	partialIndex = false;
	cursorStore = new CursorStore();

	private fffModule: typeof import("@ff-labs/fff-node") | null = null;
	private dbDir: string | null = null;
	private finderPromise: Promise<void> | null = null;

	constructor(fffModule?: typeof import("@ff-labs/fff-node"), agentDir?: string) {
		if (fffModule) {
			this.fffModule = fffModule;
			if (agentDir) {
				this.dbDir = join(agentDir, "pi-pretty", "fff");
				try {
					mkdirSync(this.dbDir, { recursive: true });
				} catch { /* ignore */ }
			}
		}
	}

	/** Returns true if the FFF native module is loaded (installed). */
	isModuleLoaded(): boolean {
		return this.fffModule !== null;
	}

	get isAvailable(): boolean {
		return this.finder !== null && !this.finder.isDestroyed;
	}

	/** Attempt to load FFF module dynamically (called during session_start if not injected). */
	async tryLoadModule(): Promise<boolean> {
		if (this.fffModule) return true;
		try {
			const mod = await import("@ff-labs/fff-node");
			this.fffModule = mod;
			if (!this.dbDir && process.env.HOME) {
				this.dbDir = join(process.env.HOME, ".pi/agent", "pi-pretty", "fff");
				try {
					mkdirSync(this.dbDir, { recursive: true });
				} catch { /* ignore */ }
			}
			return true;
		} catch {
			return false;
		}
	}

	async ensureFinder(cwd: string): Promise<void> {
		if (this.finder && !this.finder.isDestroyed) return;
		if (this.finderPromise) return this.finderPromise;

		this.finderPromise = this._createFinder(cwd);
		await this.finderPromise;
		this.finderPromise = null;
	}

	private async _createFinder(cwd: string): Promise<void> {
		if (!this.fffModule) return;

		if (this.finder && !this.finder.isDestroyed) {
			this.finder.destroy();
			this.finder = null;
		}

		const result = this.fffModule.FileFinder.create({
			basePath: cwd,
			frecencyDbPath: this.dbDir ? join(this.dbDir, "frecency.mdb") : "",
			historyDbPath: this.dbDir ? join(this.dbDir, "history.mdb") : "",
			aiMode: true,
		});

		if (!result.ok) {
			throw new Error(`FFF init failed: ${result.error}`);
		}

		this.finder = result.value;
		const scan = await this.finder.waitForScan(15_000);
		this.partialIndex = scan.ok && !scan.value;
	}

	destroy(): void {
		if (this.finder && !this.finder.isDestroyed) {
			this.finder.destroy();
			this.finder = null;
		}
		this.partialIndex = false;
		this.finderPromise = null;
	}

	getFinder(): import("@ff-labs/fff-node").FileFinder | null {
		return this.finder;
	}

	getCursorStore(): CursorStore {
		return this.cursorStore;
	}
}
