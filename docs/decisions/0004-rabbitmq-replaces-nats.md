# 0004: RabbitMQ replaces NATS for notification events

Status: accepted

This supersedes decision 5 of ADR 0003 (NATS is optional). The optional-broker rule itself is kept; the broker changes.

## Context

The tutorial API published notifications to NATS JetStream and stored them from a consumer. The `nats` package is deprecated, and the broker was optional: the API had to run with only Postgres and Redis. NATS was never part of the local Docker Compose file.

## Decision

Use RabbitMQ 4.4.0 (`rabbitmq:4.4.0-management-alpine`) with `amqplib` and `amqp-connection-manager`. `amqplib` ships its own types, so `@types/amqplib` is not used. The broker is added to `infra/docker/docker-compose.yml`, bound to `127.0.0.1` (AMQP 5672, management UI 15672), with credentials required from `.env`.

### Topology

Declared by `src/events/topology.ts` and asserted on every channel (re)connect:

- Topic exchange `notifications`, routing key `notifications.created`.
- Quorum queue `notifications.storage`, bound to the exchange, with `x-delivery-limit` 5, `x-dead-letter-exchange` `notifications.dlx`, `x-dead-letter-strategy` `at-least-once` and `x-overflow` `reject-publish`.
- Fanout dead-letter exchange `notifications.dlx` and durable queue `notifications.dead`.

### Envelope

Every message is `{ id, type, version, occurredAt, payload }`: `id` is a UUID, `type` is `notifications.created`, `version` is 1, `occurredAt` is an ISO timestamp. It is validated with zod on the consumer side.

### Publishing

Messages are persistent and published on a confirm channel, so `sendNotification` resolves only after the broker confirms. A publish times out after 2 s and is retried once. `sendNotification` never fails the request: a publish failure is logged (`queue.publish.failed`) and swallowed.

### Consuming

- Manual acknowledgement, prefetch 10, one database row per message.
- Idempotency: `notifications.event_id` is the envelope `id` (unique), and the insert uses `onConflictDoNothing`. A redelivered message is acknowledged without a second row or push.
- The row is stored first, then acknowledged, then pushed over SSE. A push failure is logged and does not affect the message.

### Failure handling

- Malformed messages (invalid JSON or envelope) and database errors of class 22 or 23 (data and constraint errors) are rejected without requeue and dead-lettered to `notifications.dead`.
- Any other database error is treated as transient: the message is requeued, the consumer is cancelled (paused) and resumed after a database ping succeeds, with exponential backoff from 1 s capped at 30 s.
- Finding: on RabbitMQ 4.4 over AMQP 0.9.1, `basic.nack` with `requeue=true` does not increment the quorum queue delivery count (verified experimentally). The broker `x-delivery-limit` therefore does not bound a poison message that the consumer keeps nacking. The consumer keeps an in-memory failure count per envelope id (limit 5, the same default) and dead-letters the message when it is reached. The count resets when the API restarts. The broker limit still applies to messages returned by a dying consumer channel (for example a crash with unacknowledged messages).
- Alternative considered: carry an attempt count in an `x-attempt` header and republish the message on each failure. It survives restarts, but republishing breaks ordering, creates a window for duplicates or loss between publish and ack, and needs a second publish path. Rejected for now; the in-memory count is simple and the idempotent insert makes the duplicates harmless.

### Optional at startup

Without `RABBITMQ_URL` the publisher is a no-op, the consumer is not started, and the API runs with only Postgres and Redis. Notifications are then neither stored nor pushed. The admin system health reports `rabbitmq` status only (`{ ok, latencyMs? }`, from a 2 s exchange check), and shutdown stops the consumer before closing the connection.

## Consequences

- Decision 5 of ADR 0003 is superseded. NATS references remain only in ADR 0003 and this ADR as history.
- There is no outbox. Several places publish after a database commit; if the publish fails (or the process dies between commit and publish), the notification is lost. The places are:
  - `proposals.service.ts`: 122, 234
  - `proposals.controller.ts`: 113, 162
  - `agency.service.ts`: 885, 1117, 1447
  - `contracts.service.ts`: 340, 1380, 1564
  - `contracts.controller.ts`: 127, 137, 208, 254, 390
  - `payouts.service.ts`: 210

  A transactional outbox is the fix if notifications must be reliable; it is not decided.

- Delivery is at least once, and the insert is idempotent, so duplicates do not create rows.
- The in-memory failure count is per process and resets on restart; a poison message can take up to five more attempts after a restart.
- The failure count is in-memory and resets on restart; the broker delivery limit still covers consumer crashes.
- Docker is not needed to run the API, but it is needed to run the RabbitMQ integration test and to inspect the dead-letter queue in the management UI (`http://127.0.0.1:15672`).
- Compose pins RabbitMQ to the exact patch tag (see `infra/AGENTS.md`).
