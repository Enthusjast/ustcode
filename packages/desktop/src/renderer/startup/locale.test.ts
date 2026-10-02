import { describe, expect, test } from "bun:test"
import { storedLocaleValue } from "./locale-value"

describe("desktop stored locale", () => {
  test("extracts the current locale field", () => {
    expect(storedLocaleValue('{"locale":"en"}')).toBe("en")
    expect(storedLocaleValue('{"other":true,"locale" : "zh"}')).toBe("zh")
  })

  test("ignores missing locale data", () => {
    expect(storedLocaleValue(null)).toBeUndefined()
    expect(storedLocaleValue("{}")).toBeUndefined()
  })
})
