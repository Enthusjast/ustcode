import type { IntegrationDraft, IntegrationMethodRegistration } from "../effect/integration.js"
import type { CredentialValue } from "@enthusjast/ustcode-sdk/v2/types"
import type { Hooks } from "./registration.js"

export type { IntegrationDraft, IntegrationMethodRegistration }

export interface IntegrationHooks extends Hooks<{ transform: IntegrationDraft }> {
  readonly connection: {
    readonly active: (
      integrationID: string,
    ) => Promise<import("@enthusjast/ustcode-sdk/v2/types").ConnectionInfo | undefined>
    readonly resolve: (
      connection: import("@enthusjast/ustcode-sdk/v2/types").ConnectionInfo,
    ) => Promise<CredentialValue | undefined>
  }
}
