import path from "node:path"

export function isolatedEnv(root: string, overrides: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    HOME: root,
    USTCODE_CLI_CONFIG_CONTENT: undefined,
    USTCODE_CONFIG_CONTENT: "{}",
    USTCODE_CONFIG_DIR: path.join(root, "config"),
    USTCODE_DB: path.join(root, "ustcode.db"),
    USTCODE_DISABLE_FILEWATCHER: "true",
    USTCODE_DISABLE_MODELS_FETCH: "true",
    USTCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    ...overrides,
  }
}
