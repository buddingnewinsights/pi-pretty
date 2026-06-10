/* pi-pretty: find tool -- FFF-backed file search with SDK fallback. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SdkToolDef, FindDetails, FffServiceLike, FileItem, TextContent, ThemeLike, RenderCtxLike, ComponentLike } from "../types.js";
import { resolveBaseBackground, BG_ERROR, FG_DIM, RST } from "../config.js";
import { shortPath } from "../helpers.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderFindResults, renderToolError, renderToolMetrics, fillToolBackground } from "../render.js";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerFindTool(
	pi: ExtensionAPI,
	cwd: string,
	fffService: FffServiceLike | null | undefined,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	if (!TextComp) {
		const { Text } = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void; render(w: number): string[]; invalidate(): void } };
		TextComp = Text;
	}
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "find",
		label: "Find",
		description: sdkTool.description ?? "Find files matching a glob pattern",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const pattern = String((params as any).pattern ?? "");
			const path = (params as any).path ? String((params as any).path) : undefined;
			const limit = typeof (params as any).limit === "number" ? (params as any).limit : 200;

			if (fffService?.isAvailable) {
				try {
					const fff = fffService.getFinder();
					if (!fff) throw new Error("FFF finder not available");
					const effectiveLimit = Math.max(1, limit);
					const searchResult = fff.fileSearch(path ? `${path} ${pattern}` : pattern, { pageSize: effectiveLimit });
					if (searchResult.ok) {
						const items: FileItem[] = searchResult.value.items.slice(0, effectiveLimit);
						const notices: string[] = [];
						if (fffService.partialIndex) notices.push("Warning: partial file index");
						if (items.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
						if (searchResult.value.totalMatched > items.length) notices.push(`${searchResult.value.totalMatched} total matches`);
						const text = appendNotices(items.map((i) => i.relativePath).join("\n"), notices);
						return { content: [{ type: "text" as const, text }], details: { _type: "findResult", text, pattern, matchCount: items.length } as FindDetails };
					}
				} catch { /* fall through */ }
			}

			const result = await sdkTool.execute(tid, params, sig, undefined, ctx) as Result;
			const tc = getText(result);
			result.details = { _type: "findResult", text: tc, pattern, matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0 } as FindDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TextComp!("", 0, 0);
			const p = args.path ? ` ${theme.fg("muted", `in ${shortPath(cwd, home, String(args.path))}`)}` : "";
			text.setText(fillToolBackground(`\n  ${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", String(args.pattern ?? ""))}${p}`, ctx.isError ? BG_ERROR : undefined));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TextComp!("", 0, 0);
			if (ctx.isError) { text.setText(renderToolError(getText(result) || "Error", theme)); return text; }
			const d = result.details as FindDetails | undefined;
			if (d?._type === "findResult" && d.text) {
				const rendered = renderFindResults(d.text).split("\n").map(l => `  ${l}`).join("\n");
				text.setText(fillToolBackground(`  ${FG_DIM}${d.matchCount} files${RST}${renderToolMetrics(result)}\n${rendered}`));
				return text;
			}
			const fc = result.content?.[0];
			text.setText(fillToolBackground(`  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "found")}`));
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function appendNotices(text: string, notices: string[]): string { return notices.length ? `${text}\n\n[${notices.join(". ")}]` : text; }
function getText(result: Result): string { return ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? ""; }
