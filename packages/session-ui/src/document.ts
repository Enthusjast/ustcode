import type { FileDiffInfo, SessionMessageInfo, SessionStatus } from "@ustcode-ai/client/promise"

export type SessionDocument = {
  sessionID: string
  messages: SessionMessageInfo[]
  status: SessionStatus
  diffs: FileDiffInfo[]
}
