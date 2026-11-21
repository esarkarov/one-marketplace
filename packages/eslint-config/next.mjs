import path from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const unmigratedApps = ["agency-dashboard", "freelancer-dashboard"];

const cwd = process.cwd();
const isUnmigratedApp =
  path.basename(path.dirname(cwd)) === "apps" &&
  unmigratedApps.includes(path.basename(cwd));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  ...(isUnmigratedApp
    ? [
        {
          rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "react-hooks/set-state-in-effect": "warn",
            "react/no-unescaped-entities": "warn",
            "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
            "react-hooks/purity": "warn",
          },
        },
      ]
    : []),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
