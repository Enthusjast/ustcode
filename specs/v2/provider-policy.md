# Provider Policy

Status: **Implemented.**

## Purpose

Policies control whether an operation on a named resource is allowed. Statements are authored in configuration files and applied by a terminal plugin.

Two consumers exist:

```text
action:   provider.use
resource: provider ID, such as openai or company-ai

action:   permission
resource: <permission action>:<resource>, such as shell:sudo * or edit:*.env
```

Provider configuration and provider policy remain separate:

- `providers` describes endpoints, options, and model overrides.
- `experimental.policies` determines whether an operation using a provider is allowed.

A provider can be correctly configured and have valid credentials while policy still denies its use.

## Goals

- Replace legacy `enabled_providers` and `disabled_providers`.
- Keep the default experience unchanged when users specify no policy.
- Support wildcard matching for actions and resources.
- Provide one small policy vocabulary that can later cover operations such as `plugin.load` or `mcp.connect`.
- Let user-global policy override repository policy.
- Keep evaluation simple: matching statements are applied in order and the last match wins.

## Non-Goals

- Policies do not configure endpoints, credentials, models, or provider options.
- Policies do not make unusable resources usable.
- Policies do not currently provide conditions, principals, approval prompts, or enforced configuration values.
- A `permission` statement never grants access; permissions and saved approvals still decide `allow` versus `ask`.

## Statement Shape

```jsonc
{
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai",
      },
    ],
  },
}
```

```ts
interface PolicyInfo {
  effect: "allow" | "deny"
  action: "provider.use" | "permission"
  resource: string
}
```

`ConfigPolicy` owns the statement schema; `action` is a closed set and a statement with any other value is dropped during normalization with a diagnostic. The policy plugin interprets `provider.use` after all other catalog transforms have run and `permission` after every other permission evaluation hook.

## Matching

Both `action` and `resource` use ustcode's existing wildcard matching behavior.

Examples:

| Action         | Resource           | Matches                                                         |
| -------------- | ------------------ | --------------------------------------------------------------- |
| `provider.use` | `openai`           | Only use of provider ID `openai`                                |
| `provider.use` | `company-*`        | Use of provider IDs such as `company-us` and `company-eu`       |
| `permission`   | `shell:git push *` | The `shell` permission for `git push` with or without arguments |
| `permission`   | `*`                | Every permission check on every resource                        |

No pattern-specific precedence exists. A specific resource does not automatically beat a wildcard resource. Written/evaluation order controls the result.

## Evaluation

To evaluate an operation and resource:

1. Start with `allow`.
2. Consider every statement whose `action` and `resource` match the requested action and resource.
3. Each matching statement replaces the current decision with its `effect`.
4. The last matching statement determines the result.

Conceptually:

```ts
function evaluate(action: string, resource: string, fallback: Policy.Effect, statements: Policy.Info[]) {
  return (
    statements.findLast(
      (statement) => Wildcard.match(action, statement.action) && Wildcard.match(resource, statement.resource),
    )?.effect ?? fallback
  )
}
```

Each caller supplies the default effect appropriate for its operation. Catalog provider use supplies `"allow"`, so no provider policy statements means normal behavior continues: otherwise usable providers are allowed.

## Ordering Within One Config Document

Statements remain in the order written by the user.

To deny all providers except Anthropic:

```jsonc
{
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "*",
      },
      {
        "effect": "allow",
        "action": "provider.use",
        "resource": "anthropic",
      },
    ],
  },
}
```

Result:

```text
provider.use / anthropic -> allow
provider.use / openai    -> deny
```

To allow internal providers except experimental ones:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "company-*" },
      { "effect": "deny", "action": "provider.use", "resource": "company-experimental-*" },
    ],
  },
}
```

Result:

```text
company-stable: allowed
company-experimental-fast: denied
openai: denied
```

## Ordering Across Authored Config Documents

Ordinary settings and policies have different precedence needs:

- Ordinary settings are read forward, so location-specific settings override user-global settings.
- Policies are read by reversing authored config documents, so user-global policy can override repository policy.
- Statements inside each document keep their written order.

At minimum, this means a repository cannot silently re-enable something the user denied globally.

Project config:

```jsonc
{
  "experimental": {
    "policies": [{ "effect": "allow", "action": "provider.use", "resource": "openai" }],
  },
}
```

User-global config:

```jsonc
{
  "experimental": {
    "policies": [{ "effect": "deny", "action": "provider.use", "resource": "openai" }],
  },
}
```

Result:

```text
provider.use / openai -> deny
```

The relative policy precedence of direct project files and `.ustcode` files is intentionally deferred until `.ustcode` configuration is reviewed.

## Permission Policy

`permission` statements run in the `permission.evaluate` hook after agent and session rules, saved approvals, and every other plugin's hook. For each resource the tool checks, the string `<action>:<resource>` is matched against the statement resource; if the last matching statement for any resource is `deny`, the evaluation becomes `deny` with the message above.

```text
permission / shell:sudo ls        -> deny   (statement shell:sudo *)
permission / shell:git status     -> unchanged: the agent's rules decide allow or ask
```

- A configured `deny` from agent or session rules already denies before the hook runs.
- A statement `deny` overrides `allow` and `ask`, including saved "Allow always" approvals.
- A statement `allow` never grants; it only cancels an earlier, broader statement `deny`.

## Interaction With Provider Configuration

```jsonc
{
  "providers": {
    "company-ai": {
      "package": "@ustcode-ai/ai/providers/openai-compatible",
      "settings": { "baseURL": "https://ai.company.example/v1" },
    },
  },
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "company-ai" },
    ],
  },
}
```

The provider entry configures `company-ai`; the policy statements make it the only provider permitted for use.

Provider policy applies regardless of how a provider becomes known or usable, including:

- models.dev catalog data
- environment credentials
- saved accounts
- built-in provider plugins
- explicit provider configuration

## Applying Provider Policy

Provider records and model overrides are assembled before checking provider policy. Otherwise later provider loading could recreate a provider that was already filtered.

Flow:

1. Build provider/model catalog entries from catalog data, credentials, plugins, and config.
2. Apply configured provider and model overrides.
3. Run the terminal config policy transform over the reversed authored statements.
4. Remove providers denied by the final matching `provider.use` statement.

Config reload refreshes the policy snapshot and rebuilds the catalog through the terminal policy transform.

## Legacy Migration

Legacy deny list:

```jsonc
{
  "disabled_providers": ["openai", "google"],
}
```

Equivalent v2 policy:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" },
    ],
  },
}
```

Legacy allowlist:

```jsonc
{
  "enabled_providers": ["anthropic", "openai"],
}
```

Equivalent v2 policy:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" },
    ],
  },
}
```
