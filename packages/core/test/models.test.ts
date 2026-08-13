import { describe, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@enthusjast/ustcode-core/effect/app-node-builder"
import { Flag } from "@enthusjast/ustcode-core/flag/flag"
import { Global } from "@enthusjast/ustcode-core/global"
import { ModelsDev } from "@enthusjast/ustcode-core/models-dev"
import { it } from "./lib/effect"
import { readFile, rm, writeFile, mkdir } from "fs/promises"
import path from "path"

// Test the local catalog fallback without depending on the process preload's
// configured fixture path. Save and restore the mutation around the suite.
const ORIGINAL_MODELS_PATH = Flag.USTCODE_MODELS_PATH
beforeAll(() => {
  Flag.USTCODE_MODELS_PATH = undefined
})
afterAll(() => {
  Flag.USTCODE_MODELS_PATH = ORIGINAL_MODELS_PATH
})

const cacheFile = path.join(Global.Path.cache, "models.json")

const fixture: Record<string, ModelsDev.Provider> = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const fixture2: Record<string, ModelsDev.Provider> = {
  beta: {
    id: "beta",
    name: "Beta",
    env: ["BETA_API_KEY"],
    models: {
      "beta-1": {
        id: "beta-1",
        name: "Beta One",
        release_date: "2026-02-01",
        attachment: false,
        reasoning: true,
        temperature: false,
        tool_call: false,
        limit: { context: 64000, output: 4096 },
      },
    },
  },
}

const buildLayer = () =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cachedInvalidateWithTTL state from the first run.
  Layer.fresh(AppNodeBuilder.build(ModelsDev.node))

const writeCacheText = (text: string) =>
  Effect.promise(async () => {
    await mkdir(Global.Path.cache, { recursive: true })
    await writeFile(cacheFile, text)
  })

const writeCache = (data: object) => writeCacheText(JSON.stringify(data))

const provided = <A, E>(eff: Effect.Effect<A, E, ModelsDev.Service>) => eff.pipe(Effect.provide(buildLayer()))

beforeEach(async () => {
  await rm(cacheFile, { force: true })
})

afterAll(async () => {
  await rm(cacheFile, { force: true })
})

describe("ModelsDev Service", () => {
  it.live("get() returns providers from disk when cache file exists", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const result = yield* provided(
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixture)
    }),
  )

  it.live("get() returns empty catalog when disk is empty and no bundled snapshot is injected", () =>
    Effect.gen(function* () {
      const result = yield* provided(
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual({})
    }),
  )

  it.live("get() recovers from a corrupted cache file by removing it and returning an empty catalog", () =>
    Effect.gen(function* () {
      yield* writeCacheText("{")
      const result = yield* provided(
        ModelsDev.Service.use((s) => s.get()),
      )
      // This fork is config-driven and never fetches; a corrupt cache file is
      // removed and the catalog falls back to empty.
      expect(result).toEqual({})
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8").then(() => null, () => "removed"))).toBe("removed")
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const results = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
            concurrency: "unbounded",
          })
        }),
      )
      for (const result of results) expect(result).toEqual(fixture)
    }),
  )

  it.live("get() caches across calls (later disk writes are ignored until invalidate)", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const first = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          // mutate disk between calls — cache should mask the change
          yield* writeCache(fixture2)
          const b = yield* svc.get()
          return { a, b }
        }),
      )
      expect(first.a).toEqual(fixture)
      expect(first.b).toEqual(fixture)
    }),
  )

  it.live("refresh invalidates the local catalog", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      const result = yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          yield* writeCache(fixture2)
          yield* svc.refresh(true)
          const after = yield* svc.get()
          return { before, after }
        }),
      )
      expect(result.before).toEqual(fixture)
      expect(result.after).toEqual(fixture2)
    }),
  )

  it.live("refresh(false) also invalidates the local catalog", () =>
    Effect.gen(function* () {
      yield* writeCache(fixture)
      yield* provided(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.get()
          yield* writeCache(fixture2)
          yield* svc.refresh(false)
          expect(yield* svc.get()).toEqual(fixture2)
        }),
      )
    }),
  )
})
