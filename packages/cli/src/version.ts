declare const USTCODE_VERSION: string
declare const USTCODE_CHANNEL: string
declare const USTCODE_ARTIFACT: string

const version = typeof USTCODE_VERSION === "string" ? USTCODE_VERSION : "local"
const channel = typeof USTCODE_CHANNEL === "string" ? USTCODE_CHANNEL : "local"
const artifact = typeof USTCODE_ARTIFACT === "string" ? USTCODE_ARTIFACT : "cli"

export { version as USTCODE_VERSION, channel as USTCODE_CHANNEL, artifact as USTCODE_ARTIFACT }
export const USTCODE_LOCAL = channel === "local"
