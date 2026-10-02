#!/usr/bin/env bun

import { Script } from "@ustcode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
const tag = `v${Script.version}`

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

async function prepareReleaseFiles() {
  for (const file of pkgjsons) {
    let pkg = await Bun.file(file).text()
    pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
    console.log("updated:", file)
    await Bun.file(file).write(pkg)
  }

  await $`bun install`
}

if (Script.release && !Script.preview && !Script.dryRun) {
  await $`git fetch origin --tags`
  await $`git switch --detach`
}

if (!Script.dryRun) await prepareReleaseFiles()

if (Script.release && !Script.dryRun) await $`bun ./packages/desktop/scripts/publish.ts --dry-run`

async function publish(script: string) {
  await (Script.dryRun ? $`bun ${script} --dry-run` : $`bun ${script}`)
}

console.log("\n=== schema ===\n")
await publish("./packages/schema/script/publish.ts")

console.log("\n=== codemode ===\n")
await publish("./packages/codemode/script/publish.ts")

console.log("\n=== theme ===\n")
await publish("./packages/theme/script/publish.ts")

console.log("\n=== http-recorder ===\n")
await publish("./packages/http-recorder/script/publish.ts")

console.log("\n=== ai ===\n")
await publish("./packages/ai/script/publish.ts")

console.log("\n=== util ===\n")
await publish("./packages/util/script/publish.ts")

console.log("\n=== protocol ===\n")
await publish("./packages/protocol/script/publish.ts")

console.log("\n=== client ===\n")
await publish("./packages/client/script/publish.ts")

console.log("\n=== cli ===\n")
await publish("./packages/cli/script/publish.ts")

console.log("\n=== plugin ===\n")
await publish("./packages/plugin/script/publish.ts")

console.log("\n=== plugin-browser ===\n")
await publish("./packages/plugin-browser/script/publish.ts")

console.log("\n=== core ===\n")
await publish("./packages/core/script/publish.ts")

console.log("\n=== simulation ===\n")
await publish("./packages/simulation/script/publish.ts")

console.log("\n=== server ===\n")
await publish("./packages/server/script/publish.ts")

console.log("\n=== sdk ===\n")
await publish("./packages/sdk/script/publish.ts")

console.log("\n=== ui ===\n")
await publish("./packages/ui/script/publish.ts")

if (Script.release && !Script.preview && !Script.dryRun) {
  if ((await $`git diff --quiet`.nothrow()).exitCode !== 0) await $`git commit -am "release: ${tag}"`
  await $`git tag -d ${tag}`.nothrow()
  await $`git tag ${tag}`
  await $`git push origin refs/tags/${tag} --force-with-lease --no-verify`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`git fetch origin`
  await $`git checkout -B v2 origin/v2`
  await prepareReleaseFiles()
  if ((await $`git diff --quiet`.nothrow()).exitCode !== 0) {
    await $`git commit -am "sync release versions for ${tag}"`
    await $`git push origin HEAD:v2 --no-verify`
  }
}

if (Script.release && !Script.dryRun) {
  console.log("\n=== desktop ===\n")
  await $`bun ./packages/desktop/scripts/publish.ts`
}
