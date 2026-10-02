import type { EventApi } from "@ustcode-ai/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
