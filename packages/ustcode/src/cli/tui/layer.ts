import { run as runTui, type TuiInput } from "@enthusjast/ustcode-tui"
import { Global } from "@enthusjast/ustcode-core/global"
import { AppNodeBuilder } from "@enthusjast/ustcode-core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
