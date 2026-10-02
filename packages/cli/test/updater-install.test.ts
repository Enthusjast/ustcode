import { NodeServices } from "@effect/platform-node"
import { Global } from "@ustcode-ai/util/global"
import { AppProcess } from "@ustcode-ai/util/process"
import { expect, spyOn, test } from "bun:test"
import { Effect, FileSystem, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

declare const USTCODE_CLI_NAME: string | undefined

function fixture(
  respond: (command: ChildProcess.StandardCommand) => Partial<AppProcess.RunResult> & {
    error?: AppProcess.AppProcessError
  } = () => ({}),
  name = "@ustcode-ai/cli",
  failCleanup = false,
  releasePackage = name,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ustcode-updater-" })
    const execPath = process.execPath
    const modules = path.join(root, "node_modules")
    const executable = path.join(modules, "@ustcode", "cli", "bin", "ustcode")
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    yield* fs.writeFileString(
      path.join(modules, "@ustcode", "cli", "package.json"),
      JSON.stringify({ name, bin: { ustcode: "bin/ustcode" } }),
    )
    // The updater uses global fetch; scope this replacement to each install test.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(async () => Response.json({ version: "2.3.4", metadata: { package: releasePackage } }), {
            preconnect: fetch.preconnect,
          }),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const commands: string[][] = []
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        remove: (target, options) =>
          failCleanup && target.startsWith(global.cache)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                }),
              )
            : fs.remove(target, options),
        realPath: (input) => (input === execPath ? Effect.succeed(executable) : fs.realPath(input)),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.suspend(() => {
              if (command._tag !== "StandardCommand") return Effect.die("Unexpected piped install command")
              commands.push([command.command, ...command.args])
              const result = respond(command)
              if (result.error) return Effect.fail(result.error)
              return Effect.succeed({
                command: command.command,
                exitCode: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
                ...result,
              })
            }),
          runStream: () => Stream.die("Unexpected streaming install command"),
        }),
      ),
    )
    return { updater, commands, global, fs, executable }
  })
}

const windows = process.platform === "win32" ? it.live : it.live.skip
const unix = process.platform === "win32" ? it.live.skip : it.live

const installs = [
  { method: "npm", command: ["npm", "install", "--global", "--force", "@ustcode-ai/cli@2.3.4-beta.1"] },
  {
    method: "pnpm",
    command: ["pnpm", "add", "--global", "--allow-build=@ustcode-ai/cli", "@ustcode-ai/cli@2.3.4-beta.1"],
  },
  { method: "yarn", command: ["yarn", "global", "add", "@ustcode-ai/cli@2.3.4-beta.1"] },
  { method: "vp", command: ["vp", "update", "-g", "@ustcode-ai/cli@2.3.4-beta.1"] },
] as const

installs.forEach(({ method, command }) => {
  it.live(`${method} installs the explicit V2 package version without a leading v`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.updater.upgrade(method, "v2.3.4-beta.1")
      expect(test.commands).toEqual([[...command]])
    }),
  )
})

it.live("vp force-installs a renamed V2 package that replaces the existing binary owner", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@ustcode-ai/cli", false, "@ustcode-ai/cli-node")
    yield* test.updater.upgrade("vp", "v2.3.4-beta.1")
    expect(test.commands).toEqual([["vp", "install", "-g", "--force", "@ustcode-ai/cli-node@2.3.4-beta.1"]])
  }),
)

