import { appendFileSync, readFileSync } from "node:fs";

const [junitPath, requiredFile] = process.argv.slice(2);

if (!junitPath || !requiredFile) {
  console.error("usage: verify-integration-junit.mjs <junit.xml> <test-file>");
  process.exit(2);
}

const xml = readFileSync(junitPath, "utf8");

const attr = (tag, name) => {
  const match = new RegExp(`\\s${name}="(\\d+)"`).exec(tag);
  return match ? Number(match[1]) : 0;
};

const rootTag = /<testsuites\b[^>]*>/.exec(xml)?.[0] ?? "";
const suiteTags = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map(
  (match) => match[0],
);
const suiteName = (tag) => /\sname="([^"]*)"/.exec(tag)?.[1] ?? "";
const required = suiteTags.filter((tag) =>
  suiteName(tag).endsWith(requiredFile),
);

const sum = (tags, name) => tags.reduce((n, tag) => n + attr(tag, name), 0);
const total = {
  tests: attr(rootTag, "tests") || sum(suiteTags, "tests"),
  failures:
    (attr(rootTag, "failures") || sum(suiteTags, "failures")) +
    (attr(rootTag, "errors") || sum(suiteTags, "errors")),
  skipped: sum(suiteTags, "skipped"),
};
const integration = {
  tests: sum(required, "tests"),
  failures: sum(required, "failures") + sum(required, "errors"),
  skipped: sum(required, "skipped"),
};

const problems = [];
if (required.length === 0) {
  problems.push(`${requiredFile} is missing from the junit report`);
} else {
  if (integration.tests === 0) problems.push(`${requiredFile} ran no tests`);
  if (integration.skipped > 0) {
    problems.push(
      `${integration.skipped} test(s) in ${requiredFile} were skipped`,
    );
  }
  if (integration.failures > 0) {
    problems.push(`${integration.failures} test(s) in ${requiredFile} failed`);
  }
}

const row = (label, counts) =>
  `| ${label} | ${counts.tests} | ${counts.failures} | ${counts.skipped} |`;
const summary = [
  "### API tests",
  "",
  "| Scope | Tests | Failures | Skipped |",
  "| --- | ---: | ---: | ---: |",
  row("All files", total),
  row(requiredFile, integration),
  "",
  problems.length === 0
    ? "RabbitMQ integration tests ran and passed."
    : `RabbitMQ integration check failed: ${problems.join("; ")}.`,
  "",
].join("\n");

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
