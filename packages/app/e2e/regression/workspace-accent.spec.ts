import { expect, test, type Locator, type Page } from "@playwright/test"
import type { USTCodeEvent, WorktreeDirectory } from "@ustcode-ai/client/promise"
import { base64Encode } from "@ustcode-ai/util/encode"
import { mockUSTCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionReady } from "../utils/waits"

const root = "C:/ustcode/WorkspaceAccent"
const workspace = `${root}/.worktrees/feature`
const projectID = "proj_workspace_accent"
const sessionID = "ses_workspace_accent"
const title = "Workspace accent regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const inventory: WorktreeDirectory[] = [
  { directory: root },
  { directory: workspace, strategy: "git" },
  { directory: "C:/ustcode/LinkedWorkspace", strategy: "git" },
  { directory: "C:/ustcode/WorkspaceCopy", strategy: "copy" },
  { directory: "C:/ustcode/RegisteredDirectory" },
]

test.use({ serviceWorkers: "block" })

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("ustcode-theme-id", "ustcode")
        localStorage.setItem("ustcode-color-scheme", theme)
      }, theme)
    })

    for (const scenario of [
      { name: "managed Git worktree", directory: workspace, accent: true },
      { name: "linked Git worktree outside main", directory: "C:/ustcode/LinkedWorkspace", accent: true },
      {
        name: "linked Git worktree on a narrow screen",
        directory: "C:/ustcode/LinkedWorkspace",
        accent: true,
        viewport: { width: 390, height: 844 },
      },
      {
        name: "main root with Windows case and separators",
        directory: "c:\\USTCODE\\workspaceaccent\\",
        accent: false,
      },
      { name: "nested main directory", directory: `${root}/packages/app`, accent: false },
      { name: "nested workspace inside main", directory: `${workspace}/packages/app`, accent: true },
      {
        name: "workspace with Windows case and separators",
        directory: "c:\\ustcode\\WORKSPACEACCENT\\.worktrees\\FEATURE\\src\\",
        accent: true,
      },
      { name: "unregistered sibling with the same prefix", directory: `${workspace}-unregistered`, accent: false },
      { name: "workspace using another strategy", directory: "C:/ustcode/WorkspaceCopy", accent: true },
      { name: "registered directory without a strategy", directory: "C:/ustcode/RegisteredDirectory", accent: true },
    ]) {
      test(`existing session send button: ${scenario.name}`, async ({ page }, testInfo) => {
        if (scenario.viewport) await page.setViewportSize(scenario.viewport)
        const view = await openSession(page, scenario.directory)
        await view.input.fill("Inspect this fixture workspace.")
        await expect(view.send).toBeEnabled()

        if (scenario.name === "managed Git worktree") {
          // Capture before the color assertion so both red and green runs have evidence.
          const path = testInfo.outputPath("workspace-accent.png")
          await view.composer.screenshot({ path })
          await testInfo.attach("workspace-accent", { path, contentType: "image/png" })
        }

        await expectBackground(view.send, "icon-button-contrast")
        await view.send.hover()
        await expectBackground(view.send, "icon-button-contrast")
        await view.composer.locator('[data-action="composer-model"]').press("Tab")
        await expect(view.send).toBeFocused()
        await expectBackground(view.send, "icon-button-contrast")
        const message = page.locator('[data-slot="user-message-text"]')
        await expect(message).toHaveText("Check this fixture workspace.")
        await expectToken(
          message,
          "background-color",
          scenario.accent ? "--v2-background-bg-accent" : theme === "light" ? "--v2-blue-100" : "--v2-blue-1200",
        )
        await expectToken(
          message,
          "color",
          scenario.accent ? "--v2-text-text-contrast" : theme === "light" ? "--v2-blue-700" : "--v2-blue-300",
        )
      })
    }

    test("inventory updates leave send neutral; disabled and stop stay neutral", async ({ page }) => {
      const view = await openSession(page, workspace, [{ directory: root }])
      await view.input.fill("Keep this draft while the inventory changes.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, "icon-button-contrast")
      const url = page.url()

      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/worktree" &&
          new URL(response.url()).searchParams.get("projectID") === projectID &&
          response.request().method() === "GET",
      )
      view.worktrees.push({ directory: workspace, strategy: "git" })
      view.events.push({
        id: "evt_workspace_accent_inventory",
        created: 1700000001000,
        type: "worktree.updated",
        data: { projectID },
      })
      expect((await refreshed).ok()).toBe(true)
      await expectBackground(view.send, "icon-button-contrast")
      await expect(page).toHaveURL(url)
      await expect(view.input).toHaveText("Keep this draft while the inventory changes.")
      await expect(view.send).toBeEnabled()

      await view.input.fill("")
      await expect(view.send).toBeDisabled()
      await expectBackground(view.send, "icon-button-contrast")

      view.events.push({
        id: "evt_workspace_accent_running",
        created: 1700000002000,
        type: "session.execution.started",
        durable: { aggregateID: sessionID, seq: 1, version: 1 },
        data: { sessionID },
      })
      const stop = view.composer.getByRole("button", { name: "Stop", exact: true })
      await expect(stop).toBeEnabled()
      await expectBackground(stop, "icon-button-contrast")

      await view.input.fill("Send a follow-up instead of stopping.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, "icon-button-contrast")
      await expect(page).toHaveURL(url)
    })

    test("new workspace send button stays neutral", async ({ page }) => {
      const view = await openSession(page, root, [...inventory], true)
      await expect(view.send).toBeDisabled()
      await expectBackground(view.send, "icon-button-contrast")
      await page.getByRole("button", { name: "Local", exact: true }).click()
      await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
      await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
      await view.input.fill("Inspect this fixture workspace.")
      await expect(view.send).toBeEnabled()
      await expectBackground(view.send, "icon-button-contrast")
      await view.send.hover()
      await expectBackground(view.send, "icon-button-contrast")
      await view.composer.locator('[data-action="composer-model"]').press("Tab")
      await expect(view.send).toBeFocused()
      await expectBackground(view.send, "icon-button-contrast")
    })
  })
}

