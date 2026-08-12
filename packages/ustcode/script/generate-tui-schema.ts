#!/usr/bin/env bun
// Generates the JSON Schema for the TUI config file (tui.json), derived from the
// Effect schema `TuiConfig.Info` so it stays in sync with the parser.
//
// The TUI config module contains JSX components, so bun needs the Solid JSX
// import source. Run via the `generate:tui-schema` npm script:
//   bun run --jsx-import-source="@opentui/solid" script/generate-tui-schema.ts
//
// Output: tui-schema.json at the repo root, served on GitHub Pages as /tui.json
// (see TUI_SCHEMA_URL in packages/ustcode/src/config/tui-migrate.ts).

import { Schema } from "effect"
import { TuiConfig } from "@enthusjast/ustcode-tui/config"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root: packages/ustcode/script -> ../../../tui-schema.json
const outFile = path.resolve(__dirname, "../../../tui-schema.json")

const document = Schema.toJsonSchemaDocument(TuiConfig.Info)

const tuiSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ustcode.enthusjast.cc/tui.json",
  title: "ustcode TUI configuration",
  ...document.schema,
  $defs: document.definitions,
}

await Bun.write(outFile, JSON.stringify(tuiSchema, null, 2) + "\n")
console.log(`Wrote ${outFile}`)
