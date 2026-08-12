/**
 * Helpers for building OpenAI Chat `/chat/completions` SSE chunk bodies in
 * tests. Each helper returns one decoded `data:` payload that the `openai-chat`
 * protocol parses; `sseEvents(...)` serializes them onto the wire.
 */
export type OpenAIChatDelta = {
  readonly role?: "assistant"
  readonly content?: string | null
  readonly reasoning_content?: string | null
  readonly tool_calls?: ReadonlyArray<{
    readonly index: number
    readonly id?: string | null
    readonly type?: "function"
    readonly function?: { readonly name?: string | null; readonly arguments?: string | null }
  }>
}

export type OpenAIChatChunk = {
  readonly choices: ReadonlyArray<{
    readonly delta: OpenAIChatDelta | null
    readonly finish_reason: string | null
  }>
}

export const deltaChunk = (delta: OpenAIChatDelta, finishReason: string | null = null): OpenAIChatChunk => ({
  choices: [{ delta, finish_reason: finishReason }],
})

export const finishChunk = (reason: string): OpenAIChatChunk => ({
  choices: [{ delta: {}, finish_reason: reason }],
})

export const toolCallChunk = (id: string, name: string, args: string): OpenAIChatChunk => ({
  choices: [
    {
      delta: {
        role: "assistant",
        tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }],
      },
      finish_reason: null,
    },
  ],
})
