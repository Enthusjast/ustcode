// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { USTCode } from "./client.js"

export * from "./generated/index"
export { USTCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@ustcode-ai/schema/agent"
export { Command } from "@ustcode-ai/schema/command"
export { Config } from "@ustcode-ai/schema/config"
export { Credential } from "@ustcode-ai/schema/credential"
export { Event } from "@ustcode-ai/schema/event"
export { EventLog } from "@ustcode-ai/schema/event-log"
export { FileSystem } from "@ustcode-ai/schema/filesystem"
export { Form } from "@ustcode-ai/schema/form"
export { Integration } from "@ustcode-ai/schema/integration"
export { Location } from "@ustcode-ai/schema/location"
export { Model } from "@ustcode-ai/schema/model"
export { Permission } from "@ustcode-ai/schema/permission"
export { PermissionSaved } from "@ustcode-ai/schema/permission-saved"
export { Project } from "@ustcode-ai/schema/project"
export { Worktree } from "@ustcode-ai/schema/worktree"
export { Vcs } from "@ustcode-ai/schema/vcs"
export { Provider } from "@ustcode-ai/schema/provider"
export { Pty } from "@ustcode-ai/schema/pty"
export { Question } from "@ustcode-ai/schema/question"
export { Reference } from "@ustcode-ai/schema/reference"
export { WebSearch } from "@ustcode-ai/schema/websearch"
export { AbsolutePath, RelativePath } from "@ustcode-ai/schema/schema"
export { Session } from "@ustcode-ai/schema/session"
export { SessionInbox } from "@ustcode-ai/schema/session-inbox"
export { SessionMessage } from "@ustcode-ai/schema/session-message"
export { Skill } from "@ustcode-ai/schema/skill"
export { Prompt } from "@ustcode-ai/schema/prompt"
export { PromptInput } from "@ustcode-ai/schema/prompt-input"
export type { USTCodeEvent } from "@ustcode-ai/protocol/groups/event"
export type USTCodeClient = Effect.Success<ReturnType<typeof USTCode.make>>
