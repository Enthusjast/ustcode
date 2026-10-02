import { Plugin, PluginContextProvider, usePlugin } from "@ustcode-ai/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensureRuntimePluginSupport({
  additional: {
    "@ustcode-ai/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
})
