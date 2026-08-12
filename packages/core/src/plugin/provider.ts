import { DynamicProviderPlugin } from "./provider/dynamic"
import { GatewayPlugin } from "./provider/gateway"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  DynamicProviderPlugin,
  GatewayPlugin,
  OpenAICompatiblePlugin,
]
