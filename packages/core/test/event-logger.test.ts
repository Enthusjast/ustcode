import { describe, expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { AppNodeBuilder } from "@ustcode-ai/core/effect/app-node-builder"
import { LayerNode } from "@ustcode-ai/util/effect/layer-node"
import { Database } from "@ustcode-ai/core/database/database"
import { Bus } from "@ustcode-ai/core/bus"
import { EventLogger } from "@ustcode-ai/core/event-logger"
import { Agent } from "@ustcode-ai/schema/agent"
import { Model } from "@ustcode-ai/schema/model"
import { Provider } from "@ustcode-ai/schema/provider"
import { Command } from "@ustcode-ai/schema/command"
import { Config } from "@ustcode-ai/schema/config"
import { McpEvent } from "@ustcode-ai/schema/mcp-event"

const UnlistedUpdated = Bus.ephemeral({ type: "test.updated", schema: {} })

describe("EventLogger", () => {
  test("logs explicitly listed updated events", async () => {
    const output = new Array<ReturnType<typeof Logger.formatStructured.log>>()
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      output.push(entry)
    })

    await Effect.gen(function* () {
      const bus = yield* Bus.Service
      yield* bus.publish(Agent.Event.Updated, {})
      yield* bus.publish(Provider.Event.Updated, {})
      yield* bus.publish(Model.Event.Updated, {})
      yield* bus.publish(Command.Event.Updated, {})
      yield* bus.publish(Config.Event.Updated, {})
      yield* bus.publish(McpEvent.StatusChanged, { server: "example" })
      yield* bus.publish(UnlistedUpdated, {})
    }).pipe(
      Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, EventLogger.node]))),
      Effect.provide(Logger.layer([logger])),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(
      output.flatMap((entry) => (Array.isArray(entry.message) && entry.message[0] === "event" ? [entry.message] : [])),
    ).toEqual([
      ["event", { event: expect.objectContaining({ type: "agent.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "provider.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "model.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "command.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "config.updated" }) }],
    ])
  })
})
