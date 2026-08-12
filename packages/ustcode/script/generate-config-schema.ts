#!/usr/bin/env bun
// Generates the JSON Schema for the ustcode config file (ustcode.json/ustcode.jsonc).
//
// The schema is derived from the Effect schema `ConfigV1.Info` (the definition of
// the config file format in packages/core/src/v1/config/config.ts), so it stays in
// sync with the parser automatically.
//
// Output: config-schema.json at the repo root. It is served later via GitHub Pages
// as the `$schema` target (see CONFIG_SCHEMA_URL in packages/ustcode/src/config/config.ts).
//
// Usage: bun run --cwd packages/ustcode script/generate-config-schema.ts

import { Schema } from "effect"
import { ConfigV1 } from "@enthusjast/ustcode-core/v1/config/config"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root: packages/ustcode/script -> ../../../config-schema.json
const outFile = path.resolve(__dirname, "../../../config-schema.json")

const document = Schema.toJsonSchemaDocument(ConfigV1.Info)

const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ustcode.enthusjast.cc/config.json",
  title: "ustcode configuration",
  // Root schema is a $ref to the Config definition; keep it at the top level so
  // editors pick up both completion and validation from the $defs below.
  ...document.schema,
  $defs: document.definitions,
}

await Bun.write(outFile, JSON.stringify(configSchema, null, 2) + "\n")
console.log(`Wrote ${outFile}`)