it.live("vp removes the package from its managed global store", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const removal = test.updater.removal("vp")
    if (!removal) return yield* Effect.die("Expected vp removal command")
    expect(removal.command).toEqual(["vp", "uninstall", "-g", "@ustcode-ai/cli"])
    yield* removal.run
    expect(test.commands).toEqual([["vp", "uninstall", "-g", "@ustcode-ai/cli"]])
  }),
)
;[0, 1].forEach((exitCode) => {
  it.live(`bun isolates and removes its install cache after exit ${exitCode}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        expect(command.command).toBe("bun")
        expect(existsSync(command.args[4])).toBe(true)
        return { exitCode, stderr: Buffer.from("bun install failed") }
      })
      const result = yield* test.updater.upgrade("bun", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const cache = test.commands[0]?.[5]
      expect(cache).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["bun", "install", "--global", "--trust", "--cache-dir", cache, "@ustcode-ai/cli@2.3.4-beta.1"],
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(exitCode === 0 ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe("bun install failed")
    }),
  )
})

it.live("bun ignores install cache cleanup failures", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@ustcode-ai/cli", true)
    yield* test.updater.upgrade("bun", "v2.3.4-beta.1")
    expect(test.commands).toHaveLength(1)
  }),
)
;["success", "download", "install"].forEach((failure) => {
  it.live(`curl uses the USTCode installer and cleans its directory: ${failure}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        const installer = command.command === "curl" ? command.args[2] : command.args[0]
        expect(existsSync(path.dirname(installer))).toBe(true)
        return {
          exitCode: command.command === (failure === "download" ? "curl" : failure === "install" ? "bash" : "") ? 1 : 0,
          stderr: Buffer.from(`${failure} failed`),
        }
      })
      const result = yield* test.updater.upgrade("curl", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const installer = test.commands[0]?.[3]
      expect(installer).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["curl", "-fsSL", "-o", installer, "https://ustcode.enthusjast.cc/install"],
        ...(failure === "download" ? [] : [["bash", installer, "--version", "2.3.4-beta.1", "--no-modify-path"]]),
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(failure === "success" ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe(`${failure} failed`)
    }),
  )
})

it.live("invalid version targets never execute a command or create a cache", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* Effect.forEach(Updater.methods, (method) =>
      Effect.forEach(
        ["", "latest", "2.3", "01.2.3", "vv2.3.4", "2.3.4; echo unsafe", "--global", "v2.3.4\n--force"],
        (version) =>
          Effect.gen(function* () {
            const error = yield* test.updater.upgrade(method, version).pipe(Effect.flip)
            expect(error.message).toBe(`Invalid version: ${version}`)
          }),
      ),
    )
    expect(test.commands).toEqual([])
    expect(yield* test.fs.exists(test.global.cache)).toBe(false)
  }),
)

it.live("install failures expose stderr and process errors do not report success", () =>
  Effect.gen(function* () {
    const failed = yield* fixture(() => ({ exitCode: 1, stderr: Buffer.from("  registry denied access\n") }))
    const error = yield* failed.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    const missing = yield* fixture(() => ({ error: new AppProcess.AppProcessError({ command: "npm" }) }))
    const unavailable = yield* missing.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(unavailable.message).toBe("Failed to update with npm")
    expect(failed.commands).toHaveLength(1)
    expect(missing.commands).toHaveLength(1)
  }),
)
;(["npm", "pnpm", "bun", "yarn", "vp", undefined] as const).forEach((method) => {
  it.live(`method detection identifies ${method ?? "an unknown installation"} using the USTCode package`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => ({
        stdout: Buffer.from(
          command.command === method
            ? method === "vp"
              ? JSON.stringify([{ name: "@ustcode-ai/cli", version: "2.3.4" }])
              : "@ustcode-ai/cli@2.3.4"
            : command.command === "vp"
              ? "[]"
              : "@example/cli@1.0.0",
        ),
      }))
      expect(yield* test.updater.method()).toBe(method)
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@ustcode-ai/cli"],
        ["pnpm", "list", "-g", "--depth=0", "@ustcode-ai/cli"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["vp", "list", "-g", "--json", "@ustcode-ai/cli"],
      ])
    }),
  )
})

it.live("method detection tolerates unavailable package managers", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) =>
      command.command === "yarn"
        ? { stdout: Buffer.from("@ustcode-ai/cli@2.3.4") }
        : { error: new AppProcess.AppProcessError({ command: command.command }) },
    )
    expect(yield* test.updater.method()).toBe("yarn")
    expect(test.commands).toHaveLength(5)
  }),
)

it.live("vp detection ignores no-match output that repeats the package name", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) => ({
      stdout: Buffer.from(command.command === "vp" ? "No global packages matching '@ustcode-ai/cli'." : ""),
    }))
    expect(yield* test.updater.method()).toBeUndefined()
  }),
)

// Links are named ustcode-upgrade-<pid>-<random>.exe; read them from inside the installer run.
const links = (directory: string) =>
  existsSync(directory) ? readdirSync(directory).filter((name) => name.startsWith("ustcode-")) : []
const upgradeLinks = (directory: string) =>
  links(directory).filter((name) => name.startsWith(`ustcode-upgrade-${process.pid}-`))

