import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@ustcode-ai/core/provider"

describe("Provider", () => {
  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@ustcode-ai/ai/providers/baseten",
      "@ustcode-ai/ai/providers/cerebras",
      "@ustcode-ai/ai/providers/cloudflare-ai-gateway",
      "@ustcode-ai/ai/providers/cloudflare-workers-ai",
      "@ustcode-ai/ai/providers/deepinfra",
      "@ustcode-ai/ai/providers/deepseek",
      "@ustcode-ai/ai/providers/fireworks",
      "@ustcode-ai/ai/providers/google-vertex",
      "@ustcode-ai/ai/providers/google-vertex/gemini",
      "@ustcode-ai/ai/providers/google-vertex/chat",
      "@ustcode-ai/ai/providers/google-vertex/responses",
      "@ustcode-ai/ai/providers/google-vertex/messages",
      "@ustcode-ai/ai/providers/groq",
      "@ustcode-ai/ai/providers/mistral",
      "@ustcode-ai/ai/providers/togetherai",
    ]

    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
        transport: "websocket",
      }),
    ).toEqual({
      apiKey: "secret",
      reasoningEffort: "high",
    })
  })

  test("inherits shared and loose settings without provider-only policies", () => {
    expect(
      Provider.modelSettings({
        timeout: 60_000,
        chunkTimeout: 30_000,
        transport: "websocket",
        compaction: { type: "native" },
        reasoningEffort: "high",
      }),
    ).toEqual({
      compaction: { type: "native" },
      reasoningEffort: "high",
    })
  })
})
