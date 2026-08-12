import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812093718_brave_vargas",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`session_share\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
