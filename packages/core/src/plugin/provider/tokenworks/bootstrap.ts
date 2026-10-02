import { Money } from "@ustcode-ai/schema/money"
import { Model } from "../../../model.js"
import { Provider } from "../../../provider.js"
import { BOOTSTRAP_URL, requestDirect, type Requester } from "./oidc.js"

export const providerID = Provider.ID.make("ustc-tokenworks")
export const providerName = "USTC TokenWorks"
export const gatewayOrigin = "https://api.llm.ustc.edu.cn"
export const defaultContextWindow = 262_144
export const defaultMaxOutputTokens = 32_768

const maxModels = 500
const maxContext = 10_000_000
const reasoningLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
const modelPackage = "@ustcode-ai/ai/providers/openai-compatible"
const zeroCost = {
  input: Money.USDPerMillionTokens.zero,
  output: Money.USDPerMillionTokens.zero,
  cache: {
    read: Money.USDPerMillionTokens.zero,
    write: Money.USDPerMillionTokens.zero,
  },
}

export type GatewayConfig = {
  readonly apiKey: string
  readonly baseURL: string
  readonly headers: Record<string, string>
  readonly expiresAt: number
  readonly recheckAt: number
  readonly models: Model.Info[]
}

export class BootstrapConfigError extends Error {
  constructor(field: string, message?: string) {
    super(message === undefined ? "TokenWorks bootstrap " + field : "TokenWorks bootstrap " + field + ": " + message)
    this.name = "BootstrapConfigError"
  }
}

export class BootstrapNetworkError extends Error {
  constructor() {
    super("TokenWorks bootstrap is temporarily unavailable")
  }
}

export class BootstrapAuthorizationError extends Error {
  constructor(readonly status: 401 | 403) {
    super(
      status === 401
        ? "USTC TokenWorks sign-in expired; sign in again"
        : "This USTC account is not authorized to use the model gateway",
    )
  }
}

export async function fetchBootstrap(
  accessToken: string,
  requester: Requester = requestDirect,
  now = Date.now(),
): Promise<GatewayConfig> {
  let response: Response
  try {
    response = await requester(BOOTSTRAP_URL, {
      headers: { accept: "application/json", authorization: "Bearer " + accessToken },
    })
  } catch {
    throw new BootstrapNetworkError()
  }
  if (response.status === 401 || response.status === 403) throw new BootstrapAuthorizationError(response.status)
  if (response.status >= 500) throw new BootstrapNetworkError()
  if (!response.ok) throw new BootstrapConfigError("HTTP " + response.status)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 4 * 1024 * 1024) throw new BootstrapConfigError("response too large")
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new BootstrapConfigError("invalid JSON")
  }
  return readBootstrapConfig(value, now)
}

export function readBootstrapConfig(value: unknown, now = Date.now()): GatewayConfig {
  if (!isRecord(value)) throw new BootstrapConfigError("document", "must be an object")
  if (value.inferenceProvider !== "gateway") throw new BootstrapConfigError("inferenceProvider", "must be gateway")
  if (value.inferenceCredentialKind !== undefined && value.inferenceCredentialKind !== "static")
    throw new BootstrapConfigError("inferenceCredentialKind", "only static credentials are supported")
  if (value.inferenceGatewayAuthScheme !== undefined && value.inferenceGatewayAuthScheme !== "bearer")
    throw new BootstrapConfigError("inferenceGatewayAuthScheme", "only Bearer authentication is supported")
  if (typeof value.inferenceGatewayApiKey !== "string" || value.inferenceGatewayApiKey.trim().length === 0)
    throw new BootstrapConfigError("inferenceGatewayApiKey", "must be a non-empty string")
  const baseURL = gatewayURL(value.inferenceGatewayBaseUrl)
  const headers = gatewayHeaders(value.inferenceCustomHeaders)
  const expiresAt = timestamp(value.expiresAt, now)
  const interval = value.configRecheckIntervalMinutes ?? 10
  if (!Number.isInteger(interval) || Number(interval) < 2 || Number(interval) > 30)
    throw new BootstrapConfigError("configRecheckIntervalMinutes", "must be an integer between 2 and 30")
  if (
    !Array.isArray(value.inferenceModels) ||
    value.inferenceModels.length === 0 ||
    value.inferenceModels.length > maxModels
  )
    throw new BootstrapConfigError("inferenceModels", "must be a non-empty supported model list")

  const seen = new Set<string>()
  const models = value.inferenceModels.map((item) => {
    const model = modelEntry(item)
    if (seen.has(model.name)) throw new BootstrapConfigError("inferenceModels", "contains duplicate model IDs")
    seen.add(model.name)
    return modelInfo(model)
  })
  return {
    apiKey: value.inferenceGatewayApiKey.trim(),
    baseURL,
    headers,
    expiresAt,
    recheckAt: Math.min(expiresAt, now + Number(interval) * 60_000),
    models,
  }
}

