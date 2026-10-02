// Published separately as @ustcode-ai/pty with platform-specific companion packages.
import { binaryPath } from "@ustcode-ai/pty"

const binding: string | { readonly path: string; readonly version: string; readonly sha256: string } | undefined =
  binaryPath

export default binding
