# Browser QA — Workshop roadmap increment

## Reference contract

No pixel reference screenshot is present in `docs/` or `assets/`. The reference is the reusable token and responsive behavior contract in `DESIGN.md`; the reference screenshots are therefore marked as unavailable rather than synthesized.

## Enumerated pages and states

Final captures are `*-final.png`; earlier captures remain as the initial audit trail.

1. Desktop workspace and successful model reply at 1280×900: `workspace-chat-success-final.png`.
2. Desktop settings with the live provider status at 1280×900: `settings-provider-desktop-final.png`.
3. Desktop collapsed chat rail with visible control glyphs: `chat-collapsed-desktop-final.png`.
4. Desktop settings after plugin activation: `settings-plugin-active-desktop-final.png`.
5. Mobile provider settings at 390×844: `settings-provider-mobile-final.png`.
6. Mobile settings with the extension active and lifecycle actions available: `settings-plugin-active-mobile-final.png`.
7. Mobile settings with the extension deactivated and restore action available: `plugin-manager-disabled-mobile-final.png`.
8. Mobile notes workspace with a temporary QA note at 390×844: `workspace-notes-mobile-final.png`.
9. Mobile empty workspace at 390×844: `workspace-empty-mobile-final.png`.
10. Mobile empty chat at 390×844: `chat-mobile-empty-final.png`.
11. Desktop chat response after a real structured `list_plugins` tool call: `agent-tool-list-plugins-final.png`.

All captures are PNGs with dimensions matching their requested viewport and RGB color; BrowserSkill returned complete screenshots. No exact-reference image diff was run because there is no reference image to compare.

## Observed interactions

- Provider discovery through the Vite proxy returned HTTP 200 and the browser UI showed `Der Modellserver ist erreichbar.`
- Before the fix, browser chat failed with `net::ERR_ALPN_NEGOTIATION_FAILED`; direct calls to LM Studio and the Vite proxy each returned HTTP 200 with a valid SSE stream.
- With the request body buffered as an `ArrayBuffer`, the same browser request returned HTTP 200. The actual chat UI then received `Chat funktioniert.` from the configured LM Studio model and returned to `Server verbunden`.
- The extension manager activated and deactivated Demo Notes; tests separately cover LKG recording and restore. The final captured states include active and disabled controls.
- Notes were created and edited, survived a reload and explicit reactivation, then were deleted. The temporary chat messages were cleared. No QA note or QA chat message remains in the BrowserSkill Agent Window.
- The settings dialog uses a single scroll area on desktop and mobile. Empty status panels no longer leave blank bordered boxes.
- The configured LM Studio model received the `list_plugins` function schema, called it, and answered with the actual discovered plugin state, version, Last Known Good version and permissions. BrowserSkill observed two successful HTTP 200 SSE `POST /v1/chat/completions` requests for the tool round trip, then the browser showed `Server verbunden`; the generated transcript was cleared after capture.
- Local tests verify tool call streaming, execution and return-to-model flow, as well as strict argument validation, unknown-tool denial, bounded log reads and credential redaction.

## Follow-up after SSE parser extraction

The configured browser model completed the same `list_plugins` query after moving SSE parsing into `desktop/core/openaiStream.ts`. The UI returned the discovered `demo-notes` extension, version `0.1.0`, permissions and status, confirming that the extracted parser still handles the live tool round trip. The browser control connection timed out while clearing this follow-up transcript, so cleanup of this one test conversation is unconfirmed.

## Capture metadata

Final captures were taken after the visual-contract fixes using attached Chrome through BrowserSkill. The measured mobile lifecycle buttons were 44px high with 13px labels; no visible mobile button/input/select target fell below 44px. The hidden provider notice no longer moves the composer into the flexible transcript row. The session was stopped after resetting the temporary note, conversation, and plugin activation.
