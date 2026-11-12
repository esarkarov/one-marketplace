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

`api-test` also keeps `docs/api/openapi.json` in sync with the code. After the coverage step, "Regenerate OpenAPI spec" runs `pnpm --filter @onemarketplace/api openapi:generate` and "Fail if the OpenAPI spec is stale" runs `git diff --exit-code -- docs/api/openapi.json`, so a pull request that changes routes or schemas without committing the regenerated spec fails. The steps live in `api-test` because it already has checkout, Node, pnpm and installed dependencies; a separate job would repeat that setup. The generator needs no secrets, database or extra env entries: it sets its own dummy environment. `.gitattributes` enforces LF (`* text=auto eol=lf`), so line endings do not cause false drift.

`api-test` uploads `services/api/coverage` and `services/api/test-results/junit.xml` as the `api-test-results` artifact (kept 7 days) and writes test, failure and skipped counts to the job summary.

CodeQL is configured in the workflow. Do not also enable GitHub's CodeQL default setup in the repository settings; the two conflict.

CodeQL reads `.github/codeql/codeql-config.yml` (the `config-file` input of the `init` step). It excludes test code from analysis with `paths-ignore`: `**/*.test.ts`, `**/*.test.tsx` and `**/test/**`. Add a pattern there if test helpers live elsewhere. The first CodeQL run after a change to this file shows whether the exclusion took effect; nothing here can run locally.

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
node .github/scripts/verify-integration-junit.mjs services/api/test-results/junit.xml src/infrastructure/events/rabbitmq.integration.test.ts
```

OpenAPI spec drift (no infrastructure needed):

```bash
pnpm --filter @onemarketplace/api openapi:generate
git diff docs/api/openapi.json
```

Commit the regenerated file if the diff is expected.

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

## Supply-chain policy

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`. pnpm (checked against the pnpm 12.15 docs and pnpm 12.18.0) will not resolve or install a package version published less than 1440 minutes (1 day) ago. This applies to every dependency, transitive ones included, and `pnpm install --frozen-lockfile` (local and in the `check`, `build` and `api-test` jobs) verifies the lockfile against it.

Because the value is set explicitly, pnpm's strict mode is on: resolution fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` instead of falling back to a younger version. Without the setting, pnpm's built-in 1-day default is non-strict. On pnpm 12.18.0 that default installed a version published hours earlier and wrote it into `minimumReleaseAgeExclude` by itself, so the age check never actually blocked anything.

**Why 1 day.** Compromised or defective releases are usually found and pulled from the registry within hours, so a day of delay avoids most of them at little cost to normal work. Dependabot adds its own 3-day cooldown on top (see `.github/dependabot.yml`).

**One-off exception for an urgent patch.** List the exact version in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - some-package@1.2.3
```

Pin the version (`name@version`) instead of the bare name, because a bare name exempts every version of the package. Put the change in its own commit and link the advisory in the commit message. Remove the entry once the version is a day old.

**Never lower the value casually.** Do not reduce `minimumReleaseAge`, set it to 0, or exclude a whole package without a reviewed pull request that states the reason.

**Check that it is enforced.** In an empty directory outside the repository, create a `package.json` with `"packageManager": "pnpm@12.18.0"` and a `pnpm-workspace.yaml` containing `packages: []` and `minimumReleaseAge: 1440`. Then run `pnpm add <package>@<version published today> --lockfile-only`. It must fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, while an older version succeeds. `--lockfile-only` resolves without installing or running anything.

## Accepted advisories

`pnpm audit` (the informational `audit` job) reports two moderate advisories. Both are accepted for now: no dependency or override was changed for them.

| Advisory                                                                                      | Package     | Where it comes from                                                                                                                                                  | Why it is not exploitable here                                                                                                                                     | Revisit when                                                                 |
| --------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (minimatch DoS)      | `minimatch` | `minimatch` 10.2.6 through eslint 10 and `@eslint/config-array` (lint toolchain only). Vulnerable <11.0.1, patched >=11.0.1.                                         | Dev tooling only; no runtime code uses it. Exploiting it needs an attacker-controlled glob pattern, and eslint only reads globs from this repository's own config. | An eslint release depends on `minimatch` >=11.0.1.                           |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (esbuild dev server) | `esbuild`   | `esbuild` 0.18.20 through `drizzle-kit`, `@esbuild-kit/esm-loader` and `@esbuild-kit/core-utils` (dev dependency of the API). Vulnerable <=0.24.2, patched >=0.25.0. | The issue is in esbuild's development server, which `drizzle-kit` never starts. Dev-only, with no runtime path and no network exposure.                            | `drizzle-kit` drops `@esbuild-kit` (the latest 0.31.11 still depends on it). |

Do not dismiss these in the GitHub UI without recording the reason here. If either revisit trigger happens, upgrade the parent package instead of adding an override.
