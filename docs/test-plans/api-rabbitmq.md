# Test plan: Stage 4a manual verification of RabbitMQ notifications

## Scope

`services/api` notification events on RabbitMQ (ADR 0004): `config/rabbitmq.ts`, `events/topology.ts`, `events/envelope.ts`, `events/publisher.ts`, `events/consumer.ts`, startup and shutdown in `server.ts`, and `getSystemHealth` in `admin.service.ts`. Unit tests use stubs; nothing below needs real code changes, but it needs Docker and a running API.

Use throwaway credentials only. Never use or print the real `.env`.

Preconditions for all sections unless stated: `pnpm infra:up` (Postgres, Redis, RabbitMQ healthy), `RABBITMQ_URL` set in the API environment, API started with `pnpm --filter @onemarketplace/api dev`, management UI at `http://127.0.0.1:15672`, a user that can trigger a notification (for example submit a proposal).

Legend: I integration, E end to end / manual.

## 1. Startup

| #   | Scenario               | Steps                                                                     | Expected                                                                                                                                                                                                                                | Type |
| --- | ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1.1 | Topology created       | Start the API against a fresh broker; open Exchanges and Queues in the UI | Exchanges `notifications` (topic) and `notifications.dlx` (fanout); quorum queue `notifications.storage` with delivery limit 5 and dead-letter args; `notifications.dead`; `queue.connected` and `queue.consumer.started` logged (info) | E    |
| 1.2 | No `RABBITMQ_URL`      | Unset it, start the API, trigger a notification                           | API starts and serves requests; no connection attempt and no `queue.*` logs; nothing stored or pushed; no error logged                                                                                                                  | E    |
| 1.3 | Broker down at startup | `pnpm infra:down`, start the API with `RABBITMQ_URL` set                  | Start is not blocked by the broker or fails with a clear error (record which); connection warnings logged (`queue.connection.failed`), no `queue.connected`, no credentials in logs                                                     | E    |
| 1.4 | Broker comes up later  | After 1.3, run `pnpm infra:up`                                            | `queue.connected` logged, topology asserted, consumer subscribed (`queue.consumer.started` is logged only at startup, so it will not appear again); record whether a restart is needed                                                  | E    |

## 2. Publish and consume

| #   | Scenario              | Steps                                                                           | Expected                                                                                                                                                                                                                                                             | Type |
| --- | --------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 2.1 | Happy path            | Trigger a notification; watch `notifications.storage` in the UI                 | Message consumed and acknowledged; one `notifications` row with `event_id` set; SSE client receives the event                                                                                                                                                        | E    |
| 2.2 | Duplicate delivery    | Publish the same envelope twice from the UI (same `id`)                         | Both acknowledged; one row only; one push                                                                                                                                                                                                                            | E    |
| 2.3 | Broker killed mid-run | `docker stop` the RabbitMQ container while the API runs; trigger a notification | `queue.disconnected` (info) and `queue.connection.lost` (warn) logged when the connection drops. The request still succeeds with its normal response and `queue.publish.skipped` is logged immediately (no 2 s wait, no retry); the notification is lost (no outbox) | E    |
| 2.4 | Broker returns        | `docker start` it again; trigger a notification                                 | `queue.connected` logged again on reconnect; connection and channels recover without restarting the API; new notification stored and pushed                                                                                                                          | E    |

## 3. Consumer pause and resume

| #   | Scenario                | Steps                                                          | Expected                                                                                                                                                                        | Type |
| --- | ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 3.1 | Postgres stopped        | Stop the Postgres container; trigger or publish a notification | `queue.message.failed` and `queue.consumer.paused` (info) logged; message requeued; consumer cancelled (zero consumers in the UI); backoff 1 s, 2 s, 4 s ... capped at 30 s     | E    |
| 3.2 | Postgres restored       | Start Postgres                                                 | After a successful ping the consumer resubscribes and `queue.consumer.resumed` (info) is logged, not before; the queued message is stored once and acknowledged; backoff resets | E    |
| 3.3 | Failure count limit     | Keep Postgres down and publish one message; count attempts     | After 5 failed attempts for that envelope id the message is dead-lettered to `notifications.dead` (in-memory count, ADR 0004)                                                   | E    |
| 3.4 | Count resets on restart | During 3.3 restart the API after two failures                  | Count starts again from zero; record the extra attempts                                                                                                                         | E    |

