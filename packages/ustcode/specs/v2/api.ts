// @ts-nocheck

import { UstCode } from "@enthusjast/ustcode-core"
import { ReadTool } from "@enthusjast/ustcode-core/tools"

const ustcode = UstCode.make({})

ustcode.tool.add(ReadTool)

ustcode.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

ustcode.auth.add({
  provider: "openai-compatible",
  type: "api",
  value: process.env.OPENAI_COMPATIBLE_API_KEY,
})

ustcode.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai-compatible",
    variant: "xhigh",
  },
})

const sessionID = await ustcode.session.create({
  agent: "build",
})

ustcode.subscribe((event) => {
  console.log(event)
})

await ustcode.session.prompt({
  sessionID,
  text: "hey what is up",
})

await ustcode.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await ustcode.session.wait()

console.log(await ustcode.session.messages(sessionID))
