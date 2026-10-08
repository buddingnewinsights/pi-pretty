import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerLsTool } from "../src/tools/ls.js";
import { registerReadTool } from "../src/tools/read.js";

class MockText {
	setText(_value: string) {}
}

// grep/find are deliberately absent: their host snippets would advertise dedicated
// search tools next to the bash tool's `rg -n` guidance.
describe("host prompt metadata passthrough", () => {
	it("read forwards the host snippet, guidelines, and constrained sampling", () => {
		let definition: ToolDefinition | undefined;
		const pi = {
			registerTool: (d: ToolDefinition) => {
				definition = d;
			},
		} as unknown as ExtensionAPI;

		registerReadTool(
			pi,
			process.cwd(),
			undefined,
			{
				description: "read fixture",
				parameters: { type: "object", properties: {} },
				promptSnippet: "Read file contents",
				promptGuidelines: ["Use read to examine files instead of cat or sed."],
				constrainedSampling: { type: "json_schema", strict: "prefer" },
				execute: async () => ({ content: [], details: {} }),
			},
			MockText,
		);

		expect(definition?.promptSnippet).toBe("Read file contents");
		expect(definition?.promptGuidelines).toEqual(["Use read to examine files instead of cat or sed."]);
		expect(definition?.constrainedSampling).toEqual({ type: "json_schema", strict: "prefer" });
	});

	it("read forwards the host output schema", () => {
		let definition: ToolDefinition | undefined;
		const pi = {
			registerTool: (d: ToolDefinition) => {
				definition = d;
			},
		} as unknown as ExtensionAPI;
		const outputSchema = { type: "object", properties: { content: { type: "string" } } };

		registerReadTool(
			pi,
			process.cwd(),
			undefined,
			{
				parameters: { type: "object", properties: {} },
				outputSchema,
				execute: async () => ({ content: [], details: {} }),
			},
			MockText,
		);

		expect(definition?.outputSchema).toBe(outputSchema);
	});

	it("ls forwards the host snippet", () => {
		let definition: ToolDefinition | undefined;
		const pi = {
			registerTool: (d: ToolDefinition) => {
				definition = d;
			},
		} as unknown as ExtensionAPI;

		registerLsTool(
			pi,
			process.cwd(),
			undefined,
			{
				description: "ls fixture",
				parameters: { type: "object", properties: {} },
				promptSnippet: "List directory contents",
				execute: async () => ({ content: [], details: {} }),
			},
			MockText,
		);

		expect(definition?.promptSnippet).toBe("List directory contents");
	});
});
