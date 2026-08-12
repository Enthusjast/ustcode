import type { ModelMessage, ToolResultPart } from "ai"
import { mergeDeep, unique } from "remeda"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type * as Provider from "./provider"
import type * as ModelsDev from "@enthusjast/ustcode-core/models-dev"

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

export const OUTPUT_TOKEN_MAX = 32_000

export function sanitizeSurrogates(content: string) {
  return content.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
}

// Maps npm package to the key the AI SDK expects for providerOptions
function sdkKey(npm: string): string | undefined {
  switch (npm) {
    case "@ai-sdk/gateway":
      return "gateway"
  }
  return undefined
}

// TODO: fix this stupid inefficient dogshit function
function normalizeMessages(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options: Record<string, unknown>,
): ModelMessage[] {
  const sanitizeToolResultOutput = (content: ToolResultPart) => {
    if (content.output.type === "text" || content.output.type === "error-text") {
      content.output.value = sanitizeSurrogates(content.output.value)
    }
    if (content.output.type === "content") {
      content.output.value = content.output.value.map((item) => {
        if (item.type === "text") {
          item.text = sanitizeSurrogates(item.text)
        }
        return item
      })
    }
    return content
  }

  msgs = msgs.map((msg) => {
    switch (msg.role) {
      case "tool":
        if (!Array.isArray(msg.content)) return msg
        msg.content = msg.content.map((content) => {
          if (content.type === "tool-result") {
            return sanitizeToolResultOutput(content)
          }
          return content
        })
        return msg

      case "system":
        msg.content = sanitizeSurrogates(msg.content)
        return msg

      case "user":
        if (typeof msg.content === "string") {
          msg.content = sanitizeSurrogates(msg.content)
        } else {
          msg.content = msg.content.map((content) => {
            if (content.type === "text") {
              content.text = sanitizeSurrogates(content.text)
            }
            return content
          })
        }
        return msg

      case "assistant":
        if (typeof msg.content === "string") {
          msg.content = sanitizeSurrogates(msg.content)
        } else {
          msg.content = msg.content.map((content) => {
            if (content.type === "text" || content.type === "reasoning") {
              content.text = sanitizeSurrogates(content.text)
            }
            if (content.type === "tool-result") {
              return sanitizeToolResultOutput(content)
            }
            return content
          })
        }
        return msg
    }
  })

  if (model.api.id.includes("claude")) {
    const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")
    msgs = msgs.map((msg) => {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((part) => {
            if (part.type === "tool-call" || part.type === "tool-result") {
              return { ...part, toolCallId: scrub(part.toolCallId) }
            }
            return part
          }),
        }
      }
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((part) => {
            if (part.type === "tool-result") {
              return { ...part, toolCallId: scrub(part.toolCallId) }
            }
            return part
          }),
        }
      }
      return msg
    })
  }

  // Deepseek requires all assistant messages to have reasoning on them
  if (model.api.id.toLowerCase().includes("deepseek")) {
    msgs = msgs.map((msg) => {
      if (msg.role !== "assistant") return msg
      if (Array.isArray(msg.content)) {
        if (msg.content.some((part) => part.type === "reasoning")) return msg
        return { ...msg, content: [...msg.content, { type: "reasoning", text: "" }] }
      }
      return {
        ...msg,
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          { type: "reasoning" as const, text: "" },
        ],
      }
    })
  }

  if (
    typeof model.capabilities.interleaved === "object" &&
    model.capabilities.interleaved.field
  ) {
    const field = model.capabilities.interleaved.field
    return msgs.map((msg) => {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
        const reasoningText = reasoningParts.map((part: any) => part.text).join("")

        // Filter out reasoning parts from content
        const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

        // Include reasoning_content | reasoning_details directly on the message for all assistant messages.
        // Always set the field even when empty — some providers (e.g. DeepSeek) may return empty
        // reasoning_content which still needs to be sent back in subsequent requests.
        return {
          ...msg,
          content: filteredContent,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              ...msg.providerOptions?.openaiCompatible,
              [field]: reasoningText,
            },
          },
        }
      }

      return msg
    })
  }

  return msgs
}

