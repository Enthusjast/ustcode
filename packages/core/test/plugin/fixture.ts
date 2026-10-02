import { Agent } from "@ustcode-ai/core/agent"
import { AISDK } from "@ustcode-ai/core/aisdk"
import { Command } from "@ustcode-ai/core/command"
import { Config } from "@ustcode-ai/core/config"
import { Credential } from "@ustcode-ai/core/credential"
import { LayerNodePlatform } from "@ustcode-ai/util/effect/app-node-platform"
import { AppProcess } from "@ustcode-ai/util/process"
import { LayerNode } from "@ustcode-ai/util/effect/layer-node"
import { Bus } from "@ustcode-ai/core/bus"
import { FileSystem } from "@ustcode-ai/core/filesystem"
import { FSUtil } from "@ustcode-ai/util/fs-util"
import { Form } from "@ustcode-ai/core/form"
import { Generate } from "@ustcode-ai/core/generate"
import { Integration } from "@ustcode-ai/core/integration"
import { KV } from "@ustcode-ai/core/kv"
import { Location } from "@ustcode-ai/core/location"
import { Mcp } from "@ustcode-ai/core/mcp/index"
import { Model } from "@ustcode-ai/core/model"
import { Npm } from "@ustcode-ai/util/npm"
import { Plugin } from "@ustcode-ai/core/plugin"
import { PluginHooks } from "@ustcode-ai/core/plugin/hooks"
import { Provider } from "@ustcode-ai/core/provider"
import { ProviderAuth } from "@ustcode-ai/core/provider-auth"
import { Session } from "@ustcode-ai/core/session"
import { PersistentPty } from "@ustcode-ai/core/persistent-pty"
import { LocationServiceMap } from "@ustcode-ai/core/location-service-map"
import { AppNodeBuilder } from "@ustcode-ai/core/effect/app-node-builder"
import { Permission } from "@ustcode-ai/core/permission"
import { Reference } from "@ustcode-ai/core/reference"
import { Rpc } from "@ustcode-ai/core/rpc"
import { Skill } from "@ustcode-ai/core/skill"
import { SkillDiscovery } from "@ustcode-ai/core/skill/discovery"
import { Watcher } from "@ustcode-ai/core/filesystem/watcher"
import { Tool } from "@ustcode-ai/core/tool"
import { Vcs } from "@ustcode-ai/core/vcs"
import { WebSearch } from "@ustcode-ai/core/websearch"
import { Worktree } from "@ustcode-ai/core/worktree"
import { WorktreeStrategies } from "@ustcode-ai/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(Generate.Service, Generate.Service.of({ text: () => Effect.succeed("") }))

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    AppProcess.node,
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    Bus.node,
    Form.node,
    Generate.node,
    LayerNodePlatform.httpClient,
    Plugin.node,
    Agent.node,
    AISDK.node,
    Provider.node,
    ProviderAuth.node,
    Model.node,
    Command.node,
    Integration.node,
    KV.node,
    Mcp.node,
    Session.node,
    PersistentPty.node,
    LocationServiceMap.node,
    Permission.node,
    PluginHooks.node,
    Reference.node,
    Rpc.node,
    Skill.node,
    SkillDiscovery.node,
    Tool.node,
    Vcs.node,
    Watcher.node,
    WebSearch.node,
    Worktree.node,
    WorktreeStrategies.node,
  ]),
  [
    Location.node.replace(tempLocationLayer),
    Npm.node.replace(npmLayer),
    Config.node.replace(Config.testLayer()),
    Mcp.node.replace(emptyMcpLayer),
    Generate.node.replace(generateLayer),
    Permission.node.replace(permissionLayer),
  ],
)
