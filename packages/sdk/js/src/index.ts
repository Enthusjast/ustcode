export * from "./client.js"
export * from "./server.js"

import { createUstcodeClient } from "./client.js"
import { createUstcodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createUstcode(options?: ServerOptions) {
  const server = await createUstcodeServer({
    ...options,
  })

  const client = createUstcodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
