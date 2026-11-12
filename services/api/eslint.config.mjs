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
    files: ["src/modules/**/*.controller.ts", "src/modules/**/*.route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)database(/|$)",
              message:
                "Controllers and routes go through the service layer, not the database.",
            },
            {
              regex: "\\.schema(\\.js)?$",
              message:
                "Controllers and routes go through the service layer, not table files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/infrastructure/**", "src/**/*.test.ts", "src/test/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: ["stripe", "redis", "amqplib", "amqp-connection-manager"].map(
            (name) => ({
              name,
              allowTypeImports: true,
              message: "Third-party clients live only in src/infrastructure.",
            }),
          ),
          patterns: [
            {
              group: ["@imagekit/*", "@clerk/*"],
              allowTypeImports: true,
              message: "Third-party clients live only in src/infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/modules/jobs/**/*.ts",
      "src/modules/freelancer/freelancer.agency-identity.ts",
      "src/config/**/*.ts",
      "src/infrastructure/**/*.ts",
      "src/shared/**/*.ts",
      "src/app-middleware/**/*.ts",
      "src/bootstrap/**/*.ts",
      "src/database/db-executor.ts",
      "src/routes/**/*.ts",
      "src/types/**/*.ts",
      "src/*.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
]);
