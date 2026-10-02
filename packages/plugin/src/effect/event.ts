import type { EventApi } from "@ustcode-ai/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
