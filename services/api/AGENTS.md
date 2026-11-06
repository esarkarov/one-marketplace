# services/api

Express modular monolith (planned; nothing is implemented yet). Package name: `@onemarketplace/api`.

- One module per domain. A module owns its routes, services, validation and tables, and exposes a small public interface.
- Never import another module's internals or query its tables. Call its public interface or publish an event.
- All database access goes through `@onemarketplace/db`. Do not create connections or define tables here.
- Validate every request body, query and param at the route boundary before it reaches a service.
- Read configuration from `process.env` in one config module. Never hardcode secrets or URLs.
- Extend `@onemarketplace/tsconfig/node.json` and `@onemarketplace/eslint-config/node`.
- Return consistent error shapes and never leak stack traces or SQL errors to clients.
