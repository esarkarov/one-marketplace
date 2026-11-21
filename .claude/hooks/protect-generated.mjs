import { execFileSync } from "node:child_process";
import {
  deny,
  projectDir,
  readInput,
  relativeToProject,
  targetFile,
} from "./lib.mjs";

const isTracked = (rel) => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], {
      cwd: projectDir(),
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

try {
  const input = await readInput();
  const target = targetFile(input);
  const rel = typeof target === "string" ? relativeToProject(target) : null;
  if (rel) {
    const lower = rel.toLowerCase();
    if (lower === "docs/api/openapi.json") {
      deny(
        "Blocked: docs/api/openapi.json is generated. Run pnpm --filter @onemarketplace/api openapi:generate.",
      );
    }
    if (lower.startsWith("packages/api-client/src/generated/")) {
      deny(
        "Blocked: packages/api-client/src/generated is generated. Run pnpm --filter @onemarketplace/api-client generate.",
      );
    }
    if (lower.startsWith("services/api/drizzle/") && isTracked(rel)) {
      deny(
        `Blocked: ${rel} is an applied migration file. Migrations are append-only; add a new migration through /db-change.`,
      );
    }
  }
} catch {
  deny("Blocked: protect-generated hook could not parse the tool input.");
}
