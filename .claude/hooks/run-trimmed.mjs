import { spawn } from "node:child_process";

const command = Buffer.from(process.argv[2] ?? "", "base64").toString("utf8");
const maxLines = 200;
const summary =
  /^\s*(Test Files|Tests|Test Suites|Snapshots|Duration|Start at|Errors?)\b.*$|^\s*\d+ (passed|failed|skipped)\b/;
const passMarker = /^\s*(✓|√|PASS\b|include:|exclude:|\|[\w-]+\|\s*$)/;
const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

const child = spawn("bash", ["-c", command], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
child.on("error", (error) => {
  process.stderr.write(`run-trimmed: ${error.message}\n`);
  process.exit(127);
});
child.on("close", (code) => {
  const lines = output.replace(ansi, "").split(/\r?\n/);
  const summaryLines = lines.filter((line) => summary.test(line));
  let shown;
  if (code === 0) {
    shown = summaryLines.length > 0 ? summaryLines : lines.slice(-10);
  } else {
    const failures = lines.filter(
      (line) => !passMarker.test(line) && line.trim() !== "",
    );
    shown =
      failures.length > maxLines
        ? [
            ...failures.slice(0, maxLines - 50),
            `... ${failures.length - maxLines} lines trimmed (set CLAUDE_FULL_TEST_OUTPUT=1 for all) ...`,
            ...failures.slice(-50),
          ]
        : failures;
  }
  process.stdout.write(`${shown.join("\n")}\n[exit ${code}]\n`);
  process.exit(code ?? 1);
});
