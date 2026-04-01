import { afterEach, describe, expect, test } from "bun:test";
import { getAPIProvider } from "../providers";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe("getAPIProvider", () => {
	test("returns openai when CLAUDE_CODE_USE_OPENAI is enabled", () => {
		process.env.CLAUDE_CODE_USE_OPENAI = "1";

		expect(getAPIProvider()).toBe("openai");
	});

	test("prefers openai over other third-party provider flags", () => {
		process.env.CLAUDE_CODE_USE_OPENAI = "1";
		process.env.CLAUDE_CODE_USE_BEDROCK = "1";
		process.env.CLAUDE_CODE_USE_VERTEX = "1";

		expect(getAPIProvider()).toBe("openai");
	});
});
