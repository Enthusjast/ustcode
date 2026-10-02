import type { ConnectionInfo } from "@ustcode-ai/client"
import { Cause, Effect, Duration, Exit, Semaphore, Stream } from "effect"
import { define } from "@ustcode-ai/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Provider } from "../../provider.js"
import { ProviderAuth } from "../../provider-auth.js"
import type { PluginInternal } from "../internal.js"
import {
  BootstrapAuthorizationError,
  BootstrapConfigError,
  BootstrapNetworkError,
  fetchBootstrap,
  providerID,
  providerName,
  type GatewayConfig,
} from "./tokenworks/bootstrap.js"
import { METHOD_ID, method, requestDirect, type Requester } from "./tokenworks/oidc.js"

const integrationID = Integration.ID.make(providerID)
const retryDelays = [60_000, 120_000, 300_000, 600_000]
const modelPackage = "@ustcode-ai/ai/providers/openai-compatible"

type Runtime = {
  accountID?: string
  subject?: string
  pendingSubject?: string
  connection?: ConnectionInfo
  gateway?: GatewayConfig
  generation: number
  denied: boolean
  failures: number
  nextAttemptAt: number
}
type CredentialConnection = Extract<ConnectionInfo, { type: "credential" }>
type Account = { connection: CredentialConnection; credential: Credential.OAuth; subject: string }

