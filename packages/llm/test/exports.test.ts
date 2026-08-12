import { describe, expect, test } from "bun:test"
import { LLM, LLMClient, Provider } from "@enthusjast/ustcode-llm"
import { Route, Protocol } from "@enthusjast/ustcode-llm/route"
import { Provider as ProviderSubpath } from "@enthusjast/ustcode-llm/provider"
import { OpenAICompatible } from "@enthusjast/ustcode-llm/providers"
import { OpenAIChat, OpenAICompatibleChat } from "@enthusjast/ustcode-llm/protocols"

describe("public exports", () => {
  test("root exposes app-facing runtime APIs", () => {
    expect(LLM.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(Provider.make).toBeFunction()
    expect(ProviderSubpath.make).toBe(Provider.make)
  })

  test("route barrel exposes route-authoring APIs", () => {
    expect(Route.make).toBeFunction()
    expect(Protocol.make).toBeFunction()
  })

  test("provider barrel exposes the openai-compatible facade", () => {
    expect(OpenAICompatible.configure({ baseURL: "https://api.openai.test/v1" }).model).toBeFunction()
    expect(OpenAICompatible.deepseek.model).toBeFunction()
    expect(OpenAICompatible.deepseek.configure).toBeFunction()
    expect(OpenAICompatible.provider.configure).toBeFunction()
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
  })
})
