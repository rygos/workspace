# Workshop Design System

## 0. Research Log

- Embedded refs: shortlisted Linear (precise productivity UI), Supabase (dark developer console), and Warp (developer workspace); picked taste-skill + Supabase because a local, code-first tool benefits from a quiet dark console and a single restrained signal color.
- Lazyweb: 4 queries, 1 screen viewed (Miro desktop workspace) -> keep the working canvas visually dominant and make the right utility pane persistent; the empty state remains useful without copying the reference.
- StyleGallery: adopted `scroll-body-shell` for the viewport and a fixed `panel-layout` split for workspace and chat; the chat transcript alone owns its internal scroll.
- Imagen drafts: skipped because the deliverable is an operational desktop shell with no image-led hero or illustrative surface.
- UI/UX database: dark developer console lookup supported a dark-only palette, visible focus states, responsive collapse and restrained green status/action color.
- Stack research: official Tauri v2 and LM Studio documentation supports a TypeScript web UI in a cross-platform desktop shell and OpenAI-compatible `/v1` endpoints.

## 1. Atmosphere & Identity

Workshop feels like a private workbench: quiet, precise, and ready for the user to shape. Its signature is an uninterrupted, deep ink workspace beside a steady chat rail; one soft mineral green signals connection and committed actions.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--surface-canvas` | `#101311` | App background |
| Surface | `--surface-panel` | `#171b18` | Workspace and chat |
| Elevated | `--surface-raised` | `#1e2420` | Inputs, menus, selected wash |
| Hover wash | `--surface-hover` | `#252c27` | Hover and active rows |
| Primary ink | `--ink-primary` | `#edf1ed` | Main text |
| Secondary ink | `--ink-secondary` | `#a1aaa2` | Explanatory text |
| Muted ink | `--ink-muted` | `#737e75` | Hints and metadata |
| Divider | `--line-subtle` | `#2a322c` | Structural separation |
| Accent | `--accent` | `#75c995` | Primary action, online indicator |
| Accent hover | `--accent-strong` | `#91dcaa` | Hover feedback |
| Error | `--status-error` | `#e28a84` | Errors with adjacent text |
| Warning | `--status-warning` | `#e6c27a` | Warnings with adjacent text |

The palette adapts Supabase's dark neutral and mineral-green roles. Colors are tokens; state selection uses a tonal wash and text/glyph, never an accent border.

## 3. Typography

- Primary: system UI stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif); no remote font request.
- Mono: `ui-monospace`, `SFMono-Regular`, `Cascadia Code`, monospace for model identifiers and technical metadata.
- Display 32px/1.2, section 20px/1.35, body 15px/1.5, compact 13px/1.45, metadata 12px/1.4. Interactive labels and essential body copy do not go below 13px.

## 4. Spacing & Layout

