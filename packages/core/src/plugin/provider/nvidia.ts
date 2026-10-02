import { Effect } from "effect"
import { define } from "@ustcode-ai/plugin/effect/plugin"

export const NvidiaPlugin = define({
  id: "ustcode.provider.nvidia",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@ustcode-ai/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://integrate.api.nvidia.com/v1") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "HTTP-Referer": "https://ustcode.enthusjast.cc/",
            "X-Title": "ustcode",
            "X-BILLING-INVOKE-ORIGIN": provider.headers?.["X-BILLING-INVOKE-ORIGIN"] ?? "USTCode",
          }
        })
      }
    })
  }),
})
