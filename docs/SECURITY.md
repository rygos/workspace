# Security Requirements

Treat LLM output and AI-generated code as untrusted input.

Use explicit permissions for filesystem, network, clipboard, notifications, database, process execution and other sensitive capabilities. The agent also has scoped tool permissions. Avoid unrestricted shell access. Validate tool arguments and paths and prevent traversal outside allowed project/staging areas.

Dependencies introduced by the agent must be visible and policy checked. Avoid unnecessary dependencies. Never send project data to cloud AI implicitly; LM Studio/local OpenAI-compatible provider is the default.

Protect secrets from logs, LLM context, diffs and generated code. Redact credentials. Keep audit records of agent actions without storing hidden reasoning.
