/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Renderable, TextRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { ArgsProvider } from "../../../src/context/args"
import { KVProvider } from "../../../src/context/kv"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { RouteProvider } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { ExitProvider } from "../../../src/context/exit"
import { TuiConfigProvider } from "../../../src/config"
import { UstcodeKeymapProvider, registerUstcodeKeymap } from "../../../src/keymap"
import { useDialog, DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { Footer } from "../../../src/routes/session/footer"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { tmpdir } from "../../fixture/fixture"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mount(status: object) {
  const root = await tmpdir()
  const state = path.join(root.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  let iwanRequests = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/iwan") {
      iwanRequests += 1
      return json(status)
    }
    if (url.pathname === "/project/directories") return json([])
  })
  const events = createEventSource()
  let dialog!: ReturnType<typeof useDialog>

  function Probe() {
    dialog = useDialog()
    return (
      <box width="100%" height={3}>
        <Footer />
      </box>
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig()
    const off = registerUstcodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={root.path}
        paths={{
          home: root.path,
          state,
          worktree: root.path,
        }}
      >
        <UstcodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ArgsProvider>
              <KVProvider>
                <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                  <PermissionProvider>
                    <ProjectProvider>
                      <ExitProvider exit={() => {}}>
                        <SyncProvider>
                          <RouteProvider initialRoute={{ type: "session", sessionID: "session_test" }}>
                            <ThemeProvider mode="dark">
                              <ToastProvider>
                                <DialogProvider>
                                  <Probe />
                                </DialogProvider>
                              </ToastProvider>
                            </ThemeProvider>
                          </RouteProvider>
                        </SyncProvider>
                      </ExitProvider>
                    </ProjectProvider>
                  </PermissionProvider>
                </SDKProvider>
              </KVProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </UstcodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 20 })
  await app.renderOnce()
  return {
    app,
    dialog: () => dialog,
    requests: () => iwanRequests,
    async cleanup() {
      app.renderer.destroy()
      await root[Symbol.asyncDispose]()
    },
  }
}

function findText(root: Renderable, value: string): TextRenderable | undefined {
  for (const child of root.getChildren()) {
    if (child instanceof TextRenderable && child.plainText.includes(value)) return child
    const found = findText(child, value)
    if (found) return found
  }
}

test("footer shows connected iWAN status and opens its panel", async () => {
  const footer = await mount({
    state: "connected",
    servers: [],
    server: { name: "USTC", host: "127.0.0.1", port: 443 },
    proxy: { address: "127.0.0.1", port: 1080, flows: 0 },
  })

  try {
    await wait(() => footer.requests() > 0)
    await wait(async () => {
      await footer.app.renderOnce()
      return footer.app.captureCharFrame().includes("iWAN · USTC")
    })
    const status = findText(footer.app.renderer.root, "iWAN · USTC")
    if (!status) throw new Error("iWAN status text was not rendered")

    let opened = false
    footer.dialog().replace = () => {
      opened = true
    }
    await footer.app.mockMouse.click(status.screenX + 1, status.screenY)
    expect(opened).toBe(true)
  } finally {
    await footer.cleanup()
  }
})

test("footer hides disconnected iWAN status", async () => {
  const footer = await mount({ state: "disconnected", servers: [] })

  try {
    await wait(() => footer.requests() > 0)
    await footer.app.renderOnce()
    expect(footer.app.captureCharFrame()).not.toContain("iWAN")
  } finally {
    await footer.cleanup()
  }
})