function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

  const providerOptions = {
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
  }

  for (const msg of unique([...system, ...final])) {
    const shouldUseContentOptions = Array.isArray(msg.content) && msg.content.length > 0

    if (shouldUseContentOptions) {
      const lastContent = msg.content[msg.content.length - 1]
      if (
        lastContent &&
        typeof lastContent === "object" &&
        lastContent.type !== "tool-approval-request" &&
        lastContent.type !== "tool-approval-response"
      ) {
        lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
        continue
      }
    }

    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
  }

  return msgs
}

function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

    const filtered = msg.content.map((part) => {
      if (part.type !== "file" && part.type !== "image") return part

      // Check for empty base64 image data
      if (part.type === "image") {
        const imageStr = String(part.image)
        if (imageStr.startsWith("data:")) {
          const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
          if (match && (!match[2] || match[2].length === 0)) {
            return {
              type: "text" as const,
              text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
            }
          }
        }
      }

      const mime = part.type === "image" ? String(part.image).split(";")[0].replace("data:", "") : part.mediaType
      const filename = part.type === "file" ? part.filename : undefined
      const modality = mimeToModality(mime)
      if (!modality) return part
      if (model.capabilities.input[modality]) return part

      const name = filename ? `"${filename}"` : modality
      return {
        type: "text" as const,
        text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
      }
    })

    return { ...msg, content: filtered }
  })
}

function mapProviderOptions(
  msgs: ModelMessage[],
  transform: (options: Record<string, any> | undefined) => Record<string, any> | undefined,
) {
  return msgs.map((msg) => {
    if (!Array.isArray(msg.content)) return { ...msg, providerOptions: transform(msg.providerOptions) }
    return {
      ...msg,
      providerOptions: transform(msg.providerOptions),
      content: msg.content.map((part) =>
        part.type === "tool-approval-request" || part.type === "tool-approval-response"
          ? part
          : { ...part, providerOptions: transform(part.providerOptions) },
      ),
    } as typeof msg
  })
}

export function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
  msgs = unsupportedParts(msgs, model)
  msgs = normalizeMessages(msgs, model, options)
  if (
    (model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude")) &&
    model.api.npm !== "@ai-sdk/gateway"
  ) {
    msgs = applyCaching(msgs, model)
  }

  // Remap providerOptions keys from stored providerID to expected SDK key
  const key = sdkKey(model.api.npm)
  if (key && key !== model.providerID) {
    const remap = (opts: Record<string, any> | undefined) => {
      if (!opts) return opts
      if (!(model.providerID in opts)) return opts
      const result = { ...opts }
      result[key] = result[model.providerID]
      delete result[model.providerID]
      return result
    }

    msgs = mapProviderOptions(msgs, remap)
  }

  return msgs
}

const GEMINI_MODELS_WITH_SAMPLING_DEFAULTS = [
  /gemini-2[.-]5(?:[.-]|$)/,
  /gemini-3-(?:flash|pro)(?:[.-]|$)/,
  /gemini-3[.-]1(?:[.-]|$)/,
  /gemini-3[.-]5-flash(?!-lite)(?:[.-]|$)/,
]

export function temperature(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("north-mini-code")) return 1.0
  if (id.includes("qwen")) return 0.55
  if (id.includes("claude")) return undefined
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 1.0 : undefined
  if (id.includes("glm-4.6")) return 1.0
  if (id.includes("glm-4.7")) return 1.0
  if (id.includes("minimax-m2")) return 1.0
  if (id.includes("kimi-k2")) {
    // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
    if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
      return 1.0
    }
    return 0.6
  }
  return undefined
}

export function topP(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("qwen")) return 1
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 0.95 : undefined
  if (["minimax-m2", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
    return 0.95
  }
  if (
    ["deepseek-v4-flash-0731", "deepseek-v4-flash:0731"].some((name) => id.includes(name)) ||
    (id.includes("deepseek-v4-flash") && model.providerID === "deepseek")
  ) {
    return 0.95
  }
  return undefined
}

