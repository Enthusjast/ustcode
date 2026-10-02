import { expect } from "bun:test"
import { Credential } from "@ustcode-ai/core/credential"
import { Integration } from "@ustcode-ai/core/integration"
import { Model } from "@ustcode-ai/core/model"
import { Plugin } from "@ustcode-ai/core/plugin"
import { PluginHost } from "@ustcode-ai/core/plugin/host"
import { Provider } from "@ustcode-ai/core/provider"
import { ProviderAuth } from "@ustcode-ai/core/provider-auth"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { createTokenWorksPlugin } from "../../src/plugin/provider/tokenworks"
import { BOOTSTRAP_URL, METHOD_ID } from "../../src/plugin/provider/tokenworks/oidc"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("ustc-tokenworks")
const integrationID = Integration.ID.make("ustc-tokenworks")
const existingProviderID = Provider.ID.make("existing-provider")
const existingModelID = Model.ID.make("existing-model")
const access = "oidc-access-token"
const gatewayKey = "ephemeral-gateway-key"

it.effect("publishes authorized models while keeping the bootstrap key out of persistent and public data", () =>
  Effect.gen(function* () {
    const credential = Credential.OAuth.make({
      type: "oauth",
      methodID: METHOD_ID,
      access,
      refresh: "oidc-refresh-token",
      expires: Date.now() + 3_600_000,
      metadata: { sub: "ustc-user", name: "USTC User", clientId: "claude" },
    })
    const credentials = yield* Credential.Service
    yield* credentials.create({ integrationID, value: credential, label: "USTC User" })
    const models = yield* Model.Service
    const providers = yield* Provider.Service
    const existing = {
      ...Model.Info.default(existingProviderID, existingModelID),
      name: "Existing default",
      package: "@ustcode-ai/ai/providers/openai-compatible",
    }
    yield* providers.transform((editor) =>
      editor.add({
        info: {
          ...Provider.Info.empty(existingProviderID),
          name: "Existing provider",
          activation: "enabled",
          package: "@ustcode-ai/ai/providers/openai-compatible",
        },
        models: [existing],
      }),
    )
    yield* models.transform((editor) => editor.default.set(existingProviderID, existingModelID))
    const defaultBefore = yield* models.default()
    const requests: { url: string; init?: RequestInit }[] = []
    const requester = async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url !== BOOTSTRAP_URL) throw new Error("Unexpected TokenWorks request")
      return Response.json({
        inferenceProvider: "gateway",
        inferenceCredentialKind: "static",
        inferenceGatewayBaseUrl: "https://api.llm.ustc.edu.cn/v1",
        inferenceGatewayApiKey: gatewayKey,
        inferenceGatewayAuthScheme: "bearer",
        expiresAt: Date.now() / 1_000 + 600,
        inferenceModels: [
          {
            name: "qwen-chat",
            contextWindow: 131_072,
            maxOutputTokens: 16_384,
            capabilities: { tools: true, reasoning: true },
          },
        ],
      })
    }
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    yield* createTokenWorksPlugin(requester).effect(host)

    const auth = yield* ProviderAuth.Service
    const integrations = yield* Integration.Service
    const provider = yield* providers.get(providerID)
    const model = yield* models.get(providerID, Model.ID.make("qwen-chat"))
    const integration = yield* integrations.get(integrationID)
    const resolveCredential = yield* auth.get(providerID)
    if (!provider || !model || !resolveCredential) throw new Error("TokenWorks provider was not registered")
    const transient = yield* resolveCredential()
    const stored = yield* credentials.all()

    expect(requests).toHaveLength(1)
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer " + access)
    expect(transient.key).toBe(gatewayKey)
    expect(integration?.methods).toContainEqual({
      id: METHOD_ID,
      type: "oauth",
      label: "Sign in with USTC TokenWorks",
    })
    expect(provider.settings).toMatchObject({ baseURL: "https://api.llm.ustc.edu.cn/v1", provider: "ustc-tokenworks" })
    expect(provider.settings).not.toHaveProperty("apiKey")
    expect(JSON.stringify(model)).not.toContain(gatewayKey)
    expect(JSON.stringify(provider)).not.toContain(gatewayKey)
    expect(JSON.stringify(stored)).not.toContain(gatewayKey)
    expect(stored).toHaveLength(1)
    expect((yield* models.default())?.providerID).toBe(defaultBefore?.providerID)
    expect((yield* models.default())?.id).toBe(defaultBefore?.id)
  }),
)
