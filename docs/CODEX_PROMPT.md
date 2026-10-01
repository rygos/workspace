# Codex Master Prompt: Self-Evolving Local-AI Desktop Platform

Build a cross-platform desktop application whose initial user-facing functionality is intentionally minimal: an empty workspace plus a persistent AI chat panel on the right. The chat connects to a local LM Studio server through its OpenAI-compatible API (default `http://127.0.0.1:1234/v1`). The user can describe desired features in natural language. The integrated development agent must inspect the existing application, plan the change, implement it as a dynamically loadable TypeScript/JavaScript plugin whenever possible, test it, validate it in staging, activate it, and make it available with hot reload where technically safe.

The long-term goal is a personal application platform that grows through use. Features must be composable: plugins expose typed capabilities and events so later plugins can reuse existing functionality instead of duplicating it.

## Non-negotiable architecture

Use a Stable Core + Dynamic Plugins + Plugin SDK + Capability Registry + Event Bus + AI Development Control Plane architecture. Do not create a system where the LLM repeatedly rewrites the entire application. Initially, all dynamically generated plugins/features must use TypeScript/JavaScript only.

The stable Core owns application startup, workspace shell, right-side AI chat, configuration, plugin lifecycle, recovery UI, logging, permissions, version history, last-known-good state, capability registry, event bus, and repair orchestration. Core modifications are exceptional and require stronger validation than plugin changes.

Prefer Tauri plus a TypeScript frontend (React is acceptable) if architectural investigation confirms it is suitable for Windows, Linux and macOS. Native code should be minimized. Document the final stack decision in `docs/ARCHITECTURE.md` before implementation.

## Critical reliability requirement: errors must trigger repair, not kill the application

Design for graceful degradation. A failure in a generated plugin, UI component, plugin event handler, background task, migration, agent operation, or dynamically added feature must not normally terminate the stable Core or AI/recovery interface.

Use process/runtime isolation where appropriate, frontend error boundaries, guarded event dispatch, timeouts, structured exception capture and plugin lifecycle supervision. A failed plugin must be quarantined or disabled while the rest of the application continues operating.

Whenever a recoverable runtime error is detected, automatically create a Repair Incident and start the local AI Repair Agent. Supply it with only the relevant context, including:

- error and stack trace
- structured logs around the failure
- affected plugin/component/capability
- relevant source files
- plugin manifest and dependencies
- recent Git commits
- current diff
- last successful version
- failing and related tests
- architecture contracts and ADRs
- consumers of changed capabilities/events

The Repair Agent must never patch production files blindly. Workflow:

`detect -> isolate -> capture incident -> create working copy/branch -> diagnose -> plan -> patch -> lint/typecheck -> unit tests -> affected integration tests -> build -> sandbox/smoke test -> activate -> hot reload -> observe`

If validation succeeds, create an auditable commit and activate the repaired version. If the repaired plugin immediately fails, revert activation and start another bounded repair attempt. Implement a configurable retry budget and circuit breaker to prevent infinite repair loops. After the retry budget is exhausted, disable/quarantine the failing plugin and restore its Last Known Good version where possible. The Core and chat/recovery UI must remain usable. Clearly inform the user what failed, what was attempted and the current state.

Never let the Repair Agent weaken tests, remove safety checks, suppress an exception without addressing its cause, or modify unrelated code merely to make validation pass.

## AI development agent

The chat is both assistant and development control plane. Implement structured tools instead of unrestricted shell access. At minimum support safe equivalents of:

- inspect_project
- search_code
- read_file
- create_file
- patch_file
- create_plugin
- inspect_plugin
- list_plugins
- run_lint
- run_typecheck
- run_tests
- build_plugin
- validate_plugin
- reload_plugin
- read_logs
- inspect_incident
- create_migration
- inspect_capabilities
- inspect_dependencies
- rollback_change

Dangerous operations require explicit policy/permission checks. Arbitrary process execution must not be exposed as a default LLM tool.

Support Safe, Normal and Autonomous development modes. Autonomous mode still obeys security boundaries, validation gates and repair-loop limits.

## Plugin system

Generated user features should default to plugins. Each plugin has a manifest, source, tests, optional migrations, permissions, provided capabilities, consumed capabilities/events and semantic version.

Example manifest fields: id, name, version, description, entrypoint, permissions, dependencies, provides, consumes, events, UI contributions and schema version.

Create an internal `@platform/plugin-sdk` with APIs such as `registerPlugin`, `registerPage`, `registerSidebarItem`, `registerCommand`, `registerCapability`, `getCapability`, `subscribeEvent`, `emitEvent`, `getStorage`, `getLogger`, `reportHealth` and lifecycle hooks.

Avoid uncontrolled direct imports between plugins. Communication should normally use typed capabilities/services and an Event Bus. Maintain a dependency/capability graph and detect missing dependencies, version conflicts and cycles.

