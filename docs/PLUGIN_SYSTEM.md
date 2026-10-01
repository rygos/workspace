# Plugin System

Each plugin should contain `plugin.json`, `src/`, `tests/`, optional `migrations/`, and documentation.

Manifest should cover identity/version, entrypoint, permissions, dependencies, provided/consumed capabilities, emitted/subscribed events, UI contributions, storage/schema version and minimum platform API version.

Plugin SDK should provide lifecycle hooks, UI registration, command registration, capability registration/discovery, event subscription/emission, namespaced storage, logger, health reporting and controlled platform services.

Plugin lifecycle states should include discovered, validated, loaded, active, degraded, failed, quarantined, disabled and updating.

Activation must be transactional where feasible: validate new version, prepare, swap, observe, finalize; on failure restore previous version.
