export * as ConfigProviderOptionsV1 from "./provider-options"

type Options = Readonly<Record<string, unknown>>

export interface ProviderResult {
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
  readonly url?: string
  readonly settings?: Record<string, unknown>
}

export interface Lowerer {
  readonly provider: (options: Options) => ProviderResult
  readonly request: (options: Options) => Record<string, unknown>
}

export function get(packageName?: string): Lowerer {
  const key = packageName ?? ""
  return Object.hasOwn(lowerers, key) ? lowerers[key]! : raw
}

const raw: Lowerer = {
  provider(options) {
    return { body: clone(options) }
  },
  request: clone,
}

const openaiCompatible: Lowerer = {
  provider(options) {
    return { ...direct(options, ["baseURL"]), url: string(options.baseURL) }
  },
  request(options) {
    const result = clone(options)
    if (options.reasoningEffort !== undefined) {
      result.reasoning_effort = options.reasoningEffort
      delete result.reasoningEffort
    }
    return result
  },
}

const lowerers: Readonly<Record<string, Lowerer>> = {
  "@ai-sdk/openai-compatible": openaiCompatible,
  "ai-gateway-provider": openaiCompatible,
}

function direct(options: Options, extraKeys: ReadonlyArray<string> = []): ProviderResult {
  return {
    headers: headers(options.headers),
    body: body(options.body),
    settings: omit(options, ["headers", "body", ...extraKeys]),
  }
}

function body(input: unknown) {
  if (!isRecord(input)) return undefined
  return { ...input }
}

function clone(options: Options) {
  return { ...options }
}

function omit(options: Options, keys: ReadonlyArray<string>) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !keys.includes(key)))
}

function headers(input: unknown) {
  if (!isRecord(input)) return undefined
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function string(input: unknown) {
  return typeof input === "string" && input ? input : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
