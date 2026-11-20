import base from "@onemarketplace/eslint-config/node";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...base,
  globalIgnores(["src/generated/**"]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: { "no-console": "error" },
  },
]);
