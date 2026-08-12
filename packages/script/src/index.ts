import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  USTCODE_CHANNEL: process.env["USTCODE_CHANNEL"],
  USTCODE_BUMP: process.env["USTCODE_BUMP"],
  USTCODE_VERSION: process.env["USTCODE_VERSION"],
  USTCODE_RELEASE: process.env["USTCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.USTCODE_CHANNEL) return env.USTCODE_CHANNEL
  if (env.USTCODE_BUMP) return "latest"
  if (env.USTCODE_VERSION && !env.USTCODE_VERSION.startsWith("0.0.0-")) return "latest"
  // Branch fallback: `main` (or a detached HEAD with no branch) means a stable
  // release; anything else (e.g. `dev`) is a preview build.
  return await $`git branch --show-current`.text().then((x) => {
    const branch = x.trim()
    return branch === "" || branch === "main" ? "latest" : branch
  })
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.USTCODE_VERSION) return env.USTCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  // Bump from the fork's own version rather than tracking upstream releases.
  const ustcodePkgPath = path.resolve(import.meta.dir, "../../ustcode/package.json")
  const ustcodePkg = await Bun.file(ustcodePkgPath).json()
  const [major, minor, patch] = (ustcodePkg.version ?? "0.0.0").split(".").map((x: string) => Number(x) || 0)
  const t = env.USTCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.USTCODE_RELEASE
  },
}
console.log(`ustcode script`, JSON.stringify(Script, null, 2))
