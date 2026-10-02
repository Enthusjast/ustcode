import { Plugin } from "@ustcode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveUSTCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "ustcode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveUSTCodeDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
