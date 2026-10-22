import { describe, expect, it } from "vitest";
import { installUserRail, setUserRail, userRailWidth } from "../src/user-rail.js";

// The host pads every line it renders to the width it was handed, so the rail's cell has to come
// out of that budget rather than on top of it — otherwise rows overflow their column by one cell.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]133;[A-Z]\x07/g, "");
const visible = (s: string) => [...strip(s)].length;

// A minimal stand-in for the host's UserMessageComponent: pads each line to the given width and
// brackets the block with OSC133 zone markers, which is all the rail wrapper has to preserve.
class StubUserMessage {
	constructor(private readonly text: string) {}
	render(width: number): string[] {
		const body = ` ${this.text}`.padEnd(width, " ");
		return [`\u001b]133;A\u0007${body}`, "".padEnd(width, " "), `\u001b]133;B\u0007\u001b]133;C\u0007${body}`];
	}
}

describe("user message rail", () => {
	it("installs onto the host class and reports the width it costs", () => {
		expect(installUserRail(StubUserMessage)).toBe(true);
		// A second install is a no-op rather than a second wrapper.
		expect(installUserRail(StubUserMessage)).toBe(true);
		setUserRail("#505078");
		expect(userRailWidth()).toBe(1);
		setUserRail(undefined);
		expect(userRailWidth()).toBe(0);
	});

	it("keeps every row within the width it was asked to render", () => {
		installUserRail(StubUserMessage);
		setUserRail("#505078");
		const rows = new StubUserMessage("hello world").render(40);
		setUserRail(undefined);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(visible(row)).toBe(40);
	});

	it("prefixes a tinted bar and keeps OSC133 markers at the start of the line", () => {
		installUserRail(StubUserMessage);
		setUserRail("#505078");
		const rows = new StubUserMessage("hi").render(40);
		setUserRail(undefined);
		const stripped = rows.map(strip);
		// The bar occupies the first column of the first content row.
		expect(stripped[1].startsWith(" ")).toBe(true);
		// The zone markers stay ahead of the rail on the rows that carry them.
		expect(rows[0].startsWith("\u001b]133;")).toBe(true);
		expect(rows[rows.length - 1]).toContain("\u001b]133;B\u0007");
	});

	it("renders exactly as the host does when disabled", () => {
		installUserRail(StubUserMessage);
		setUserRail(undefined);
		expect(userRailWidth()).toBe(0);
		const own = new StubUserMessage("hello world").render(40);
		for (const row of own) expect(visible(row)).toBe(40);
		// No background SGR is introduced by the wrapper while the rail is off.
		expect(own.join("")).not.toContain("\u001b[48;2;");
	});

	it("ignores a colour that is not #rrggbb", () => {
		installUserRail(StubUserMessage);
		setUserRail("red");
		expect(userRailWidth()).toBe(0);
	});
});
