import { describe, expect, test } from "bun:test"
import { ConfigProviderOptionsV1 } from "@enthusjast/ustcode-core/v1/config/provider-options"

describe("ConfigProviderOptionsV1", () => {
  test("keeps raw provider and request options unchanged", () => {
    const lowerer = ConfigProviderOptionsV1.get("custom-provider")

    expect(lowerer.provider({ apiKey: "secret", headers: { "x-test": "1" }, nested: { camelCase: true } })).toEqual({
      body: { apiKey: "secret", headers: { "x-test": "1" }, nested: { camelCase: true } },
    })
    expect(lowerer.request({ nested: { camelCase: true } })).toEqual({ nested: { camelCase: true } })
  })

  test("falls back to raw lowering for prototype property package names", () => {
    expect(ConfigProviderOptionsV1.get("toString").provider({ enabled: true })).toEqual({ body: { enabled: true } })
  })

  test("lowers OpenAI-compatible provider and request options", () => {
    const lowerer = ConfigProviderOptionsV1.get("@ai-sdk/openai-compatible")

    expect(
      lowerer.provider({
        baseURL: "https://compatible.example/v1",
        headers: { "x-test": "1" },
        body: { trace: true },
        apiKey: "secret",
      }),
    ).toEqual({
      url: "https://compatible.example/v1",
      headers: { "x-test": "1" },
      body: { trace: true },
      settings: { apiKey: "secret" },
    })
    expect(lowerer.request({ reasoningEffort: "high", serviceTier: "priority" })).toEqual({
      reasoning_effort: "high",
      serviceTier: "priority",
    })
  })

  test.each(["ai-gateway-provider"])("uses OpenAI-compatible lowering for %s", (packageName) => {
    const lowerer = ConfigProviderOptionsV1.get(packageName)

    expect(lowerer.provider({ baseURL: "https://example.test", apiKey: "secret" })).toEqual({
      url: "https://example.test",
      headers: undefined,
      body: undefined,
      settings: { apiKey: "secret" },
    })
    expect(lowerer.request({ reasoningEffort: "high" })).toEqual({ reasoning_effort: "high" })
  })
})
