const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://ustcode.enthusjast.cc" : `https://${stage}.ustcode.enthusjast.cc`,
  email: "hello@ustcode.enthusjast.cc",
  socialCard: "https://ustcode.enthusjast.cc/social-card.png",
  github: "https://github.com/Enthusjast/ustcode",
  discord: "https://ustcode.enthusjast.cc/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
