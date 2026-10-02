import { expect, test } from "@playwright/test"

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
