import { makeGlobalNode } from "@enthusjast/ustcode-core/effect/app-node"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Iwan } from "./service"

const fetch = Effect.gen(function* () {
  const iwan = yield* Iwan.Service
  const routed = ((input: RequestInfo | URL, init?: RequestInit) =>
    iwan.routeFetch(input, init)) as typeof globalThis.fetch
  routed.preconnect = globalThis.fetch.preconnect
  return routed
})

const layer = FetchHttpClient.layer.pipe(Layer.provide(Layer.effect(FetchHttpClient.Fetch, fetch)))

export const node = makeGlobalNode({ service: HttpClient.HttpClient, layer, deps: [Iwan.node] })

export * as IwanHttp from "./http"
