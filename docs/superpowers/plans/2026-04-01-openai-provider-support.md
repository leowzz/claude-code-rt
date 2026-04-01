# OpenAI Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenAI-compatible provider that can call `v1/chat/completions`, reuse `modelOverrides`, and stream tool calls through the existing assistant event pipeline.

**Architecture:** Add a formal `openai` provider alongside the existing Anthropic providers, keep Claude-facing model selection logic unchanged, and translate Anthropic-style request/response shapes at the API client boundary. Reuse the current query loop by adapting OpenAI chat completion chunks into Anthropic-style streaming events rather than rewriting the downstream stream consumer.

**Tech Stack:** Bun, TypeScript, fetch/SSE parsing, existing Anthropic SDK-compatible internal request pipeline

---

### Task 1: Lock provider and model-mapping behavior

**Files:**
- Modify: `src/utils/model/providers.ts`
- Modify: `src/utils/model/configs.ts`
- Modify: `src/utils/model/modelStrings.ts`
- Test: `src/utils/model/__tests__/providers.test.ts`
- Test: `src/utils/model/__tests__/modelStrings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("prefers openai provider when CLAUDE_CODE_USE_OPENAI is set", () => {
  process.env.CLAUDE_CODE_USE_OPENAI = "1";
  expect(getAPIProvider()).toBe("openai");
});

test("applies multiple model overrides for provider requests", () => {
  expect(applyModelOverridesForTests(base, overrides).opus46).toBe("gpt-5.4");
  expect(applyModelOverridesForTests(base, overrides).haiku45).toBe("gpt-5-mini");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: FAIL because the provider enum and exported test helper do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
export type APIProvider = "firstParty" | "bedrock" | "vertex" | "foundry" | "openai";
// extend config entries with openai defaults
// export a pure helper for override application
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: PASS

### Task 2: Lock OpenAI request and stream translation

**Files:**
- Create: `src/services/api/openaiCompat.ts`
- Test: `src/services/api/__tests__/openaiCompat.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("maps Anthropic tool schema into OpenAI tools", () => {
  expect(toOpenAIChatRequest(params).tools?.[0]?.type).toBe("function");
});

test("translates streamed tool call deltas into Anthropic-style events", () => {
  expect(events.map(e => e.type)).toContain("content_block_delta");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts`
Expected: FAIL because the translation helpers do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
export function toOpenAIChatRequest(...) { ... }
export function openAIChunkToAnthropicEvents(...) { ... }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts`
Expected: PASS

### Task 3: Integrate the OpenAI-compatible client path

**Files:**
- Modify: `src/services/api/client.ts`
- Modify: `src/services/api/claude.ts`
- Modify: `src/utils/sideQuery.ts`
- Modify: `src/services/tokenEstimation.ts`

- [ ] **Step 1: Write the failing integration-focused tests**

```ts
test("builds a chat completions request with the overridden model id", () => {
  expect(request.model).toBe("gpt-5.4");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: FAIL because the client still assumes Anthropic SDK transport semantics only.

- [ ] **Step 3: Write the minimal implementation**

```ts
if (getAPIProvider() === "openai") {
  return createOpenAICompatibleClient(...);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: PASS

### Task 4: Add provider-specific degradations and finish verification

**Files:**
- Modify: `src/services/claudeAiLimits.ts`
- Modify: `src/utils/model/modelCapabilities.ts`
- Modify: `src/services/tokenEstimation.ts`
- Modify: `src/utils/status.tsx`

- [ ] **Step 1: Write the failing tests or assertions where practical**

```ts
test("openai provider skips anthropic-only capability probes", () => {
  expect(isModelCapabilitiesEligible()).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: FAIL until the provider-specific guards are updated.

- [ ] **Step 3: Write the minimal implementation**

```ts
if (getAPIProvider() === "openai") return;
```

- [ ] **Step 4: Run focused verification**

Run: `bun test src/services/api/__tests__/openaiCompat.test.ts src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: PASS

- [ ] **Step 5: Run broader safety verification**

Run: `bun test src/utils/__tests__/array.test.ts src/utils/__tests__/set.test.ts src/services/api/__tests__/openaiCompat.test.ts src/utils/model/__tests__/providers.test.ts src/utils/model/__tests__/modelStrings.test.ts`
Expected: PASS
