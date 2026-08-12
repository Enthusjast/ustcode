import { AgentV2 } from "@enthusjast/ustcode-core/agent"
import { AISDK } from "@enthusjast/ustcode-core/aisdk"
import { Catalog } from "@enthusjast/ustcode-core/catalog"
import { CommandV2 } from "@enthusjast/ustcode-core/command"
import { Credential } from "@enthusjast/ustcode-core/credential"
import { AppNodeBuilder } from "@enthusjast/ustcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@enthusjast/ustcode-core/effect/app-node-platform"
import { LayerNode } from "@enthusjast/ustcode-core/effect/layer-node"
import { EventV2 } from "@enthusjast/ustcode-core/event"
import { FileSystem } from "@enthusjast/ustcode-core/filesystem"
import { FSUtil } from "@enthusjast/ustcode-core/fs-util"
import { Integration } from "@enthusjast/ustcode-core/integration"
import { Location } from "@enthusjast/ustcode-core/location"
import { Npm } from "@enthusjast/ustcode-core/npm"
import { PluginV2 } from "@enthusjast/ustcode-core/plugin"
import { Reference } from "@enthusjast/ustcode-core/reference"
import { SkillV2 } from "@enthusjast/ustcode-core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
