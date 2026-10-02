import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { USTCode, Session } from "../src"

test("Promise host uses the embedded router", async () => {
  await using directory = await tmpdir("ustcode-promise-sdk-")
  const config = join(directory.path, "config")
  await mkdir(config)
  const ustcode = await USTCode.create({
    events: { persist: true },
    config: { directory: config, project: false, content: "{}" },
  })

  try {
    const location = { directory: directory.path }
    const session = await ustcode.sessions.create({ location })
    const selected = await ustcode.sessions.get({ sessionID: session.id })
    const page = await ustcode.sessions.list({ directory: directory.path })
    const events = Array.fromAsync(ustcode.sessions.log({ sessionID: session.id }))

    expect(selected.id).toBe(session.id)
    expect(page.data.some((item) => item.id === session.id)).toBe(true)
    expect((await events).some((event) => event.type === "session.created")).toBe(true)

    const missingSessionID = Session.ID.create()
    const missing = await ustcode.sessions.get({ sessionID: missingSessionID }).catch((error: unknown) => error)
    expect(missing).toMatchObject({ _tag: "SessionNotFoundError", sessionID: missingSessionID })
  } finally {
    await ustcode.close()
    await ustcode.close()
  }
})

test("Promise event streams support cancellation", async () => {
  await using directory = await tmpdir("ustcode-promise-stream-")
  const config = join(directory.path, "config")
  await mkdir(config)
  {
    await using ustcode = await USTCode.create({ config: { directory: config, project: false, content: "{}" } })
    const controller = new AbortController()
    const events = ustcode.events.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    expect(await events.next()).toMatchObject({ value: { type: "server.connected" }, done: false })
    const pending = events.next()
    controller.abort()
    const error = await pending.catch((error: unknown) => error)
    expect(error).toMatchObject({ name: "ClientError", reason: "Transport" })
    await events.return?.()
  }
})

test("closing cancels active Promise event streams", async () => {
  await using directory = await tmpdir("ustcode-promise-stream-close-")
  const config = join(directory.path, "config")
  await mkdir(config)
  const ustcode = await USTCode.create({ config: { directory: config, project: false, content: "{}" } })
  const events = ustcode.events.subscribe()[Symbol.asyncIterator]()
  expect(await events.next()).toMatchObject({ value: { type: "server.connected" }, done: false })
  const pending = events.next()

  await ustcode.close()
  const error = await pending.catch((error: unknown) => error)
  expect(error).toMatchObject({ name: "ClientError", reason: "Transport" })
})
