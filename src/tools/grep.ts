/* pi-pretty: grep tool -- FFF-backed text search with SDK fallback. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SdkToolDef, GrepDetails, FffServiceWithCursor, TextContent, ThemeLike, RenderCtxLike } from "../types.js";
import { resolveBaseBackground, MAX_PREVIEW_LINES, BG_BASE, BG_ERROR, FG_DIM, RST } from "../config.js";
import { shortPath, normalizeLineEndings } from "../helpers.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderToolError, renderToolMetrics, fillToolBackground } from "../render.js";
import { fffFormatGrepText } from "../fff-helpers.js";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerGrepTool(
	pi: ExtensionAPI,
	cwd: string,
	fffService: FffServiceWithCursor | null | undefined,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const T = TextComp ?? (() => { const m = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void } }; return m.Text; })();
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "grep",
		label: "Grep",
		description: sdkTool.description ?? "Search file contents by pattern",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const p = params as any;
			const pattern = String(p.pattern ?? "");
			const path = p.path ? String(p.path) : undefined;
			const glob = p.glob ? String(p.glob) : undefined;
			const context = typeof p.context === "number" ? p.context : 0;
			const limit = typeof p.limit === "number" ? p.limit : 200;
			const literal = p.literal === true;

			if (fffService?.isAvailable && !path && !glob) {
				try {
					const fff = fffService.getFinder();
					if (!fff) throw new Error("FFF finder not available");
					const effectiveLimit = Math.max(1, limit);
					const grepResult = fff.grep(pattern, { pageSize: effectiveLimit, mode: literal ? "plain" : "regex", beforeContext: context, afterContext: context });
					if (grepResult.ok) {
						const grep = grepResult.value;
						const items = grep.items.slice(0, effectiveLimit);
						const cursorStore = fffService.getCursorStore();
						const notices: string[] = [];
						if (fffService.partialIndex) notices.push("Warning: partial file index");
						if (items.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
						if (grep.regexFallbackError) notices.push(`Regex failed: ${grep.regexFallbackError}, used literal match`);
						if (grep.nextCursor) {
							const cursorId = cursorStore.store(grep.nextCursor);
							notices.push(`More results available: cursor="${cursorId}"`);
						}
						const text = appendNotices(fffFormatGrepText(items, effectiveLimit), notices);
						return { content: [{ type: "text" as const, text }], details: { _type: "grepResult", text, pattern, matchCount: items.length } as GrepDetails };
					}
				} catch { /* fall through */ }
			}

			const result = await sdkTool.execute(tid, p, sig, undefined, ctx) as Result;
			for (const c of (result.content ?? []) as any[]) { if (c.type === "text") c.text = normalizeLineEndings(c.text); }
			const tc = ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
			result.details = { _type: "grepResult", text: tc, pattern, matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0 } as GrepDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new T("", 0, 0);
			const p = args.path ? ` ${theme.fg("muted", `in ${shortPath(cwd, home, String(args.path))}`)}` : "";
			const lit = args.literal ? ` ${theme.fg("dim", "[literal]")}` : "";
			text.setText(fillToolBackground(`\n  ${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", String(args.pattern ?? ""))}${p}${lit}`, ctx.isError ? BG_ERROR : undefined));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new T("", 0, 0);
			if (ctx.isError) { text.setText(renderToolError(((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text).join("\n") || "Error", theme)); return text; }
			const d = result.details as GrepDetails | undefined;
			if (d?._type === "grepResult" && d.text) {
				const lines = d.text.split("\n");
				const maxShow = ctx.expanded ? lines.length : Math.min(lines.length, MAX_PREVIEW_LINES);
				const preview = lines.slice(0, maxShow).map(l => `  ${l}`).join("\n");
				const more = lines.length > maxShow ? `\n${FG_DIM}  ... ${lines.length - maxShow} more lines${RST}` : "";
				text.setText(fillToolBackground(`  ${FG_DIM}${d.matchCount} matches${RST}${renderToolMetrics(result)}\n${preview}${more}`));
				return text;
			}
			const fc = result.content?.[0];
			text.setText(fillToolBackground(`  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "no matches")}`));
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function appendNotices(text: string, notices: string[]): string { return notices.length ? `${text}\n\n[${notices.join(". ")}]` : text; }