export function createTokenWorksPlugin(requester: Requester = requestDirect) {
  return define({
    id: "ustcode.provider.ustc-tokenworks",
    effect: Effect.fn(function* (ctx) {
      const auth = yield* ProviderAuth.Service
      const bus = yield* Bus.Service
      const lock = Semaphore.makeUnsafe(1)
      const state: Runtime = {
        generation: 0,
        denied: false,
        failures: 0,
        nextAttemptAt: Number.POSITIVE_INFINITY,
      }

      yield* ctx.integration.transform((editor) => {
        editor.update(providerID, (integration) => {
          integration.name = providerName
        })
        const registered = method(requester)
        editor.method.update({
          ...registered,
          authorize: (answer) =>
            registered.authorize(answer).pipe(
              Effect.map((authorization) => {
                if (authorization.mode !== "auto") return authorization
                return {
                  ...authorization,
                  callback: authorization.callback.pipe(Effect.tap((credential) => lock.withPermit(warm(credential)))),
                }
              }),
            ),
        })
      })
      yield* ctx.provider.transform((editor) => {
        if (!state.gateway) {
          editor.remove(providerID)
          return
        }
        editor.add({
          info: {
            id: providerID,
            name: providerName,
            integrationID,
            activation: "enabled",
            package: modelPackage,
            settings: { baseURL: state.gateway.baseURL, provider: providerID },
            headers: state.gateway.headers,
          },
          models: state.gateway.models,
          ...(state.connection ? { sourceConnection: state.connection } : {}),
        })
      })

      const unavailable = (cause: unknown) =>
        new Integration.AuthorizationError({
          cause: cause instanceof Error ? cause : new Error("USTC TokenWorks credentials are unavailable"),
        })
      const apiKey = () =>
        lock
          .withPermit(
            Effect.gen(function* () {
              const gateway = yield* ensureGateway()
              return Credential.Key.make({ type: "key", key: gateway.apiKey })
            }),
          )
          .pipe(Effect.catch((cause) => Effect.fail(unavailable(cause))))

      const unregister = yield* auth.register(providerID, apiKey)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          state.gateway = undefined
          unregister()
        }).pipe(Effect.andThen(ctx.provider.reload().pipe(Effect.ignore))),
      )

      yield* lock.withPermit(ensureGateway()).pipe(Effect.ignore)
      const loop = Effect.forever(
        Effect.gen(function* () {
          const delay = Number.isFinite(state.nextAttemptAt)
            ? Math.max(1_000, state.nextAttemptAt - Date.now())
            : Duration.toMillis(Duration.minutes(5))
          yield* Effect.sleep(Duration.millis(delay))
          if (!state.denied) yield* lock.withPermit(ensureGateway()).pipe(Effect.ignore)
        }),
      )
      yield* loop.pipe(Effect.forkScoped)
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filter((event) => event.data.integrationID === integrationID),
        Stream.runForEach(() => lock.withPermit(ensureGateway()).pipe(Effect.ignore)),
        Effect.forkScoped({ startImmediately: true }),
      )

      function warm(credential: Credential.OAuth) {
        return Effect.gen(function* () {
          const subject = typeof credential.metadata?.sub === "string" ? credential.metadata.sub : undefined
          if (!subject) return yield* Effect.fail(unavailable(new Error("OIDC account has no subject")))
          const gateway = yield* loadGateway(credential.access)
          state.generation++
          state.accountID = undefined
          state.subject = subject
          state.pendingSubject = subject
          state.connection = undefined
          state.gateway = gateway
          state.denied = false
          state.failures = 0
          state.nextAttemptAt = gateway.recheckAt
          yield* ctx.provider.reload()
        })
      }

      function activeConnection(): Effect.Effect<ConnectionInfo | undefined, Integration.AuthorizationError> {
        return ctx.integration.connection.active(providerID).pipe(Effect.mapError((cause) => unavailable(cause)))
      }

      function currentAccount(): Effect.Effect<Account | undefined, Integration.AuthorizationError> {
        return Effect.gen(function* () {
          const connection = yield* activeConnection()
          const credentialConnection = connection && "id" in connection ? connection : undefined
          if (!credentialConnection) return undefined
          const value = yield* ctx.integration.connection
            .resolve(credentialConnection)
            .pipe(Effect.mapError((cause) => unavailable(cause)))
          if (value?.type !== "oauth" || value.methodID !== METHOD_ID) return undefined
          const subject = value.metadata?.sub
          if (typeof subject !== "string" || subject.length === 0)
            return yield* Effect.fail(unavailable(new Error("OIDC account has no subject")))
          return { connection: credentialConnection, credential: value, subject }
        })
      }

      function setAccount(account: Account | undefined) {
        return Effect.gen(function* () {
          const accountID = account?.connection.type === "credential" ? account.connection.id : undefined
          if (accountID === state.accountID && account?.subject === state.subject) {
            if (account) state.connection = account.connection
            return
          }
          state.generation++
          const keepWarmKey =
            !!account &&
            account.subject === state.pendingSubject &&
            !!state.gateway &&
            Date.now() < state.gateway.expiresAt
          state.accountID = accountID
          state.subject = account?.subject
          state.pendingSubject = undefined
          state.connection = account?.connection
          state.denied = false
          state.failures = 0
          state.nextAttemptAt = Date.now()
          if (!keepWarmKey) state.gateway = undefined
          yield* ctx.provider.reload()
        })
      }

      function ensureGateway(): Effect.Effect<GatewayConfig, unknown> {
        return Effect.gen(function* () {
          const connection = yield* activeConnection()
          if (!connection || connection.type !== "credential") {
            yield* setAccount(undefined)
            return yield* Effect.fail(unavailable(new Error("Sign in to USTC TokenWorks first")))
          }
          if (connection.id !== state.accountID) {
            const account = yield* currentAccount()
            if (!account || account.connection.type !== "credential" || account.connection.id !== connection.id) {
              yield* setAccount(account)
              return yield* Effect.fail(unavailable(new Error("USTC TokenWorks account is unavailable")))
            }
            yield* setAccount(account)
          } else {
            state.connection = connection
          }
          if (state.denied) return yield* Effect.fail(unavailable(new Error("USTC TokenWorks access is not available")))
          if (state.gateway && Date.now() < state.gateway.expiresAt && Date.now() < state.gateway.recheckAt)
            return state.gateway
          if (state.nextAttemptAt > Date.now()) {
            if (state.gateway && Date.now() < state.gateway.expiresAt) return state.gateway
            return yield* Effect.fail(unavailable(new BootstrapNetworkError()))
          }
          const accountResult = yield* Effect.exit(currentAccount())
          if (Exit.isFailure(accountResult)) {
            const error = Cause.squash(accountResult.cause)
            state.gateway = undefined
            state.denied = true
            state.nextAttemptAt = Number.POSITIVE_INFINITY
            yield* ctx.provider.reload()
            if (state.connection) {
              yield* ctx.integration.connection.status({
                integrationID,
                connection: state.connection,
                status: {
                  status: "needs_auth",
                  message: error instanceof Error ? error.message : "USTC TokenWorks sign-in must be renewed.",
                },
              })
            }
            return yield* Effect.fail(unavailable(error))
          }
          const account = accountResult.value
          if (!account || account.connection.id !== connection.id) {
            yield* setAccount(account)
            return yield* Effect.fail(unavailable(new Error("USTC TokenWorks account changed")))
          }
          yield* setAccount(account)
          return yield* reloadGateway(account)
        })
      }

      function reloadGateway(account: Account) {
        return Effect.gen(function* () {
          const generation = state.generation
          const old = state.gateway
          const result = yield* Effect.exit(loadGateway(account.credential.access))
          if (generation !== state.generation) return yield* Effect.fail(unavailable(new Error("USTC account changed")))

          const latest = yield* activeConnection()
          const latestCredential = latest && "id" in latest ? latest : undefined
          if (!latestCredential || latestCredential.id !== account.connection.id) {
            if (!latestCredential) yield* setAccount(undefined)
            else yield* setAccount(yield* currentAccount())
            return yield* Effect.fail(unavailable(new Error("USTC account changed")))
          }

          if (Exit.isFailure(result)) {
            const error = Cause.squash(result.cause)
            if (error instanceof BootstrapAuthorizationError) {
              state.gateway = undefined
              state.denied = true
              state.nextAttemptAt = Number.POSITIVE_INFINITY
              yield* ctx.provider.reload()
              yield* ctx.integration.connection.status({
                integrationID,
                connection: latestCredential,
                status: { status: "needs_auth", message: error.message },
              })
              return yield* Effect.fail(unavailable(error))
            }

            state.failures++
            const delay = retryDelays[Math.min(state.failures - 1, retryDelays.length - 1)] ?? retryDelays.at(-1)!
            state.nextAttemptAt = Math.min(Date.now() + delay, old?.expiresAt ?? Number.POSITIVE_INFINITY)
            if (old && Date.now() < old.expiresAt) return old
            state.gateway = undefined
            yield* ctx.provider.reload()
            return yield* Effect.fail(unavailable(error))
          }

          state.gateway = result.value
          state.connection = latestCredential
          state.pendingSubject = undefined
          state.failures = 0
          state.nextAttemptAt = result.value.recheckAt
          yield* ctx.provider.reload()
          yield* ctx.integration.connection.status({ integrationID, connection: latestCredential, status: undefined })
          return result.value
        })
      }

      function loadGateway(accessToken: string) {
        return Effect.tryPromise({
          try: () => fetchBootstrap(accessToken, requester),
          catch: (cause) =>
            cause instanceof BootstrapAuthorizationError ||
            cause instanceof BootstrapNetworkError ||
            cause instanceof BootstrapConfigError
              ? cause
              : new BootstrapNetworkError(),
        })
      }
    }),
  } satisfies PluginInternal.InternalPlugin)
}

export const TokenWorksPlugin = createTokenWorksPlugin()
