import path from "node:path"
import { USTCODE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.USTCODE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(USTCODE_CHANNEL) ||
    process.env.USTCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.USTCODE_DISABLE_CHANNEL_DB === "true"
      ? "ustcode.db"
      : `ustcode-${USTCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