export function topK(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("minimax-m2")) {
    if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
    return 20
  }
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 64 : undefined
  return undefined
}

const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
const OPENAI_GPT5_1_EFFORTS = ["none", ...WIDELY_SUPPORTED_EFFORTS]
const OPENAI_GPT5_2_PLUS_EFFORTS = [...OPENAI_GPT5_1_EFFORTS, "xhigh"]
const OPENAI_GPT5_PRO_EFFORTS = ["high"]
const OPENAI_GPT5_PRO_2_PLUS_EFFORTS = ["medium", "high", "xhigh"]
const OPENAI_GPT5_CHAT_EFFORTS = ["medium"]
const OPENAI_GPT5_CODEX_XHIGH_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
const OPENAI_GPT5_CODEX_3_PLUS_EFFORTS = ["none", ...OPENAI_GPT5_CODEX_XHIGH_EFFORTS]

// OpenAI rolled out the `none` reasoning_effort tier on this date (Responses API).
// Models released before it 400 on `reasoning_effort: "none"`, so we only expose
// it as a variant for models new enough to accept it.
const OPENAI_NONE_EFFORT_RELEASE_DATE = "2025-11-13"

// OpenAI rolled out the `xhigh` reasoning_effort tier on this date. Same reasoning.
const OPENAI_XHIGH_EFFORT_RELEASE_DATE = "2025-12-04"

// Matches members of the gpt-5 family across the id formats we encounter:
//   "gpt-5", "gpt-5-nano", "gpt-5.4", "openai/gpt-5.4-codex".
// Anchored to start-of-string or "/" so it doesn't false-match "gpt-50" or "gpt-5o".
const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/

function gpt5Version(apiId: string) {
  return Number(GPT5_VERSION_RE.exec(apiId)?.[1]) || undefined
}

function versionedGpt5ReasoningEfforts(apiId: string) {
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_2_PLUS_EFFORTS
  const version = gpt5Version(apiId)
  if (version === undefined) return undefined
  if (version === 1) return OPENAI_GPT5_1_EFFORTS
  return OPENAI_GPT5_2_PLUS_EFFORTS
}

function gpt5CodexReasoningEfforts(apiId: string) {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes("codex")) return undefined
  const version = gpt5Version(apiId)
  if (version !== undefined && version >= 3) return OPENAI_GPT5_CODEX_3_PLUS_EFFORTS
  if (apiId.includes("codex-max") || (version !== undefined && version >= 2)) return OPENAI_GPT5_CODEX_XHIGH_EFFORTS
  return WIDELY_SUPPORTED_EFFORTS
}

function gpt5ChatReasoningEfforts(apiId: string) {
  if (!GPT5_FAMILY_RE.test(apiId) || !apiId.includes("-chat")) return undefined
  return gpt5Version(apiId) === undefined ? [] : OPENAI_GPT5_CHAT_EFFORTS
}

// Computes the reasoning_effort tiers an OpenAI (or OpenAI-compatible upstream
// routed through it, e.g. cf-ai-gateway) model exposes. Effort order: weakest
// to strongest.
function openaiReasoningEfforts(apiId: string, releaseDate: string) {
  const id = apiId.toLowerCase()
  if (id.includes("deep-research")) return ["medium"]
  const chatEfforts = gpt5ChatReasoningEfforts(id)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(id)) return OPENAI_GPT5_PRO_EFFORTS
  const codexEfforts = gpt5CodexReasoningEfforts(id)
  if (codexEfforts) return codexEfforts
  const versionedEfforts = versionedGpt5ReasoningEfforts(id)
  // GPT-5.1 replaced GPT-5's `minimal` effort with `none`; GPT-5.2+
  // additionally accepts `xhigh`. Model pages list the supported subset.
  if (versionedEfforts) return versionedEfforts
  const efforts = [...WIDELY_SUPPORTED_EFFORTS]
  if (GPT5_FAMILY_RE.test(id)) efforts.unshift("minimal")
  if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift("none")
  if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push("xhigh")
  return efforts
}

