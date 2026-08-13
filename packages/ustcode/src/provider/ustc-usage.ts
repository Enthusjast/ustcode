import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

export const USTC_API_BASE_URL = "https://api.llm.ustc.edu.cn"

const optionalNumber = Schema.optional(Schema.NullOr(Schema.Finite))
const optionalString = Schema.optional(Schema.NullOr(Schema.String))

const BudgetLimit = Schema.Struct({
  reset_at: optionalString,
  max_budget: optionalNumber,
  budget_duration: optionalString,
  spend: optionalNumber,
})

export const KeyInfo = Schema.Struct({
  key_alias: optionalString,
  spend: optionalNumber,
  max_budget: optionalNumber,
  budget_duration: optionalString,
  budget_reset_at: optionalString,
  budget_limits: Schema.optional(Schema.NullOr(Schema.Array(BudgetLimit))),
  expires: optionalString,
  blocked: Schema.optional(Schema.NullOr(Schema.Boolean)),
  rpm_limit: optionalNumber,
  tpm_limit: optionalNumber,
  max_parallel_requests: optionalNumber,
  user_id: optionalString,
  team_id: optionalString,
  models: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  model_spend: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.Finite)))),
  model_max_budget: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.Finite)))),
})
export type KeyInfo = Schema.Schema.Type<typeof KeyInfo>

const KeyInfoResponse = Schema.Struct({
  info: KeyInfo,
})

const UserKey = Schema.Struct({
  key_alias: optionalString,
  spend: optionalNumber,
  max_budget: optionalNumber,
  budget_duration: optionalString,
  expires: optionalString,
  rpm_limit: optionalNumber,
  tpm_limit: optionalNumber,
  max_parallel_requests: optionalNumber,
  user_id: optionalString,
  team_id: optionalString,
})
export type UserKey = Schema.Schema.Type<typeof UserKey>

const UserInfo = Schema.Struct({
  user_id: optionalString,
  user_role: optionalString,
  user_alias: optionalString,
  spend: optionalNumber,
  max_budget: optionalNumber,
  budget_duration: optionalString,
  teams: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

const UserInfoResponse = Schema.Struct({
  user_id: optionalString,
  user_info: UserInfo,
  keys: Schema.Array(UserKey),
})
export type UserInfoResponse = Schema.Schema.Type<typeof UserInfoResponse>

const DailyMetrics = Schema.Struct({
  spend: optionalNumber,
  prompt_tokens: optionalNumber,
  completion_tokens: optionalNumber,
  cache_read_input_tokens: optionalNumber,
  cache_creation_input_tokens: optionalNumber,
  total_tokens: optionalNumber,
  successful_requests: optionalNumber,
  failed_requests: optionalNumber,
  api_requests: optionalNumber,
})
export type DailyMetrics = Schema.Schema.Type<typeof DailyMetrics>

const DailyModel = Schema.Struct({
  metrics: DailyMetrics,
})

const DailyBreakdown = Schema.Struct({
  models: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, DailyModel))),
})

const DailyResult = Schema.Struct({
  date: Schema.String,
  metrics: DailyMetrics,
  breakdown: Schema.optional(Schema.NullOr(DailyBreakdown)),
})

export const DailyActivity = Schema.Struct({
  results: Schema.Array(DailyResult),
})
export type DailyActivity = Schema.Schema.Type<typeof DailyActivity>

