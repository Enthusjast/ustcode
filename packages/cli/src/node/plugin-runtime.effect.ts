import {
  Agent,
  Command,
  Connection,
  Credential,
  Integration,
  Model,
  Plugin,
  Provider,
  Reference,
  Skill,
} from "@ustcode-ai/plugin/effect"
import { Tool } from "@ustcode-ai/schema/tool"

const key = Symbol.for("ustcode.plugin.v2.effect")
;(globalThis as typeof globalThis & { [key]?: unknown })[key] = {
  Agent,
  Command,
  Connection,
  Credential,
  Integration,
  Model,
  Plugin,
  Provider,
  Reference,
  Skill,
  Tool: { Error: Tool.Error },
}
