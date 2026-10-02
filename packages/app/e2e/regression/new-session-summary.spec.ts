import { expect, test } from "@playwright/test"
import { mockUSTCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_summary"
const directory = "/workspace/summary-project"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("does not show session details on the new session screen", async ({ page }, testInfo) => {
  await mockUSTCodeServer(page, {
    directory,
    project: {
      id: "proj_new_summary",
      worktree: directory,
      vcs: "git",
      name: "summary-project",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "ustcode",
          name: "USTCode",
          models: { "summary-model": { id: "summary-model", name: "Summary Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["ustcode"],
      default: { providerID: "ustcode", modelID: "summary-model" },
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem(
        "ustcode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "ustcode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="composer-editor"]'))
  await expect(page.getByRole("button", { name: "Session details", exact: true })).toHaveCount(0)
  await testInfo.attach("new-session-without-summary", { body: await page.screenshot(), contentType: "image/png" })
})