function openaiCompatibleReasoningEfforts(id: string) {
  const apiId = id.toLowerCase()
  const chatEfforts = gpt5ChatReasoningEfforts(apiId)
  if (chatEfforts) return chatEfforts
  if (GPT5_PRO_RE.test(apiId)) return OPENAI_GPT5_PRO_EFFORTS
  return gpt5CodexReasoningEfforts(apiId) ?? versionedGpt5ReasoningEfforts(apiId) ?? OPENAI_EFFORTS
}

function anthropicUsesModernAdaptiveThinking(apiId: string) {
  if (!apiId.toLowerCase().includes("claude-")) return false
  // Covers family-first IDs such as claude-opus-4.7 and version-first IDs such as claude-4.7-opus.
  // Limit minors to two digits so release dates in IDs such as claude-opus-4-20250514 are not versions.
  const version = /claude-(?:[a-z]+-)?(\d+)(?:[.-](\d{1,2}))?(?:[.@-]|$)/i.exec(apiId)
  if (!version) return true
  const major = Number(version[1])
  const minor = Number(version[2] ?? 0)
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicAdaptiveEfforts(apiId: string): string[] | null {
  if (anthropicUsesModernAdaptiveThinking(apiId)) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
  if (
    ["opus-4-6", "opus-4.6", "4-6-opus", "4.6-opus", "sonnet-4-6", "sonnet-4.6", "4-6-sonnet", "4.6-sonnet"].some((v) =>
      apiId.includes(v),
    )
  ) {
    return ["low", "medium", "high", "max"]
  }
  return null
}

function anthropicOmitsThinking(apiId: string) {
  return anthropicUsesModernAdaptiveThinking(apiId)
}

function googleThinkingBudgetMax(apiId: string) {
  const id = apiId.toLowerCase()
  if (id.includes("2.5") && id.includes("pro") && !id.includes("flash")) return 32_768
  return 24_576
}

export function variants(model: Provider.Model): Record<string, Record<string, any>> {
  if (!model.capabilities.reasoning) return {}

  const id = model.id.toLowerCase()
  const glm52 = ["glm-5.2", "glm-5-2", "glm-5p2"].some(
    (name) => id.includes(name) || model.api.id.toLowerCase().includes(name),
  )
  if (
    model.api.id.toLowerCase().includes("minimax-m3") &&
    model.api.npm === "@ai-sdk/openai-compatible"
  ) {
    if (model.providerID === "lilac") {
      return {
        none: { chat_template_kwargs: { thinking_mode: "disabled" } },
        thinking: { chat_template_kwargs: { thinking_mode: "enabled" } },
      }
    }
    return {
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    }
  }
  const adaptiveThinkingOmitted = anthropicOmitsThinking(model.api.id)
  const adaptiveEfforts = anthropicAdaptiveEfforts(model.api.id)
  if (glm52 && model.api.npm === "@ai-sdk/openai-compatible") {
    return {
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    }
  }
  if (
    id.includes("deepseek-chat") ||
    id.includes("deepseek-reasoner") ||
    id.includes("deepseek-r1") ||
    id.includes("deepseek-v3") ||
    id.includes("minimax") ||
    (id.includes("glm") && !glm52) ||
    id.includes("kimi") ||
    id.includes("k2p") ||
    id.includes("qwen") ||
    id.includes("big-pickle")
  )
    return {}

  // see: https://docs.x.ai/docs/guides/reasoning#control-how-hard-the-model-thinks
  if (id.includes("grok") && id.includes("grok-3-mini")) {
    return {
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    }
  }

  switch (model.api.npm) {
    case "@ai-sdk/gateway":
      if (model.api.id.includes("anthropic")) {
        if (adaptiveEfforts) {
          return Object.fromEntries(
            adaptiveEfforts.map((effort) => [
              effort,
              {
                thinking: {
                  type: "adaptive",
                  // Newer adaptive-only models default "display" to "omitted", which
                  // returns empty thinking blocks. Force "summarized" so summaries
                  // survive (4.6/Sonnet 4.6 already default to "summarized").
                  ...(adaptiveThinkingOmitted ? { display: "summarized" } : {}),
                },
                effort,
              },
            ]),
          )
        }
        return {
          high: {
            thinking: {
              type: "enabled",
              budgetTokens: 16000,
            },
          },
          max: {
            thinking: {
              type: "enabled",
              budgetTokens: 31999,
            },
          },
        }
      }
      if (model.api.id.includes("google")) {
        if (model.api.id.includes("2.5")) {
          return {
            high: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: 16000,
              },
            },
            max: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: googleThinkingBudgetMax(model.api.id.toLowerCase()),
              },
            },
          }
        }
        return Object.fromEntries(
          ["low", "high"].map((effort) => [
            effort,
            {
              includeThoughts: true,
              thinkingLevel: effort,
            },
          ]),
        )
      }
      return Object.fromEntries(
        openaiCompatibleReasoningEfforts(model.api.id).map((effort) => [effort, { reasoningEffort: effort }]),
      )

    case "@ai-sdk/openai-compatible":
      if (model.api.id.toLowerCase().includes("north-mini-code")) {
        return Object.fromEntries(["none", "high"].map((effort) => [effort, { reasoningEffort: effort }]))
      }
      const efforts = [...WIDELY_SUPPORTED_EFFORTS]
      if (model.api.id.toLowerCase().includes("deepseek-v4")) {
        efforts.push("max")
      }
      return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
  }
  return {}
}

