#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import { Script } from "@enthusjast/ustcode-script"
import pkg from "../package.json"

const ustcModels = await Bun.file(path.join(dir, "models", "ustc.json")).text()

const singleFlag = process.argv.includes("--single")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const treeSitterWorker = await Bun.file(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))).text()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }
      return true
    })
  : allTargets

await $`rm -rf dist`

// Resolve `catalog:` specifiers to the concrete version pinned in the root
// workspace catalog — `bun install <pkg>@catalog:` does not resolve.
const rootPkg = await Bun.file(path.resolve(dir, "../../package.json")).json()
const resolveDep = (name: string, spec: string) =>
  spec === "catalog:" ? (rootPkg.workspaces.catalog as Record<string, string>)[name] : spec

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${resolveDep("@opentui/core", pkg.dependencies["@opentui/core"]!)}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${resolveDep("@parcel/watcher", pkg.dependencies["@parcel/watcher"]!)}`
  await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${resolveDep("@ff-labs/fff-bun", pkg.dependencies["@ff-labs/fff-bun"]!)}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const workerPath = "./src/cli/tui/worker.ts"
  const treeSitterWorkerPath = "opentui-tree-sitter-worker.js"
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/ustcode`,
      execArgv: [`--user-agent=ustcode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      [treeSitterWorkerPath]: treeSitterWorker,
    },
    entrypoints: ["./src/index.ts", workerPath, treeSitterWorkerPath],
    define: {
      FFF_LIBC: JSON.stringify("gnu"),
      USTCODE_VERSION: `'${Script.version}'`,
      USTCODE_MODELS_DEV: ustcModels,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + treeSitterWorkerPath,
      USTCODE_WORKER_PATH: workerPath,
      USTCODE_CHANNEL: `'${Script.channel}'`,
      USTCODE_LIBC: item.os === "linux" ? `'glibc'` : "",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify("glibc") } : {}),
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch) {
    const binaryPath = `dist/${name}/bin/ustcode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    // Flat archive name from the short platform name (e.g. "ustcode-linux-x64.tar.gz")
    // so publish.ts, the console download route, and the release workflow can reference them.
    const shortName = key.split("/").pop() ?? key
    const binDir = path.join(dir, "dist", key, "bin")
    const archive = path.join(dir, "dist", `${shortName}${key.includes("linux") ? ".tar.gz" : ".zip"}`)
    if (key.includes("linux")) {
      await $`tar -czf ${archive} *`.cwd(binDir)
    } else {
      await $`zip -r ${archive} *`.cwd(binDir)
    }
  }
  // Upload the archives to a pre-created GitHub Release. Only when GH_REPO is set
  // (CI release flow); local `USTCODE_RELEASE=1` builds just produce archives.
  if (process.env.GH_REPO) {
    await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
  }
}

export { binaries }
