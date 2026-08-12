/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeUstcodeContent from "./skill/customize-ustcode.md" with { type: "text" }

export const CustomizeUstcodeContent = customizeUstcodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-ustcode",
            description:
              "Use ONLY when the user is editing or creating ustcode's own configuration: ustcode.json, ustcode.jsonc, files under .ustcode/, or files under ~/.config/ustcode/. Also use when creating or fixing ustcode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring ustcode itself.",
            location: AbsolutePath.make("/builtin/customize-ustcode.md"),
            content: CustomizeUstcodeContent,
          }),
        }),
      )
    })
  }),
})
