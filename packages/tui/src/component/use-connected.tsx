import { createMemo } from "solid-js"
import { useSync } from "../context/sync"
import { isUstcProvider } from "../util/provider"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some(
      (provider) =>
        !isUstcProvider(provider.id) || Object.values(provider.models).some((model) => model.cost?.input !== 0),
    ),
  )
}
