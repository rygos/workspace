# Codex Working Rules

Read `CODEX_PROMPT.md` and every Markdown file in this package before coding.

Priorities, in order: application survivability; safe rollback/recovery; security boundaries; architectural consistency; testability; extensibility; user-requested functionality.

Keep the stable Core small. Prefer TypeScript/JavaScript plugins for user features. Never bypass validation to make a generated change appear successful. Never hide a failed repair. Never silently weaken tests. Work in small buildable increments and commit meaningful milestones.

Before editing: inspect architecture, affected plugin contracts, capability consumers and recent changes. Before activation: lint, typecheck, test, build and validate. After activation: observe health. On runtime failure: isolate first, then repair. Preserve the AI chat/recovery control plane whenever possible.
