#!/usr/bin/env node

const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"]

function run(target) {
  const child = childProcess.spawn(target, process.argv.slice(2), { stdio: "inherit" })
  child.on("error", (error) => {
    console.error(error.message)
    process.exit(1)
  })
  const forwarders = {}
  for (const signal of forwardedSignals) {
    forwarders[signal] = () => {
      try {
        child.kill(signal)
      } catch {}
    }
    process.on(signal, forwarders[signal])
  }
  child.on("exit", (code, signal) => {
    for (const forwardedSignal of forwardedSignals) process.removeListener(forwardedSignal, forwarders[forwardedSignal])
    if (signal) return process.kill(process.pid, signal)
    process.exit(typeof code === "number" ? code : 0)
  })
}

const envPath = process.env.USTCODE_BIN_PATH
const scriptDir = path.dirname(fs.realpathSync(__filename))
const cached = path.join(scriptDir, ".ustcode")
const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[os.platform()] || os.platform()
const arch = { x64: "x64", arm64: "arm64", arm: "arm" }[os.arch()] || os.arch()
const base = "@enthusjast/ustcode-cli-" + platform + "-" + arch
const binary = platform === "windows" ? "ustcode.exe" : "ustcode"

const names = [base]

function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules))
      for (const name of names) {
        const candidate = path.join(modules, name, "bin", binary)
        if (fs.existsSync(candidate)) return candidate
      }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

const resolved = envPath || (fs.existsSync(cached) ? cached : findBinary(scriptDir))
if (!resolved) {
  console.error(
    "It seems that your package manager failed to install the right ustcode CLI package. Try manually installing " +
      names.map((name) => `"${name}"`).join(" or ") +
      " package",
  )
  process.exit(1)
}
run(resolved)