export function options(input: {
  model: Provider.Model
  sessionID: string
  providerOptions?: Record<string, any>
}): Record<string, any> {
  const result: Record<string, any> = {}

  if (input.model.providerID === "baseten") {
    result["chat_template_args"] = { enable_thinking: true }
  }

  if (
    ["zai", "zhipuai"].some((id) => input.model.providerID.includes(id)) &&
    input.model.api.npm === "@ai-sdk/openai-compatible"
  ) {
    result["thinking"] = {
      type: "enabled",
      clear_thinking: false,
    }
  }

  const modelId = input.model.api.id.toLowerCase()

  // Enable thinking for reasoning models on alibaba-cn (DashScope).
  // DashScope's OpenAI-compatible API requires `enable_thinking: true` in the request body
  // to return reasoning_content. Without it, models like kimi-k2.5, qwen-plus, qwen3, qwq,
  // deepseek-r1, etc. never output thinking/reasoning tokens.
  // Note: kimi-k2-thinking is excluded as it returns reasoning_content by default.
  if (
    input.model.providerID === "alibaba-cn" &&
    input.model.capabilities.reasoning &&
    input.model.api.npm === "@ai-sdk/openai-compatible" &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result["enable_thinking"] = true
  }

  if (input.providerOptions?.setCacheKey === true) {
    result["promptCacheKey"] = input.sessionID
  }

  if (input.model.api.npm === "@ai-sdk/gateway") {
    result["gateway"] = { caching: "auto" }
  }

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    if (!input.model.api.id.includes("gpt-5-pro")) {
      result["reasoningEffort"] = "medium"
    }

    // Only set textVerbosity for non-chat gpt-5.x models
    // Chat models (e.g. gpt-5.2-chat-latest) only support "medium" verbosity
    if (
      input.model.api.id.includes("gpt-5.") &&
      !input.model.api.id.includes("codex") &&
      !input.model.api.id.includes("-chat")
    ) {
      result["textVerbosity"] = "low"
    }
  }

  return result
}

export function smallOptions(model: Provider.Model) {
  const small = Object.values(model.variants ?? {})[0] ?? {}
  return small
}

// Maps model ID prefix to provider slug used in providerOptions.
// Example: "amazon/nova-2-lite" → "bedrock"
const SLUG_OVERRIDES: Record<string, string> = {
  amazon: "bedrock",
}