async function openSession(page: Page, directory: string, worktrees = [...inventory], draft = false) {
  const events: USTCodeEvent[] = []
  await mockUSTCodeServer(page, {
    directory,
    project: {
      id: projectID,
      canonical: root,
      worktree: root,
      vcs: "git",
      name: "workspace-accent",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "ustcode",
          name: "USTCode",
          models: { "accent-model": { id: "accent-model", name: "Accent Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["ustcode"],
      default: { providerID: "ustcode", modelID: "accent-model" },
    },
    sessions: [
      {
        id: sessionID,
        projectID,
        directory,
        title,
        model: { id: "accent-model", providerID: "ustcode" },
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({
      items: [
        {
          id: "msg_workspace_accent",
          type: "user",
          text: "Check this fixture workspace.",
          time: { created: 1700000000000 },
        },
      ],
    }),
    events: () => events.splice(0),
  })
  // Keep authoritative inventory independent of the raw project's empty sandboxes.
  await page.route(
    (url) => url.pathname === "/api/worktree",
    (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({ json: worktrees, headers: { "access-control-allow-origin": "*" } })
    },
  )
  if (draft)
    await page.addInitScript(
      ({ root, server }) => {
        localStorage.setItem(
          "ustcode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: root, expanded: true }] },
            lastProject: { local: root },
          }),
        )
        localStorage.setItem(
          "ustcode.window.browser.dat:tabs",
          JSON.stringify([{ type: "draft", draftID: "draft_workspace_accent", server, directory: root }]),
        )
      },
      { root, server },
    )
  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/worktree" &&
      new URL(response.url()).searchParams.get("projectID") === projectID &&
      response.request().method() === "GET",
  )
  await page.goto(
    draft ? "/new-session?draftId=draft_workspace_accent" : `/server/${base64Encode(server)}/session/${sessionID}`,
  )
  expect((await loaded).ok()).toBe(true)
  if (!draft) await expectSessionReady(page, { server, sessionID, title })
  const composer = page.locator('[data-component="composer"]')
  await expectAppVisible(composer)
  const input = composer.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(input).toBeEditable()
  await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Accent Model")
  return { composer, input, send: composer.getByRole("button", { name: "Send", exact: true }), events, worktrees }
}

async function expectBackground(element: Locator, token: string, property = "background-image") {
  const color = await element.evaluate((element, token) => {
    // Resolve semantic colors through the browser, without reproducing the button's gradient.
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.backgroundColor = `var(--v2-background-bg-${token})`
    element.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, token)
  await expect(element).toHaveCSS(property, new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

async function expectToken(element: Locator, property: string, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.color = `var(${token})`
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
  await expect(element).toHaveCSS(property, color)
}
