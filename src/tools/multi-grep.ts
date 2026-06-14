/* pi-pretty: multi_grep tool -- FFF-backed multi-pattern search with ripgrep/SDK fallback. */

import { type ToolDefinition, type ExtensionAPI, type ExtensionContext, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SdkToolDef, GrepDetails, FffServiceWithCursor, TextContent, ComponentLike, ThemeLike, RenderCtxLike } from "../types.js";
import { resolveBaseBackground, MAX_PREVIEW_LINES, BG_ERROR, FG_DIM, FG_LNUM, FG_RULE, RST } from "../config.js";
import { shortPath, normalizeLineEndings } from "../helpers.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { renderToolError, renderToolMetrics, fillToolBackground } from "../render.js";
import { fffFormatGrepText } from "../fff-helpers.js";
import { parseMultiGrepConstraints } from "../multi-grep-fallback.js";
import type { MultiGrepFallback } from "../types.js";

type Result = AgentToolResult<Record<string, unknown>>;

const noopFallback: MultiGrepFallback = async () => ({ text: "", matchCount: 0, limitReached: false });

export function registerMultiGrepTool(
	pi: ExtensionAPI,
	cwd: string,
	fffService: FffServiceWithCursor | null | undefined,
	sdkGrepTool?: SdkToolDef,
	ripgrepFallback: MultiGrepFallback = noopFallback,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = TextComp ?? (() => {
		const { Text } = require("@earendil-works/pi-tui") as { Text: new (t?: string, x?: number, y?: number) => { setText(v: string): void } };
		return Text;
	})();
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "multi_grep",
		label: "Multi Grep",
		description: "Search file contents using multiple patterns (OR logic)",
	parameters: Type.Object({
			patterns: Type.Array(Type.String()),
			path: Type.Optional(Type.String()),
			constraints: Type.Optional(Type.String()),
			context: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
		}),
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const p = params as any;
			const patterns = Array.isArray(p.patterns) ? p.patterns.map(String) : [String(p.patterns ?? "")];

			// Guard: empty patterns
			if (!patterns.length || (patterns.length === 1 && !patterns[0])) {
				return { content: [{ text: "patterns array must have at least 1 element", type: "text" as const }], details: { _type: "grepResult" } as GrepDetails };
			}

			// Guard: aborted signal
			if (sig?.aborted) {
				return { content: [{ text: "Aborted", type: "text" as const }], details: { _type: "grepResult" } as GrepDetails };
			}
			const constraintsStr = p.constraints ? String(p.constraints) : undefined;
			const context = typeof p.context === "number" ? p.context : undefined;
			const effectiveLimit = typeof p.limit === "number" ? p.limit : 200;
			const alternationPattern = patterns.length === 1 ? patterns[0] : patterns.join("|");

			const hasNativeConstraints = Boolean(constraintsStr);
			const parsedConstraints = constraintsStr ? parseMultiGrepConstraints(constraintsStr) : null;
			const requestedConstraints = parsedConstraints?.ok ? constraintsStr : undefined;
			let effectivePath = p.path ? String(p.path) : undefined;
			const requestedPath = parsedConstraints?.ok ? parsedConstraints.tokens[0] : undefined;
			if (requestedPath && !effectivePath) effectivePath = requestedPath;

			// 1. FFF multiGrep (no constraints AND no path)
			if (fffService?.isAvailable && !hasNativeConstraints && !effectivePath) {
				try {
					const fff = fffService.getFinder();
					if (!fff) throw new Error("FFF finder not available");
					const grepResult = fff.multiGrep({
						patterns,
						pageSize: effectiveLimit,
						smartCase: !shouldIgnoreCase(patterns),
						beforeContext: context ?? 0,
						afterContext: context ?? 0,
					});
					if (grepResult.ok) {
						const grep = grepResult.value;
						const items = grep.items.slice(0, effectiveLimit);
						const cursorStore = fffService.getCursorStore();
						const notices: string[] = [];
						if (fffService.partialIndex) notices.push("Warning: partial file index");
						if (items.length >= effectiveLimit) notices.push(`${effectiveLimit} limit reached`);
						if (grep.nextCursor) {
							const cursorId = cursorStore.store(grep.nextCursor);
							notices.push(`More results available: cursor="${cursorId}"`);
						}
						const text = appendNotices(fffFormatGrepText(items, effectiveLimit), notices);
						return { content: [{ type: "text" as const, text }], details: { _type: "grepResult", text, pattern: alternationPattern, matchCount: items.length } as GrepDetails };
					}
					// FFF failure -> return error directly
					return { content: [{ type: "text" as const, text: grepResult.error || "multi_grep failed" }], details: { _type: "grepResult", text: "", pattern: alternationPattern, matchCount: 0 } as GrepDetails };
				} catch { /* fall through */ }
			}

			// 2. Ripgrep fallback
			if (requestedConstraints || !sdkGrepTool) {
				try {
					const pathBacked = Boolean(requestedConstraints && requestedPath && !Boolean(p.path) && !requestedConstraints.includes("*") && !requestedConstraints.includes("?"));
			const constraintsForRg = pathBacked ? undefined : requestedConstraints;
					const notices: string[] = [];
					if (!fffService?.isAvailable) notices.push("FFF unavailable, used ripgrep fallback");
					else if (hasNativeConstraints) notices.push("Used ripgrep fallback for constrained search");
					else notices.push("Used ripgrep fallback");

					const rgResult = await ripgrepFallback({
						cwd, patterns, path: effectivePath, constraints: constraintsForRg,
						ignoreCase: shouldIgnoreCase(patterns), context, limit: effectiveLimit, signal: sig,
					});
					const text = normalizeLineEndings(rgResult.text) || "No matches found";
					if (rgResult.limitReached) notices.push(`${effectiveLimit} limit reached`);
					return { content: [{ type: "text" as const, text: appendNotices(text, notices) }], details: { _type: "grepResult", text, pattern: alternationPattern, matchCount: rgResult.matchCount } as GrepDetails };
				} catch (error: unknown) {
					return { content: [{ type: "text" as const, text: `multi_grep error: ${error instanceof Error ? error.message : String(error)}` }], details: { _type: "grepResult", text: "", pattern: alternationPattern, matchCount: 0 } as GrepDetails };
				}
			}

			// 3. SDK grep fallback
			try {
				const notices: string[] = [];
				if (!fffService?.isAvailable) notices.push("FFF unavailable, used SDK grep fallback");
				const result = await sdkGrepTool.execute(tid, { pattern: alternationPattern, path: effectivePath, ignoreCase: shouldIgnoreCase(patterns), context, limit: effectiveLimit }, sig, null, ctx) as Result;
				const tc = getText(result);
				result.content = [{ type: "text" as const, text: appendNotices(tc, notices) }];
				result.details = { _type: "grepResult", text: tc, pattern: alternationPattern, matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0 } as GrepDetails;
				return result;
			} catch (error: unknown) {
				return { content: [{ type: "text" as const, text: `multi_grep error: ${error instanceof Error ? error.message : String(error)}` }], details: { _type: "grepResult", text: "", pattern: alternationPattern, matchCount: 0 } as GrepDetails };
			}
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const patterns: string[] = Array.isArray(args.patterns) ? args.patterns.map((p: unknown) => String(p)) : [];
			const limit = typeof args.limit === "number" ? args.limit : undefined;
			const path = args.path === null || args.path === undefined ? "<missing>" : shortPath(cwd, home, String(args.path));
			const literal = args.literal === true;
			const patternStr = patterns.length === 0 ? "" : patterns.length === 1 ? patterns[0]! : patterns.length === 2 ? `${patterns[0]}|${patterns[1]}` : `${patterns[0]}|${patterns[1]}|+${patterns.length - 2}`;
			let out = `${theme.fg("toolTitle", theme.bold("mgrep"))} ${theme.fg("accent", `/${patternStr || ""}/`)}${theme.fg("toolOutput", ` in ${path}`)}`;
			if (literal) out += theme.fg("dim", ` (literal)`);
			if (limit !== undefined) out += theme.fg("dim", ` limit ${limit}`);
			text.setText(fillToolBackground(`\n  ${out}`, ctx.isError ? BG_ERROR : undefined));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			if (ctx.isError) { text.setText(renderToolError(getText(result) || "Error", theme)); return text; }
			const d = result.details as GrepDetails | undefined;
			if (d?._type === "grepResult" && d.text) {
				const lines = d.text.split("\n");
				const maxShow = ctx.expanded ? lines.length : Math.min(lines.length, MAX_PREVIEW_LINES);
				const show = lines.slice(0, maxShow);
				const nw = Math.max(3, 5);

				let hlRe: RegExp | null = null;
				try { hlRe = new RegExp(`(${d.pattern})`, "gi"); } catch {}

				const out: string[] = [];
				let currentFile = "";
				for (const line of show) {
					const fileMatch = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
					if (fileMatch) {
						const [, file, lineNo, content] = fileMatch;
						if (file !== currentFile) {
							if (currentFile) out.push("");
							out.push(`  ${theme.fg("accent", theme.bold(file))}`);
							currentFile = file;
						}
						let display = content;
						if (hlRe) display = content.replace(hlRe, (m) => `${RST}${theme.fg("warning", theme.bold(m))}${RST}`);
						const padded = `${FG_LNUM}${String(lineNo).padStart(nw)}${RST} ${FG_RULE}│${RST} ${display}${RST}`;
						out.push(`  ${padded}`);
					} else if (line.trim()) {
						out.push(`  ${FG_DIM}  ${line.trim()}${RST}`);
					}
				}
				const preview = out.join("\n");
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

function shouldIgnoreCase(patterns: string[]): boolean { return !patterns.some((p) => /[A-Z]/.test(p)); }
function appendNotices(text: string, notices: string[]): string { return notices.length ? `${text}\n\n[${notices.join(". ")}]` : text; }
function getText(result: Result): string { return ((result.content ?? []) as TextContent[]).filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? ""; }
