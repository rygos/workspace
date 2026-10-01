# Mandatory Acceptance Tests

1. App starts on supported development platform with empty workspace and right AI chat.
2. LM Studio unavailable: app remains usable and offers retry/settings.
3. LM Studio available: chat works through OpenAI-compatible API.
4. Notes request produces a validated TypeScript plugin and activates it.
5. Follow-up request modifies notes plugin and retains data.
6. Task plugin can consume a notes capability without direct uncontrolled coupling.
7. Plugin UI render exception is contained; Core/chat stay alive.
8. Plugin event-handler exception is contained and incident is captured.
9. Runtime defect automatically launches Repair Agent.
10. Repair happens in staging, not directly in active source/artifact.
11. Successful repair creates regression validation, passes gates and hot reloads.
12. Immediate recurrence causes failed candidate to be withdrawn.
13. Repeated unrepairable error hits retry limit/circuit breaker and quarantines or rolls back plugin.
14. Last Known Good state can be restored.
15. Restart after bad activation enters a recoverable state rather than a crash loop.
16. Capability-breaking change triggers tests for known consumers.
17. Agent cannot write outside approved workspace/staging paths through normal tools.
18. Git/change/incident history explains what happened.
