export * as ConfigPolicyPlugin from "./policy.js"

import { define } from "@ustcode-ai/plugin/effect/plugin"
import { Document } from "@ustcode-ai/schema/config"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Wildcard } from "../../util/wildcard.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "ustcode.config.policy",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.provider.reload())
    const policies = () => {
      return loaded.entries
        .filter((entry): entry is Document => entry.type === "document")
        .toReversed()
        .flatMap((entry) => entry.info.experimental?.policies ?? [])
        .map((policy) => ({ ...policy, message: "Blocked by configuration policy" }))
    }
    yield* ctx.provider.transform((providers) => {
      const current = policies()
      for (const record of providers.list()) {
        const policy = current.findLast(
          (policy) => policy.action === "provider.use" && Wildcard.match(record.provider.id, policy.resource),
        )
        if (policy?.effect === "deny") providers.remove(record.provider.id)
      }
    })
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        const current = policies()
        const denied = event.resources
          .map((resource) =>
            current.findLast(
              (policy) =>
                policy.action === "permission" && Wildcard.match(`${event.action}:${resource}`, policy.resource),
            ),
          )
          .find((policy) => policy?.effect === "deny")
        if (!denied) return
        event.effect = "deny"
        event.message = denied.message
      }),
    )
  }),
})
