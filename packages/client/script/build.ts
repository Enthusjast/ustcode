import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@ustcode-ai/httpapi-codegen"
import { ClientApi, effectOmitEndpoints, groupNames, promiseOmitEndpoints } from "@ustcode-ai/protocol/client"
import { Agent } from "@ustcode-ai/schema/agent"
import { Command } from "@ustcode-ai/schema/command"
import { Config } from "@ustcode-ai/schema/config"
import { Credential } from "@ustcode-ai/schema/credential"
import { Event } from "@ustcode-ai/schema/event"
import { EventLog } from "@ustcode-ai/schema/event-log"
import { FileDiff } from "@ustcode-ai/schema/file-diff"
import { FileSystem } from "@ustcode-ai/schema/filesystem"
import { Form } from "@ustcode-ai/schema/form"
import { InstructionEntry } from "@ustcode-ai/schema/instruction-entry"
import { Integration } from "@ustcode-ai/schema/integration"
import { Location } from "@ustcode-ai/schema/location"
import { Mcp } from "@ustcode-ai/schema/mcp"
import { Model } from "@ustcode-ai/schema/model"
import { Permission } from "@ustcode-ai/schema/permission"
import { PermissionSaved } from "@ustcode-ai/schema/permission-saved"
import { Plugin } from "@ustcode-ai/schema/plugin"
import { Project } from "@ustcode-ai/schema/project"
import { Worktree } from "@ustcode-ai/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@ustcode-ai/schema/prompt"
import { PromptInput } from "@ustcode-ai/schema/prompt-input"
import { Provider } from "@ustcode-ai/schema/provider"
import { Pty } from "@ustcode-ai/schema/pty"
import { PtyTicket } from "@ustcode-ai/schema/pty-ticket"
import { Question } from "@ustcode-ai/schema/question"
import { Reference } from "@ustcode-ai/schema/reference"
import { AbsolutePath, PositiveInt, RelativePath } from "@ustcode-ai/schema/schema"
import { Session } from "@ustcode-ai/schema/session"
import { SessionMessage } from "@ustcode-ai/schema/session-message"
import { SessionInbox } from "@ustcode-ai/schema/session-inbox"
import { Shell } from "@ustcode-ai/schema/shell"
import { Skill } from "@ustcode-ai/schema/skill"
import { Vcs } from "@ustcode-ai/schema/vcs"
import { WebSearch } from "@ustcode-ai/schema/websearch"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@ustcode-ai/schema/agent", Agent),
  ...namespaceTypes("Command", "@ustcode-ai/schema/command", Command),
  ...namespaceTypes("Config", "@ustcode-ai/schema/config", Config),
  ...namespaceTypes("Credential", "@ustcode-ai/schema/credential", Credential),
  ...namespaceTypes("Event", "@ustcode-ai/schema/event", Event),
  ...namespaceTypes("EventLog", "@ustcode-ai/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@ustcode-ai/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@ustcode-ai/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@ustcode-ai/schema/form", Form),
  ...namespaceTypes("InstructionEntry", "@ustcode-ai/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@ustcode-ai/schema/integration", Integration),
  typeReference("Location.PublicRef", "@ustcode-ai/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@ustcode-ai/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@ustcode-ai/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@ustcode-ai/schema/model", Model),
  ...namespaceTypes("Permission", "@ustcode-ai/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@ustcode-ai/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@ustcode-ai/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@ustcode-ai/schema/project", Project),
  ...namespaceTypes("Worktree", "@ustcode-ai/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@ustcode-ai/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@ustcode-ai/schema/provider", Provider),
  ...namespaceTypes("Pty", "@ustcode-ai/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@ustcode-ai/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@ustcode-ai/schema/question", Question),
  ...namespaceTypes("Reference", "@ustcode-ai/schema/reference", Reference),
  ...namespaceTypes("Session", "@ustcode-ai/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@ustcode-ai/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@ustcode-ai/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@ustcode-ai/schema/shell", Shell),
  ...namespaceTypes("Skill", "@ustcode-ai/schema/skill", Skill),
  ...namespaceTypes("Vcs", "@ustcode-ai/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@ustcode-ai/schema/websearch", WebSearch),
  typeReference("Prompt", "@ustcode-ai/schema/prompt", Prompt),
  typeReference("PromptMention", "@ustcode-ai/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@ustcode-ai/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@ustcode-ai/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@ustcode-ai/schema/schema", AbsolutePath),
  typeReference("PositiveInt", "@ustcode-ai/schema/schema", PositiveInt),
  typeReference("RelativePath", "@ustcode-ai/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "USTCodeEvent",
              import: 'import type { USTCodeEvent } from "@ustcode-ai/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