export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
  const normalized = options

  if (model.api.npm === "@ai-sdk/gateway") {
    // Gateway providerOptions are split across two namespaces:
    // - `gateway`: gateway-native routing/caching controls (order, only, byok, etc.)
    // - `<upstream slug>`: provider-specific model options (anthropic/openai/...)
    // We keep `gateway` as-is and route every other top-level option under the
    // model-derived upstream slug.
    const i = model.api.id.indexOf("/")
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined
    const gateway = normalized.gateway
    const rest = Object.fromEntries(Object.entries(normalized).filter(([k]) => k !== "gateway"))
    const has = Object.keys(rest).length > 0

    const result: Record<string, any> = {}
    if (gateway !== undefined) result.gateway = gateway

    if (has) {
      if (slug) {
        // Route model-specific options under the provider slug
        result[slug] = rest
      } else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        result.gateway = { ...gateway, ...rest }
      } else {
        result.gateway = rest
      }
    }

    return result
  }

  // AI SDK packages that resolve providerOptionsName by splitting the
  // provider name on "." (e.g. "wafer.ai" -> "wafer") need the same
  // logic here so the key we write matches the key they read.
  const usesDotSplitOptions = model.api.npm === "@ai-sdk/openai-compatible"
  const key = sdkKey(model.api.npm) ?? (usesDotSplitOptions ? model.providerID.split(".")[0] : model.providerID)
  return { [key]: normalized }
}

export function maxOutputTokens(model: Provider.Model, outputTokenMax = OUTPUT_TOKEN_MAX): number {
  return Math.min(model.limit.output, outputTokenMax) || outputTokenMax
}

export function schema(model: Provider.Model, schema: JSONSchema7): JSONSchema7 {
  /*
  if (["openai", "azure"].includes(providerID)) {
    if (schema.type === "object" && schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (schema.required?.includes(key)) continue
        schema.properties[key] = {
          anyOf: [
            value as JSONSchema.JSONSchema,
            {
              type: "null",
            },
          ],
        }
      }
    }
  }
  */

  if (model.providerID === "moonshotai" || model.api.id.toLowerCase().includes("kimi")) {
    const sanitizeMoonshot = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== "object") return obj
      if (Array.isArray(obj)) return obj.map(sanitizeMoonshot)
      // Moonshot expands $ref before validation and rejects sibling keywords like description on the same node.
      if ("$ref" in obj && typeof obj.$ref === "string") return { $ref: obj.$ref }
      const result = Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, sanitizeMoonshot(value)]))
      // MFJS does not support tuple-style `items` arrays; it requires one schema object for all array items.
      if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
      return result
    }

    const sanitized = sanitizeMoonshot(schema)
    if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
      schema = sanitized
    }
  }

  // Convert integer enums to string enums for Google/Gemini
  if (model.api.id.includes("gemini")) {
    const isPlainObject = (node: unknown): node is Record<string, any> =>
      typeof node === "object" && node !== null && !Array.isArray(node)
    const hasCombiner = (node: unknown) =>
      isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
    const hasSchemaIntent = (node: unknown) => {
      if (!isPlainObject(node)) return false
      if (hasCombiner(node)) return true
      return [
        "type",
        "properties",
        "items",
        "prefixItems",
        "enum",
        "const",
        "$ref",
        "additionalProperties",
        "patternProperties",
        "required",
        "not",
        "if",
        "then",
        "else",
      ].some((key) => key in node)
    }

    const sanitizeGemini = (obj: any): any => {
      if (obj === null || typeof obj !== "object") {
        return obj
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitizeGemini)
      }

      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === "enum" && Array.isArray(value)) {
          // Convert all enum values to strings
          result[key] = value.map((v) => String(v))
          // If we have integer type with enum, change type to string
          if (result.type === "integer" || result.type === "number") {
            result.type = "string"
          }
        } else if (typeof value === "object" && value !== null) {
          result[key] = sanitizeGemini(value)
        } else {
          result[key] = value
        }
      }

      // Gemini requires a single `type`, not a JSON Schema type array such as
      // `["number","string"]` (emitted by some MCP servers). OpenAI-compatible
      // transports proxying to Gemini forward them verbatim and the backend
      // rejects the array form. Mirror the SDK: split non-null types into
      // `anyOf`, and lift `null` into `nullable`.
      if (Array.isArray(result.type)) {
        const hasNull = result.type.includes("null")
        const nonNull = result.type.filter((entry: unknown) => entry !== "null")
        if (nonNull.length === 0) {
          result.type = "null"
        } else {
          delete result.type
          result.anyOf = nonNull.map((entry: unknown) => ({ type: entry }))
          if (hasNull) result.nullable = true
        }
      }

      // Filter required array to only include fields that exist in properties
      if (result.type === "object" && result.properties && Array.isArray(result.required)) {
        result.required = result.required.filter((field: any) => field in result.properties)
      }

      if (result.type === "array" && !hasCombiner(result)) {
        if (result.items == null) {
          result.items = {}
        }
        // Ensure items has a type only when it's still schema-empty.
        if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
          result.items.type = "string"
        }
      }

      // Remove properties/required from non-object types (Gemini rejects these)
      if (result.type && result.type !== "object" && !hasCombiner(result)) {
        delete result.properties
        delete result.required
      }

      return result
    }

    schema = sanitizeGemini(schema)
  }

  return schema
}

