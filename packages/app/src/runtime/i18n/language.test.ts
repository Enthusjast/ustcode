import { describe, expect, test } from "bun:test"
import { localizedListParts, normalizeLocale, richTemplateParts } from "./language"

describe("rich translations", () => {
  test("lets the translated phrase position a rich slot", () => {
    const names = { type: "names" }
    expect(richTemplateParts("Written by {{names}}", { names })).toEqual(["Written by ", names])
    expect(richTemplateParts("{{names}} tarafından yazıldı", { names })).toEqual([names, " tarafından yazıldı"])
  })

  test("keeps list elements intact while localizing punctuation", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(localizedListParts("en", items).filter((part) => typeof part !== "string")).toEqual(items)
  })
})

describe("supported locales", () => {
  test("normalizes persisted simplified Chinese aliases and falls back to English", () => {
    expect(normalizeLocale("en")).toBe("en")
    expect(normalizeLocale("zh")).toBe("zh")
    expect(normalizeLocale("zh-CN")).toBe("zh")
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh")
    expect(normalizeLocale("zh-TW")).toBe("en")
    expect(normalizeLocale("fr")).toBe("en")
  })
})
