# packages/db

Drizzle ORM schema, migrations and client for PostgreSQL (planned; nothing is implemented yet). Package name: `@onemarketplace/db`.

- This package is the only place tables are defined. Schema changes and their generated migration go in the same commit.
- Generate migrations with drizzle-kit. Never edit a migration that is already merged; add a new one.
- Ask before any destructive change: dropping a table or column, narrowing a type, or adding a non-null column without a default.
- Connect through `DATABASE_URL`. Never hardcode connection strings.
- Use `snake_case` for table and column names, and an explicit primary key and `created_at` on every table.
- Never run migrations or `infra:reset` against anything but the local Docker database.
