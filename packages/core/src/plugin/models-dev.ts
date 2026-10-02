import { define } from "@ustcode-ai/plugin/effect/plugin"
import { Integration } from "@ustcode-ai/schema/integration"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { ModelsDev } from "../models-dev.js"

export const ModelsDevPlugin = define({
  id: "ustcode.models.dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    const bus = yield* Bus.Service
    // Filtering and definition indexes are shared across Locations. Only Model materialization
    // makes mutable copies, after provider configuration and access have been resolved.
    const loaded = { data: snapshots(yield* modelsDev.get()) }
    yield* ctx.integration.transform((integrations) => {
      for (const provider of loaded.data) {
        if (provider.environment.length === 0) continue
        const integrationID = provider.info.id
        integrations.update(integrationID, (integration) => (integration.name = provider.info.name))
        integrations.method.update({
          integrationID,
          method: { type: "key" },
        })
        integrations.method.update({
          integrationID,
          method: {
            type: "env",
            names: [...provider.environment],
          },
        })
      }
    })
    yield* ctx.provider.transform((providers) => {
      for (const provider of loaded.data) {
        providers.add({
          info: { ...provider.info, integrationID: Integration.ID.make(provider.info.id) },
          models: provider.models,
        })
      }
    })
    const apply = (data: readonly ModelsDev.Snapshot[]) => {
      loaded.data = snapshots(data)
      return ctx.integration.reload().pipe(Effect.andThen(ctx.provider.reload()))
    }
    yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() => modelsDev.get().pipe(Effect.flatMap(apply))),
      Effect.forkScoped({ startImmediately: true }),
    )
    // A refresh that landed between the initial read and the subscription above published
    // Refreshed to nobody here. On a cold cache that read served the bundled snapshot, so
    // re-read now instead of waiting for the next TTL refresh.
    const latest = yield* modelsDev.get()
    if (snapshots(latest) !== loaded.data) yield* apply(latest)
  }),
})

const prepared = new WeakMap<readonly ModelsDev.Snapshot[], readonly ModelsDev.Snapshot[]>()

function snapshots(data: readonly ModelsDev.Snapshot[]) {
  const cached = prepared.get(data)
  if (cached) return cached
  const result = data
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.status !== "deprecated"),
    }))
  prepared.set(data, result)
  return result
}
