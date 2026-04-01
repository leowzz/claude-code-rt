import { describe, expect, test } from "bun:test";
import {
	getOpenAIPath,
	openAIChunkToAnthropicEvents,
	toOpenAIChatRequest,
} from "../openaiCompat";

describe("toOpenAIChatRequest", () => {
	test("maps Anthropic tools into OpenAI function tools", () => {
		const request = toOpenAIChatRequest({
			model: "gpt-5.4",
			max_tokens: 128,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "ping",
						},
					],
				},
			],
			system: [
				{
					type: "text",
					text: "system prompt",
				},
			],
			tools: [
				{
					name: "lookup_weather",
					description: "Look up the weather",
					input_schema: {
						type: "object",
						properties: {
							city: { type: "string" },
						},
						required: ["city"],
					},
				},
			],
		});

		expect(request.model).toBe("gpt-5.4");
		expect(request.stream).toBeTrue();
		expect(request.messages[0]).toEqual({
			role: "system",
			content: "system prompt",
		});
		expect(request.tools).toEqual([
			{
				type: "function",
				function: {
					name: "lookup_weather",
					description: "Look up the weather",
					parameters: {
						type: "object",
						properties: {
							city: { type: "string" },
						},
						required: ["city"],
					},
				},
			},
		]);
	});
});

describe("openAIChunkToAnthropicEvents", () => {
	test("converts text and tool-call deltas into Anthropic-style stream events", () => {
		const events = openAIChunkToAnthropicEvents({
			id: "chatcmpl-123",
			model: "gpt-5.4",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						content: "Hello",
						tool_calls: [
							{
								index: 0,
								id: "call_123",
								type: "function",
								function: {
									name: "lookup_weather",
									arguments: "{\"city\":\"Shanghai\"}",
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		expect(events.map(event => event.type)).toEqual([
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

describe("getOpenAIPath", () => {
	test("normalizes a base URL into the chat completions endpoint", () => {
		expect(getOpenAIPath("https://example.com")).toBe(
			"https://example.com/v1/chat/completions",
		);
		expect(getOpenAIPath("https://example.com/v1")).toBe(
			"https://example.com/v1/chat/completions",
		);
	});
});
