# infra

Local infrastructure. Today this is `docker/docker-compose.yml` with Postgres 18, Redis 8 and RabbitMQ 4.4 (`rabbitmq:4.4.0-management-alpine`, pinned to the exact patch tag; AMQP on 5672 and the management UI on 15672, both bound to `127.0.0.1`, `RABBITMQ_USER` and `RABBITMQ_PASSWORD` required).

- Drive it through `pnpm infra:up`, `infra:down` and `infra:logs`. `infra:reset` deletes volumes and all local data; ask first.
- Credentials come from the gitignored root `.env`. Document every new variable in `.env.example` with a placeholder value.
- Bind published ports to `127.0.0.1` only.
- Image tags: Postgres and Redis keep a major-version tag; RabbitMQ is pinned to the exact patch tag `4.4.0-management-alpine`. Prefer exact patch tags for stateful services. Give every service a healthcheck.
- Compose files must fail when a required credential is unset. No default passwords.
- Never read or print `.env`, and never commit it.