export function reasoningVariants(model: ModelsDev.Model, target: Provider.Model): Provider.Model["variants"] {
  const options = model.reasoning_options
  if (options === undefined) return
  if (options.length === 0) return {}

  const effort = options.find((option) => option.type === "effort")
  if (effort) return effortVariants(target, effort.values)

  const toggle = options.some((option) => option.type === "toggle")
  const budget = options.find((option) => option.type === "budget_tokens")
  if (!budget) return toggle ? nonEmptyVariants(reasoningToggle(target)) : undefined

  return nonEmptyVariants({
    ...(toggle ? reasoningToggle(target) : {}),
    ...budgetVariants(target, budget.min, budget.max),
  })
}

function effortVariants(model: Provider.Model, values: readonly unknown[]) {
  return Object.fromEntries(
    values.flatMap((value) => {
      const id = (() => {
        if (value === null) return "none"
        if (typeof value === "string") return value
      })()
      if (id === undefined) return []
      const settings = reasoningEffort(model, id)
      return settings ? [[id, settings]] : []
    }),
  )
}

function budgetVariants(model: Provider.Model, min?: number, max?: number) {
  const maximum = Math.min(max ?? OUTPUT_TOKEN_MAX - 1, model.limit.output - 1, OUTPUT_TOKEN_MAX - 1)
  if (maximum <= 0) return {}
  const high = Math.min(Math.max(min ?? 0, Math.floor((maximum + 1) / 2)), maximum)
  return Object.fromEntries(
    [
      { id: "high", budget: high },
      { id: "max", budget: maximum },
    ].flatMap((item) => {
      const settings = reasoningBudget(model, item.budget)
      return settings ? [[item.id, settings]] : []
    }),
  )
}

function nonEmptyVariants(variants: NonNullable<Provider.Model["variants"]>): Provider.Model["variants"] {
  return Object.keys(variants).length > 0 ? variants : undefined
}

function reasoningToggle(model: Provider.Model): NonNullable<Provider.Model["variants"]> {
  return {}
}

function reasoningEffort(model: Provider.Model, effort: string) {
  switch (model.api.npm) {
    case "@ai-sdk/gateway":
      if (model.id.includes("anthropic")) return { thinking: { type: "adaptive", display: "summarized" }, effort }
      if (model.id.includes("google")) return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
      return { reasoningEffort: effort }
    case "@ai-sdk/openai-compatible":
      return { reasoningEffort: effort }
  }
}

function reasoningBudget(model: Provider.Model, budget: number) {
  switch (model.api.npm) {
    case "@ai-sdk/gateway":
      if (model.id.includes("anthropic")) return { thinking: { type: "enabled", budgetTokens: budget } }
      if (model.id.includes("google")) return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
      return
    case "@ai-sdk/openai-compatible":
      return
  }
}

export * as ProviderTransform from "./transform"
