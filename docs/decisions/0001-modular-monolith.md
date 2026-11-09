# 0001: Modular monolith for the backend

Status: accepted

## Context

The marketplace needs a backend for jobs, proposals, contracts, payments and messaging. The team is small and the domain boundaries are still moving. The repository convention so far was one service per domain (`<domain>-service`).

## Decision

Build one Express service, `services/api`, as a modular monolith. Domains are modules inside it with explicit boundaries. The database schema, migrations and event code live inside `services/api` (amended by ADR 0003; there is no `packages/db` or `packages/events`).

## Consequences

- One deployable, one local process, and in-process calls between modules keep early development simple.
- Modules must not read each other's tables or import each other's internals. Boundaries are enforced by review and, later, lint rules.
- A module can be split into its own service later because it already talks to others through a public interface or events.
- The earlier `<domain>-service` convention is superseded. Root `AGENTS.md` is updated accordingly.
