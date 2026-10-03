import { expect, test } from "bun:test"
import { statSync } from "node:fs"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/ustcode-desktop.desktop"
// Use electron-builder's matcher so the tests also cover its glob and directory traversal semantics.
const { FileMatcher } = createRequire(import.meta.resolve("electron-builder"))("app-builder-lib/out/fileMatcher")

const channels = [
  { channel: "dev", appId: "ai.ustcode.desktop.dev" },
  { channel: "beta", appId: "ai.ustcode.desktop.beta" },
  { channel: "prod", appId: "ai.ustcode.desktop" },
] as const

test("signs the macOS app without signing the DMG", async () => {
  const config = (await import("./electron-builder.config.ts?mac-signing")).default as Configuration
  expect(config.mac?.sign).toBeFunction()
  expect(config.dmg?.sign).not.toBe(true)
})

test("skips macOS signing and notarization for unsigned release builds", async () => {
  const previous = process.env.USTCODE_MACOS_UNSIGNED
  process.env.USTCODE_MACOS_UNSIGNED = "true"
  try {
    const config = (await import("./electron-builder.config.ts?mac-unsigned")).default as Configuration
    expect(config.mac?.identity).toBeNull()
    expect(config.mac?.notarize).toBe(false)
    expect(config.mac?.sign).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.USTCODE_MACOS_UNSIGNED
    else process.env.USTCODE_MACOS_UNSIGNED = previous
  }
})

for (const channel of channels) {
  test(`disables security code AutoFill by default for ${channel.channel}`, async () => {
    const previous = process.env.USTCODE_CHANNEL
    process.env.USTCODE_CHANNEL = channel.channel
    try {
      const config = (await import(`./electron-builder.config.ts?autofill=${channel.channel}`)).default as Configuration
      expect(config.mac?.extendInfo?.NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.USTCODE_CHANNEL
      else process.env.USTCODE_CHANNEL = previous
    }
  })

  test(`includes the Windows sandbox permission hook for ${channel.channel}`, async () => {
    const previous = process.env.USTCODE_CHANNEL
    process.env.USTCODE_CHANNEL = channel.channel
    try {
      const config = (await import(`./electron-builder.config.ts?channel=${channel.channel}`)).default as Configuration
      const include = path.join(import.meta.dirname, "resources/windows/installer.nsh")
      expect(config.nsis?.include).toBe(include)
      expect(await Bun.file(include).exists()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.USTCODE_CHANNEL
      else process.env.USTCODE_CHANNEL = previous
    }
  })

  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.USTCODE_CHANNEL
    process.env.USTCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.USTCODE_CHANNEL
    else process.env.USTCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })

  test(`trims external dependencies without excluding runtime files for ${channel.channel}`, async () => {
    const config = (await import(`./electron-builder.config.ts?channel=${channel.channel}`)).default as Configuration
    const filter = new FileMatcher(import.meta.dirname, "", (value: string) => value, [
      "**/*",
      ...(Array.isArray(config.files) ? config.files : []).filter(
        (value): value is string => typeof value === "string" && value.startsWith("!"),
      ),
    ]).createFilter()
    for (const prefix of ["node_modules/", "node_modules/parent/node_modules/"]) {
      for (const file of [
        "@zip.js/zip.js/dist/zip.js",
        "@zip.js/zip.js/dist/z-worker.js",
        "@zip.js/zip.js/index.cjs",
        "@zip.js/zip.js/index.min.js",
        "@zip.js/zip.js/index-fflate.js",
        "@zip.js/zip.js/deno.json",
        "@zip.js/zip.js/eslint.config.mjs",
        "electron-updater/out/main.js.map",
        "electron-updater/out/providers/GitHubProvider.js.map",
        "builder-util-runtime/out/httpExecutor.js.map",
        "lazy-val/out/main.js.map",
        "ajv/lib/core.ts",
        "ajv/dist/compile/index.js.map",
        "ajv-formats/src/formats.ts",
        "ajv-formats/dist/formats.js.map",
        "js-yaml/dist/js-yaml.js",
        "js-yaml/dist/js-yaml.min.js",
        "js-yaml/dist/js-yaml.mjs.map",
        "js-yaml/bin/js-yaml.js",
        "unrelated/dist/index.js.map",
        "unrelated/dist/index.cjs.map",
        "unrelated/dist/index.d.ts",
        "unrelated/dist/index.d.cts",
        "unrelated/dist/index.d.ts.map",
      ]) {
        expect(filter(path.join(import.meta.dirname, prefix, file), statSync(import.meta.filename))).toBe(false)
      }
      for (const file of [
        "@zip.js/zip.js/index.js",
        "@zip.js/zip.js/lib/zip-fs.js",
        "@zip.js/zip.js/lib/z-worker-inline.js",
        "@zip.js/zip.js/lib/core/streams/codecs/deflate.js",
        "electron-updater/out/main.js",
        "electron-updater/out/MacUpdater.js",
        "electron-updater/out/NsisUpdater.js",
        "electron-updater/out/providers/GitHubProvider.js",
        "builder-util-runtime/out/httpExecutor.js",
        "lazy-val/out/main.js",
        "ajv/dist/ajv.js",
        "ajv/dist/refs/json-schema-draft-07.json",
        "ajv-formats/dist/formats.js",
        "js-yaml/index.js",
        "js-yaml/lib/loader.js",
        "js-yaml/dist/js-yaml.mjs",
        "debug/src/index.js",
        "unrelated/dist/index.js",
        "unrelated/dist/index.cjs",
        "unrelated/dist/data.json",
        "unrelated/src/index.ts",
        ...["@zip.js/zip.js", "electron-updater", "builder-util-runtime", "ajv", "ajv-formats", "js-yaml"].flatMap(
          (name) => [`${name}/package.json`, `${name}/LICENSE`],
        ),
      ]) {
        expect(filter(path.join(import.meta.dirname, prefix, file), statSync(import.meta.filename))).toBe(true)
      }
      expect(filter(path.join(import.meta.dirname, prefix, "@zip.js/zip.js/dist"), statSync(import.meta.dirname))).toBe(
        false,
      )
      expect(filter(path.join(import.meta.dirname, prefix, "@zip.js/zip.js/lib"), statSync(import.meta.dirname))).toBe(
        true,
      )
    }
  })
}

