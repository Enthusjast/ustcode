import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { UstcUsage } from "@/provider/ustc-usage"
import { it, testEffect } from "../lib/effect"

const calls: Array<{ url: string; authorization?: string }> = []

function responseBody(url: string) {
  return url.includes("/key/info")
    ? {
        info: {
          key_alias: "test-key",
          spend: 12.5,
          max_budget: 100,
          budget_duration: "24h",
          budget_reset_at: "2026-08-13T16:00:00+00:00",
          budget_limits: [{ reset_at: "2026-08-13T18:00:00+08:00", max_budget: 30, budget_duration: "3h" }],
          blocked: false,
          rpm_limit: 20,
          max_parallel_requests: 4,
          model_spend: { "qwen-chat": 4 },
          model_max_budget: { "qwen-chat": 10 },
        },
      }
    : url.includes("/user/info")
      ? {
          user_id: "user-1",
          user_info: { user_id: "user-1", user_role: "internal_user", spend: 123.4, max_budget: null },
          keys: [
            {
              token: "must-not-be-returned",
              key_alias: "test-key",
              spend: 12.5,
              max_budget: 100,
              rpm_limit: 20,
            },
          ],
        }
      : {
          results: [
            {
              date: "2026-08-12",
              metrics: { spend: 3.2, total_tokens: 1000, api_requests: 2 },
              breakdown: {
                models: {
                  "openai/qwen-chat": { metrics: { spend: 3.2, total_tokens: 1000, api_requests: 2 } },
                },
              },
            },
          ],
        }
}

const fetcher: UstcUsage.UstcUsageFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  const headers = new Headers(init?.headers)
  calls.push({ url, authorization: headers.get("authorization") ?? undefined })
  return new Response(JSON.stringify(responseBody(url)), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const httpClient = HttpClient.make((request) =>
  Effect.sync(() => {
    calls.push({ url: request.url, authorization: new Headers(request.headers).get("authorization") ?? undefined })
    return HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(responseBody(request.url)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  }),
)

const httpIt = testEffect(Layer.succeed(HttpClient.HttpClient, httpClient))

describe("USTC usage API", () => {
  it.effect("loads key quota, account totals, and daily model usage", () =>
    Effect.gen(function* () {
      calls.length = 0
      const report = yield* UstcUsage.getUsage({
        apiKey: "sk-test",
        baseURL: "https://ustc.test",
        fetcher,
        startDate: "2026-08-01",
        endDate: "2026-08-12",
      })

      expect(report.key.key_alias).toBe("test-key")
      expect(UstcUsage.remaining(report.key)).toBe(87.5)
      expect(UstcUsage.toJSON(report).key.model_remaining).toEqual({ "qwen-chat": 6 })
      expect(report.user.user_info.spend).toBe(123.4)
      expect(report.period.spend).toBe(3.2)
      expect(report.period.tokens.total).toBe(1000)
      expect(report.modelUsage["openai/qwen-chat"].requests.total).toBe(2)
      expect(report.daily.results[0].breakdown?.models?.["openai/qwen-chat"].metrics.total_tokens).toBe(1000)
      expect(calls.toSorted((left, right) => left.url.localeCompare(right.url))).toEqual([
        { url: "https://ustc.test/key/info", authorization: "Bearer sk-test" },
        {
          url: "https://ustc.test/user/daily/activity?start_date=2026-08-01&end_date=2026-08-12",
          authorization: "Bearer sk-test",
        },
        { url: "https://ustc.test/user/info", authorization: "Bearer sk-test" },
      ])
    }),
  )

  it.effect("does not expose key tokens in JSON output", () =>
    Effect.gen(function* () {
      const report = yield* UstcUsage.getUsage({
        apiKey: "sk-secret",
        baseURL: "https://ustc.test",
        fetcher,
        startDate: "2026-08-01",
        endDate: "2026-08-12",
      })
      const output = JSON.stringify(UstcUsage.toJSON(report))
      expect(output).not.toContain("sk-secret")
      expect(output).not.toContain("must-not-be-returned")
      expect(UstcUsage.format(report)).toContain("当前窗口花费: ¥12.50 / ¥100.00（剩余: ¥87.50）")
      expect(UstcUsage.format(report, { modelLimit: Infinity, daily: true, keys: true })).toContain(
        "模型用量:\n  openai/qwen-chat: ¥3.20，tokens 1,000，请求 2，Key 限额 ¥4.00 / ¥10.00（剩余: ¥6.00）",
      )
    }),
  )

  httpIt.effect("uses the shared Effect HTTP client in production mode", () =>
    Effect.gen(function* () {
      calls.length = 0
      const report = yield* UstcUsage.getUsage({
        apiKey: "sk-test",
        baseURL: "https://ustc.test",
        http: yield* HttpClient.HttpClient,
        startDate: "2026-08-01",
        endDate: "2026-08-12",
      })

      expect(report.period.requests.total).toBe(2)
      expect(calls.every((call) => call.authorization === "Bearer sk-test")).toBe(true)
    }),
  )
})
