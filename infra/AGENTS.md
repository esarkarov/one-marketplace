# infra

Local infrastructure. Today this is `docker/docker-compose.yml` with Postgres 18 and Redis 8.

- Drive it through `pnpm infra:up`, `infra:down` and `infra:logs`. `infra:reset` deletes volumes and all local data; ask first.
- Credentials come from the gitignored root `.env`. Document every new variable in `.env.example` with a placeholder value.
- Bind published ports to `127.0.0.1` only.
- Pin image tags to a major version and give every service a healthcheck.
- Compose files must fail when a required credential is unset. No default passwords.
- Never read or print `.env`, and never commit it.
