// Ambient declaration for vendored tree-sitter query files (`with { type: "file" }`).
// The tui package declares the same in its own src/parsers.d.ts, but this copy is
// needed so the ustcode package (which bundles the tui) typechecks them too.
declare module "*.scm" {
  const path: string
  export default path
}
