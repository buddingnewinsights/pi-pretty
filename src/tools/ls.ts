/* pi-pretty: ls tool -- directory listing with styled output. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SdkToolDef, LsDetails, TextContent, ComponentLike, ThemeLike, RenderCtxLike } from "../types.js";
import { resolveBaseBackground, termWidth, MAX_PREVIEW_LINES, BG_BASE, BG_ERROR, FG_DIM, RST } from "../config.js";
import { shortPath } from "../helpers.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderTree, renderToolError, renderToolMetrics, fillToolBackground } from "../render.js";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerLsTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const home = process.env.HOME ?? "";
	const TC = TextComp ?? (() => {
		const { Text } = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void } };
		return Text;
	})();

	pi.registerTool({
		name: "ls",
		label: "List",
		description: sdkTool.description ?? "List directory contents",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const result = await sdkTool.execute(tid, params, sig, undefined, ctx) as Result;
			const tc = getText(result);
			result.details = { _type: "lsResult", text: tc, path: String((params as any).path ?? ""), entryCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0 } as LsDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const rawPath = args.path;
			const path = rawPath === null || rawPath === undefined || String(rawPath).length === 0 ? "" : shortPath(cwd, home, String(rawPath));
			const limit = args.limit;
			let out = theme.fg("toolTitle", theme.bold("ls"));
			if (path) out += ` ${theme.fg("accent", path)}`;
			if (limit !== undefined && limit !== null) out += theme.fg("toolOutput", ` (limit ${limit})`);
			text.setText(fillToolBackground(`  \n  ${out}`, ctx.isError ? BG_ERROR : undefined));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			if (ctx.isError) { text.setText(renderToolError(getText(result) || "Error", theme)); return text; }
			const d = result.details as LsDetails | undefined;
			if (d?._type === "lsResult" && d.text) {
				const rendered = renderTree(d.text, d.path).split("\n").map(l => `  ${l}`).join("\n");
				text.setText(fillToolBackground(`  \n  ${FG_DIM}${d.entryCount} entries${RST}${renderToolMetrics(result)}\n${rendered}\n  `));
				return text;
			}
			const fc = result.content?.[0];
			text.setText(fillToolBackground(`  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")}`));
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function getText(result: Result): string {
	return ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
}
