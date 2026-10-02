import { expect, test } from "bun:test"
import { ProviderPlugins } from "@ustcode-ai/core/plugin/provider"

test("default provider plugins keep only the custom package loader", () => {
  expect(ProviderPlugins.map((plugin) => plugin.id)).toEqual(["ustcode.provider.dynamic"])
})