windows("windows keeps a second link to the running binary in the cache while the installer runs", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture(() => {
      expect(readFileSync(layout.executable, "utf8")).toBe("binary")
      const held = upgradeLinks(layout.cache)
      expect(held).toHaveLength(1)
      expect(readFileSync(path.join(layout.cache, held[0]), "utf8")).toBe("binary")
      return {}
    })
    layout.executable = test.executable
    layout.cache = test.global.cache
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    // pid 999999999 does not exist; pid 4 is System, alive but not openable (EPERM).
    yield* test.fs.writeFileString(path.join(test.global.cache, "ustcode-upgrade-999999999-dead.exe"), "exited")
    yield* test.fs.writeFileString(path.join(test.global.cache, "ustcode-service-4-aa.exe"), "inaccessible")
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
    // The installed path never disappears; the extra link is released and only dead ones are swept.
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual(["ustcode-service-4-aa.exe"])
  }),
)

windows("windows releases the link when the installer fails", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.cache)).toHaveLength(1)
      return { exitCode: 1, stderr: Buffer.from("registry denied access") }
    })
    layout.cache = test.global.cache
    const error = yield* test.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual([])
  }),
)

windows("windows keeps the uninstall link in the temporary directory, not the removed cache", () =>
  Effect.gen(function* () {
    const layout = { tmp: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.tmp)).toHaveLength(1)
      return {}
    })
    layout.tmp = test.global.tmp
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    const removal = test.updater.removal("bun")
    if (!removal) return yield* Effect.die("Expected bun removal command")
    yield* removal.run
    expect(test.commands).toEqual([["bun", "remove", "--global", "@ustcode-ai/cli"]])
    expect(links(test.global.cache)).toEqual([])
    expect(links(test.global.tmp)).toEqual([])
  }),
)

windows("windows links the curl binary before the installer replaces it", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture((command) => {
      if (command.command === "bash") {
        expect(readFileSync(layout.executable, "utf8")).toBe("binary")
        expect(upgradeLinks(layout.cache)).toHaveLength(1)
      }
      return {}
    })
    layout.executable = path.join(test.global.home, ".ustcode", "bin", "ustcode.exe")
    layout.cache = test.global.cache
    yield* test.fs.makeDirectory(path.dirname(layout.executable), { recursive: true })
    yield* test.fs.writeFileString(layout.executable, "binary")
    const original = process.execPath
    process.execPath = layout.executable
    yield* Effect.addFinalizer(() => Effect.sync(() => (process.execPath = original)))
    expect(yield* test.updater.method()).toBe("curl")
    yield* test.updater.upgrade("curl", "2.3.4")
    expect(test.commands.map((command) => command[0])).toEqual(["curl", "bash"])
    expect(yield* test.fs.readFileString(layout.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual([])
  }),
)

windows("windows leaves a source checkout's runtime alone", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    }, "not-ustcode")
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
  }),
)

unix("other platforms never link the running binary", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    })
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
  }),
)

test("Node distribution honors the compile-time CLI name", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      import.meta.path,
      "--define",
      'USTCODE_CLI_NAME="ustcode2-node"',
      "--test-name-pattern",
      "^Node distribution resolves the published npm package$",
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "pipe",
      // Bun 1.4 can reuse cached modules compiled with different --define values.
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code, stderr).toBe(0)
  expect(stderr).toContain("1 pass")
})

if (typeof USTCODE_CLI_NAME === "string" && USTCODE_CLI_NAME === "ustcode2-node") {
  it.live("Node distribution resolves the published npm package", () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command) => ({
          stdout: Buffer.from(command.command === "npm" ? "@ustcode-ai/cli-node@2.3.4" : ""),
        }),
        "@ustcode-ai/cli-node",
      )
      expect(yield* test.updater.method()).toBe("npm")
      yield* test.updater.upgrade("npm", "v2.3.4")
      yield* test.updater.upgrade("pnpm", "v2.3.4")
      yield* test.updater.upgrade("vp", "v2.3.4")
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@ustcode-ai/cli-node"],
        ["pnpm", "list", "-g", "--depth=0", "@ustcode-ai/cli-node"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["vp", "list", "-g", "--json", "@ustcode-ai/cli-node"],
        ["npm", "install", "--global", "@ustcode-ai/cli-node@2.3.4"],
        ["pnpm", "add", "--global", "--allow-build=@ustcode-ai/cli-node", "@ustcode-ai/cli-node@2.3.4"],
        ["vp", "update", "-g", "@ustcode-ai/cli-node@2.3.4"],
      ])
    }),
  )
}
