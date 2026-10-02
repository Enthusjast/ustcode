import { DynamicProviderPlugin } from "./provider/dynamic.js"
import type { PluginInternal } from "./internal.js"
import { TokenWorksPlugin } from "./provider/tokenworks.js"

// Built-in provider integrations are intentionally not registered here.
// User-defined providers still load their configured runtime package dynamically.
export const ProviderPlugins: PluginInternal.InternalPlugin[] = [DynamicProviderPlugin, TokenWorksPlugin]
