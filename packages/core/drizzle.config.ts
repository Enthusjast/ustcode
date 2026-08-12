import { defineConfig } from "drizzle-kit"
import os from "os"
import path from "path"

const defaultDbUrl = path.join(os.homedir(), ".local", "share", "ustcode", "ustcode.db")

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: process.env.USTCODE_DB_PATH ?? defaultDbUrl,
  },
})
