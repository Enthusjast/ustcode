import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.USTCODE_PASSWORD
  const previousLegacyPassword = process.env.USTCODE_SERVER_PASSWORD
  const previousValue = process.env.USTCODE_SESSION_ENV_TEST
  process.env.USTCODE_PASSWORD = "password"
  process.env.USTCODE_SERVER_PASSWORD = "legacy"
  process.env.USTCODE_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.USTCODE_PASSWORD
  else process.env.USTCODE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.USTCODE_SERVER_PASSWORD
  else process.env.USTCODE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.USTCODE_SESSION_ENV_TEST
  else process.env.USTCODE_SESSION_ENV_TEST = previousValue

  expect(environment.USTCODE_PASSWORD).toBeUndefined()
  expect(environment.USTCODE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.USTCODE_SESSION_ENV_TEST).toBe("included")
})