test("the trimmed Zip.js package can still export compressed logs", async () => {
  const config = (await import("./electron-builder.config.ts")).default
  const dir = await mkdtemp(path.join(os.tmpdir(), "ustcode-zip-package-"))
  const source = path.dirname(fileURLToPath(import.meta.resolve("@zip.js/zip.js/package.json")))
  const filter = new FileMatcher(dir, "", (value: string) => value, [
    "**/*",
    ...(Array.isArray(config.files) ? config.files : []).filter(
      (value): value is string => typeof value === "string" && value.startsWith("!"),
    ),
  ]).createFilter()
  try {
    await cp(source, dir, {
      recursive: true,
      filter: (file) =>
        filter(path.join(dir, "node_modules/@zip.js/zip.js", path.relative(source, file)), statSync(file)),
    })
    const zip = await import(pathToFileURL(path.join(dir, "index.js")).href)
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
    await writer.add("desktop.log", new zip.BlobReader(new Blob(["diagnostic log\n".repeat(100)])))
    const reader = new zip.ZipReader(new zip.BlobReader(await writer.close()))
    const entries = await reader.getEntries()
    expect(entries.map((entry: { filename: string }) => entry.filename)).toEqual(["desktop.log"])
    expect(entries[0].compressionMethod).toBe(8)
    expect(await entries[0].getData(new zip.TextWriter())).toBe("diagnostic log\n".repeat(100))
    await reader.close()
    await zip.terminateWorkers()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.USTCODE_CHANNEL
  process.env.USTCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.USTCODE_CHANNEL
  else process.env.USTCODE_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("ustcode-desktop.desktop=/usr/share/applications/ustcode-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("ustcode-desktop.desktop=/usr/share/applications/ustcode-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/ustcode/ai.ustcode.desktop %U")
  expect(desktop).toContain("Icon=ai.ustcode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.ustcode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

for (const channel of ["dev", "beta"] as const) {
  test(`bundles the CLI outside the ${channel} app archive`, async () => {
    const previous = process.env.USTCODE_CHANNEL
    process.env.USTCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.USTCODE_CHANNEL
    else process.env.USTCODE_CHANNEL = previous

    expect(config.files).toContain("!resources/ustcode-cli*")
    expect(config.extraResources).toEqual([
      {
        from: "resources/",
        to: "",
        filter: ["ustcode-cli", "ustcode-cli.exe", "ustcode-cli.version"],
      },
    ])
  })
}
