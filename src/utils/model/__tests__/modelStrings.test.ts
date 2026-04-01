import { describe, expect, test } from "bun:test";
import { applyModelOverridesForTests } from "../modelStrings";

describe("applyModelOverridesForTests", () => {
	test("supports overriding multiple canonical Claude models", () => {
		const base = {
			haiku45: "claude-haiku-4-5-20251001",
			opus46: "claude-opus-4-6",
			sonnet46: "claude-sonnet-4-6",
		};

		const overridden = applyModelOverridesForTests(base, {
			"claude-haiku-4-5-20251001": "gpt-5-mini",
			"claude-opus-4-6": "gpt-5.4",
		});

		expect(overridden.haiku45).toBe("gpt-5-mini");
		expect(overridden.opus46).toBe("gpt-5.4");
		expect(overridden.sonnet46).toBe("claude-sonnet-4-6");
	});
});
