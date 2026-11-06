# 0002: Local Postgres and Redis in Docker

Status: accepted

## Context

Developers need the same database and cache locally as the planned production setup, without installing them on the host.

## Decision

Run Postgres 18 and Redis 8 with Docker Compose from `infra/docker/docker-compose.yml`, driven by `pnpm infra:*` scripts. Credentials come from a gitignored root `.env`; `.env.example` documents the variables. Ports bind to `127.0.0.1` only. Data persists in named volumes.

## Consequences

- Docker is a prerequisite for backend and database work.
- `pnpm infra:reset` deletes the volumes and all local data.
- Compose refuses to start if credentials are unset, so no default passwords are used.
- Production hosting is not decided and is to confirm.
