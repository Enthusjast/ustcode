import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { IwanStatusResponse } from "@enthusjast/ustcode-sdk/v2"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import { DialogIwan } from "../../component/dialog-iwan"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const [iwan, setIwan] = createSignal<IwanStatusResponse>()

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    let active = true
    let pending = false

    const refresh = () => {
      if (!active || pending) return
      pending = true
      void sdk.client.iwan
        .status()
        .then((result) => {
          if (active && result.data) setIwan(result.data)
        })
        .catch(() => {})
        .finally(() => {
          pending = false
        })
    }

    refresh()
    const timer = setInterval(refresh, 3000)
    onCleanup(() => {
      active = false
      clearInterval(timer)
    })
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  const iwanStatus = createMemo(() => {
    const current = iwan()
    if (!current || current.state === "disconnected") return
    if (current.state === "connected") {
      return {
        color: theme.success,
        icon: "●",
        label: `iWAN${current.server?.name ? ` · ${current.server.name}` : ""}`,
      }
    }
    if (current.state === "error") return { color: theme.error, icon: "!", label: "iWAN error" }
    return { color: theme.warning, icon: "◌", label: "iWAN connecting" }
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
        <Show when={iwanStatus()}>
          {(status) => (
            <text fg={theme.text} onMouseUp={() => dialog.replace(() => <DialogIwan />)}>
              <span style={{ fg: status().color }}>{status().icon}</span> {status().label}
            </text>
          )}
        </Show>
      </box>
    </box>
  )
}
