import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerUstcodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
