#!/usr/bin/env bun

import { NodeFileSystem } from "@effect/platform-node"
import * as path from "node:path"
import * as prompts from "@clack/prompts"
import { Config, ConfigProvider, Effect, FileSystem, PlatformError, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import * as ProviderShared from "../src/protocols/shared"

type Provider = {
  readonly id: string
  readonly label: string
  readonly tier: "core" | "canary" | "compatible" | "optional"
  readonly note: string
  readonly vars: ReadonlyArray<{
    readonly name: string
    readonly label?: string
    readonly optional?: boolean
    readonly secret?: boolean
  }>
  readonly validate?: (env: Env) => Effect.Effect<string | undefined, unknown, HttpClient.HttpClient>
}

type Env = Record<string, string>

const PROVIDERS: ReadonlyArray<Provider> = [
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    tier: "core",
    note: "Generic OpenAI Chat-compatible recorded tests",
    vars: [
      { name: "OPENAI_COMPATIBLE_API_KEY" },
      { name: "OPENAI_COMPATIBLE_BASE_URL", label: "Base URL", secret: false },
    ],
    validate: (env) =>
      validateChat({
        url: `${ProviderShared.trimBaseUrl(env.OPENAI_COMPATIBLE_BASE_URL)}/chat/completions`,
        token: Redacted.make(env.OPENAI_COMPATIBLE_API_KEY),
        model: "gpt-4o-mini",
      }),
  },
]

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(name)
const option = (name: string) => {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

const envPath = path.resolve(process.cwd(), option("--env") ?? ".env.local")
const checkOnly = hasFlag("--check")
const providerOption = option("--providers")
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

const envNames = Array.from(new Set(PROVIDERS.flatMap((provider) => provider.vars.map((item) => item.name))))

const providersForOption = (value: string | undefined) => {
  if (!value || value === "recommended")
    return PROVIDERS.filter((provider) => provider.tier === "core" || provider.tier === "canary")
  if (value === "recorded") return PROVIDERS.filter((provider) => provider.tier !== "optional")
  if (value === "all") return PROVIDERS
  const ids = new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  return PROVIDERS.filter((provider) => ids.has(provider.id))
}

const chooseProviders = async () => {
  if (providerOption) return providersForOption(providerOption)
  return providersForOption("recommended")
}

const catchMissingFile = (error: PlatformError.PlatformError) => {
  if (error.reason._tag === "NotFound") return Effect.succeed("")
  return Effect.fail(error)
}

const readEnvFile = Effect.fn("RecordingEnv.readFile")(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  return yield* fileSystem.readFileString(envPath).pipe(Effect.catch(catchMissingFile))
})

const readConfigString = (provider: ConfigProvider.ConfigProvider, name: string) =>
  Config.string(name)
    .parse(provider)
    .pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (value) => value,
      }),
    )

const parseEnv = Effect.fn("RecordingEnv.parseEnv")(function* (contents: string) {
  const provider = ConfigProvider.fromDotEnvContents(contents)
  return Object.fromEntries(
    (yield* Effect.forEach(envNames, (name) =>
      readConfigString(provider, name).pipe(Effect.map((value) => [name, value] as const)),
    )).filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  )
})

const quote = (value: string) => JSON.stringify(value)

const status = (name: string, fileEnv: Env) => {
  if (fileEnv[name]) return "file"
  if (process.env[name]) return "shell"
  return "missing"
}

const statusLine = (provider: Provider, fileEnv: Env) =>
  [
    `${provider.label} (${provider.tier})`,
    provider.note,
    ...provider.vars.map((item) => {
      const value = status(item.name, fileEnv)
      const suffix = item.optional ? " optional" : ""
      return `  ${value === "missing" ? "missing" : "set"} ${item.name}${suffix}${value === "shell" ? " (shell only)" : ""}`
    }),
  ].join("\n")

const printStatus = (providers: ReadonlyArray<Provider>, fileEnv: Env) => {
  prompts.note(providers.map((provider) => statusLine(provider, fileEnv)).join("\n\n"), `Recording env: ${envPath}`)
}

const exitIfCancel = <A>(value: A | symbol): A => {
  if (!prompts.isCancel(value)) return value as A
  prompts.cancel("Cancelled")
  process.exit(130)
}

const upsertEnv = (contents: string, values: Env) => {
  const names = Object.keys(values)
  const seen = new Set<string>()
  const lines = contents.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match || !names.includes(match[1])) return line
    seen.add(match[1])
    return `${match[1]}=${quote(values[match[1]])}`
  })
  const missing = names.filter((name) => !seen.has(name))
  if (missing.length === 0) return lines.join("\n").replace(/\n*$/, "\n")
  const prefix = lines.join("\n").trimEnd()
  const block = [
    "",
    "# Added by bun run setup:recording-env",
    ...missing.map((name) => `${name}=${quote(values[name])}`),
  ].join("\n")
  return `${prefix}${block}\n`
}

const providerRequiredStatus = (provider: Provider, fileEnv: Env) => {
  const required = requiredVars(provider)
  if (required.some((item) => status(item.name, fileEnv) === "missing")) return "missing"
  if (required.some((item) => status(item.name, fileEnv) === "shell")) return "set in shell"
  return "already added"
}

const requiredVars = (provider: Provider) => provider.vars.filter((item) => !item.optional)

const promptVars = (provider: Provider) => provider.vars.filter((item) => !item.optional || item.secret === false)

const processEnv = (): Env =>
  Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))

const envWithValues = (fileEnv: Env, values: Env): Env => ({
  ...processEnv(),
  ...fileEnv,
  ...values,
})