## 4. Dead-letter queue

| #   | Scenario                 | Steps                                                                                                            | Expected                                                                                                               | Type |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| 4.1 | Malformed message        | In the UI publish `not json` to `notifications` with routing key `notifications.created`                         | `queue.message.invalid` logged; message appears in `notifications.dead` (Get messages with requeue off); no row stored | E    |
| 4.2 | Invalid envelope         | Publish valid JSON missing `id` or with `version` 2                                                              | Same as 4.1                                                                                                            | E    |
| 4.3 | Permanent database error | Publish an envelope whose payload breaks a constraint (for example `type` longer than the column allows, if any) | Dead-lettered without requeue and without pausing the consumer                                                         | E    |
| 4.4 | Inspect and purge        | Read a dead-lettered message in the UI, check `x-death` headers, then purge `notifications.dead`                 | Body is the original envelope; reason `rejected` for 4.1 to 4.3 and `delivery_limit` for section 5                     | E    |

## 5. Broker delivery limit

| #   | Scenario                     | Steps                                                                                                                                       | Expected                                                                                                                                    | Type |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 5.1 | Consumer dies unacknowledged | Use a throwaway script that consumes from `notifications.storage` with manual ack and exits (or closes its channel) without acking, 6 times | The delivery count rises on each return; after the limit (5) the broker dead-letters the message to `notifications.dead` (`delivery_limit`) | E    |
| 5.2 | Nack with requeue            | Same script, but `nack(requeue=true)` instead of dying                                                                                      | Delivery count does not rise (RabbitMQ 4.4 over AMQP 0.9.1, ADR 0004); this is why the API keeps its own count                              | E    |

Run 5.1 and 5.2 with the API stopped so it does not compete for messages.

## 6. Shutdown

| #   | Scenario                  | Steps                                   | Expected                                                                                                                                              | Type |
| --- | ------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 6.1 | Graceful shutdown         | Send SIGTERM while messages are flowing | Consumer cancelled and in-flight messages settled, RabbitMQ connection closed, pool and Redis closed, exit code 0, no unacked messages left in the UI | E    |
| 6.2 | Shutdown with broker down | Stop the broker, then SIGTERM           | Exit within the 10 s limit, code 0 or a documented non-zero; no hang on closing channels                                                              | E    |

## 7. Admin health

No entry in the health response carries error text; failures are logged server-side only (`admin.health.redis_failed`, `admin.health.database_failed`).

| #    | Scenario               | Steps                                                  | Expected                                                                                                           | Type |
| ---- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---- |
| 7.1  | Broker up              | Call the admin system health route with an admin token | `rabbitmq: { ok: true }` with no `latencyMs`; `redis` and `database` are `{ ok, latencyMs }`                       | E    |
| 7.2  | Broker down            | Stop the broker and call it again                      | `rabbitmq: { ok: false }` returned instantly (no probe), no error text or URL; other checks unaffected             | E    |
| 7.2b | Redis or Postgres down | Stop Redis (or Postgres) and call the route            | That entry is `{ ok: false }` with no `error` key; the matching `admin.health.*_failed` entry is in the server log | E    |
| 7.3  | Not configured         | Start without `RABBITMQ_URL` and call it               | `rabbitmq: { ok: false }`                                                                                          | E    |

Timing note for 2.3: `queue.publish.skipped` appears once the connection manager has noticed the drop. If a notification is triggered before that, a publish can still wait up to 2 s and log `queue.publish.failed` instead.

## Known unverified at QA time

- All sections above need Docker, a running API and, for sections 2 and 3, a way to trigger real notifications.
- Publish-after-commit gaps (ADR 0004) are not testable beyond 2.3: the lost notification is the expected behavior until an outbox exists.
