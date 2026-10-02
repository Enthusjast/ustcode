export const domain = (() => {
  if ($app.stage === "production") return "ustcode.enthusjast.cc"
  if ($app.stage === "dev") return "dev.ustcode.enthusjast.cc"
  return `${$app.stage}.dev.ustcode.enthusjast.cc`
})()

export const awsStage = $app.stage === "production" ? "production" : "dev"
export const deployAws = $app.stage === awsStage
