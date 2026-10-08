/* pi-pretty: bash tool -- command execution with styled output. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolveBaseBackground, termWidth } from "../config.js";
import {
	CHARS_KEY,
	compactErrorLines,
	ELAPSED_KEY,
	formatCharCount,
	inferBashExitCode,
	stripBashExitStatusLine,
} from "../helpers.js";
import {
	fillToolBackground,
	fillToolBody,
	rememberToolTitle,
	renderToolDuration,
	renderToolError,
	setCollapsedToolTitle,
	toolIndent,
} from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { BashDetails, ComponentLike, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { type RejectedExecutionMetrics, wrapExecuteWithMetrics } from "./metrics.js";

type Result = AgentToolResult<Record<string, unknown>>;

const BASH_REJECTED_METRICS_KEY = "__piPrettyBashRejectedMetrics";
const BASH_RESULT_RENDER_KEY = "__piPrettyBashResultRender";
const REJECTED_METRICS_TTL_MS = 60_000;
const rejectedBashMetrics = new Map<string, RejectedExecutionMetrics>();

function rememberRejectedBashMetrics(toolCallId: string, metrics: RejectedExecutionMetrics): void {
	rejectedBashMetrics.set(toolCallId, metrics);
	const timer = setTimeout(() => {
		if (rejectedBashMetrics.get(toolCallId) === metrics) rejectedBashMetrics.delete(toolCallId);
	}, REJECTED_METRICS_TTL_MS);
	timer.unref?.();
}

function takeRejectedBashMetrics(ctx: RenderCtxLike): RejectedExecutionMetrics | undefined {
	const state = ctx.state;
	const cached = state[BASH_REJECTED_METRICS_KEY] as RejectedExecutionMetrics | undefined;
	if (cached) return cached;
	if (!ctx.toolCallId) return undefined;
	const metrics = rejectedBashMetrics.get(ctx.toolCallId);
	if (metrics) {
		rejectedBashMetrics.delete(ctx.toolCallId);
		state[BASH_REJECTED_METRICS_KEY] = metrics;
	}
	return metrics;
}

function addRejectedMetrics(result: Result, metrics: RejectedExecutionMetrics): Result {
	const details = {
		...((result.details ?? {}) as Record<string, unknown>),
		[ELAPSED_KEY]: metrics.elapsedMs,
		[CHARS_KEY]: metrics.chars,
	};
	return { ...result, details } as Result;
}

function restoreBashResultRender(ctx: RenderCtxLike, text: ComponentLike): void {
	const state = ctx.state;
	const original = state[BASH_RESULT_RENDER_KEY] as ((width: number) => string[]) | undefined;
	if (!original) return;
	(text as unknown as { render: (width: number) => string[] }).render = original;
	delete state[BASH_RESULT_RENDER_KEY];
}

export function registerBashTool(
	pi: ExtensionAPI,
	_cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);

	pi.registerTool({
		name: "bash",
		label: "Bash",
		description: sdkTool.description
			? `${sdkTool.description} For text search: \`rg -n\`.`
			: "Execute shell commands. For text search: `rg -n`.",
		promptSnippet: "Execute commands via bash. For text search: `rg -n`.",
		promptGuidelines: [
			// Re-registering by name drops the host's built-in bash guidelines; keep them.
			...(sdkTool.promptGuidelines ?? []),
			"rg skips .gitignored and hidden files by default. On no results use `--hidden` for dotfiles (add `-g '!.git'`), `--no-ignore` for ignored files, or name the path directly; `-u` = `--no-ignore`, `-uu` adds hidden.",
			"Quote rg patterns: `rg -n 'foo|bar'`. `|` is alternation, `\\|` is a literal pipe (unlike GNU grep); use `-F` for literal text.",
			"Keep output small: `-l` lists files only, `-m N` caps matches per file.",
		],
		parameters: sdkTool.parameters,
		constrainedSampling: sdkTool.constrainedSampling,
		outputSchema: sdkTool.outputSchema,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, upd, ctx: ExtensionContext) => {
			// Let the host derive the tool-error flag from the rejected execution.
			// AgentToolResult has no portable `isError` field, so converting a bash
			// failure into a successful-looking result hides the failure from the model.
			return (await sdkTool.execute(tid, params, sig, upd, ctx)) as Result;
		}, rememberRejectedBashMetrics),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const t = typeof args.timeout === "number" ? ` ${theme.fg("muted", `(timeout ${args.timeout}s)`)}` : "";
			const ind = toolIndent(ctx);
			const tw = termWidth() || 80;
			const rawCmd = String(args.command ?? "");
			const headerBudget = ctx.expanded ? tw : Math.max(8, tw - 20);
			const cmd =
				rawCmd.length === 0
					? theme.fg("toolOutput", "...")
					: !ctx.expanded && rawCmd.length > headerBudget
						? `${rawCmd.slice(0, Math.max(1, headerBudget))}…`
						: rawCmd;
			const commandLabel = theme.fg(ctx.isError ? "error" : "toolTitle", theme.bold(`$ ${cmd}`));
			const renderTitle = (suffix = ""): string =>
				fillToolBackground(`\n${ind}${commandLabel}${t}${suffix}\n`, undefined, ctx.expanded ? undefined : tw, ind);
			rememberToolTitle(ctx, text, renderTitle);
			text.setText(renderTitle());
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);

			const text = ctx.lastComponent ?? new TC("", 0, 0);
			restoreBashResultRender(ctx, text as ComponentLike);
			const rejectedMetrics = takeRejectedBashMetrics(ctx);
			const displayResult = rejectedMetrics ? addRejectedMetrics(result, rejectedMetrics) : result;

			const details = displayResult.details;
			const tc = getText(displayResult);
			const d: BashDetails | undefined =
				(details as BashDetails)?._type === "bashResult"
					? (details as BashDetails)
					: tc || ctx.isError
						? {
								_type: "bashResult",
								text: tc || "Error",
								exitCode: inferBashExitCode(tc, ctx.isError ? 1 : 0),
								command: "",
							}
						: undefined;

			if (d?._type === "bashResult") {
				const isErr = ctx.isError || (d.exitCode !== null && d.exitCode !== 0);
				const cleaned = stripBashExitStatusLine(d.text);
				const output = isErr ? compactErrorLines(cleaned).join("\n") : cleaned;
				const lineCount = output.split("\n").length;
				const buildInfo = (): string =>
					[
						`${lineCount} lines`,
						renderToolDuration(displayResult, ctx),
						rejectedMetrics ? formatCharCount(rejectedMetrics.chars) : "",
						!ctx.expanded ? "ctrl+o to expand" : "",
					]
						.filter(Boolean)
						.map((part) => theme.fg("dim", part))
						.join(theme.fg("dim", " · "));
				const info = buildInfo();
				const rw = termWidth();

				if (setCollapsedToolTitle(ctx, text, ` ${info}`)) return text;

				const renderFn = (w: number) => {
					const ind = toolIndent(ctx);
					const header = `${ind}${buildInfo()}`;
					if (!ctx.expanded) return fillToolBody(header, undefined, w, ind);
					if (!output.trim()) return fillToolBody(header, undefined, w, ind);
					const show = output.split("\n");
					const out = [header, "", ...show.map((line: string) => `${ind}${line}`)];
					return fillToolBody(out.join("\n"), undefined, w, ind);
				};

				text.setText(renderFn(rw));
				const baseRender =
					typeof (text as ComponentLike).render === "function" ? (text as ComponentLike).render.bind(text) : null;
				if (baseRender) {
					ctx.state[BASH_RESULT_RENDER_KEY] = baseRender;
					let key: string | undefined;
					(text as unknown as Record<string, unknown>).render = (w: number) => {
						const width = Math.max(1, Math.floor(w || termWidth()));
						const k = `bash:${ctx.expanded ? "1" : "0"}:${width}:${d.exitCode ?? "killed"}:${output.length}:${renderToolDuration(displayResult, ctx)}:${toolIndent(ctx).length}`;
						if (key !== k) {
							text.setText(renderFn(width));
							key = k;
						}
						return baseRender(width);
					};
				}
				return text;
			}

			if (ctx.isError) {
				text.setText(renderToolError(tc || "Error", theme, toolIndent(ctx)));
				return text;
			}
			const fc = displayResult.content?.[0];
			const ind = toolIndent(ctx);
			text.setText(
				fillToolBody(
					`${ind}${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")}`,
					undefined,
					undefined,
					ind,
				),
			);
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function getText(result: Result): string {
	return (
		((result.content ?? []) as TextContent[])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n") ?? ""
	);
}
