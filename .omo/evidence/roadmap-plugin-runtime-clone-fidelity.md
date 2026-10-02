# Workshop roadmap — independent design-system review

recommendation: REQUEST_CHANGES

VERDICT: REVISE

CONFIDENCE: HIGH for the located source and visible layout defects; no exact pixel reference exists.

## Summary

The UI is live DOM with reusable button, field, feed and panel styling, and its plugin actions and chat trace into real services. It is not a screenshot substitute. Approval is blocked by the chat grid placement, blank collapsed-rail controls, incomplete token use and mobile controls that violate the supplied design contract.

## Evidence inspected

All seven requested captures were directly opened with `view_image`:

- `.omo/evidence/roadmap-plugin-runtime/workspace-chat-success.png` — 1280×900.
- `.omo/evidence/roadmap-plugin-runtime/settings-desktop.png` — 1280×900.
- `.omo/evidence/roadmap-plugin-runtime/settings-mobile-restored.png` — 390×844.
- `.omo/evidence/roadmap-plugin-runtime/plugin-manager-disabled-mobile.png` — 390×844.
- `.omo/evidence/roadmap-plugin-runtime/workspace-notes-mobile.png` — 390×844.
- `.omo/evidence/roadmap-plugin-runtime/workspace-empty-mobile.png` — 390×844.
- `.omo/evidence/roadmap-plugin-runtime/chat-mobile-empty.png` — 390×844.

Read `DESIGN.md`, the shared `qa-log.md`, `desktop/styles/{tokens,app}.css`, `desktop/ui/{shell,pluginManager,notesWorkspace,shellInteractions,resizer,chatView}.ts`, `desktop/plugins/{host,demoNotes}.ts`, `desktop/core/{provider,chatController}.ts`, and the relevant startup wiring in `desktop/main.ts`. Inspected Git status, tracked diff statistics, the complete tracked UI/document diff and the available tracked backend deletion diff. The desktop implementation is untracked, so ordinary `git diff` omits it; the live source files were inspected directly. No notepad path was supplied or discovered in the evidence directory.

PNG signatures, dimensions and RGB mode were independently checked with Pillow. Frames are composited without missing/black regions. Six captures were newer than the latest desktop source at inspection; `chat-mobile-empty.png` was older than `desktop/styles/app.css` (source mtime 1790884369.6397166). RGB screenshots have no alpha channel to score. No reference image, diff ratio, similarity score or hotspot JSON exists; no pixel-match claim is made.

## CRITICAL

None found. No raster/background-image substitute for controls or text.

## HIGH

1. **[product] Chat layout assigns the flexible row to the composer when the provider notice is hidden.** `desktop/styles/app.css:441` defines five automatic rows, while `desktop/ui/shell.ts:87` supplies a hideable second child and `desktop/ui/chatView.ts:60` hides it when online. The remaining children auto-place one row earlier. In `workspace-chat-success.png`, the composer runs approximately y317–868 with a large blank lower area; in `chat-mobile-empty.png`, it runs y481–812. The transcript should own the remaining height under DESIGN.md. Stable row placement is required with the notice both shown and hidden; fresh captures must show the bounded composer and scrollable transcript.

2. **[product] Collapsed rail controls deliberately lose their visible labels.** `desktop/styles/app.css:663` sets both action buttons to `font-size: 0`, and line 669 repeats it for the rail toggle. `desktop/ui/shell.ts:82` and line 83 provide text only; `desktop/main.ts:64` only changes that text to “Ausklappen”. There is no replacement visible icon or label. The result is blank controls for clearing and reopening chat. A visible compact affordance and a collapsed-state capture are required.

3. **[product] The style system remains only partially token driven.** The token palette and spacing scale are reused, but semantic colors remain scattered outside tokens: brand at `desktop/styles/app.css:96`, empty state at line 240, user messages at line 560, composer border/focus at lines 577/582, dialog border/backdrop at lines 678/684, and field border at line 772. Type sizes are per-selector literals rather than shared type roles (lines 103, 110, 219, 302, 469, 608, 713); `desktop/styles/tokens.css:33` uses a 14px base whereas DESIGN.md specifies 15px body. Header sizing is also 52px at app.css:69 against the documented 48px. This fails the required rigorous token-driven implementation gate. Consolidate the visual roles and resolve the contract discrepancies before approval.

## MEDIUM

4. **[product] Mobile touch controls and essential labels violate explicit size requirements.** DESIGN.md requires 44px touch targets and interactive labels at least 13px. `.button` is 36px at `desktop/styles/app.css:141`, `.button--small` is 32px at line 168, `.send-button` is 36px at line 611, and the mobile settings button is explicitly reduced to 32px/12px at lines 1018–1020. No enlarged hit region exists. This is visible in all mobile captures, including note Edit/Delete and plugin lifecycle controls. Apply the touch size requirement consistently; chat header action labels at line 469 also need the 13px floor.

5. **[evidence] The capture set does not establish all claimed coverage on the current source.** `chat-mobile-empty.png` is older than the latest app.css edit, contradicting `qa-log.md`'s all-fresh assertion. `settings-desktop.png` is scrolled to the extension/reliability sections; provider settings and provider status are outside its frame despite the enumerated “provider status and extension manager” coverage claim. Capture the provider portion separately, regenerate the stale mobile frame, and add the collapsed state required to close finding 2. No CJK content appears in the captures, so CJK rendering is untested rather than passed.

## LOW

None additionally recorded. The visible German wrapping is readable without clipped glyphs or one-character orphan lines. The settings scrollbar shown is consistent with its single bounded body scroll area; clipping at its scroll boundary is expected.

## What is good

- Shell, messages, notes and plugin entries are native live elements. Dynamic content uses `textContent`; native forms and buttons are reused.
- `PluginManagerView` calls host activation/deactivation/health/restore methods; notes call a capability service with storage and validation. The chat provider posts requests and reads SSE; the success screenshot contains the returned text. Runtime interaction claims beyond the inspected paths remain the executor's observations, not an independently replayed session in this pass.
- Mobile panels switch rather than squeeze into a split. The notes feed stays in workspace flow and does not introduce a nested scroll region.
- Notes and plugin list additions reuse spacing, radii and surface tokens substantially. Statuses are expressed in text as well as color.
- The supplied settings captures show legible grouped sections and persistent footer actions. No blank feedback box is visible in the seven frames.

## Blocking

- Correct chat row placement in online/offline states.
- Make collapsed controls visibly identifiable.
- Complete semantic token use and reconcile the documented type/layout contract.
- Meet mobile control and interactive label sizes.
- Supply fresh, truthful coverage for mobile chat, provider settings and the collapsed rail.

No product files were modified. This report is the sole review artifact written.
