import { Config } from "effect"
import type { Auth } from "../src/route/auth"
import type { ModelFactory } from "../src/route/auth-options"
import { Auth as RuntimeAuth } from "../src/route/auth"
import * as OpenAIChat from "../src/protocols/openai-chat"
import * as OpenAICompatible from "../src/providers/openai-compatible"

type BaseOptions = {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
}

type Model = {
  readonly id: string
}

declare const auth: Auth
declare const optionalAuthModel: ModelFactory<BaseOptions, "optional", Model>
declare const requiredAuthModel: ModelFactory<BaseOptions, "required", Model>
const configApiKey = Config.redacted("OPENAI_API_KEY")

OpenAIChat.route.model({ id: "gpt-4.1-mini" })

// @ts-expect-error route model selection does not configure endpoints.
OpenAIChat.route.model({ id: "gpt-4.1-mini", baseURL: "https://gateway.example.com/v1" })

// @ts-expect-error route model selection does not configure query params.
OpenAIChat.route.model({ id: "gpt-4.1-mini", queryParams: { debug: "1" } })

// @ts-expect-error route model selection does not configure auth.
OpenAIChat.route.model({ id: "gpt-4.1-mini", auth })

// @ts-expect-error route model selection does not configure api keys.
OpenAIChat.route.model({ id: "gpt-4.1-mini", apiKey: "sk-test" })

optionalAuthModel("gpt-4.1-mini")
optionalAuthModel("gpt-4.1-mini", {})
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test" })
optionalAuthModel("gpt-4.1-mini", { apiKey: configApiKey })
optionalAuthModel("gpt-4.1-mini", { auth })
optionalAuthModel("gpt-4.1-mini", { auth, baseURL: "https://gateway.example.com/v1" })
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", headers: { "x-source": "test" } })

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", auth })

requiredAuthModel("custom-model", { apiKey: "key" })
requiredAuthModel("custom-model", { apiKey: configApiKey })
requiredAuthModel("custom-model", { auth })
requiredAuthModel("custom-model", { auth, headers: { "x-tenant-id": "tenant" } })

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model")

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model", {})

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
requiredAuthModel("custom-model", { apiKey: "key", auth })

OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1" }).model("gpt-4.1-mini")
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1", apiKey: "sk-test" }).model("gpt-4.1-mini")
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1", apiKey: configApiKey }).model("gpt-4.1-mini")
OpenAICompatible.configure({
  baseURL: "https://api.openai.test/v1",
  auth: RuntimeAuth.bearer("oauth-token"),
}).model("gpt-4.1-mini")
OpenAICompatible.configure({
  baseURL: "https://gateway.example.com/v1",
  auth: RuntimeAuth.headers({ authorization: "Bearer gateway" }),
}).model("gpt-4.1-mini")
OpenAICompatible.configure({
  baseURL: "https://api.openai.test/v1",
  generation: { maxTokens: 100 },
}).model("gpt-4.1-mini")

// @ts-expect-error OpenAI-compatible model selectors only accept model ids.
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1" }).model("gpt-4.1-mini", {})

// @ts-expect-error openai-compatible configure requires a baseURL.
OpenAICompatible.configure({})

// @ts-expect-error apiKey only accepts string, Redacted<string>, or Config<string | Redacted<string>>.
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1", apiKey: 123 })

// @ts-expect-error provider helpers reject unknown top-level options.
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1", bogus: true })

// @ts-expect-error common generation options remain typed.
OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1", generation: { maxTokens: "many" } })

// @ts-expect-error auth is an override, so openai-compatible rejects apiKey with auth.
OpenAICompatible.configure({
  baseURL: "https://api.openai.test/v1",
  apiKey: "sk-test",
  auth: RuntimeAuth.bearer("oauth-token"),
})

OpenAICompatible.deepseek.configure({ apiKey: "deepseek-key" }).model("deepseek-chat")
// @ts-expect-error OpenAI-compatible family selectors only accept model ids.
OpenAICompatible.deepseek.configure({ apiKey: "deepseek-key" }).model("deepseek-chat", {})
