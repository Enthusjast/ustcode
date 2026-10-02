import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/ustcode-theme-preload.js", import.meta.url))
const themeScript = readFileSync(theme, "utf8")
const tailwind = tailwindcss()
const tailwindGenerate = tailwind.find((plugin) => plugin.name === "@tailwindcss/vite:generate:serve")
const tailwindHotUpdate = tailwindGenerate?.hotUpdate

// Tailwind 4.3.3 expects a server that Vite's bundled dev hook does not provide.
if (tailwindGenerate && typeof tailwindHotUpdate === "function") {
  tailwindGenerate.hotUpdate = function (context) {
    if (!context.server) return
    return tailwindHotUpdate.call(this, context)
  }
}

// The markdown worker imports these directly, so they are served unbundled to keep worker startup
// stable. Vite applies `exclude` to every import inside a pre-bundle too, which would leave a bare
// `import "marked"` in mermaid's chunk that the browser cannot resolve from this package.
const workerDeps = ["@shikijs/stream", "marked", "marked-shiki", "remend"]

/** @type {import("rolldown").Plugin} */
const bundleNestedWorkerDeps = {
  name: "ustcode-desktop:bundle-nested-worker-deps",
  resolveId(id, importer) {
    if (!importer || !workerDeps.includes(id) || !importer.includes("node_modules")) return
    try {
      return createRequire(importer).resolve(id)
    } catch {
      return
    }
  },
}

export const channel = (() => {
  const raw = process.env.USTCODE_CHANNEL
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.USTCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "ustcode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_USTCODE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
        optimizeDeps: {
          exclude: workerDeps,
          include: ["@ustcode-ai/session-ui > mermaid", "@ustcode-ai/session-ui > mermaid > katex"],
          rolldownOptions: { plugins: [bundleNestedWorkerDeps] },
        },
      }
    },
  },
  {
    name: "ustcode-desktop:theme-preload",
    transformIndexHtml: {
      order: "pre",
      handler: inlineThemePreload,
    },
  },
  ...tailwind,
  solidPlugin(),
]

export function inlineThemePreload(html) {
  return html.replace(
    /<script id="ustcode-theme-preload-script" src="(?:\.\/|\/)ustcode-theme-preload\.js"><\/script>/,
    `<script id="ustcode-theme-preload-script">${themeScript}</script>`,
  )
}
