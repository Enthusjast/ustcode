import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.USTCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.USTCODE_VERSION ?? app.getVersion())

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"

const appNames: Record<string, string> = {
  dev: "USTCode Dev",
  beta: "USTCode Beta",
  prod: "USTCode",
}
const appIDs: Record<string, string> = {
  dev: "ai.ustcode.desktop.dev",
  beta: "ai.ustcode.desktop.beta",
  prod: "ai.ustcode.desktop",
}
// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "USTCode Dev"
export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.ustcode.desktop.dev"