export class UstcUsageError extends Schema.TaggedErrorClass<UstcUsageError>()("UstcUsageError", {
  message: Schema.String,
  endpoint: Schema.String,
  status: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {}

export type UstcUsageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type UsageQuery = {
  apiKey: string
  baseURL?: string
  /** Used by fixture tests and embedders that already own a fetch boundary. */
  fetcher?: UstcUsageFetch
  /** Production callers should pass the shared Effect HTTP client. */
  http?: HttpClient.HttpClient
}

export type DailyUsageQuery = UsageQuery & {
  startDate: string
  endDate: string
}

export type UsageSummary = {
  spend: number
  tokens: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    total: number
  }
  requests: {
    total: number
    successful: number
    failed: number
  }
}

export type UsageReport = {
  key: KeyInfo
  user: UserInfoResponse
  daily: DailyActivity
  period: UsageSummary
  modelUsage: Record<string, UsageSummary>
  startDate: string
  endDate: string
}

const requestJson = <S extends Schema.Top>(input: {
  apiKey: string
  baseURL: string | undefined
  fetcher: UstcUsageFetch | undefined
  http: HttpClient.HttpClient | undefined
  endpoint: string
  schema: S
  query?: Record<string, string>
}) =>
  Effect.gen(function* () {
    const baseURL = (input.baseURL ?? USTC_API_BASE_URL).replace(/\/+$/, "")
    const url = new URL(input.endpoint, `${baseURL}/`)
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value)

    if (input.http) {
      const request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders({ Authorization: `Bearer ${input.apiKey}` }),
      )
      const response = yield* input.http.execute(request).pipe(
        Effect.mapError(
          (cause) =>
            new UstcUsageError({
              message: `Failed to request USTC ${input.endpoint}`,
              endpoint: input.endpoint,
              cause,
            }),
        ),
      )

      if (response.status < 200 || response.status >= 300) {
        const detail = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
        return yield* httpError(input, response.status, detail)
      }

      return yield* HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
        Effect.mapError(
          (cause) =>
            new UstcUsageError({
              message: `Invalid JSON response from USTC ${input.endpoint}`,
              endpoint: input.endpoint,
              cause,
            }),
        ),
      )
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        (input.fetcher ?? fetch)(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.apiKey}`,
          },
        }),
      catch: (cause) =>
        new UstcUsageError({
          message: `Failed to request USTC ${input.endpoint}`,
          endpoint: input.endpoint,
          cause,
        }),
    })

    if (response.status < 200 || response.status >= 300) {
      const detail = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "",
      })
      return yield* httpError(input, response.status, detail)
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new UstcUsageError({
          message: `Invalid JSON response from USTC ${input.endpoint}`,
          endpoint: input.endpoint,
          cause,
        }),
    })

    return yield* Schema.decodeUnknownEffect(input.schema)(body).pipe(
      Effect.mapError(
        (cause) =>
          new UstcUsageError({
            message: `Invalid JSON response from USTC ${input.endpoint}`,
            endpoint: input.endpoint,
            cause,
          }),
      ),
    )
  })

export const getKeyInfo = Effect.fn("UstcUsage.getKeyInfo")(function* (input: UsageQuery) {
  const response = yield* requestJson({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    fetcher: input.fetcher,
    http: input.http,
    endpoint: "key/info",
    schema: KeyInfoResponse,
  })
  return response.info
})

export const getUserInfo = Effect.fn("UstcUsage.getUserInfo")(function* (input: UsageQuery) {
  return yield* requestJson({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    fetcher: input.fetcher,
    http: input.http,
    endpoint: "user/info",
    schema: UserInfoResponse,
  })
})

export const getDailyActivity = Effect.fn("UstcUsage.getDailyActivity")(function* (input: DailyUsageQuery) {
  return yield* requestJson({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    fetcher: input.fetcher,
    http: input.http,
    endpoint: "user/daily/activity",
    schema: DailyActivity,
    query: {
      start_date: input.startDate,
      end_date: input.endDate,
    },
  })
})

export const getUsage = Effect.fn("UstcUsage.getUsage")(function* (input: DailyUsageQuery) {
  const [key, user, daily] = yield* Effect.all([getKeyInfo(input), getUserInfo(input), getDailyActivity(input)], {
    concurrency: 3,
  })
  return {
    key,
    user,
    daily,
    period: daily.results.map((item) => toSummary(item.metrics)).reduce(addSummary, emptySummary()),
    modelUsage: aggregateModelUsage(daily),
    startDate: input.startDate,
    endDate: input.endDate,
  } satisfies UsageReport
})

export function remaining(input: Pick<KeyInfo, "max_budget" | "spend">): number | undefined {
  if (typeof input.max_budget !== "number" || typeof input.spend !== "number") return undefined
  return Math.max(0, input.max_budget - input.spend)
}

export function toJSON(report: UsageReport) {
  return {
    range: {
      start_date: report.startDate,
      end_date: report.endDate,
    },
    key: publicKeyInfo(report.key),
    account: publicAccountInfo(report.user.user_info),
    keys: report.user.keys.map(publicUserKey),
    period: {
      totals: summaryJSON(report.period),
      model_usage: Object.fromEntries(
        Object.entries(report.modelUsage).map(([model, summary]) => [model, summaryJSON(summary)]),
      ),
    },
    daily: report.daily.results,
  }
}

export type FormatOptions = {
  modelLimit?: number
  daily?: boolean
  keys?: boolean
}

export function format(report: UsageReport, options: FormatOptions = {}) {
  const lines = [
    "USTC 用量与限额",
    `查询区间: ${report.startDate} 至 ${report.endDate}`,
    `当前 Key: ${report.key.key_alias ?? "当前 API Key"}`,
    `当前窗口花费: ${formatMoney(report.key.spend)} / ${formatMoney(report.key.max_budget)}（剩余: ${formatMoney(remaining(report.key))}）`,
    `预算窗口: ${report.key.budget_duration ?? "-"}，下次重置: ${formatDateTime(report.key.budget_reset_at)}`,
    `状态: ${report.key.blocked === true ? "已封禁" : report.key.blocked === false ? "正常" : "未知"}`,
    `查询区间用量: ${formatMoney(report.period.spend)}，tokens ${formatNumber(report.period.tokens.total)}，请求 ${formatNumber(report.period.requests.total)}`,
    `账号累计花费: ${formatMoney(report.user.user_info.spend)}`,
  ]

  const limits = [
    report.key.rpm_limit === null || report.key.rpm_limit === undefined
      ? undefined
      : `RPM ${formatNumber(report.key.rpm_limit)}`,
    report.key.tpm_limit === null || report.key.tpm_limit === undefined
      ? undefined
      : `TPM ${formatNumber(report.key.tpm_limit)}`,
    report.key.max_parallel_requests === null || report.key.max_parallel_requests === undefined
      ? undefined
      : `并发 ${formatNumber(report.key.max_parallel_requests)}`,
  ].filter((value): value is string => value !== undefined)
  if (limits.length) lines.push(`请求限制: ${limits.join("，")}`)
  if (report.key.expires) lines.push(`Key 有效期至: ${report.key.expires}`)

  if (report.key.budget_limits?.length) {
    lines.push("子限额:")
    for (const limit of report.key.budget_limits) {
      const limitRemaining = remaining(limit)
      lines.push(
        `  ${limit.budget_duration ?? "滚动窗口"}: 上限 ${formatMoney(limit.max_budget)}${limitRemaining === undefined ? "" : `，剩余 ${formatMoney(limitRemaining)}`}，重置 ${formatDateTime(limit.reset_at)}`,
      )
    }
  }

  const modelIDs = [
    ...new Set([
      ...Object.keys(report.modelUsage),
      ...Object.keys(report.key.model_spend ?? {}),
      ...Object.keys(report.key.model_max_budget ?? {}),
    ]),
  ]
  if (options.modelLimit !== undefined && modelIDs.length) {
    const models = modelIDs
      .sort((left, right) => (report.modelUsage[right]?.spend ?? 0) - (report.modelUsage[left]?.spend ?? 0))
      .slice(0, options.modelLimit === Infinity ? undefined : options.modelLimit)
    lines.push("模型用量:")
    for (const model of models) {
      const summary = report.modelUsage[model] ?? emptySummary()
      const budget = modelBudget(report.key, model)
      const budgetText = budget
        ? `，Key 限额 ${formatMoney(budget.spend)} / ${formatMoney(budget.max_budget)}（剩余: ${formatMoney(remaining(budget))}）`
        : ""
      lines.push(
        `  ${model}: ${formatMoney(summary.spend)}，tokens ${formatNumber(summary.tokens.total)}，请求 ${formatNumber(summary.requests.total)}${budgetText}`,
      )
    }
  }

  if (options.keys && report.user.keys.length) {
    lines.push("名下 Key:")
    for (const key of report.user.keys) {
      lines.push(
        `  ${key.key_alias ?? "未命名 Key"}: 花费 ${formatMoney(key.spend)} / ${formatMoney(key.max_budget)}（剩余: ${formatMoney(remaining(key))}）`,
      )
    }
  }

  if (options.daily) {
    lines.push("每日用量:")
    if (report.daily.results.length === 0) lines.push("  无数据")
    for (const day of report.daily.results) {
      const summary = toSummary(day.metrics)
      lines.push(
        `  ${day.date}: ${formatMoney(summary.spend)}，tokens ${formatNumber(summary.tokens.total)}，请求 ${formatNumber(summary.requests.total)}（成功 ${formatNumber(summary.requests.successful)}，失败 ${formatNumber(summary.requests.failed)}）`,
      )
    }
  }

  return lines.join("\n")
}

function httpError(
  input: { apiKey: string; endpoint: string },
  status: number,
  body: string,
): Effect.Effect<never, UstcUsageError> {
  const detail = body.replaceAll(input.apiKey, "[redacted]").trim().slice(0, 300)
  return Effect.fail(
    new UstcUsageError({
      message: `USTC ${input.endpoint} returned HTTP ${status}${detail ? `: ${detail}` : ""}`,
      endpoint: input.endpoint,
      status,
    }),
  )
}

function aggregateModelUsage(daily: DailyActivity) {
  return daily.results.reduce<Record<string, UsageSummary>>((result, day) => {
    for (const [model, value] of Object.entries(day.breakdown?.models ?? {})) {
      result[model] = addSummary(result[model] ?? emptySummary(), toSummary(value.metrics))
    }
    return result
  }, {})
}

function emptySummary(): UsageSummary {
  return {
    spend: 0,
    tokens: { input: 0, output: 0, cache: { read: 0, write: 0 }, total: 0 },
    requests: { total: 0, successful: 0, failed: 0 },
  }
}

function toSummary(metrics: DailyMetrics): UsageSummary {
  const input = number(metrics.prompt_tokens)
  const output = number(metrics.completion_tokens)
  const read = number(metrics.cache_read_input_tokens)
  const write = number(metrics.cache_creation_input_tokens)
  return {
    spend: number(metrics.spend),
    tokens: {
      input,
      output,
      cache: { read, write },
      total: number(metrics.total_tokens) || input + output + read + write,
    },
    requests: {
      total: number(metrics.api_requests) || number(metrics.successful_requests) + number(metrics.failed_requests),
      successful: number(metrics.successful_requests),
      failed: number(metrics.failed_requests),
    },
  }
}

function addSummary(left: UsageSummary, right: UsageSummary): UsageSummary {
  return {
    spend: left.spend + right.spend,
    tokens: {
      input: left.tokens.input + right.tokens.input,
      output: left.tokens.output + right.tokens.output,
      cache: {
        read: left.tokens.cache.read + right.tokens.cache.read,
        write: left.tokens.cache.write + right.tokens.cache.write,
      },
      total: left.tokens.total + right.tokens.total,
    },
    requests: {
      total: left.requests.total + right.requests.total,
      successful: left.requests.successful + right.requests.successful,
      failed: left.requests.failed + right.requests.failed,
    },
  }
}

function number(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

function summaryJSON(summary: UsageSummary) {
  return {
    spend: summary.spend,
    tokens: summary.tokens,
    requests: summary.requests,
  }
}

function publicKeyInfo(key: KeyInfo) {
  return {
    key_alias: key.key_alias,
    spend: key.spend,
    max_budget: key.max_budget,
    remaining: remaining(key),
    budget_duration: key.budget_duration,
    budget_reset_at: key.budget_reset_at,
    budget_limits: key.budget_limits?.map((limit) => ({ ...limit, remaining: remaining(limit) })),
    expires: key.expires,
    blocked: key.blocked,
    rpm_limit: key.rpm_limit,
    tpm_limit: key.tpm_limit,
    max_parallel_requests: key.max_parallel_requests,
    user_id: key.user_id,
    team_id: key.team_id,
    models: key.models,
    model_spend: key.model_spend,
    model_max_budget: key.model_max_budget,
    model_remaining: modelRemaining(key),
  }
}

function publicAccountInfo(user: UserInfoResponse["user_info"]) {
  return {
    user_id: user.user_id,
    user_role: user.user_role,
    user_alias: user.user_alias,
    spend: user.spend,
    max_budget: user.max_budget,
    remaining: remaining(user),
    budget_duration: user.budget_duration,
    teams: user.teams,
  }
}

function publicUserKey(key: UserKey) {
  return {
    key_alias: key.key_alias,
    spend: key.spend,
    max_budget: key.max_budget,
    remaining: remaining(key),
    budget_duration: key.budget_duration,
    expires: key.expires,
    rpm_limit: key.rpm_limit,
    tpm_limit: key.tpm_limit,
    max_parallel_requests: key.max_parallel_requests,
    user_id: key.user_id,
    team_id: key.team_id,
  }
}

function modelRemaining(key: KeyInfo) {
  const modelIDs = new Set([...Object.keys(key.model_spend ?? {}), ...Object.keys(key.model_max_budget ?? {})])
  return Object.fromEntries(
    [...modelIDs].flatMap((model) => {
      const spend = key.model_spend?.[model]
      const maxBudget = key.model_max_budget?.[model]
      if (typeof spend !== "number" || typeof maxBudget !== "number") return []
      return [[model, Math.max(0, maxBudget - spend)]]
    }),
  )
}

function modelBudget(key: KeyInfo, model: string) {
  const candidates = [model, model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : undefined].filter(
    (value): value is string => value !== undefined,
  )
  const id = candidates.find(
    (candidate) => key.model_spend?.[candidate] !== undefined || key.model_max_budget?.[candidate] !== undefined,
  )
  if (id === undefined) return
  return {
    spend: key.model_spend?.[id],
    max_budget: key.model_max_budget?.[id],
  }
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 })
}

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `¥${value.toFixed(2)}`
}

function formatDateTime(value: string | null | undefined) {
  return value ?? "-"
}

export * as UstcUsage from "./ustc-usage"
