import { Effect } from "effect"
import { define } from "@ustcode-ai/plugin/effect/plugin"

export const CerebrasPlugin = define({
  id: "ustcode.provider.cerebras",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@ustcode-ai/ai/providers/cerebras") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "X-Cerebras-3rd-Party-Integration": "ustcode" }
        })
      }
    })
  }),
})
