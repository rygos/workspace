# Mandatory Acceptance Tests

1. App starts on supported development platform with empty workspace and right AI chat.
2. LM Studio unavailable: app remains usable and offers retry/settings.
3. LM Studio available: chat works through OpenAI-compatible API.
4. Notes request produces a validated TypeScript plugin and activates it.
5. Follow-up request modifies notes plugin and retains data.
6. Task plugin can consume a notes capability without direct uncontrolled coupling.
7. Plugin UI render exception is contained; Core/chat stay alive.
8. Plugin event-handler exception is contained and incident is captured.
9. A new trusted-plugin incident or active staged-plugin runtime failure automatically starts a local AI diagnosis and records its bounded summary in incident history; any trusted activation function or staged entrypoint source context is redacted, capped and not persisted.
10. After a staged-plugin runtime incident, repair may apply at most one exact `plugin.js` replacement per attempt to its originating staging copy after direct confirmation; the artifact must pass static acceptance checks and a separately confirmed `bun test` gate before a separately confirmed isolated canary. The repair passes only after ten seconds of observation. Same-plugin Hot Reload must retain rollback during observation. Settings cap attempts per plugin and app session at zero through three, default one; cancellation, runtime failure or validation failure is recorded and consumes an attempt unless repair is unavailable before model execution.
11. Successful repair creates regression validation, passes gates and hot reloads.
12. Immediate recurrence causes failed candidate to be withdrawn.
13. The configured number of matching runtime failures within the configured window triggers the shared lifecycle circuit breaker for trusted and staged plugins. For staged plugins it quarantines the plugin, stops its active runtime and blocks activation and repair canaries. Below the threshold, same-plugin Hot Reload failure restores the previous runtime where available; when the breaker opens, the plugin remains stopped. Quarantine expires after the configured cooldown and never activates the plugin automatically; any activation still requires direct confirmation.
14. Last Known Good state can be restored.
15. Restart after bad activation enters a recoverable state rather than a crash loop.
16. Capability-breaking change triggers tests for known consumers.
17. Agent cannot write outside approved workspace/staging paths through normal tools.
18. Git/change/incident history explains what happened.
19. Staging plugin acceptance checks report the fixed artifact pair, manifest schema, preview permissions and bundle export separately; malformed artifacts fail without running their code.
20. A statically valid staging plugin activates in the main workspace only after direct confirmation, remains isolated in an iframe, and stores declared plugin data under its own persistent namespace. Restarting Workshop does not activate staged code automatically.
21. Hot Reload accepts only the same plugin ID. A candidate is started in a hidden sandbox with transactional storage; after its startup succeeds, the new frame replaces the active frame without restarting Workshop. If candidate startup fails, the previous frame and its stored state remain active. If the replacement later reports a runtime failure, its frame is stopped, its storage changes are rolled back, and the previous version is loaded again automatically.
22. After activation or Hot Reload, the runtime reports a 10-second observation period. Hot Reload remains unavailable during that period; a runtime failure restores the prior version and storage, while a candidate that survives is accepted and its rollback snapshot is released.
23. A user can install a statically accepted artifact after direct confirmation. Its manifest and bounded entrypoint remain in local app storage if the staging copy is removed. Restarting does not execute installed code; each activation revalidates the saved artifact and asks for direct confirmation. Removing an installation also requires confirmation and is blocked while that plugin is active.
