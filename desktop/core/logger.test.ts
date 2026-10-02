import { describe, expect, test } from "bun:test"
import { Logger } from "./logger"

describe("structured application logger", () => {
  test("keeps a bounded, ordered snapshot of records", () => {
    const logger = new Logger(() => undefined)

    for (let index = 0; index < 502; index += 1) {
      logger.info("test", `record ${index}`)
    }

    const records = logger.snapshot()
    expect(records).toHaveLength(500)
    expect(records[0]?.message).toBe("record 2")
    expect(records.at(-1)?.message).toBe("record 501")
    expect(records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
