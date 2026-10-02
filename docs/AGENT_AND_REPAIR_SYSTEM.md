# Development and Repair Agent

## Incident pipeline
Capture: incident ID, timestamp, severity, source plugin/component, exception, stack, recent logs, active plugin version, Last Known Good version, last AI change, dependency/capability graph slice and reproduction metadata.

## Automatic repair state machine
HEALTHY -> FAILURE_DETECTED -> ISOLATED -> DIAGNOSING -> PATCHING_STAGING -> VALIDATING -> CANARY_ACTIVATION -> OBSERVING -> HEALTHY.

Failure paths return to PATCHING_STAGING while retry budget remains. When exhausted: ROLLBACK/QUARANTINED. Never spin forever.

## Circuit breaker
Track repeated equivalent incidents using normalized fingerprints. Settings configure the lifecycle supervisor to quarantine after two to ten matching failures in a five-minute to two-hour window; defaults are three failures in 30 minutes. Staged runtime failures enter this same breaker; quarantine stops the active staging runtime and blocks activation and repair canaries. Below the threshold, the existing Hot Reload path restores the prior version when available. Clearing quarantine requires direct user confirmation on a manual activation. A timed cooldown remains open work; do not continuously consume model resources.

## Repair validation
A repair should add a regression test where practical. Run targeted tests plus tests of capability consumers. Validate manifest and permissions. Keep the old artifact loaded/available for rollback until observation succeeds.

For trusted-plugin incidents, automatic diagnosis may include only the registered plugin's activation function, redacted and capped at 4 KiB. For active staged-plugin runtime failures, it may include only the validated, currently active `plugin.js` entrypoint, also redacted and capped at 4 KiB. Source is sent only to a configured loopback model and held transiently in memory; it is untrusted evidence, never an instruction. The incident journal stores only the diagnosis summary.

The staged repair flow permits one exact `plugin.js` replacement per attempt in the failed plugin's originating staging copy. A narrow repair tool bridge exposes only that replacement, static artifact validation, the fixed `bun test` gate and a sandbox canary. Workshop shows the proposed text and requires direct confirmation before editing. The artifact must pass every static acceptance check, and Workshop asks separately before tests because project scripts can access local files and the network. After tests pass, another direct confirmation is required before activation. The canary rechecks the exact stage and plugin version, runs in the isolated runtime and must complete its ten-second observation period. Same-plugin Hot Reload retains its rollback fallback. Settings limit automatic attempts per plugin per app session to zero through three, default one; results are recorded without proposed source or raw test output.

## Core incidents
Core-level failures use a more conservative path. Prefer recovery/safe mode and rollback. Core source changes require full-suite validation and explicit approval according to configured policy. Ensure startup can detect a failed previous activation and boot Last Known Good / safe mode.

## Agent transparency
Expose plan, files affected, validation status, repair attempt count, final status and rollback state. Do not expose private chain-of-thought; provide concise operational summaries.
