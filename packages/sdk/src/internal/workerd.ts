export * as WorkerdProfile from "./workerd"

import type { Config } from "@ustcode-ai/schema/config"
import { ServerWorkerd } from "@ustcode-ai/server/workerd"

export type Configuration = Omit<typeof Config.Info.Encoded, "plugins">

export interface Options extends Omit<ServerWorkerd.Options, "password" | "config"> {
  readonly config?: Configuration
}

export function make({ config, ...options }: Options) {
  const server = {
    ...options,
    config: config === undefined ? undefined : { content: JSON.stringify(config) },
  }
  return {
    options: ServerWorkerd.serverOptions(server),
    replacements: ServerWorkerd.replacements(server),
  }
}
