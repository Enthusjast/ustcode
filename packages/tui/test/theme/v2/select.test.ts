import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@ustcode-ai/theme/tui"
import { getUSTCodeTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getUSTCodeTheme(), "light")
  const dark = selectTheme(getUSTCodeTheme(), "dark")
  expect(selectTheme(getUSTCodeTheme())).toEqual(light)
  expect(light.hue).toEqual(getUSTCodeTheme().light.hue)
  expect(dark.text).toEqual(getUSTCodeTheme().base.text)
  expect(dark.hue).toEqual(getUSTCodeTheme().dark.hue)
  expect(selectThemeMode(getUSTCodeTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getUSTCodeTheme().base, light: getUSTCodeTheme().light } as const
  const darkOnly = { base: getUSTCodeTheme().base, dark: getUSTCodeTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getUSTCodeTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getUSTCodeTheme(), "dark"), mode: "dark" })
})
