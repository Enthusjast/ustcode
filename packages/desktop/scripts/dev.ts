import { $ } from "bun"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { prepareDevElectron } from "./dev-electron"
import { downloadCliToResources, windowsify } from "./utils"

type ServerSource = { type: "build" } | { type: "download"; version: string }
type DevOptions = { server: ServerSource; electron: string[] }

async function main() {
  process.env.USTCODE_CHANNEL = "local"
  process.env.USTCODE_VERSION = `2.0.0-local-${Date.now()}`
  process.env.USTCODE_DISABLE_CHANNEL_DB = "0"
  const options = selectOptions()
  if (options.server.type === "build") process.env.USTCODE_DESKTOP_SERVER_CHANNEL = "local"
  process.env.USTCODE_DESKTOP_ISOLATED_SERVER = "1"
  await prepareDesktop()
  await prepareServer(options.server)
  await startDesktop(options.electron)
}

async function prepareDesktop() {
  await Promise.all([
    $`bun run install-electron`,
    $`bun ./scripts/copy-icons.ts ${process.env.USTCODE_CHANNEL ?? "dev"}`,
  ])
  if (process.platform === "darwin") process.env.ELECTRON_EXEC_PATH = await prepareDevElectron()
}

function selectOptions(): DevOptions {
  const args = process.argv.slice(2)
  const build = args.indexOf("--build-server")
  const download = args.indexOf("--download-server")
  if (build >= 0 && download >= 0) {
    throw new Error("--build-server and --download-server cannot be used together")
  }
  if (download >= 0 && !args[download + 1]) throw new Error("--download-server requires a version")
  const consumed = new Set([build, download, download >= 0 ? download + 1 : -1])
  return {
    server: download >= 0 ? { type: "download", version: args[download + 1] } : { type: "build" },
    electron: args.filter((_, index) => !consumed.has(index)),
  }
}

async function prepareServer(source: ServerSource) {
  if (source.type === "download")
    return downloadCliToResources(source.version, windowsify("resources/ustcode-cli-dev"))
  await $`bun run --cwd ${join(import.meta.dirname, "../../app")} build`.env({
    ...process.env,
    VITE_USTCODE_SERVER_MODE: "origin",
  })
  process.env.USTCODE_DESKTOP_CLI_DEV = join(import.meta.dirname, "../../cli")
  await $`bun run --cwd ${process.env.USTCODE_DESKTOP_CLI_DEV} --define=USTCODE_VERSION=${JSON.stringify(process.env.USTCODE_VERSION)} src/index.ts --version`
  if (process.platform !== "win32") return
  process.env.USTCODE_DESKTOP_WSL_CLI_BUILD = join(import.meta.dirname, "../../cli/script/build.ts")
  process.env.USTCODE_DESKTOP_WSL_CLI_OUTPUT = join(import.meta.dirname, "../resources/ustcode-cli-wsl")
}

async function startDesktop(args: string[]) {
  // Bun's implicit spawn environment omits values set during preparation.
  process.exitCode = await Bun.spawn(
    ["node", fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))), "dev", ...args],
    { env: process.env, stdio: ["inherit", "inherit", "inherit"] },
  ).exited
}

await main()
