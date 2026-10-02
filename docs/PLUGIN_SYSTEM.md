# Plugin System

Each plugin should contain `plugin.json`, `src/`, `tests/`, optional `migrations/`, and documentation.

## Staging preview artifact

A staging snapshot may include an opt-in preview artifact at its root:

- `workshop-plugin.json`: a JSON `PluginManifest` whose `entrypoint` is exactly `plugin.js`.
- `plugin.js`: a self-contained, bundled classic script (maximum 256 KiB) that assigns `globalThis.WorkshopPlugin = { manifest, activate(api) }` and repeats the manifest identity. Imports and exports are not supported by the preview artifact.

The agent can create the manifest and entrypoint together in a complete staging copy after one direct confirmation that shows the plugin identity and permissions. It refuses to overwrite either fixed file. On explicit user request, the agent can start the native Settings preview, which asks separately before running it and returns the actual lifecycle result. The iframe receives a DOM root and the storage facade only when the manifest declares `storage`; the preview uses temporary in-memory storage which is discarded when Settings closes. The preview does not install or activate the staged plugin in Workshop's normal runtime. Other declared permissions currently make the artifact ineligible for preview.

The preview lifecycle is reported as `idle`, `loading`, `running`, `failed`, `cancelled` or `stopped`. Uncaught errors and unhandled promise rejections after startup change the state to `failed` and stop the frame. The local agent can read this status on request; it does not receive the plugin source through this status tool.

`validate_staging_plugin` statically checks that both fixed files can be loaded within their limits, that the manifest matches the plugin schema and preview permission rules, and that the entrypoint contains the documented `globalThis.WorkshopPlugin` export. It does not compile or execute the JavaScript; run the separately confirmed sandbox preview to observe startup behavior.

After passing static checks, a user can activate the staging plugin in the main workspace with a separate confirmation. It remains inside the opaque-origin iframe, receives only its root element and optional storage facade, and uses its persistent plugin namespace. Activation is session-scoped and is not resumed automatically after restart. A separately confirmed install copies the validated manifest and bounded entrypoint into the local application catalog, so removing the source staging copy does not remove the install. Each activation from this catalog revalidates the saved artifact and requires fresh confirmation; startup never runs installed staged code automatically. The catalog holds up to five plugins and 2 MiB total and is stored outside plugin namespaces. Hot Reload starts the replacement in a hidden candidate frame, buffers its storage changes and swaps frames only after the candidate signals successful activation. A failed candidate is discarded and its storage is rolled back, leaving the previous active frame in place. After activation, a 10-second observation period is shown in the workspace; Hot Reload remains disabled during it. A runtime failure during this period stops the candidate, restores its storage snapshot and reloads the previous version when one exists. Once the period succeeds, the runtime releases the rollback snapshot. Storage snapshots are limited to 128 keys and 1 MiB per active version.

Repeated staged runtime failures share the lifecycle supervisor's configurable circuit breaker. It defaults to three matching failures within 30 minutes and can be set to two to ten failures within five minutes to two hours. Quarantine stops the active staged runtime and blocks further activation and repair canaries. Below the threshold, the Hot Reload recovery path restores a previous version when one is available; when quarantine opens, the runtime remains stopped. A user can clear quarantine only by confirming a manual activation; repair-agent actions cannot clear it.

Minimal manifest:

```json
{
  "id": "hello-preview",
  "name": "Hello Preview",
  "description": "A minimal isolated preview.",
  "version": "0.1.0",
  "apiVersion": 1,
  "schemaVersion": 1,
  "entrypoint": "plugin.js",
  "permissions": ["storage"],
  "provides": [],
  "consumes": [],
  "events": [],
  "dependencies": [],
  "uiContributions": []
}
```

Minimal bundled entrypoint:

```js
globalThis.WorkshopPlugin = {
  manifest: { id: "hello-preview", version: "0.1.0", apiVersion: 1 },
  async activate({ root, storage }) {
    const heading = document.createElement("h2");
    heading.textContent = "Hello from the isolated preview";
    root.replaceChildren(heading);
    await storage.set("opened", true);
  },
};
```

Manifest should cover identity/version, entrypoint, permissions, dependencies, provided/consumed capabilities, emitted/subscribed events, UI contributions, storage/schema version and minimum platform API version.

Plugin SDK should provide lifecycle hooks, UI registration, command registration, capability registration/discovery, event subscription/emission, namespaced storage, logger, health reporting and controlled platform services.

Plugin lifecycle states should include discovered, validated, loaded, active, degraded, failed, quarantined, disabled and updating.

Activation must be transactional where feasible: validate new version, prepare, swap, observe, finalize; on failure restore previous version.
