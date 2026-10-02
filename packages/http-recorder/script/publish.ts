#!/usr/bin/env bun

import { Script } from "@ustcode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import { pack, withPackedArchive } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const dryRun = Script.dryRun
const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as { name: string; version: string }
if (dryRun) pkg.version = Script.version

if (!dryRun && (await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

if (dryRun) {
  try {
    await Bun.write("package.json", JSON.stringify(pkg, null, 2))
    const archive = await pack()
    await verifyPackage(archive)
    console.log(`dry-run: would publish ${pkg.name}@${pkg.version} from ${archive}`)
  } finally {
    await Bun.write("package.json", originalText)
  }
}
if (!dryRun)
  await withPackedArchive(async (archive) => {
    await verifyPackage(archive)
    await $`npm publish ${archive} --tag ${Script.channel} --access public`
  })
