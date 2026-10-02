import { describe, expect, test } from "bun:test"
import { hasExistingAppState } from "./install-state"

const file = (name: string) => ({ name, directory: false })
const directory = (name: string) => ({ name, directory: true })

describe("hasExistingAppState", () => {
  test("ignores files Electron may create on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
  })

  test("recognizes state written by an earlier USTCode launch", () => {
    expect(hasExistingAppState([file("ustcode.settings")])).toBe(true)
    expect(hasExistingAppState([file("ustcode.global.dat")])).toBe(true)
    expect(hasExistingAppState([file("drafts.sqlite")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("ustcode")])).toBe(true)
  })
})
