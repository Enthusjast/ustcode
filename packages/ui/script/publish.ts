#!/usr/bin/env bun

import { Script } from "@ustcode-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { pack } from "./pack"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as { name: string; version: string }
if (Script.dryRun) pkg.version = Script.version
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if (!Script.dryRun && (await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

try {
  await $`bun run typecheck`
  if (!Script.dryRun) await $`bun run test`
  if (Script.dryRun) await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  const packed = await pack()
  if (Script.dryRun) console.log(`dry-run: would publish ${pkg.name}@${pkg.version} from ${packed}`)
  if (!Script.dryRun) await $`npm publish ${tarball} --access public --tag ${Script.channel}`
} finally {
  if (Script.dryRun) await Bun.write("package.json", originalText)
  if (!Script.dryRun) await rm(tarball, { force: true })
}
