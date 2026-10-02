import { expect } from "bun:test"
import { Effect } from "effect"
import { AISDK } from "@ustcode-ai/core/aisdk"
import { Model } from "@ustcode-ai/core/model"
import { Plugin } from "@ustcode-ai/core/plugin"
import { PluginHost } from "@ustcode-ai/core/plugin/host"
import { CoherePlugin } from "@ustcode-ai/core/plugin/provider/cohere"
import { GatewayPlugin } from "@ustcode-ai/core/plugin/provider/gateway"
import { PerplexityPlugin } from "@ustcode-ai/core/plugin/provider/perplexity"
import { VenicePlugin } from "@ustcode-ai/core/plugin/provider/venice"
import { Provider } from "@ustcode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const modelID = Model.ID.make("test-model")
const options = { name: "custom-provider", apiKey: "test", baseURL: "https://example.test" }
const providers = [
  { id: "cohere", plugin: CoherePlugin, package: "@ai-sdk/cohere", provider: "cohere.chat" },
  { id: "gateway", plugin: GatewayPlugin, package: "@ai-sdk/gateway", provider: "gateway" },
  { id: "perplexity", plugin: PerplexityPlugin, package: "@ai-sdk/perplexity", provider: "perplexity" },
  { id: "venice", plugin: VenicePlugin, package: "venice-ai-sdk-provider", provider: "custom-provider.chat" },
] as const

const it = testEffect(PluginTestLayer)

providers.forEach((item) =>
  it.effect(`${item.id} loads only its exact package`, () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const host = yield* PluginHost.make(plugin)
      yield* item.plugin.effect(host)
      const model = Model.Info.make({
        ...Model.Info.default(Provider.ID.make(item.id), modelID),
        modelID,
        package: Provider.aisdk(item.package),
      })
      const matched = yield* aisdk.runSDK({ model, package: item.package, options })
      const ignored = yield* aisdk.runSDK({ model, package: `${item.package}/unsupported`, options })
      const language = matched.sdk?.languageModel(modelID)

      expect({
        provider: language?.provider,
        modelID: language?.modelId,
        version: language?.specificationVersion,
        ignored: ignored.sdk === undefined,
      }).toEqual({ provider: item.provider, modelID: "test-model", version: "v3", ignored: true })
    }),
  ),
)
