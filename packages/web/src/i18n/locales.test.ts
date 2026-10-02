import { describe, expect, test } from "bun:test"
import { docsLocale, exactLocale, locale, matchLocale } from "./locales"

describe("documentation locales", () => {
  test("exposes only English and Simplified Chinese", () => {
    expect(docsLocale).toEqual(["zh-cn"])
    expect(locale).toEqual(["root", "zh-cn"])
  })

  test("matches English and Simplified Chinese language tags", () => {
    expect(exactLocale("en")).toBe("root")
    expect(exactLocale("zh-CN")).toBe("zh-cn")
    expect(exactLocale("zh-Hans")).toBe("zh-cn")
    expect(matchLocale("en-US")).toBe("root")
    expect(matchLocale("zh")).toBe("zh-cn")
    expect(matchLocale("zh-SG")).toBe("zh-cn")
  })

  test("does not route unsupported languages to a translated locale", () => {
    expect(exactLocale("fr")).toBeNull()
    expect(exactLocale("zh-TW")).toBeNull()
    expect(matchLocale("fr-FR")).toBeNull()
    expect(matchLocale("zh-TW")).toBeNull()
    expect(matchLocale("zh-Hant-HK")).toBeNull()
  })
})
