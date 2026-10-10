import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Never read the developer's real ~/.pi/agent/pi-pretty.json (e.g. toolStyle) during tests.
		env: { PRETTY_CONFIG_DIR: "/nonexistent/pi-pretty-test-config" },
	},
});
