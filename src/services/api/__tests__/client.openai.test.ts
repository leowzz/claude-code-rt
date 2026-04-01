import { afterEach, describe, expect, test } from "bun:test";
import { getAnthropicClient } from "../client";

const ORIGINAL_ENV = { ...process.env };
(globalThis as typeof globalThis & { MACRO?: { VERSION: string } }).MACRO = {
	VERSION: "test",
};

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe("getAnthropicClient OpenAI provider", () => {
	test("sends chat completions requests to the configured OpenAI-compatible endpoint", async () => {
		process.env.CLAUDE_CODE_USE_OPENAI = "1";
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env.ANTHROPIC_BASE_URL = "https://example.com/custom";

		let seenUrl = "";
		let seenBody = "";

		const client = await getAnthropicClient({
			maxRetries: 0,
			model: "gpt-5.4",
			fetchOverride: async (input, init) => {
				seenUrl = typeof input === "string" ? input : input.url;
				seenBody = String(init?.body);
				return new Response(
					JSON.stringify({
						id: "chatcmpl-123",
						model: "gpt-5.4",
						usage: {
							prompt_tokens: 12,
							completion_tokens: 5,
						},
						choices: [
							{
								finish_reason: "stop",
								message: {
									content: "hello",
								},
							},
						],
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					},
				);
			},
			source: "test_openai_client",
		});

		const response = await client.beta.messages.create({
			model: "gpt-5.4",
			max_tokens: 64,
			stream: false,
			system: [],
			messages: [{ role: "user", content: "hello" }],
		});

		expect(seenUrl).toBe("https://example.com/custom/v1/chat/completions");
		expect(JSON.parse(seenBody)).toMatchObject({
			model: "gpt-5.4",
			stream: false,
			messages: [{ role: "user", content: "hello" }],
		});
		expect(response.content).toEqual([
			{
				type: "text",
				text: "hello",
			},
		]);
	});

	test("adapts streaming chat completions chunks into Anthropic-style stream events", async () => {
		process.env.CLAUDE_CODE_USE_OPENAI = "1";
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env.ANTHROPIC_BASE_URL = "https://example.com";

		const encoder = new TextEncoder();
		const sseFrames = [
			'data: {"id":"chatcmpl-1","model":"gpt-5.4","choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n',
			'data: {"id":"chatcmpl-1","model":"gpt-5.4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup_weather","arguments":"{\\"city\\":\\"Shanghai\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":6}}\n\n',
			"data: [DONE]\n\n",
		];

		const client = await getAnthropicClient({
			maxRetries: 0,
			model: "gpt-5.4",
			fetchOverride: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							for (const frame of sseFrames) {
								controller.enqueue(encoder.encode(frame));
							}
							controller.close();
						},
					}),
					{
						status: 200,
						headers: {
							"content-type": "text/event-stream",
							"x-request-id": "req_123",
						},
					},
				),
			source: "test_openai_stream",
		});

		const { data, request_id } = await client.beta.messages
			.create({
				model: "gpt-5.4",
				max_tokens: 64,
				stream: true,
				system: [],
				messages: [{ role: "user", content: "hello" }],
			})
			.withResponse();

		const events = [];
		for await (const event of data) {
			events.push(event);
		}

		expect(request_id).toBe("req_123");
		expect(events.map((event: any) => event.type)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop",
		]);
	});
});
