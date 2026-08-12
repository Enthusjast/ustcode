// NOTE: `./fixture` must be imported before the provider plugin modules. Its
// AppNodeBuilder -> location-services dependency chain evaluates
// src/plugin/internal.ts first, which fully initializes the provider plugin
// aggregator before gateway.ts is imported. Importing gateway.ts first would
// enter the plugin circular import (gateway -> internal -> provider -> gateway)
// through the leaf module and hit a TDZ ReferenceError on GatewayPlugin.
import { PluginTestLayer } from "./fixture"
import { AISDK } from "@enthusjast/ustcode-core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@enthusjast/ustcode-core/model"
import { PluginV2 } from "@enthusjast/ustcode-core/plugin"
import { PluginHost } from "@enthusjast/ustcode-core/plugin/host"
import { GatewayPlugin } from "@enthusjast/ustcode-core/plugin/provider/gateway"
import { ProviderV2 } from "@enthusjast/ustcode-core/provider"
import { testEffect } from "../lib/effect"

const gatewayCalls: Record<string, unknown>[] = []
const vercelGatewayModels = ["anthropic/claude-sonnet-4", "openai/gpt-5", "google/gemini-2.5-pro"]
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GatewayPlugin.effect(host)
})

mock.module("@ai-sdk/gateway", () => ({
  createGateway(options: Record<string, unknown>) {
    gatewayCalls.push({ ...options })
    return {
      languageModel(modelID: string) {
        return {
          modelId: modelID,
          provider: options.name,
          specificationVersion: "v3",
        }
      },
    }
  },
}))

describe("GatewayPlugin", () => {
  it.effect("creates a Gateway SDK for @ai-sdk/gateway", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gateway"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/gateway",
        options: { name: "gateway" },
      })
      expect(result.sdk).toBeDefined()
      expect(gatewayCalls).toHaveLength(1)
    }),
  )

  it.effect("passes the model providerID as the Gateway SDK name", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("vercel"), ModelV2.ID.make("anthropic/claude-sonnet-4")),
          api: {
            id: ModelV2.ID.make("anthropic/claude-sonnet-4"),
            type: "aisdk",
            package: "test-provider",
          },
        }),
        package: "@ai-sdk/gateway",
        options: { name: "vercel", apiKey: "test-key" },
      })

      expect(gatewayCalls).toEqual([{ name: "vercel", apiKey: "test-key" }])
      expect(result.sdk.languageModel("anthropic/claude-sonnet-4").provider).toBe("vercel")
    }),
  )

  it.effect("matches Vercel AI Gateway models by their @ai-sdk/gateway package", () =>
    Effect.gen(function* () {
      gatewayCalls.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      for (const modelID of vercelGatewayModels) {
        const ignored = yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.make("vercel"), ModelV2.ID.make(modelID)),
            api: { id: ModelV2.ID.make(modelID), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/vercel",
          options: { name: "vercel" },
        })
        expect(ignored.sdk).toBeUndefined()

        const result = yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.make("vercel"), ModelV2.ID.make(modelID)),
            api: { id: ModelV2.ID.make(modelID), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/gateway",
          options: { name: "vercel" },
        })
        expect(result.sdk).toBeDefined()
      }

      expect(gatewayCalls).toHaveLength(3)
    }),
  )
})
