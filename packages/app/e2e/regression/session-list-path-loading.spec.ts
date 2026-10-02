import { test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockUSTCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test("shows loaded sessions before the directory path request resolves", async ({ page }) => {
  await mockUSTCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })

  let releasePath!: () => void
  const pathBlocked = new Promise<void>((resolve) => {
    releasePath = resolve
  })
  await page.route("**/api/location*", async (route) => {
    await pathBlocked
    return route.fallback()
  })

  await page.addInitScript((directory) => {
    localStorage.setItem(
      "ustcode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  try {
    await expectAppVisible(page.getByText(fixture.expected.sourceTitle).first())
  } finally {
    releasePath()
  }
})
