import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@enthusjast/ustcode-core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~ustcode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~ustcode/WorkspaceRef", {
  defaultValue: () => undefined,
})
