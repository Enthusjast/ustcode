#!/usr/bin/env bun

import { Script } from "@ustcode-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import pkg from "../package.json"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const version = Script.dryRun ? Script.version : pkg.version
if (!Script.dryRun && (await $`npm view ${pkg.name}@${version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

await $`bun run typecheck`
await $`bun run build`
const original = await Bun.file("package.json").text()
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${version}.tgz`
try {
  await Bun.write(
    "package.json",
    JSON.stringify(
      {
        ...pkg,
        version,
        exports: Object.fromEntries(
          Object.entries(pkg.exports).map(([name, value]) => [
            name,
            {
              import: value.replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
              types: value.replace("./src/", "./dist/").replace(/\.ts$/, ".d.ts"),
            },
          ]),
        ),
      },
      null,
      2,
    ) + "\n",
  )
  await rm(tarball, { force: true })
  await $`bun pm pack`
  if (Script.dryRun) console.log(`dry-run: would publish ${pkg.name}@${version} from ${tarball}`)
  if (!Script.dryRun) await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", original)
  if (!Script.dryRun) await rm(tarball, { force: true })
}
