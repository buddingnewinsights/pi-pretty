import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withClaudeToolStyle } from "../../src/claude-style.js";
import { makeRenderCall } from "../../src/render.js";
import type { ThemeLike } from "../../src/types.js";

export default function (pi: ExtensionAPI): void {
	const style = process.env.PROBE_STYLE;
	if (style !== "claudecode" && style !== "default") {
		throw new Error("Choose the claudecode or default tool style.");
	}

	const configDir = process.env.PRETTY_CONFIG_DIR;
	if (!configDir) throw new Error("PRETTY_CONFIG_DIR is required for this fixture.");

	const defaultCall = makeRenderCall("Read");
	const renderCall =
		style === "claudecode"
			? withClaudeToolStyle({ name: "read", label: "Read", renderCall: defaultCall }).renderCall
			: defaultCall;

	let colours = {
		toolSuccessBg: "\x1b[48;2;204;208;218m",
		toolErrorBg: "\x1b[48;2;230;233;239m",
	};
	const theme: ThemeLike = {
		fg: (_key, text) => text,
		bold: (text) => text,
		getBgAnsi: (key) => (key === "toolSuccessBg" || key === "toolErrorBg" ? colours[key] : ""),
	};
	const render = (isError: boolean): string[] =>
		renderCall({ path: "a.ts" }, theme, { state: {}, isPartial: false, isError, outputPad: 1 }).render(24);
	const snapshot = () => ({ success: render(false), error: render(true) });
	const snapshots = [snapshot()];

	colours = {
		toolSuccessBg: "\x1b[48;2;49;50;68m",
		toolErrorBg: "\x1b[48;2;30;30;46m",
	};
	snapshots.push(snapshot());

	const configPath = join(configDir, "pi-pretty.json");
	for (const background of [{ tool: "#112233", error: "#445566" }, { tool: "#778899" }, undefined]) {
		writeFileSync(configPath, JSON.stringify({ background }));
		snapshots.push(snapshot());
	}

	pi.events.emit("tool-backgrounds", snapshots);
}
