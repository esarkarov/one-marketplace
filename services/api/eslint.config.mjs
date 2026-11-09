import base from "@onemarketplace/eslint-config/node";
import { defineConfig } from "eslint/config";

export default defineConfig([
  ...base,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/test/**"],
    rules: { "no-console": "error" },
  },
  {
    files: [
      "src/modules/jobs/**/*.ts",
      "src/config/**/*.ts",
      "src/middleware/**/*.ts",
      "src/utils/**/*.ts",
      "src/routes/**/*.ts",
      "src/types/**/*.ts",
      "src/*.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
]);
