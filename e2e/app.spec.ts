import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

test("shell loads and settings persist across a browser restart", async ({ page }) => {
  await page.route("**/__workshop_lmstudio/v1/models", (route) =>
    route.fulfill({ json: { data: [{ id: "e2e-local-model" }] } }),
  )
  await page.goto("/")

  await expect(page.locator("#workspace-title")).toContainText("zum Leben erwecken")
  await expect(page.getByRole("complementary", { name: "KI-Chat" })).toBeVisible()
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()

  const settings = page.getByRole("dialog", { name: "Einstellungen" })
  await expect(settings).toBeVisible()
  await settings.locator("#setting-mode").selectOption("safe")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  await page.reload()
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Einstellungen" }).locator("#setting-mode")).toHaveValue(
    "safe",
  )
})

test("the shell remains usable while the local model endpoint is offline", async ({ page }) => {
  await page.route("**/__workshop_lmstudio/v1/models", (route) => route.abort())
  await page.goto("/")

  const notice = page.locator("#provider-notice")
  await expect(notice).toBeVisible()
  await expect(page.locator("#workspace-title")).toContainText("zum Leben erwecken")
  await notice.getByRole("button", { name: "Einstellungen" }).click()
  await expect(page.getByRole("dialog", { name: "Einstellungen" })).toBeVisible()
})

test("local data export can restore settings without exporting the session key", async ({ page }) => {
  await page.route("**/__workshop_lmstudio/v1/models", (route) =>
    route.fulfill({ json: { data: [{ id: "e2e-local-model" }] } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Einstellungen" })
  await settings.locator("#setting-api-key").fill("e2e-session-secret")
  await settings.locator("#setting-mode").selectOption("safe")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  page.once("dialog", (dialog) => dialog.accept())
  const downloadPromise = page.waitForEvent("download")
  await settings.getByRole("button", { name: "Daten exportieren" }).click()
  const download = await downloadPromise
  const exportContent = await readFile(await download.path(), "utf8")
  expect(exportContent).not.toContain("e2e-session-secret")
  expect(exportContent).toContain('"format": "workshop-local-data"')

  await settings.locator("#setting-mode").selectOption("normal")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  const fileChooserPromise = page.waitForEvent("filechooser")
  await settings.getByRole("button", { name: "Daten wiederherstellen" }).click()
  const fileChooser = await fileChooserPromise
  const reloadPromise = page.waitForEvent("load")
  page.once("dialog", (dialog) => dialog.accept())
  await fileChooser.setFiles(await download.path())
  await reloadPromise
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Einstellungen" }).locator("#setting-mode")).toHaveValue(
    "safe",
  )
})

test("an unsupported import is rejected without replacing the current settings", async ({ page }) => {
  await page.route("**/__workshop_lmstudio/v1/models", (route) =>
    route.fulfill({ json: { data: [{ id: "e2e-local-model" }] } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Einstellungen" })
  await settings.locator("#setting-mode").selectOption("safe")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  await settings.locator("#setting-mode").selectOption("normal")
  const fileChooserPromise = page.waitForEvent("filechooser")
  await settings.getByRole("button", { name: "Daten wiederherstellen" }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: "unsupported-workshop-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ format: "workshop-local-data", version: 99, exportedAt: new Date().toISOString(), entries: [] }),
    ),
  })
  await expect(settings.locator("#save-feedback")).toContainText("nicht unterstützte Version")
  await expect(settings.locator("#setting-mode")).toHaveValue("normal")
})

test("a failed storage write rolls back the previous data", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "app-state" && localStorage.getItem("e2e-fail-once") === "1") {
        localStorage.removeItem("e2e-fail-once")
        throw new DOMException("Simulated storage write failure", "QuotaExceededError")
      }
      originalSetItem.call(this, key, value)
    }
  })
  await page.route("**/__workshop_lmstudio/v1/models", (route) =>
    route.fulfill({ json: { data: [{ id: "e2e-local-model" }] } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Einstellungen" })
  await settings.locator("#setting-mode").selectOption("safe")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  page.once("dialog", (dialog) => dialog.accept())
  const downloadPromise = page.waitForEvent("download")
  await settings.getByRole("button", { name: "Daten exportieren" }).click()
  const download = await downloadPromise
  await settings.locator("#setting-mode").selectOption("normal")
  await settings.getByRole("button", { name: "Einstellungen speichern" }).click()
  await expect(settings.locator("#save-feedback")).toHaveText("Gespeichert.")

  await page.evaluate(() => localStorage.setItem("e2e-fail-once", "1"))
  const fileChooserPromise = page.waitForEvent("filechooser")
  await settings.getByRole("button", { name: "Daten wiederherstellen" }).click()
  const fileChooser = await fileChooserPromise
  page.once("dialog", (dialog) => dialog.accept())
  await fileChooser.setFiles(await download.path())
  await expect(settings.locator("#save-feedback")).toContainText("Simulated storage write failure")

  await page.reload()
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Einstellungen" }).locator("#setting-mode")).toHaveValue(
    "normal",
  )
})
