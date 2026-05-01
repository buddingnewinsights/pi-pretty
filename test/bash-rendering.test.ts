import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";

import piPrettyExtension from "../src/index.js";

class MockText {
	private text = "";
	constructor(_text = "", _x = 0, _y = 0) {}
	setText(value: string) {
		this.text = value;
	}
	getText() {
		return this.text;
	}
}

const mockTheme = {
	fg: (_key: string, text: string) => text,
	bold: (text: string) => text,
};

const ansiMockTheme = {
	fg: (_key: string, text: string) => `\x1b[31m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

function mockToolFactory(exec: any) {
	return (_cwd: string) => ({
		name: "mock",
		description: "mock",
		parameters: { type: "object", properties: {} },
		execute: exec,
	});
}

function withStdoutColumns<T>(columns: number, fn: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
	try {
		return fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(process.stdout, "columns", descriptor);
		} else {
			delete (process.stdout as NodeJS.WriteStream & { columns?: number }).columns;
		}
	}
}

function loadBashTool() {
	const noopExec = async () => ({ content: [{ type: "text", text: "" }] });
	const tools = new Map<string, any>();
	const pi = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: () => {},
		on: () => {},
	};

	piPrettyExtension(pi, {
		sdk: {
			createReadToolDefinition: mockToolFactory(noopExec),
			createBashToolDefinition: mockToolFactory(noopExec),
			createLsToolDefinition: mockToolFactory(noopExec),
			createFindToolDefinition: mockToolFactory(noopExec),
			createGrepToolDefinition: mockToolFactory(noopExec),
			getAgentDir: () => "/tmp/pi-pretty-test",
		},
		TextComponent: MockText,
	});

	return tools.get("bash");
}

describe("bash renderCall expansion", () => {
	it("truncates long commands when collapsed", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const rendered = bashTool.renderCall({ command }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: false,
			invalidate: () => {},
		});

		expect(rendered.getText()).toContain("bash");
		expect(rendered.getText()).toContain("…");
		expect(rendered.getText()).not.toContain(command);
	});

	it("shows the full command when expanded", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const rendered = bashTool.renderCall({ command }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: true,
			invalidate: () => {},
		});

		expect(rendered.getText()).toContain(command);
	});

	it("preserves timeout text in both collapsed and expanded states", () => {
		const bashTool = loadBashTool();
		const command = `printf '${"x".repeat(120)}'`;

		const collapsed = bashTool.renderCall({ command, timeout: 5 }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: false,
			invalidate: () => {},
		});
		const expanded = bashTool.renderCall({ command, timeout: 5 }, mockTheme, {
			lastComponent: new MockText(),
			isError: false,
			state: {},
			expanded: true,
			invalidate: () => {},
		});

		expect(collapsed.getText()).toContain("5s timeout");
		expect(expanded.getText()).toContain("5s timeout");
	});

	it("truncates expanded ANSI tool headers to the terminal width before padding backgrounds", () => {
		withStdoutColumns(84, () => {
			const bashTool = loadBashTool();
			const command = `printf '${"界".repeat(120)}'`;

			const rendered = bashTool.renderCall({ command }, ansiMockTheme, {
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: true,
				invalidate: () => {},
			});

			for (const line of rendered.getText().split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(80);
			}
		});
	});

	it("does not exceed narrow terminal widths", () => {
		withStdoutColumns(24, () => {
			const bashTool = loadBashTool();
			const command = `printf '${"x".repeat(120)}'`;

			const rendered = bashTool.renderCall({ command }, ansiMockTheme, {
				lastComponent: new MockText(),
				isError: false,
				state: {},
				expanded: true,
				invalidate: () => {},
			});

			for (const line of rendered.getText().split("\n")) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(20);
			}
		});
	});
});