- Base unit: 4px. Tokens: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-6: 24px`, `--space-8: 32px`, `--space-10: 40px`.
- The app uses a `100dvh` grid shell with a fixed 48px title bar, a fluid main workspace, and a right rail initially 360px wide.
- The rail can be resized from 300px to 520px, collapsed, and restored. Under 820px, the app switches between workspace and chat as single panels. DOM order remains title bar, workspace, chat.
- Named pattern: StyleGallery `scroll-body-shell` for the fixed shell; `panel-layout` for its split. Chat transcript is the only inner scroll owner; its title and composer remain fixed. The workspace owns vertical scrolling; the notes feed stays in normal flow without a nested scroll region.
- The transcript and workspace content use `min-block-size: 0` and `min-inline-size: 0` so long conversations and unbroken identifiers cannot stretch the shell. The notes feed follows StyleGallery `feed` for repeated items: [scroll-body-shell](https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md), [feed](https://github.com/changeroa/StyleGallery/blob/main/patterns/stacking/feed.md).

## 5. Components

### App Shell
- **Structure**: title bar, main workspace, complementary chat rail.
- **Variants**: expanded rail, collapsed rail; wide split, compact single-panel.
- **Spacing**: 4px base; 16px workspace gutter.
- **States**: default, workspace view, chat view, rail collapsed, focus-visible.
- **Accessibility**: named main and complementary landmarks; keyboard-operable rail controls; DOM order is reading order.
- **Motion**: immediate state change with a 180ms opacity/transform transition; reduced motion removes positional movement.
- **Layout**: `scroll-body-shell`; only workspace or chat content may scroll within its own bounded region.

### Chat Transcript
- **Structure**: panel header, connection status, scrollable message list, fixed labelled composer.
- **Variants**: empty, connecting, connected, offline, generating, error.
- **Spacing**: 12px message rhythm; 16px panel inset.
- **States**: default, empty prompt, streaming, retry offered, settings requested.
- **Accessibility**: labelled textarea, submit button, polite live region for new assistant content, errors announced beside the input.
- **Motion**: streaming status appears in place; reduced motion preserves the state without pulsing.
- **Layout**: utility rail; transcript owns vertical scroll; header and composer do not scroll.

### Text Button and Input
- **Structure**: visible label or accessible name, control, adjacent helper/error text.
- **Variants**: primary, quiet, destructive; single-line, multiline, password.
- **Spacing**: 8px inline and 12px control inset.
- **States**: default, hover, active, focus-visible, disabled, loading, error.
- **Accessibility**: native buttons and fields; labels remain visible; 44px minimum target on touch layouts.
- **Motion**: 120ms tonal transition; no layout animation.
- **Layout**: inline cluster or vertical stack; content determines width.

### Settings Dialog
- **Structure**: labelled dialog, grouped provider, development, extension and reliability settings, save/cancel controls.
- **Variants**: provider settings, development mode, plugin lifecycle controls, installed staging artifacts, recent incidents and safe mode.
- **Spacing**: 24px sections, 12px fields.
- **States**: default, saving, saved, invalid field, plugin discovered, active, disabled, quarantined, installed but not activated, Last Known Good available, and repair diagnosis queued, running, complete, unavailable or failed.
- **Accessibility**: focus moves into the dialog and returns to its opener; Escape closes it; fields have visible labels.
- **Motion**: 180ms fade/scale; reduced-motion fade only.
- **Layout**: modal overlay; dialog body scrolls only when viewport height requires it.

### Plugin Manager and Notes Workspace
- **Structure**: settings lists discovered plugin modules and lifecycle actions; an active workspace contribution replaces the empty state with a notes form and ordered feed.
- **Variants**: plugin discovered, active, disabled, quarantined, explicitly marked healthy, restored; notes empty, populated, creating, editing and error.
- **Spacing**: 4px base, 12px feed gap, 16px card inset.
- **States**: actions have visible labels and feedback; status is conveyed in text as well as color.
- **Accessibility**: native forms, ordered list semantics, visible labels and focus, keyboard-operable actions.
- **Motion**: no new motion; state changes follow the existing immediate layout behavior.
- **Layout**: notes remain in the workspace's existing scroll region; the feed itself does not scroll.

### Isolated Plugin Preview
- **Structure**: staging-copy selector, explicit preview action, status text and a bounded iframe viewport.
- **Variants**: no project selected, no staging copy, incompatible artifact, loading, running and failed.
- **Spacing**: follows the settings section and field tokens; preview viewport uses the existing control radius and canvas surface.
- **States**: status is written in text; errors remain outside plugin-controlled DOM.
- **Accessibility**: labelled native selector and button, live status, titled sandbox frame; closing Settings terminates the frame.
- **Motion**: no added motion.
- **Layout**: preview stays inside the scrollable settings body and has a minimum 180px height.

## 6. Motion & Interaction

| Type | Duration | Easing | Use |
|---|---|---|---|
| Micro | 120ms | ease-out | Button and focus feedback |
| Standard | 180ms | ease-in-out | Rail collapse, dialog |

Only `transform` and `opacity` animate. Drag resizing tracks pointer input directly; pointer and keyboard controls both adjust pane size. `prefers-reduced-motion` switches movement to opacity or an immediate state. Hover never carries unique information.

## 7. Depth & Surface

- Strategy: tonal shift with subtle structural dividers; no decorative shadows.
- The chat rail is one shade above the canvas, separated with `--line-subtle`. Composer and settings fields use `--surface-raised`.
- Radius tokens: `--radius-control: 8px`, `--radius-panel: 12px`, `--radius-dialog: 16px`.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA, 4.5:1 body-text contrast, visible keyboard focus, logical keyboard order, reduced-motion support, and no color-only status.
- At 375px, hide the inactive panel through view switching rather than narrowing both panes below usability.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Localized UI strings are initially German | Initial shell | The specification and request are German; localization infrastructure is a later platform feature. | Product / before localization work |
| Native platform integrations beyond the shell are phased | `src-tauri` | A running, recoverable shell and provider take priority before plugin expansion. | Platform / roadmap Phase 3 |
