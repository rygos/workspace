# Roadmap

## Phase 0 — Design
Architecture, threat model, plugin contract, error containment model, ADRs.

## Phase 1 — Shell
Cross-platform shell, empty workspace, right chat, settings, logging.

## Phase 2 — AI Provider
Generic OpenAI-compatible client with LM Studio defaults, model discovery and graceful offline behavior.

## Phase 3 — Extension Runtime
Plugin SDK, loader, lifecycle, Event Bus, Capability Registry, namespaced storage, demo plugin.

## Phase 4 — Reliability
Error boundaries, lifecycle supervisor, incidents, Last Known Good, safe mode, transactional activation and rollback.

## Phase 5 — Development Agent
Structured tools, repository index, feature contracts, plans, staging worktree/copy, diff and validation pipeline.

## Phase 6 — Self-extension
Natural-language feature -> generated TypeScript plugin -> tests -> activation -> hot reload.

## Phase 7 — Repair Agent
Automatic incident diagnosis, bounded repair loops, regression tests, canary activation, observation, circuit breaker and quarantine.

## Phase 8 — Hardening
Dependency graph regression analysis, permissions, migration safety, export/backups, E2E tests and packaging for Linux/Windows/macOS.
