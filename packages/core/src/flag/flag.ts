import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["USTCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["USTCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("USTCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  USTCODE_AUTO_HEAP_SNAPSHOT: truthy("USTCODE_AUTO_HEAP_SNAPSHOT"),
  USTCODE_GIT_BASH_PATH: process.env["USTCODE_GIT_BASH_PATH"],
  USTCODE_CONFIG: process.env["USTCODE_CONFIG"],
  USTCODE_CONFIG_CONTENT: process.env["USTCODE_CONFIG_CONTENT"],
  USTCODE_DISABLE_AUTOUPDATE: truthy("USTCODE_DISABLE_AUTOUPDATE"),
  USTCODE_ALWAYS_NOTIFY_UPDATE: truthy("USTCODE_ALWAYS_NOTIFY_UPDATE"),
  USTCODE_DISABLE_PRUNE: truthy("USTCODE_DISABLE_PRUNE"),
  USTCODE_DISABLE_TERMINAL_TITLE: truthy("USTCODE_DISABLE_TERMINAL_TITLE"),
  USTCODE_SHOW_TTFD: truthy("USTCODE_SHOW_TTFD"),
  USTCODE_DISABLE_AUTOCOMPACT: truthy("USTCODE_DISABLE_AUTOCOMPACT"),
  USTCODE_DISABLE_MODELS_FETCH: truthy("USTCODE_DISABLE_MODELS_FETCH"),
  USTCODE_DISABLE_MOUSE: truthy("USTCODE_DISABLE_MOUSE"),
  USTCODE_FAKE_VCS: process.env["USTCODE_FAKE_VCS"],
  USTCODE_SERVER_PASSWORD: process.env["USTCODE_SERVER_PASSWORD"],
  USTCODE_SERVER_USERNAME: process.env["USTCODE_SERVER_USERNAME"],
  USTCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("USTCODE_DISABLE_FFF"),

  // Experimental
  USTCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("USTCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  USTCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("USTCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  USTCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("USTCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  USTCODE_MODELS_URL: process.env["USTCODE_MODELS_URL"],
  USTCODE_MODELS_PATH: process.env["USTCODE_MODELS_PATH"],
  USTCODE_DB: process.env["USTCODE_DB"],

  USTCODE_WORKSPACE_ID: process.env["USTCODE_WORKSPACE_ID"],
  USTCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("USTCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get USTCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("USTCODE_DISABLE_PROJECT_CONFIG")
  },
  get USTCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("USTCODE_EXPERIMENTAL_REFERENCES")
  },
  get USTCODE_TUI_CONFIG() {
    return process.env["USTCODE_TUI_CONFIG"]
  },
  get USTCODE_CONFIG_DIR() {
    return process.env["USTCODE_CONFIG_DIR"]
  },
  get USTCODE_PURE() {
    return truthy("USTCODE_PURE")
  },
  get USTCODE_PERMISSION() {
    return process.env["USTCODE_PERMISSION"]
  },
  get USTCODE_PLUGIN_META_FILE() {
    return process.env["USTCODE_PLUGIN_META_FILE"]
  },
  get USTCODE_CLIENT() {
    return process.env["USTCODE_CLIENT"] ?? "cli"
  },
}
