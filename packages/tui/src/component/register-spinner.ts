import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerUSTCodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
