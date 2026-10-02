import { registerCustomTheme } from "@pierre/diffs"
import { USTCodeTheme } from "./marked-theme"

let registered = false

export function registerUSTCodeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("USTCode", () => Promise.resolve(USTCodeTheme))
}
