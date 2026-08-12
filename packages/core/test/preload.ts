import path from "path"

process.env.USTCODE_DB = ":memory:"
process.env.USTCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.USTCODE_DISABLE_MODELS_FETCH = "true"
