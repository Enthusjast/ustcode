import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockUSTCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/ustcode/NewProject"

test("creates a session in a new project and selects its model", async ({ page }) => {
  // An empty draft must remain usable when the file viewer is unavailable.
  await page.route(/(?:\/_assets\/file-(?!icon-)[^/]+\.js|\/session-ui\/src\/components\/file\.tsx)(?:\?|$)/, (route) =>
    route.abort(),
  )
  await mockUSTCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "hosted-model-1": {
              id: "hosted-model-1",
              name: "Hosted Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["openai", "anthropic"],
      default: { providerID: "openai", modelID: "free-model" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    // Listings are requested by absolute path and returned relative to the stable Location.
    fileList: (path) => (path === "C:/USTCode" ? [{ path: "./", type: "directory", ignored: false }] : []),
  })
  await page.addInitScript(() => {
    localStorage.setItem("ustcode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    localStorage.setItem(
      "ustcode.global.dat:model",
      JSON.stringify({
        user: [
          { providerID: "openai", modelID: "free-model", visibility: "show" },
          { providerID: "anthropic", modelID: "hosted-model-1", visibility: "show" },
        ],
        recent: [{ providerID: "anthropic", modelID: "hosted-model-1" }],
        variant: {},
      }),
    )
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await expect(picker.getByRole("combobox")).toHaveValue("C:\\USTCode\\NewProject")
  const listing = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === "/api/fs/list" && url.searchParams.get("path") === "C:/USTCode"
  })
  await picker.getByRole("button", { name: "Parent", exact: true }).click()
  expect(new URL((await listing).url()).searchParams.get("location[directory]")).toBe(directory)
  const directoryItem = picker.getByRole("treeitem", { name: "NewProject", exact: true })
  await expect(directoryItem).toBeVisible()
  await directoryItem.click()
  await expect(directoryItem).toHaveAttribute("aria-selected", "true")
  await expect(picker.getByText("C:\\USTCode\\NewProject", { exact: true })).toBeVisible()
  const selectFolder = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(selectFolder).toBeEnabled()
  await selectFolder.click()
  await expect(picker).toBeHidden()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="composer"]'))

  const modelControl = page.locator('[data-action="composer-model"]')
  await expect(modelControl).toContainText("Hosted Model 1")
  await modelControl.click()
  const modelSearch = page.getByPlaceholder("Search models", { exact: true })
  await expect(modelSearch).toBeFocused()
  await modelSearch.press("ArrowDown")
  await modelSearch.press("Enter")
  await expect(modelControl).toContainText("Free Model")

  await modelControl.click()
  await expect(modelSearch).toBeFocused()
  await modelSearch.press("ArrowUp")
  await modelSearch.press("Enter")

  await expect(modelControl).toContainText("Hosted Model 1")
})

test("restores each existing session's model and variant when switching tabs", async ({ page }) => {
  const sessions = ["A", "B"].map((name) => ({
    ...fixture.sessions[0],
    id: `ses_model_${name}`,
    title: `Model ${name}`,
    model: { id: `model-${name}`, providerID: "openai", variant: "balanced" },
  }))
  await mockUSTCodeServer(page, {
    ...fixture,
    sessions,
    provider: {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: Object.fromEntries(
            sessions.map((session) => [
              session.model.id,
              {
                id: session.model.id,
                name: session.title,
                limit: { context: 200_000 },
                variants: { balanced: {}, high: {} },
              },
            ]),
          ),
        },
      ],
      connected: ["openai"],
      default: { providerID: "openai", modelID: sessions[0]!.model.id },
    },
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })

  const hrefA = stressSessionHref(sessions[0]!.id)
  const hrefB = stressSessionHref(sessions[1]!.id)
  await page.goto(hrefA)
  const composer = page.locator('[data-component="composer"]')
  const modelControl = composer.locator('[data-action="composer-model"]')
  const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("balanced")
  await variant.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(variant).toHaveText("high")

  await page.locator(`[data-titlebar-tab-link][href="${hrefB}"]`).click()
  await expect(page).toHaveURL(hrefB)
  await expect(modelControl).toHaveText("Model B")
  await expect(variant).toHaveText("balanced")

  await page.locator(`[data-titlebar-tab-link][href="${hrefA}"]`).click()
  await expect(page).toHaveURL(hrefA)
  await expect(modelControl).toHaveText("Model A")
  await expect(variant).toHaveText("high")
})
