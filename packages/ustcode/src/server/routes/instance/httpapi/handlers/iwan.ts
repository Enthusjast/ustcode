import { Iwan } from "@/iwan/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConnectPayload, CompleteLoginPayload, IwanApiError } from "../groups/iwan"

export const iwanHandlers = HttpApiBuilder.group(InstanceHttpApi, "iwan", (handlers) =>
  Effect.gen(function* () {
    const iwan = yield* Iwan.Service
    const mapError = <A>(effect: Effect.Effect<A, Iwan.IwanError>) =>
      effect.pipe(Effect.mapError((error) => new IwanApiError({ name: "IwanError", data: { message: error.message } })))

    const status = Effect.fn("IwanHttpApi.status")(function* () {
      return yield* iwan.status()
    })

    const login = Effect.fn("IwanHttpApi.login")(function* () {
      return yield* mapError(iwan.beginLogin())
    })

    const callback = Effect.fn("IwanHttpApi.callback")(function* (ctx: { payload: typeof CompleteLoginPayload.Type }) {
      return yield* mapError(iwan.completeLogin(ctx.payload.redirect))
    })

    const connect = Effect.fn("IwanHttpApi.connect")(function* (ctx: { payload: typeof ConnectPayload.Type }) {
      return yield* mapError(iwan.connect(ctx.payload.index))
    })

    const stop = Effect.fn("IwanHttpApi.stop")(function* () {
      return yield* mapError(iwan.stop())
    })

    return handlers
      .handle("status", status)
      .handle("login", login)
      .handle("callback", callback)
      .handle("connect", connect)
      .handle("stop", stop)
  }),
)
