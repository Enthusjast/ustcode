import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogAlert } from "../ui/dialog-alert"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"

type Status = Extract<
  Awaited<ReturnType<ReturnType<typeof useSDK>["client"]["iwan"]["status"]>>["data"],
  { state: string }
>
type Server = NonNullable<Status>["servers"][number]

function finiteNumber(value: number | string | undefined) {
  return typeof value === "number" ? value : undefined
}

export function DialogIwan() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [status, setStatus] = createSignal<Status>()

  createEffect(() => {
    void sdk.client.iwan.status().then((result) => {
      if (!result.data) {
        toast.show({ variant: "error", message: errorText(result.error) })
        return
      }
      if (result.data.state === "disconnected") {
        void sdk.client.iwan.login().then((login) => {
          if (login.data) setStatus(login.data)
          else toast.show({ variant: "error", message: errorText(login.error) })
        })
        return
      }
      setStatus(result.data)
    })
  })

  createEffect(() => {
    const current = status()
    if (!current) return
    if (current.state === "connected") return
    if (current.state === "login" && current.loginURL) {
      dialog.replace(() => <IwanCallback url={current.loginURL!} />)
      return
    }
    if (current.state === "servers" && current.servers.length > 0) {
      dialog.replace(() => <IwanServers servers={current.servers} selected={finiteNumber(current.selected)} />)
      return
    }
    if (current.state === "error") {
      dialog.replace(() => <DialogAlert title="USTC iWAN" message={current.error ?? "iWAN connection failed"} />)
    }
  })

  return (
    <Show when={status()?.state === "connected"} fallback={<DialogAlert title="USTC iWAN" message="Starting iWAN…" />}>
      {(current) => (
        <IwanConnected
          status={status()!}
          onStop={async () => {
            const result = await sdk.client.iwan.stop()
            if (result.error) {
              toast.show({ variant: "error", message: errorText(result.error) })
              return
            }
            toast.show({ variant: "success", message: "USTC iWAN tunnel stopped" })
            dialog.clear()
          }}
        />
      )}
    </Show>
  )
}

function IwanCallback(props: { url: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [busy, setBusy] = createSignal(false)

  return (
    <DialogPrompt
      title="Connect USTC iWAN"
      busy={busy()}
      busyText="Signing in and loading servers…"
      placeholder="Paste the complete redirect URL"
      description={() => (
        <box gap={1}>
          <text>Open this URL in a browser:</text>
          <text fg={theme.textMuted}>{props.url}</text>
          <text>After signing in, paste the redirect URL below.</text>
        </box>
      )}
      onConfirm={(redirect) => {
        if (!redirect.trim()) return
        setBusy(true)
        void sdk.client.iwan.callback({ redirect }).then((result) => {
          setBusy(false)
          if (result.error || !result.data) {
            toast.show({ variant: "error", message: errorText(result.error) })
            return
          }
          dialog.replace(() => (
            <IwanServers servers={result.data.servers} selected={finiteNumber(result.data.selected)} />
          ))
        })
      }}
    />
  )
}

function IwanServers(props: { servers: Server[]; selected?: number }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const options = createMemo<DialogSelectOption<number>[]>(() =>
    props.servers.map((server, index) => ({
      title: server.name,
      value: index,
      description: `${server.host}:${server.port}`,
      disabled: busy(),
    })),
  )

  return (
    <DialogSelect
      title="Select USTC iWAN server"
      options={options()}
      current={props.selected}
      locked={busy()}
      onSelect={(option) => {
        setBusy(true)
        void sdk.client.iwan.connect({ index: option.value }).then((result) => {
          setBusy(false)
          if (result.error || !result.data) {
            toast.show({ variant: "error", message: errorText(result.error) })
            return
          }
          toast.show({
            variant: "success",
            message: `USTC iWAN connected via ${result.data.server?.name ?? "selected server"}`,
          })
          dialog.clear()
        })
      }}
    />
  )
}

function IwanConnected(props: { status: NonNullable<Status>; onStop: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          USTC iWAN connected
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>
        {props.status.server?.name ?? "selected server"} · SOCKS {props.status.proxy?.address}:
        {props.status.proxy?.port}
      </text>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={props.onStop}>
          <text fg={theme.selectedListItemText}>stop tunnel</text>
        </box>
      </box>
    </box>
  )
}

function errorText(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string")
      return data.message
  }
  return error instanceof Error ? error.message : "iWAN request failed"
}
