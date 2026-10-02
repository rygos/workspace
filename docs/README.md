# Codex Specification Package — Self-Evolving AI Desktop Platform

This archive is a self-contained specification for Codex. Copy/extract it into the root of a new project and tell Codex to read `AGENTS.md` and `CODEX_PROMPT.md` first, then all referenced specification files.

The application begins as an empty cross-platform workspace with a right-side chat connected to local LM Studio. User feature requests are implemented as TypeScript/JavaScript plugins. The central reliability requirement is that generated feature failures are isolated and automatically handed to a bounded AI Repair Agent while the stable Core and recovery/chat interface remain available.

Recommended first Codex instruction after extraction:

> Read AGENTS.md, CODEX_PROMPT.md and all specification Markdown files completely. Start with Phase 0. Produce docs/ARCHITECTURE.md and docs/ROADMAP.md before writing application code, then implement incrementally while keeping the project buildable.
