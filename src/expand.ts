import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAX_PREVIEW_LINES } from "./config.js";

/** Render context from pi tool UI (Ctrl+O toggles `expanded` per tool block). */
export type ToolRenderCtx = { expanded?: boolean };

/** Lines to show in tool result body when collapsed vs expanded. */
export function previewLineCount(ctx: ToolRenderCtx, totalLines: number): number {
	if (ctx.expanded) return totalLines;
	return Math.min(totalLines, MAX_PREVIEW_LINES);
}

/**
 * Default tool output to collapsed so body content is hidden until Ctrl+O (app.tools.expand).
 * Matches Pi keybinding `app.tools.expand` / `app.tools.expandAll` (see pi.dev/docs keybindings).
 */
export function registerDefaultCollapsedToolOutput(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		// Pi interactive mode: default new tool blocks collapsed (Ctrl+O toggles per block).
		(ctx as { setConfig?: (c: { toolOutputExpanded?: boolean }) => void }).setConfig?.({
			toolOutputExpanded: false,
		});
	});
}