/* pi-pretty: find tool -- FFF-backed file search with SDK fallback. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative as toRelative } from "node:path";
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
			const limit = (params as any).limit;
			const glob = (params as any).glob;

			const fff = fffService?.isAvailable ? fffService.getFinder() : null;
			if (fff) {
				try {
					const effectiveLimit = Math.max(1, typeof limit === "number" ? limit : 100);
					const basePathResult = fff.getBasePath();
					const basePath = basePathResult.ok ? basePathResult.value : null;
					let cleanPath = path ?? "";
					if (cleanPath && isAbsolute(cleanPath) && basePath) {
						cleanPath = toRelative(basePath, cleanPath) || "";
					}
					cleanPath = cleanPath.replace(/\/$/, "");
					const cleanPattern = pattern.startsWith("/") ? pattern.slice(1) : pattern;
					const globPattern = cleanPath
						? `${cleanPath}/**/${cleanPattern}`
						: `**/${cleanPattern}`;
					const searchResult = fff.glob(globPattern, { pageSize: effectiveLimit });
    					if (searchResult.ok) {
    						const items: FileItem[] = searchResult.value.items.slice(0, effectiveLimit);
    						const notices: string[] = [];
    						if (fffService?.partialIndex) notices.push("Warning: partial file index");
    						if (items.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
    						if (searchResult.value.totalMatched > items.length) notices.push(`${searchResult.value.totalMatched} total matches`);
    						const paths = items.map((i) => i.relativePath).join("\n");
    						return { content: [{ type: "text" as const, text: paths }], details: { _type: "findResult", text: paths, pattern, matchCount: items.length, notices } as FindDetails };
    					}
				} catch { /* fall through to SDK */ }
			}

			const result = await sdkTool.execute(tid, params, sig, undefined, ctx) as Result;
			const tc = getText(result);
			result.details = { _type: "findResult", text: tc, pattern, matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0 } as FindDetails;
			return result;
		}),

    		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TextComp!("", 0, 0);
			const pattern = args.pattern === null || args.pattern === undefined ? "" : String(args.pattern);
			const path = args.path === null || args.path === undefined ? "<missing>" : shortPath(cwd, home, String(args.path));
			const limit = args.limit;
			const glob = args.glob;
			const findLabel = theme.fg("toolTitle", theme.bold("find"));
			const patternPart = pattern ? theme.fg("accent", pattern) : "";
			const inPart = theme.fg("dim", " in ");
			const pathPart = theme.fg("toolOutput", path);
			const limitPart = limit !== undefined && limit !== null ? theme.fg("dim", ` limit ${limit}`) : "";
			const out = `${findLabel} ${patternPart}${inPart}${pathPart}${limitPart}`;
			text.setText(fillToolBackground(`  \n  ${out}`, ctx.isError ? BG_ERROR : undefined));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TextComp!("", 0, 0);
			if (ctx.isError) { text.setText(renderToolError(getText(result) || "Error", theme)); return text; }
			const d = result.details as FindDetails | undefined;
			if (d?._type === "findResult") {
    				if (!d.text.trim()) {
    					const notices = (d as any).notices as string[] | undefined;
    					const noticeStr = notices?.length ? `\n  ${theme.fg("warning", `[${notices.join(". ")}]`)}` : "";
    					text.setText(fillToolBackground(`  \n  ${theme.fg("dim", "0 files")}${noticeStr}\n  `));
    					return text;
    				}
    				const rendered = renderFindResults(d.text, theme).split("\n").map(l => `  ${l}`).join("\n");
    				const notices = (d as any).notices as string[] | undefined;
    				const noticeStr = notices?.length ? `\n  ${theme.fg("warning", `[${notices.join(". ")}]`)}` : "";
    				text.setText(fillToolBackground(`  \n  ${theme.fg("dim", `${d.matchCount} files`)}${renderToolMetrics(result)}\n${rendered}${noticeStr}\n  `));
    				return text;
			}
			const fc = result.content?.[0];
			text.setText(fillToolBackground(`  \n  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "0 files")}\n  `));
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function appendNotices(text: string, notices: string[]): string { return notices.length ? `${text}\n\n[${notices.join(". ")}]` : text; }
function getText(result: Result): string { return ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? ""; }