const responseError = Effect.fn("RecordingEnv.responseError")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return undefined
  const body = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
  return `${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`
})

const executeRequest = Effect.fn("RecordingEnv.executeRequest")(function* (
  request: HttpClientRequest.HttpClientRequest,
) {
  const http = yield* HttpClient.HttpClient
  return yield* http.execute(request).pipe(Effect.flatMap(responseError))
})

const validateChat = (input: {
  readonly url: string
  readonly token: Redacted.Redacted<string>
  readonly tokenHeader?: string
  readonly model: string
  readonly headers?: Record<string, string>
}) =>
  ProviderShared.jsonPost({
    url: input.url,
    headers: { ...input.headers, [input.tokenHeader ?? "authorization"]: `Bearer ${Redacted.value(input.token)}` },
    body: ProviderShared.encodeJson({
      model: input.model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 3,
      temperature: 0,
    }),
  }).pipe(executeRequest)

const validateProvider = Effect.fn("RecordingEnv.validateProvider")(function* (provider: Provider, env: Env) {
  return yield* (provider.validate?.(env) ?? Effect.succeed("no lightweight validator")).pipe(
    Effect.catch((error) => {
      if (error instanceof Error) return Effect.succeed(error.message)
      return Effect.succeed(String(error))
    }),
  )
})

const validateProviders = Effect.fn("RecordingEnv.validateProviders")(function* (
  providers: ReadonlyArray<Provider>,
  env: Env,
) {
  const spinner = prompts.spinner()
  spinner.start("Validating credentials")
  const results = yield* Effect.forEach(
    providers,
    (provider) => validateProvider(provider, env).pipe(Effect.map((error) => ({ provider, error }))),
    { concurrency: 4 },
  )
  spinner.stop("Validation complete")
  prompts.note(
    results
      .map(
        (result) =>
          `${result.error ? "failed" : "ok"} ${result.provider.label}${result.error ? ` - ${result.error}` : ""}`,
      )
      .join("\n"),
    "Credential validation",
  )
})

const writeEnvFile = Effect.fn("RecordingEnv.writeFile")(function* (contents: string) {
  const fileSystem = yield* FileSystem.FileSystem
  yield* fileSystem.makeDirectory(path.dirname(envPath), { recursive: true })
  yield* fileSystem.writeFileString(envPath, contents, { mode: 0o600 })
})

const prompt = <A>(run: () => Promise<A | symbol>) => Effect.promise(run).pipe(Effect.map(exitIfCancel))

const chooseConfigurableProviders = Effect.fn("RecordingEnv.chooseConfigurableProviders")(function* (
  providers: ReadonlyArray<Provider>,
  fileEnv: Env,
) {
  const configurable = providers.filter((provider) => requiredVars(provider).length > 0)
  const selected = yield* prompt<ReadonlyArray<string>>(() =>
    prompts.multiselect({
      message: "Select provider credentials to add or override",
      options: configurable.map((provider) => ({
        value: provider.id,
        label: provider.label,
        hint: `${providerRequiredStatus(provider, fileEnv)} - ${requiredVars(provider)
          .map((item) => item.name)
          .join(", ")}`,
      })),
      initialValues: configurable
        .filter((provider) => providerRequiredStatus(provider, fileEnv) === "missing")
        .map((provider) => provider.id),
    }),
  )
  return configurable.filter((provider) => selected.includes(provider.id))
})

const promptEnvVar = (item: Provider["vars"][number]) =>
  prompt<string>(() => {
    const input = {
      message: item.label ?? item.name,
      validate: (input: string | undefined) => {
        if (item.optional) return undefined
        return !input || input.length === 0 ? "Leave blank by pressing Esc/cancel, or paste a value" : undefined
      },
    }
    return item.secret === false ? prompts.text(input) : prompts.password(input)
  })

const promptProviderValues = Effect.fn("RecordingEnv.promptProviderValues")(function* (
  providers: ReadonlyArray<Provider>,
) {
  const values: Env = {}
  for (const provider of providers) {
    prompts.log.info(`${provider.label}: ${provider.note}`)
    for (const item of promptVars(provider)) {
      if (values[item.name]) continue
      const value = yield* promptEnvVar(item)
      if (value !== "") values[item.name] = value
    }
  }
  return values
})

const main = Effect.fn("RecordingEnv.main")(function* () {
  prompts.intro("LLM recording credentials")
  const contents = yield* readEnvFile()
  const fileEnv = yield* parseEnv(contents)
  const providers = yield* Effect.promise(() => chooseProviders())
  printStatus(providers, fileEnv)
  if (checkOnly) {
    prompts.outro("Check complete")
    return
  }
  if (!interactive) {
    prompts.outro("Run this command in a terminal to enter credentials")
    return
  }

  const selectedProviders = yield* chooseConfigurableProviders(providers, fileEnv)
  const values = yield* promptProviderValues(selectedProviders)

  if (Object.keys(values).length === 0) {
    prompts.outro("No changes")
    return
  }

  if (
    interactive &&
    (yield* prompt(() => prompts.confirm({ message: "Validate credentials before saving?", initialValue: true })))
  ) {
    yield* validateProviders(selectedProviders, envWithValues(fileEnv, values))
  }

  yield* writeEnvFile(upsertEnv(contents, values))
  prompts.log.success(
    `Saved ${Object.keys(values).length} value${Object.keys(values).length === 1 ? "" : "s"} to ${envPath}`,
  )
  prompts.outro("Keep .env.local local. Store shared team credentials in a password manager or vault.")
})

await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(FetchHttpClient.layer)))
