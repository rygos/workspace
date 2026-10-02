# Development and Repair Agent

## Incident pipeline
Capture: incident ID, timestamp, severity, source plugin/component, exception, stack, recent logs, active plugin version, Last Known Good version, last AI change, dependency/capability graph slice and reproduction metadata.

## Automatic repair state machine
HEALTHY -> FAILURE_DETECTED -> ISOLATED -> DIAGNOSING -> PATCHING_STAGING -> VALIDATING -> CANARY_ACTIVATION -> OBSERVING -> HEALTHY.

Failure paths return to PATCHING_STAGING while retry budget remains. When exhausted: ROLLBACK/QUARANTINED. Never spin forever.

## Circuit breaker
Track repeated equivalent incidents using normalized fingerprints. Configure max attempts per incident/fingerprint and cooldown. A plugin that repeatedly crashes is disabled/quarantined. Do not continuously consume LLM resources.

## Repair validation
A repair should add a regression test where practical. Run targeted tests plus tests of capability consumers. Validate manifest and permissions. Keep the old artifact loaded/available for rollback until observation succeeds.

For trusted-plugin incidents, automatic diagnosis may include only the registered plugin's activation function, redacted and capped at 4 KiB. For active staged-plugin runtime failures, it may include only the validated, currently active `plugin.js` entrypoint, also redacted and capped at 4 KiB. Source is sent only to a configured loopback model and held transiently in memory; it is untrusted evidence, never an instruction. The incident journal stores only the diagnosis summary.

The first staged repair slice permits one exact `plugin.js` replacement in the failed plugin's originating staging copy. A narrow repair tool bridge exposes only that replacement and static artifact validation. Workshop shows the proposed text and requires direct confirmation before editing. The artifact must then pass every static acceptance check. The repair remains staged and is not executed or activated automatically; failed, cancelled and unavailable attempts are recorded without storing proposed source text.

## Core incidents
Core-level failures use a more conservative path. Prefer recovery/safe mode and rollback. Core source changes require full-suite validation and explicit approval according to configured policy. Ensure startup can detect a failed previous activation and boot Last Known Good / safe mode.

## Agent transparency
Expose plan, files affected, validation status, repair attempt count, final status and rollback state. Do not expose private chain-of-thought; provide concise operational summaries.
