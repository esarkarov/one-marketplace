import path from "node:path";
import { fileURLToPath } from "node:url";
import { readInput } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shellOperators = /[|&;<>()$`\n]/;
const testCommand =
  /^(\w+=\S+\s+)*(pnpm(\s+(--silent|-r|--filter\s+\S+|--dir\s+\S+))*\s+((run|exec)\s+)?(test(:[\w-]+)?|vitest|coverage)(\s|$)|vitest(\s|$))/;
const bypass = /(^|\s)CLAUDE_FULL_TEST_OUTPUT=1(\s|$)/;

try {
  const input = await readInput();
  const command = input.tool_input?.command;
  if (
    input.tool_name === "Bash" &&
    typeof command === "string" &&
    process.env.CLAUDE_FULL_TEST_OUTPUT !== "1" &&
    !bypass.test(command) &&
    !shellOperators.test(command) &&
    testCommand.test(command.trim())
  ) {
    const encoded = Buffer.from(command.trim(), "utf8").toString("base64");
    const runner = path.join(here, "run-trimmed.mjs").replaceAll("\\", "/");
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason:
            "Test output trimmed to failures and summary",
          updatedInput: {
            ...input.tool_input,
            command: `node "${runner}" ${encoded}`,
          },
        },
      }),
    );
  }
} catch {
  process.exit(0);
}
