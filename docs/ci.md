# CI

One workflow, `.github/workflows/ci.yml`, runs on pull requests, pushes to `main` and a weekly schedule (Mondays 04:17 UTC). The weekly run executes only `audit` and `codeql`. The workflow has `permissions: {}` at the top and each job grants itself only what it needs.

## Required status check

Require one check in the branch ruleset: `ci-pass`. It depends on every blocking job and fails unless each one succeeded. The only job allowed to be skipped is `dependency-review`, which runs on pull requests only. `ci-pass` does not run on the weekly schedule, where `audit` and `codeql` report on their own. `audit` is informational and is not part of `ci-pass`. `codeql` and `dependency-review` roll up into `ci-pass`, so they do not need their own required checks.

## Jobs

| Job                 | What it proves                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`             | Formatting, lint and typecheck pass (`pnpm check`).                                                                                                                                                                   |
| `build`             | The five Next.js apps and the API build (`pnpm -r build`). No environment variables are needed. The Next.js build cache is restored from `apps/*/.next/cache`.                                                        |
| `api-test`          | API tests pass against Postgres, Redis and RabbitMQ service containers, with coverage. A script fails the job if the RabbitMQ integration test file is missing from the JUnit report or any of its tests was skipped. |
| `gitleaks`          | No secrets in the full Git history. The binary is downloaded from a pinned release and checked against a hardcoded SHA-256.                                                                                           |
| `audit`             | `pnpm audit --prod --audit-level high` output, written to the job summary. Informational, never blocks.                                                                                                               |
| `dependency-review` | A pull request adds no dependency with a known high or critical vulnerability. Pull requests only.                                                                                                                    |
| `codeql`            | CodeQL static analysis for JavaScript and TypeScript, results in the Security tab.                                                                                                                                    |
| `workflow-lint`     | actionlint finds no errors in the workflows. The binary is pinned and checked against a hardcoded SHA-256.                                                                                                            |
| `compose-validate`  | `infra/docker/docker-compose.yml` is valid with placeholder values and fails when any required credential is unset.                                                                                                   |
| `ci-pass`           | Aggregates the blocking jobs into one status.                                                                                                                                                                         |

`api-test` uploads `services/api/coverage` and `services/api/test-results/junit.xml` as the `api-test-results` artifact (kept 7 days) and writes test, failure and skipped counts to the job summary.

CodeQL is configured in the workflow. Do not also enable GitHub's CodeQL default setup in the repository settings; the two conflict.

## Run the checks locally

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm -r build
```

API tests with coverage and the RabbitMQ integration test (needs `pnpm infra:up` and `RABBITMQ_URL` in `.env` pointing at the local broker):

```bash
pnpm --filter @onemarketplace/api db:test:setup
pnpm --filter @onemarketplace/api exec vitest run --coverage --coverage.reporter=text-summary --coverage.reporter=lcov --coverage.reporter=json-summary --reporter=verbose --reporter=junit --outputFile.junit=test-results/junit.xml
node .github/scripts/verify-integration-junit.mjs services/api/test-results/junit.xml src/events/rabbitmq.integration.test.ts
```

Other checks:

```bash
gitleaks git --config .gitleaks.toml --redact -v --no-banner .
gitleaks dir .github docs --config .gitleaks.toml --redact --no-banner
actionlint .github/workflows/ci.yml
pnpm audit --prod --audit-level high
POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x REDIS_PASSWORD=x RABBITMQ_USER=x RABBITMQ_PASSWORD=x \
  docker compose -f infra/docker/docker-compose.yml config -q
```

Use placeholder values only. Install gitleaks and actionlint from their GitHub releases and check the download against the release checksums file.

## Bump a pinned action or tool

1. Find the new tag and resolve it: `git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>' 'refs/tags/<tag>^{}'`. Use the line ending in `^{}` when it exists (annotated tag); otherwise use the plain line.
2. Replace the 40-character SHA and the trailing `# vX.Y.Z` comment everywhere the action is used. `github/codeql-action/init` and `github/codeql-action/analyze` must use the same SHA.
3. For gitleaks and actionlint, update the version and the hardcoded SHA-256 from the checksums file of that release (`gitleaks_<version>_checksums.txt`, `actionlint_<version>_checksums.txt`) for the exact Linux asset. Never compute the hash from your own download.
4. Run actionlint on the workflow.

Dependabot proposes action bumps weekly with a 3-day cooldown and also covers the pinned images in `infra/docker/docker-compose.yml`. It does not update the gitleaks and actionlint versions or hashes.

The service image tags in `ci.yml` (`postgres`, `redis` and `rabbitmq` under `api-test`) are not covered by Dependabot, which scans only `infra/docker`. Keep them in sync with `infra/docker/docker-compose.yml` by hand when that file changes.
