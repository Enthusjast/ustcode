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
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.USTCODE_VERSION) return env.USTCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${previewBuildNumber()}`
  const version = await fetch("https://registry.npmjs.org/@ustcode-ai%2fcli/latest").then(async (res) => {
    if (!res.ok) return "3.0.0"
    const data: unknown = await res.json()
    if (typeof data !== "object" || data === null || !("version" in data) || typeof data.version !== "string") {
      return "3.0.0"
    }
    return data.version
  })
  if (semver.lt(version, "3.0.0")) return "3.0.0"
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.USTCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

function previewBuildNumber() {
  const runNumber = process.env["GITHUB_RUN_NUMBER"]
  if (!runNumber) return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const runAttempt = process.env["GITHUB_RUN_ATTEMPT"]
  if (runAttempt && runAttempt !== "1") return `${runNumber}.${runAttempt}`
  return runNumber
}

const bot = ["actions-user", "ustcode", "ustcode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get dryRun() {
    return process.argv.includes("--dry-run")
  },
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
  get team() {
    return team
  },
}
console.log(`ustcode script`, JSON.stringify(Script, null, 2))
