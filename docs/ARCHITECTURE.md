# Workshop Architecture

## Stack decision

Workshop uses Tauri 2 with a Vite and TypeScript frontend. Tauri provides a small native shell while keeping nearly all product code in the required TypeScript/JavaScript runtime. Node 22, Rust, GTK 3, WebKitGTK 4.1, and Chromium are available in the current Linux workspace. Official Tauri prerequisites document desktop support across Linux, macOS, and Windows; release packaging still needs native builds or CI runners for each target.

The initial UI avoids a framework and remote assets. Its small DOM surface can be implemented with semantic HTML, strict TypeScript, and design tokens without hydration or a client-framework runtime.

## Current implementation boundary

The native staging workflow can also apply individually confirmed text edits to a complete snapshot: it adds a new source file or replaces one exact text span that occurs once, with a 256 KiB file limit. Its file-level diff is available only while the snapshot's original project folder is selected. Fixed Bun build, check and test gates run in that staging directory only after a separate confirmation; they have a 120-second limit and capped output, but project scripts still run as user code.

The agent can activate an existing build-registered plugin after confirming its identity and declared permissions. Staging artifacts have a separate user-controlled runtime: after static acceptance checks and direct confirmation, a storage-only classic bundle can run in an opaque-origin iframe in the main workspace. The runtime does not import staging code into Workshop's trusted TypeScript plugin host.

The Tauri shell and OpenAI-compatible chat are implemented. The model can call a bounded read-only tool bridge to list plugins, inspect capability dependencies and incidents, and read a capped set of structured logs. In the native app, a user-selected project folder can be inventoried, searched and source/document text can be read through bounded Rust commands; those tools are offered only for loopback model endpoints. The inventory returns paths and extension counts without file contents, while search and reads use strict count/size limits. The agent can create and retrieve locally stored, schema-validated feature-contract drafts with requirements, capability/permission declarations, persistence needs, acceptance criteria, proposed file paths, validation steps and risks. Drafts are not approvals and do not trigger writes. On explicit request and direct confirmation, the native app can make a bounded snapshot under application data, list snapshots and remove one after confirmation; these snapshots exclude common build/dependency and recognized secret files, and are not Git worktrees. Tool arguments are validated, common credential patterns are removed from returned log messages, and a turn is limited to three rounds and six calls. No active-project mutation or free-form process tool is exposed; process execution is limited to directly confirmed fixed validation gates. The plugin foundation validates manifests, limits storage/event/capability APIs to declared permissions, and tracks lifecycle and capability dependencies. Startup lazily discovers build-registered modules and records rejected modules as incidents. Settings can activate or deactivate the demo notes plugin; the plugin provides a persistent workspace notes UI through its typed capability. The incident journal, bounded lifecycle supervisor, safe-mode state and Last Known Good restore path are connected through the plugin host. A fixed staging artifact pair can be statically checked, previewed after confirmation, and activated in a separate sandboxed iframe in the main workspace. Staged runtime plugins currently support only storage or no permissions, retain namespaced storage, and do not auto-activate after app restart. Hot Reload prepares a hidden sandbox candidate and swaps it in only after startup succeeds; it remains under observation for 10 seconds while the previous version can still be restored after a runtime failure. This isolated runtime does not register staged code in the trusted TypeScript plugin host. Canary observation and persistent catalog installation are implemented for staged plugins. New trusted-plugin incidents receive loopback-only AI diagnosis using their registered activation function (redacted and capped at 4 KiB), bounded redacted runtime logs and stack frames. Active staged-plugin runtime failures trigger diagnosis with a redacted, transient `plugin.js` entrypoint capped at 4 KiB. The Repair Agent may propose one exact, user-confirmed replacement in that artifact's staging copy and statically validate it; repair source is never persisted or automatically executed. Incident history and general incident tools omit stack frames and source. Regression validation and the remaining automatic repair loop are future work. The LM Studio HTTP client uses Tauri's scoped HTTP plugin; a browser-only preview routes the default local endpoint through Vite's fixed loopback proxy.

## Layers and trust boundaries

1. **Stable host**: Tauri process, startup, window, scoped platform commands, recovery entry point.
2. **Workspace shell**: fixed title bar, empty main surface, settings and responsive chat rail.
3. **Provider adapter**: OpenAI-compatible model discovery and chat; local LM Studio defaults to `http://127.0.0.1:1234/v1`.
4. **Control plane**: typed command registry, project inventory, approval and validation gates, progress and incident records.
5. **Plugin SDK/runtime**: manifest parsing, capability/event APIs, namespaced persistence, isolated UI contributions, lifecycle state.
6. **Reliability services**: structured incidents, staging copies, bounded repair attempts, rollback and Last Known Good metadata.

LLM responses and plugin artifacts are untrusted input. The model receives named platform operations rather than a general process or filesystem execution tool. Repository paths are canonicalized and confined to the user-selected root; traversal paths and symlinks are rejected, and reads are limited by extension, size and result caps. The inventory reveals filenames but not file contents. Repository tools are unavailable to remote model endpoints. Plugin UI runs in a sandboxed surface with a message-only typed bridge; it has no direct access to the host DOM or other plugins. Capability access is explicit and dependency edges are recorded.

## Persistence and change flow

Provider preferences, chat history, plugin manifests, capability edges, incidents, validation results, activation pointers and version metadata are local application data. SQLite is the planned durable store behind an interface; plugin data is namespaced and migrations are versioned. A staging artifact is not active until its manifest, permissions, fixed entrypoint contract and sandbox startup are accepted. Hot Reload keeps the prior frame available for rollback through a 10-second post-start observation period, then accepts the candidate and releases its recovery snapshot. Users can retain an accepted staging artifact in the local application catalog; activation is revalidated and confirmed each time, and startup never executes installed staged code automatically.

## ADRs

### ADR-001: Tauri 2 and TypeScript

Accepted. Tauri keeps platform code small and suits a cross-platform desktop workspace. Rust is restricted to host and security boundaries. The frontend remains independently buildable and inspectable in Chromium. Native installers require operating-system-specific CI and have not yet been produced.

### ADR-002: Native shell before dynamic feature runtime

Accepted. The first running increment is the shell, provider settings and OpenAI-compatible chat. Plugin generation, staged builds, permissions and bounded repair are separate milestones. The LLM is not allowed to rewrite the core.

### ADR-003: Local provider endpoint

Accepted. LM Studio is the default OpenAI-compatible adapter. Model discovery uses `GET /v1/models`; chat uses `POST /v1/chat/completions`. Local service failure is represented in the UI as an offline state with retry and settings access. No project context is sent to a cloud endpoint implicitly.

### ADR-004: Responsive rail

Accepted. Desktop keeps the persistent right-side chat rail required by the product brief. At narrow widths, a labelled switcher makes workspace and chat individually available rather than compressing both panes. Rail width is a user-adjustable presentation setting.

## References

- Tauri v2 overview and platform prerequisites: https://v2.tauri.app/start/ and https://v2.tauri.app/start/prerequisites/
- LM Studio OpenAI-compatible endpoints and model listing: https://lmstudio.ai/docs/developer/openai-compat and https://lmstudio.ai/docs/developer/openai-compat/models
- Design decisions and token contract: [DESIGN.md](../DESIGN.md)
- Specification source: [CODEX_PROMPT.md](CODEX_PROMPT.md)
