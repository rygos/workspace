import { describe, expect, test } from "bun:test"
import { AppStateSchema, DEFAULT_APP_STATE, SettingsSchema } from "./model"

describe("saved application state", () => {
  test("accepts the empty workspace defaults", () => {
    expect(AppStateSchema.safeParse(DEFAULT_APP_STATE).success).toBe(true)
  })

  test("rejects a non-HTTP provider address", () => {
    const result = SettingsSchema.safeParse({
      ...DEFAULT_APP_STATE.settings,
      apiBaseUrl: "file:///etc/passwd",
    })

    expect(result.success).toBe(false)
  })

  test("keeps session credentials out of persistent settings", () => {
    const result = SettingsSchema.parse({
      ...DEFAULT_APP_STATE.settings,
      apiKey: "session-only",
    })

    expect("apiKey" in result).toBe(false)
  })
})
