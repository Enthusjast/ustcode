export * as PromiseSdk from "./promise"

import { USTCode, type USTCodeClient } from "@ustcode-ai/client"
import type { Plugin } from "@ustcode-ai/plugin"
import { Session } from "@ustcode-ai/schema/session"
import { Effect, Schema } from "effect"
import { EmbeddedHost } from "./internal/host"

export interface InstanceConfiguration {
  readonly plugins: ReadonlyArray<Plugin.Plugin>
}

export interface InstanceOptions {
  /** Select a sharing key within the Session's current Location. Must not initialize plugins. */
  readonly key: (session: typeof Session.Info.Encoded) => string
  /** Reconstruct configuration on a cache miss, including after a host restart. */
  readonly configure: (key: string) => InstanceConfiguration | Promise<InstanceConfiguration>
}

export interface CreateOptions extends Omit<EmbeddedHost.CreateOptions, "workspaceProviders" | "instances"> {
  readonly plugins?: ReadonlyArray<Plugin.Plugin>
  readonly instances?: InstanceOptions
}

export type Interface = Omit<USTCodeClient, "plugin"> & {
  readonly sessions: USTCodeClient["session"]
  readonly events: USTCodeClient["event"]
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & USTCodeClient["plugin"]
  readonly close: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export async function create(options: CreateOptions = {}, embed: EmbeddedHost.EmbedOptions = {}): Promise<Interface> {
  const { plugins, instances, ...hostOptions } = options
  const host = await Effect.runPromise(
    EmbeddedHost.create(
      {
        ...hostOptions,
        instances: instances
          ? {
              key: (session) => instances.key(Schema.encodeSync(Session.Info)(session)),
              configure: (key) =>
                Effect.gen(function* () {
                  const { PluginPromise } = yield* Effect.promise(() => import("@ustcode-ai/core/plugin/promise"))
                  const configuration = yield* Effect.tryPromise(async () => instances.configure(key))
                  return { plugins: configuration.plugins.map(PluginPromise.fromPromise) }
                }),
            }
          : undefined,
      },
      embed,
    ),
  )
  const client = USTCode.make({ baseUrl: "http://ustcode.local", fetch: host.fetch })
  const register = async (plugin: Plugin.Plugin) => {
    const { PluginPromise } = await import("@ustcode-ai/core/plugin/promise")
    return host.runtime.runPromise(host.plugins.register(PluginPromise.fromPromise(plugin)))
  }
  for (const plugin of plugins ?? []) await register(plugin)

  return {
    ...client,
    sessions: client.session,
    events: client.event,
    plugin: Object.assign(register, client.plugin),
    close: host.close,
    [Symbol.asyncDispose]: host.close,
  }
}
