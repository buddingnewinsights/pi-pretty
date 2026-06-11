/* pi-pretty: read tool -- file reading with syntax highlighting and inline image support. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SdkToolDef, ReadDetails, TextContent, ComponentLike, ThemeLike, RenderCtxLike } from "../types.js";
import { resolveBaseBackground, termWidth, MAX_PREVIEW_LINES, BG_BASE, BG_ERROR, FG_DIM, FG_LNUM, FG_RULE, RST } from "../config.js";
import { shortPath, normalizeLineEndings } from "../helpers.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderToolError, renderToolMetrics, fillToolBackground, renderFileContent } from "../render.js";

// Simple terminal image support check
function isImageTerminal(): boolean {
	const term = (process.env.TERM_PROGRAM ?? process.env.TERM ?? "").toLowerCase();
	const proto = (process.env.PRETTY_IMAGE_PROTOCOL ?? "").toLowerCase();
	if (proto === "kitty" || proto === "iterm2") return true;
	if (proto === "none") return false;
	return ["ghostty", "kitty", "iterm.app", "wezterm", "mintty"].some((t) => term.includes(t)) || process.env.LC_TERMINAL === "iTerm2";
}

type Result = AgentToolResult<Record<string, unknown>>;

export function registerReadTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = TextComp ?? (() => {
		const { Text } = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void } };
		return Text;
	})();
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "read",
		label: "Read",
		description: sdkTool.description ?? "Read file contents",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const p = params as any;
			const result = await sdkTool.execute(tid, p, sig, undefined, ctx) as Result;

			const imageBlock = (result.content as any[])?.find((c: any) => c.type === "image");
			if (imageBlock) {
				result.details = { _type: "readImage", filePath: String(p.path ?? ""), data: imageBlock.data, mimeType: imageBlock.mimeType ?? "image/png" } as ReadDetails;
				return result;
			}

			const tc = normalizeLineEndings(getText(result));
			result.details = { _type: "readFile", filePath: String(p.path ?? ""), content: tc, offset: typeof p.offset === "number" ? p.offset : 0, lineCount: tc ? tc.split("\n").length : 0 } as ReadDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			text.setText("");
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			
			const text = ctx.lastComponent ?? new TC("", 0, 0);

			if (ctx.isError) { text.setText(renderToolError(getText(result) || "Error", theme)); return text; }

			const d = result.details as ReadDetails | undefined;

			// Image rendering
			if (d?._type === "readImage") {
				if ((ctx as any).showImages && isImageTerminal()) {
					try {
						const T = require("@earendil-works/pi-tui").Text as new (t?: string, x?: number, y?: number) => ComponentLike;
						const img = new T("", 0, 0);
						if (d.mimeType.startsWith("image/svg")) {
							img.setText(d.data);
						} else {
							const pngData = (require("@earendil-works/pi-coding-agent") as any).convertToPng?.(d.data) ?? d.data;
							img.setText(`\x1b_Ga=T,f=100,m=${d.mimeType === "image/png" ? "1" : "0"};${pngData}\x1b\\\\`);
						}
						return img;
					} catch { /* fall through */ }
				}
				const fc = result.content?.[0];
				text.setText(fillToolBackground(`  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 80) : `[image: ${d.filePath}]`)}`));
				return text;
			}

			// File content — line-numbered display
			if (d?._type === "readFile" && d.content) {
				const tw = termWidth();
				const lines = d.content.split("\n");
				const total = lines.length;
				const maxShow = ctx.expanded ? lines.length : Math.min(lines.length, MAX_PREVIEW_LINES);
				const show = lines.slice(0, maxShow);
				const nw = Math.max(3, String(total).length);
				const gw = nw + 3;
				const cw = Math.max(1, tw - gw);

				const p2 = shortPath(cwd, home, String(d.filePath ?? ""));
				const off2 = typeof d.offset === "number" ? `:${d.offset}` : "";
				const header = `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", p2)}${theme.fg("dim", off2)}`;
				const out: string[] = ["", `  ${header}`];
				out.push(`  ${FG_RULE}${"─".repeat(tw - 2)}${RST}`);
				for (let i = 0; i < show.length; i++) {
					const ln = (d.offset || 0) + i + 1;
					const code = show[i] ?? "";
					const display = code.length > cw ? code.slice(0, cw) + `${FG_DIM}›${RST}` : code;
					const lineNo = String(ln);
					out.push(`  ${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} ${display}${RST}`);
				}
				if (total > maxShow) {
					out.push(`  ${FG_DIM}  … ${total - maxShow} more lines (${total} total)${RST}`);
				}
				out.push("");
				const rendered = out.join("\n");
				text.setText(fillToolBackground(rendered));
				(ctx as any).state._rt = rendered;

				// Async syntax highlighting via Shiki
				renderFileContent(d.content, d.filePath, d.offset || 0, maxShow, tw).then(hl => {
					const padded = hl.split("\n").map(l => `  ${l}`).join("\n");
					const rendered = `\n  ${header}\n${padded}\n`;
					text.setText(fillToolBackground(rendered));
					(ctx as any).state._rt = rendered;
				}).catch(() => {});

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
