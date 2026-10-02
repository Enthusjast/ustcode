import { describe, expect, test } from "bun:test"
import {
  BootstrapConfigError,
  defaultContextWindow,
  defaultMaxOutputTokens,
  providerID,
  readBootstrapConfig,
} from "../../src/plugin/provider/tokenworks/bootstrap"

const document = (overrides: Record<string, unknown> = {}) => ({
  inferenceProvider: "gateway",
  inferenceCredentialKind: "static",
  inferenceGatewayBaseUrl: "https://api.llm.ustc.edu.cn/v1",
  inferenceGatewayApiKey: "gateway-key",
  inferenceGatewayAuthScheme: "bearer",
  inferenceModels: ["qwen-chat"],
  ...overrides,
})

describe("USTC TokenWorks bootstrap", () => {
  test("normalizes the USTC API endpoint and keeps the gateway key outside model metadata", () => {
    const config = readBootstrapConfig(document())
    expect(config.baseURL).toBe("https://api.llm.ustc.edu.cn/v1")
    expect(config.apiKey).toBe("gateway-key")
    expect(config.models[0]).toMatchObject({
      id: "qwen-chat",
      modelID: "qwen-chat",
      providerID,
      package: "@ustcode-ai/ai/providers/openai-compatible",
      capabilities: { tools: false, input: ["text"], output: ["text"] },
      limit: { context: defaultContextWindow, output: defaultMaxOutputTokens },
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    })
    expect(JSON.stringify(config.models)).not.toContain("gateway-key")
  })

  test("maps declared limits, capabilities, reasoning wire values, and leaves headers empty", () => {
    const config = readBootstrapConfig(
      document({
        inferenceGatewayBaseUrl: "https://api.llm.ustc.edu.cn",
        inferenceModels: [
          {
            name: "smart/reasoning",
            labelOverride: "Smart Reasoning",
            contextWindow: 1_000_000,
            maxOutputTokens: 32_768,
            capabilities: { tools: true, reasoning: true, vision: true },
            reasoningEfforts: { off: null, medium: "balanced", high: "deep" },
            defaultReasoningEffort: "medium",
          },
        ],
      }),
    )
    const model = config.models[0]!
    expect(config.baseURL).toBe("https://api.llm.ustc.edu.cn/v1")
    expect(config.headers).toEqual({})
    expect(model.name).toBe("Smart Reasoning")
    expect(model.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(model.limit).toEqual({ context: 1_000_000, output: 32_768 })
    expect(model.settings?.reasoningEffort).toBe("balanced")
    expect(model.variants.map((variant) => String(variant.id))).toEqual(["off", "medium", "high"])
    expect(model.variants.map((variant) => variant.settings?.reasoningEffort)).toEqual([null, "balanced", "deep"])
  })

  test("accepts Unix-second and millisecond expirations and schedules the earlier recheck", () => {
    const now = 1_800_000_000_000
    expect(readBootstrapConfig(document({ expiresAt: now / 1_000 + 600 }), now).expiresAt).toBe(now + 600_000)
    expect(
      readBootstrapConfig(document({ expiresAt: now + 120_000, configRecheckIntervalMinutes: 2 }), now).recheckAt,
    ).toBe(now + 120_000)
  })

  test("rejects an untrusted gateway, unsupported auth, duplicate models, and unsafe headers", () => {
    expect(() =>
      readBootstrapConfig(
        document({
          inferenceGatewayBaseUrl: "https://other.example/v1",
        }),
      ),
    ).toThrow(BootstrapConfigError)
    expect(() => readBootstrapConfig(document({ inferenceGatewayAuthScheme: "x-api-key" }))).toThrow(
      BootstrapConfigError,
    )
    expect(() => readBootstrapConfig(document({ inferenceModels: ["qwen-chat", "qwen-chat"] }))).toThrow(
      BootstrapConfigError,
    )
    expect(() => readBootstrapConfig(document({ inferenceCustomHeaders: { Authorization: "spoof" } }))).toThrow(
      BootstrapConfigError,
    )
    expect(() => readBootstrapConfig(document({ inferenceCustomHeaders: { "X-USTC-Tenant": "campus" } }))).toThrow(
      BootstrapConfigError,
    )
  })

  test("rejects malformed model capabilities and reasoning mappings", () => {
    expect(() =>
      readBootstrapConfig(
        document({
          inferenceModels: [{ name: "qwen-chat", capabilities: { vision: "yes" } }],
        }),
      ),
    ).toThrow(BootstrapConfigError)
    expect(() =>
      readBootstrapConfig(
        document({
          inferenceModels: [
            {
              name: "qwen-chat",
              capabilities: { reasoning: true },
              reasoningEfforts: { low: null },
            },
          ],
        }),
      ),
    ).toThrow(BootstrapConfigError)
    expect(() =>
      readBootstrapConfig(
        document({
          inferenceModels: [
            {
              name: "qwen-chat",
              capabilities: { reasoning: true },
              reasoningEfforts: { high: "high" },
              defaultReasoningEffort: "medium",
            },
          ],
        }),
      ),
    ).toThrow(BootstrapConfigError)
  })
})
