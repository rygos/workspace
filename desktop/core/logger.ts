export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogRecord = {
  readonly timestamp: string
  readonly level: LogLevel
  readonly scope: string
  readonly message: string
}

const MAX_RECORDS = 500

export class Logger {
  private records: LogRecord[] = []

  constructor(private readonly emit: (record: LogRecord) => void = defaultLogSink) {}

  debug(scope: string, message: string): void {
    this.write("debug", scope, message)
  }

  info(scope: string, message: string): void {
    this.write("info", scope, message)
  }

  warn(scope: string, message: string): void {
    this.write("warn", scope, message)
  }

  error(scope: string, message: string): void {
    this.write("error", scope, message)
  }

  snapshot(): readonly LogRecord[] {
    return this.records.slice()
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const record: LogRecord = { timestamp: new Date().toISOString(), level, scope, message }
    this.records = [...this.records.slice(-(MAX_RECORDS - 1)), record]
    this.emit(record)
  }
}

function defaultLogSink(record: LogRecord): void {
  console[record.level](`[Workshop] ${record.scope}: ${record.message}`)
}

export const logger = new Logger()
