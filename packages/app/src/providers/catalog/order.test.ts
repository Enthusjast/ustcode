import { expect, test } from "bun:test"
import { popularProviders } from "./order"

test("lists the supported popular providers in a stable order", () => {
  expect(popularProviders.slice(0, 3)).toEqual(["anthropic", "github-copilot", "openai"])
  expect(popularProviders).toContain("ustc-tokenworks")
})
