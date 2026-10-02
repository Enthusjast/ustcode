export * as ProviderAuth from "./provider-auth.js"

import { Context, Effect, Layer } from "effect"
import { Credential } from "@ustcode-ai/schema/credential"
import { Provider } from "@ustcode-ai/schema/provider"
import { makeLocationNode } from "@ustcode-ai/util/effect/app-node"
import { Integration } from "./integration.js"

export type Error = Integration.AuthorizationError
export type Resolver = () => Effect.Effect<Credential.Key, Error>

export interface Interface {
  readonly register: (providerID: Provider.ID, resolve: Resolver) => Effect.Effect<() => void>
  readonly get: (providerID: Provider.ID) => Effect.Effect<Resolver | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@ustcode-ai/ProviderAuth") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const resolvers = new Map<Provider.ID, Resolver>()
    return Service.of({
      register: Effect.fn("ProviderAuth.register")((providerID, resolve) =>
        Effect.sync(() => {
          resolvers.set(providerID, resolve)
          return () => {
            if (resolvers.get(providerID) === resolve) resolvers.delete(providerID)
          }
        }),
      ),
      get: Effect.fn("ProviderAuth.get")((providerID) => Effect.sync(() => resolvers.get(providerID))),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
