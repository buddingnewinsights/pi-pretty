/* pi-pretty: bash tool -- command execution with styled output. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SdkToolDef, BashDetails, TextContent, ComponentLike, ThemeLike, RenderCtxLike } from "../types.js";
import { resolveBaseBackground, termWidth, MAX_PREVIEW_LINES, BG_BASE, BG_ERROR, FG_DIM, FG_RULE, RST } from "../config.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderBashOutput, renderToolError, renderToolMetrics, fillToolBackground } from "../render.js";
import { stripBashExitStatusLine, inferBashExitCode, compactErrorLines } from "../helpers.js";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerBashTool(
	pi: ExtensionAPI,
	_cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = TextComp ?? (() => {
		const { Text } = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void } };
		return Text;
	})();

	pi.registerTool({
		name: "bash",
		label: "Bash",
		description: sdkTool.description ?? "Execute shell commands",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			try {
				return await sdkTool.execute(tid, params, sig, undefined, ctx) as Result;
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text" as const, text: msg }], isError: true, details: { _type: "bashResult", text: msg, exitCode: 1, command: String((params as any).command ?? "") } as BashDetails };
			}
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const t = typeof args.timeout === "number" ? ` ${theme.fg("muted", `(timeout ${args.timeout}s)`)}` : "";
			const tw = termWidth() || 80;
			const rawCmd = String(args.command ?? "");
			const cmd = rawCmd.length === 0 ? theme.fg("toolOutput", "...") : (rawCmd.length > tw - 20 ? rawCmd.slice(0, Math.max(1, tw - 20)) + "…" : rawCmd);
			const toolWidth = ctx.expanded ? undefined : tw;
			text.setText(fillToolBackground(`\n  ${theme.fg("toolTitle", theme.bold(`$ ${cmd}`))}${t}`, ctx.isError ? BG_ERROR : undefined, toolWidth));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			
			const text = ctx.lastComponent ?? new TC("", 0, 0);

			const details = result.details;
			const tc = getText(result);
			const d: BashDetails | undefined =
				(details as BashDetails)?._type === "bashResult" ? details as BashDetails
					: tc || ctx.isError
						? { _type: "bashResult", text: tc || "Error", exitCode: inferBashExitCode(tc, ctx.isError ? 1 : 0), command: "" }
						: undefined;

			if (d?._type === "bashResult") {
				const isErr = ctx.isError || (d.exitCode !== null && d.exitCode !== 0);
				const bg = isErr ? BG_ERROR : undefined;
				const cleaned = stripBashExitStatusLine(d.text);
				const output = isErr ? compactErrorLines(cleaned).join("\n") : cleaned;
				const { summary } = renderBashOutput(output, d.exitCode);
				const lineCount = output.split("\n").length;
				const info = lineCount > 1 ? `  ${FG_DIM}(${lineCount} lines)${RST} ${renderToolMetrics(result)}` : ` ${renderToolMetrics(result)}`;
				const header = `  ${summary}${info}`;
				const rw = termWidth();

				const renderFn = (w: number) => {
					if (!output.trim()) return fillToolBackground(header, bg, w);
					const max = ctx.expanded ? lineCount : MAX_PREVIEW_LINES;
					const show = output.split("\n").slice(0, max);
					const out = [header, rule(w), ...show.map((l: string) => `  ${l}`)];
					if (lineCount > max) out.push(`${FG_DIM}  \u2026 ${lineCount - max} more lines${RST}`);
					return fillToolBackground(out.join("\n"), bg, w);
				};

				text.setText(renderFn(rw));
				const baseRender = typeof (text as ComponentLike).render === "function"
					? (text as ComponentLike).render.bind(text)
					: null;
				if (baseRender) {
					let key: string | undefined;
					(text as unknown as Record<string, unknown>).render = (w: number) => {
						const width = Math.max(1, Math.floor(w || termWidth()));
						const k = `bash:${ctx.expanded ? "1" : "0"}:${width}:${d.exitCode ?? "killed"}:${output.length}:${renderToolMetrics(result)}`;
						if (key !== k) { text.setText(renderFn(width)); key = k; }
						return baseRender(width);
					};
				}
				return text;
			}

			if (ctx.isError) { text.setText(renderToolError(tc || "Error", theme)); return text; }
			const fc = result.content?.[0];
			text.setText(fillToolBackground(`  ${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")}`));
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function rule(w: number): string { return `${FG_RULE}${"\u2500".repeat(w)}${RST}`; }
function getText(result: Result): string {
	return ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
}
