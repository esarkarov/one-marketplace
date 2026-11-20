import base from "@onemarketplace/eslint-config/node";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...base,
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
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
]);
