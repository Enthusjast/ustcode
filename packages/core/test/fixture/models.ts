import { ModelsDev } from "@ustcode-ai/core/models-dev"

// Tests use the bundled catalog and never rely on an explicitly configured remote source.
export const offlineModels = ModelsDev.node.replace(ModelsDev.configured({ fetch: false }))