function modelEntry(value: unknown) {
  if (typeof value === "string") {
    if (!value.trim()) throw new BootstrapConfigError("inferenceModels", "contains an empty model ID")
    return { name: value.trim(), label: value.trim(), capabilities: capabilities(undefined) }
  }
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim())
    throw new BootstrapConfigError("inferenceModels", "each model must have a non-empty name")
  if (value.labelOverride !== undefined && (typeof value.labelOverride !== "string" || !value.labelOverride.trim()))
    throw new BootstrapConfigError("inferenceModels", "labelOverride must be a non-empty string")
  if (value.isFamilyDefault !== undefined && typeof value.isFamilyDefault !== "boolean")
    throw new BootstrapConfigError("inferenceModels", "isFamilyDefault must be a boolean")
  const limit = {
    context: integer(value.contextWindow, "contextWindow", defaultContextWindow),
    output: integer(value.maxOutputTokens, "maxOutputTokens", defaultMaxOutputTokens),
  }
  const capability = capabilities(value.capabilities)
  const reasoningEfforts = effortMap(value.reasoningEfforts, capability.reasoning)
  const defaultReasoningEffort = value.defaultReasoningEffort
  if (
    defaultReasoningEffort !== undefined &&
    (typeof defaultReasoningEffort !== "string" ||
      reasoningEfforts === undefined ||
      !Object.hasOwn(reasoningEfforts, defaultReasoningEffort))
  ) {
    throw new BootstrapConfigError("inferenceModels", "defaultReasoningEffort must name a declared effort")
  }
  return {
    name: value.name.trim(),
    label: typeof value.labelOverride === "string" ? value.labelOverride.trim() : value.name.trim(),
    capabilities: capability,
    limit,
    reasoningEfforts,
    defaultReasoningEffort: typeof defaultReasoningEffort === "string" ? defaultReasoningEffort : undefined,
  }
}

function modelInfo(input: ReturnType<typeof modelEntry>): Model.Info {
  const result = Model.Info.default(providerID, Model.ID.make(input.name))
  const variants = Object.entries(input.reasoningEfforts ?? {}).map(([level, wire]) => ({
    id: Model.VariantID.make(level),
    settings: { reasoningEffort: wire },
  }))
  const defaultWire =
    input.defaultReasoningEffort === undefined ? undefined : input.reasoningEfforts?.[input.defaultReasoningEffort]
  return {
    ...result,
    modelID: Model.ID.make(input.name),
    name: input.label,
    package: modelPackage,
    ...(defaultWire === undefined ? {} : { settings: { reasoningEffort: defaultWire } }),
    capabilities: {
      tools: input.capabilities.tools,
      input: input.capabilities.vision ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    variants,
    cost: [zeroCost],
    status: "active",
    enabled: true,
    limit: input.limit ?? { context: defaultContextWindow, output: defaultMaxOutputTokens },
  }
}

function capabilities(value: unknown) {
  if (value === undefined) return { tools: false, reasoning: false, vision: false }
  if (!isRecord(value)) throw new BootstrapConfigError("inferenceModels.capabilities", "must be an object")
  const allowed = new Set(["tools", "reasoning", "vision"])
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new BootstrapConfigError("inferenceModels.capabilities", "only tools, reasoning, and vision are supported")
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== "boolean")
      throw new BootstrapConfigError("inferenceModels.capabilities", `${key} must be a boolean`)
  }
  return {
    tools: value.tools === true,
    reasoning: value.reasoning === true,
    vision: value.vision === true,
  }
}

function effortMap(value: unknown, reasoning: boolean) {
  if (value === undefined) {
    if (!reasoning) return undefined
    return { low: "low", medium: "medium", high: "high" }
  }
  if (!reasoning || !isRecord(value))
    throw new BootstrapConfigError("inferenceModels.reasoningEfforts", "requires reasoning capability and an object")
  const efforts: Record<string, string | null> = {}
  for (const [level, wire] of Object.entries(value)) {
    if (!reasoningLevels.includes(level as (typeof reasoningLevels)[number]))
      throw new BootstrapConfigError("inferenceModels.reasoningEfforts", `unsupported effort ${level}`)
    if (level === "off" && wire === null) {
      efforts[level] = null
      continue
    }
    if (typeof wire !== "string" || wire.length === 0 || wire.length > 32)
      throw new BootstrapConfigError("inferenceModels.reasoningEfforts", `${level} must map to a non-empty wire value`)
    efforts[level] = wire
  }
  return efforts
}

function integer(value: unknown, field: string, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < 1024 || Number(value) > maxContext)
    throw new BootstrapConfigError("inferenceModels", `${field} must be an integer from 1024 to ${maxContext}`)
  return Number(value)
}

function gatewayURL(value: unknown) {
  if (typeof value !== "string" || value.length === 0)
    throw new BootstrapConfigError("inferenceGatewayBaseUrl", "is missing")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BootstrapConfigError("inferenceGatewayBaseUrl", "is not a valid URL")
  }
  if (
    url.origin !== gatewayOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new BootstrapConfigError(
      "inferenceGatewayBaseUrl",
      "must target the USTC HTTPS gateway without credentials or query",
    )
  }
  return `${gatewayOrigin}/v1`
}

function gatewayHeaders(value: unknown) {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new BootstrapConfigError("inferenceCustomHeaders", "must be an object")
  if (Object.keys(value).length > 0)
    throw new BootstrapConfigError("inferenceCustomHeaders", "custom headers are not supported")
  return {}
}

function timestamp(value: unknown, now: number) {
  if (value === undefined) return Number.POSITIVE_INFINITY
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new BootstrapConfigError("expiresAt", "must be a positive timestamp")
  const expiresAt = value < 1e12 ? value * 1_000 : value
  if (expiresAt <= now) throw new BootstrapConfigError("expiresAt", "has already expired")
  return expiresAt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
