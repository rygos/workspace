# Architecture Requirements

## Layers
- Stable desktop Core
- UI shell/workspace
- AI chat
- AI Development/Repair Control Plane
- Plugin Runtime
- Plugin SDK
- Capability Registry
- Event Bus
- Plugin lifecycle supervisor
- Incident manager
- Git/staging/version manager
- Local persistence

## Runtime rule
A plugin is disposable; the Core is not. Plugin failures must be contained at lifecycle, event, UI and background-task boundaries.

## TypeScript/JavaScript only
All generated plugins and dynamically added user features use TypeScript/JavaScript in the first architecture generation. Do not add Python/Rust plugin runtimes. Native framework internals may use the minimum required native layer if the chosen desktop framework requires it.

## Plugin interoperability
Plugins publish typed capabilities and events. Maintain a graph of providers and consumers. Direct cross-plugin imports are discouraged/prohibited unless explicitly part of a stable SDK mechanism.

## Hot reload
Reload only validated artifacts. Keep old version available until new version passes an observation window. If hot reload is unsafe for a particular change, degrade gracefully and request/recommend a controlled restart rather than risking Core integrity.
