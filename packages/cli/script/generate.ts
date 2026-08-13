import path from "path"

export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await Bun.file(path.resolve(import.meta.dir, "../../ustcode/models/ustc.json")).text()

console.log("Loaded local USTC model catalog")
