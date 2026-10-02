import { Bus } from "@ustcode-ai/core/bus"
import { Image } from "@ustcode-ai/core/image"
import { LocationServiceMap } from "@ustcode-ai/core/location-service-map"
import type { LocationServices } from "@ustcode-ai/core/location-services"
import { Plugin } from "@ustcode-ai/core/plugin"
import { PluginHooks } from "@ustcode-ai/core/plugin/hooks"
import { Skill } from "@ustcode-ai/core/skill"
import type { Location } from "@ustcode-ai/schema/location"
import { makeGlobalNode } from "@ustcode-ai/util/effect/app-node"
import { LayerNode } from "@ustcode-ai/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as Layer.Layer<LocationServices>,
      )
    }),
  ),
  deps: [Bus.node],
})
