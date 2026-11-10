import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const apiDir = `${root}services/api`;
const composeFile = `${root}infra/docker/docker-compose.yml`;
const namePattern = /^[a-z][a-z0-9_]*_test$/;
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const parseUrl = (name, value) => {
  try {
    return new URL(value);
  } catch {
    return fail(`${name} is not a valid URL.`);
  }
};

const resolveTarget = () => {
  const devUrl = process.env.DATABASE_URL;
  const explicit = process.env.TEST_DATABASE_URL;
  let url;

  if (explicit) {
    url = parseUrl("TEST_DATABASE_URL", explicit);
  } else if (devUrl) {
    url = parseUrl("DATABASE_URL", devUrl);
    const devName =
      decodeURIComponent(url.pathname.slice(1)) || "onemarketplace";
    url.pathname = `/${devName}_test`;
  } else {
    return fail("Set TEST_DATABASE_URL or DATABASE_URL.");
  }

  const name = decodeURIComponent(url.pathname.slice(1));

  if (!namePattern.test(name)) {
    fail(`Refusing database name "${name}": it must match ${namePattern}.`);
  }

  const devName = process.env.POSTGRES_DB;

  if (devName && name === devName) {
    fail(`Refusing database name "${name}": it is the development database.`);
  }

  if (!localHosts.has(url.hostname)) {
    fail("The test database host must be localhost.");
  }

  return { url, name };
};

const quoteIdent = (name) => `"${name}"`;

const createWithDocker = (name, url) => {
  const compose = readFileSync(composeFile, "utf8");
  const block = compose.match(/^ {2}postgres:\n((?: {4}.*\n|\n)+)/m)?.[1] ?? "";
  const container = block.match(/container_name:\s*(\S+)/)?.[1];

  if (!container) {
    fail("Could not read the Postgres container name from the compose file.");
  }

  const user = process.env.POSTGRES_USER || decodeURIComponent(url.username);

  if (!user) {
    fail("Set POSTGRES_USER.");
  }

  const psql = (sql) =>
    execFileSync(
      "docker",
      [
        "exec",
        container,
        "psql",
        "-U",
        user,
        "-d",
        "postgres",
        "-tA",
        "-c",
        sql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${name}'`);

  if (!exists.trim()) {
    psql(`CREATE DATABASE ${quoteIdent(name)}`);
  }
};

const createWithPg = async (name, adminUrl) => {
  const require = createRequire(`${apiDir}/package.json`);
  const { Client } = require("pg");
  const client = new Client({ connectionString: adminUrl });

  await client.connect();

  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );

    if (!rowCount) {
      await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
    }
  } finally {
    await client.end();
  }
};

const create = async () => {
  const { url, name } = resolveTarget();
  const adminUrl = process.env.CREATE_TEST_DB_ADMIN_URL;

  try {
    if (adminUrl) {
      const admin = parseUrl("CREATE_TEST_DB_ADMIN_URL", adminUrl);

      if (!localHosts.has(admin.hostname)) {
        fail("The admin database host must be localhost.");
      }

      await createWithPg(name, adminUrl);
    } else {
      createWithDocker(name, url);
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    fail(`Could not create database "${name}": ${reason}`);
  }

  console.log(`Test database ready: ${name}`);
};

const migrate = () => {
  const { url, name } = resolveTarget();
  const bin = `${apiDir}/node_modules/drizzle-kit/bin.cjs`;
  const result = spawnSync(process.execPath, [bin, "migrate"], {
    cwd: apiDir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url.href },
  });

  if (result.status !== 0) {
    fail(`Migration failed for database "${name}".`);
  }
};

const command = process.argv[2];

if (command === "create") {
  await create();
} else if (command === "migrate") {
  migrate();
} else {
  fail("Usage: test-db.mjs <create|migrate>");
}
