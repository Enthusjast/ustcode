import type { USTCodeEvent } from "@ustcode-ai/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type USTCodeEventMap = { [Type in USTCodeEvent["type"]]: Extract<USTCodeEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: USTCodeEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends USTCodeEvent["type"]>(
    type: T,
    handler: (event: USTCodeEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory })
    })
  }

  return {
    subscribe,
    on,
  }
}