Plugin UI contributions should support pages, navigation/sidebar items, commands, settings pages, toolbar/context actions and later contextual `Modify with AI` actions.

## Data

Use local persistent storage, preferably SQLite behind an abstraction. Plugins receive namespaced storage. Complex plugins may define versioned migrations. Before destructive or risky migrations, make a backup. Migrations must be tested and preferably reversible.

## Git, staging and rollback

Initialize/use Git for AI changes. Every accepted AI feature or repair should result in an understandable commit. All generated changes happen in a staging worktree/branch/copy first. Maintain a Last Known Good state and feature/change history. Provide diff viewing and rollback.

## LM Studio provider

Implement a generic OpenAI-compatible provider abstraction with LM Studio as the default. Settings include base URL, model, optional API key, temperature, timeout, token/context settings. Discover models through the compatible endpoint when possible. If LM Studio is unavailable, the application must remain operational and show a retry/settings state rather than crash.

## Agent context and memory

Do not dump the whole repository into the LLM context. Maintain a machine-readable project index containing plugins, capabilities, events, schemas, dependencies, UI contributions, documentation and recent changes. Retrieve only relevant code. Prepare an abstraction for future local semantic search/embeddings without making a vector DB mandatory for MVP.

Persist architecture decisions and stable project conventions. Use ADRs for important decisions. The agent must respect existing contracts and architecture.

## Feature contracts and regression analysis

Before implementing a feature, create a machine-readable Feature Contract containing requirements, provided/required capabilities, permissions, persistence needs and acceptance tests. Before modifying an existing capability, inspect its consumers. Run affected integration/regression tests automatically.

## User experience

Initial UI: empty main workspace and resizable/collapsible AI chat on the right. Include settings for AI provider and development mode. The chat must transparently show high-level development progress, plans, validation results, incidents, repairs and rollbacks without overwhelming the user with raw internal reasoning.

Later plugins populate the workspace dynamically. Add a command palette early so plugins can register actions.

## Self-improvement boundaries

Distinguish Requested Changes, Suggested Improvements and Automatic Repairs. Requested changes come from the user. Suggested improvements may be surfaced in an inbox but are not silently applied. Automatic repairs are allowed only to restore intended behavior within defined policies after detected failures or failures introduced during an active requested development operation.

Do not implement an uncontrolled autonomous self-modifying loop.

## MVP acceptance scenario

1. Start the nearly empty application.
2. Chat successfully connects to local LM Studio.
3. User requests: "Create a simple notes manager. I want to create, edit and delete notes."
4. Agent creates a feature contract and plan, checks existing capabilities, generates a TypeScript plugin, persistence and tests in staging, validates/builds it and activates it.
5. Notes UI appears without manual coding.
6. User requests tags and filtering; the agent updates the existing plugin safely.
7. User requests a task manager and links tasks to notes; a second plugin is created and integrates through capabilities/events.
8. Intentionally inject a runtime defect into the task plugin.
9. The Core and AI chat remain running. The task plugin is isolated. An incident is created automatically.
10. Repair Agent diagnoses and patches the defect in staging, runs validation and reloads the plugin.
11. If a deliberately unrepairable defect is used instead, the retry budget is exhausted, the plugin is quarantined/rolled back, and the rest of the application remains functional.

This error/repair scenario is a mandatory acceptance test, not an optional enhancement.

## Implementation order

First write `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`. Then implement iteratively, keeping the repository buildable after each milestone:

1. app shell and UI
2. OpenAI-compatible LM Studio chat
3. logging and error/incident foundation
4. Plugin SDK and loader
5. Event Bus and Capability Registry
6. one manually authored demo plugin
7. plugin isolation and lifecycle supervisor
8. Last Known Good / rollback
9. agent tool layer
10. staging/worktree development workflow
11. generated plugin end-to-end flow
12. automated Repair Agent
13. hot reload and post-activation observation
14. regression/dependency graph
15. hardening and end-to-end tests

Do not attempt the entire vision in one giant change.

## Definition of Done for generated changes

A generated feature is complete only when its requirement/feature contract exists, relevant architecture and existing capabilities were inspected, implementation and tests were created, lint/typecheck/tests/build pass, permissions are validated, affected integrations pass, the change is versioned, rollback is possible, activation succeeds and the plugin survives a post-activation health observation window.

A repair is complete only when the original failure is reproducibly covered by a regression test or equivalent validation, the patch passes validation, activation succeeds, no immediate recurrence is detected, and the repair is recorded in incident/change history.

Read all specification files in this package before starting. If a lower-level implementation choice is unspecified, choose the safest reversible design consistent with these requirements and document it. Ask the user only for decisions that are fundamental, high-impact and not reasonably reversible.
