import { EOL } from "os"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Auth } from "../../auth"
import { UstcUsage } from "../../provider/ustc-usage"
import { CliError, effectCmd, fail } from "../effect-cmd"

const DEFAULT_DAYS = 7

export const UsageCommand = effectCmd({
  command: "usage",
  aliases: ["quota"],
  describe: "show USTC usage, quota, and limits",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("start-date", {
        describe: "start date for daily usage (YYYY-MM-DD)",
        type: "string",
      })
      .option("end-date", {
        describe: "end date for daily usage (YYYY-MM-DD)",
        type: "string",
      })
      .option("days", {
        describe: `number of recent calendar days when dates are omitted (default: ${DEFAULT_DAYS})`,
        type: "number",
      })
      .option("models", {
        describe: "show usage grouped by model (pass a number to show only the top N)",
      })
      .option("daily", {
        describe: "show daily usage details",
        type: "boolean",
      })
      .option("keys", {
        describe: "show all keys belonging to the account",
        type: "boolean",
      })
      .option("json", {
        describe: "print sanitized JSON instead of a human-readable report",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.usage")(function* (args) {
    const range = dateRange(args)
    if (typeof range === "string") return yield* fail(range)

    const apiKey = yield* resolveApiKey()
    const http = yield* HttpClient.HttpClient
    const report = yield* UstcUsage.getUsage({ apiKey, http, ...range }).pipe(
      Effect.mapError(
        (error) =>
          new CliError({
            message: error instanceof UstcUsage.UstcUsageError ? error.message : String(error),
          }),
      ),
    )
    const modelLimit =
      args.models === true
        ? Infinity
        : typeof args.models === "number"
          ? Math.max(0, Math.floor(args.models))
          : undefined
    const output = args.json
      ? JSON.stringify(UstcUsage.toJSON(report), null, 2)
      : UstcUsage.format(report, { modelLimit, daily: args.daily, keys: args.keys })
    return yield* Effect.sync(() => process.stdout.write(output + EOL))
  }),
})

const resolveApiKey = Effect.fn("Cli.usage.resolveApiKey")(function* () {
  const environmentKey = process.env.USTC_API_KEY?.trim()
  if (environmentKey) return environmentKey

  const auth = yield* Auth.Service
  const credentials = yield* Effect.orDie(auth.all())
  const stored = Object.entries(credentials).find(
    ([provider, info]) =>
      ["ustc", "ustcode"].includes(provider.toLowerCase()) && info.type === "api" && info.key.trim(),
  )
  if (stored?.[1].type === "api") return stored[1].key.trim()

  return yield* fail("USTC API Key not found. Set USTC_API_KEY or run `ustcode providers login --provider USTC` first.")
})

function dateRange(input: { "start-date"?: string; "end-date"?: string; days?: number }) {
  const hasStart = input["start-date"] !== undefined
  const hasEnd = input["end-date"] !== undefined
  if (hasStart !== hasEnd) return "--start-date and --end-date must be provided together"

  if (hasStart && hasEnd) {
    if (!isDate(input["start-date"]!) || !isDate(input["end-date"]!)) {
      return "--start-date and --end-date must use YYYY-MM-DD"
    }
    if (input["start-date"]! > input["end-date"]!) return "--start-date must not be later than --end-date"
    if (input.days !== undefined) return "Do not combine --days with --start-date/--end-date"
    return { startDate: input["start-date"]!, endDate: input["end-date"]! }
  }

  const days = input.days ?? DEFAULT_DAYS
  if (!Number.isInteger(days) || days < 1 || days > 366) return "--days must be an integer from 1 to 366"

  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  return { startDate: formatDate(start), endDate: formatDate(end) }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
