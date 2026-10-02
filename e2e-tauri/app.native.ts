import { $, expect } from "@wdio/globals"

describe("native Workshop shell", () => {
  it("opens settings and saves a mode change in the native UI", async () => {
    await expect($("#workspace-title")).toBeDisplayed()

    await $("#settings-open").click()
    await expect($("#settings-dialog")).toBeDisplayed()

    await $("#setting-mode").selectByAttribute("value", "normal")
    await $("#settings-dialog button[type='submit']").click()
    await expect($("#save-feedback")).toHaveText("Gespeichert.")
    await expect($("#setting-mode")).toHaveValue("normal")
  })
})
