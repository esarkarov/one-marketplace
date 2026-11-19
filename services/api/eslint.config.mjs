import base from "@onemarketplace/eslint-config/node";
import { defineConfig } from "eslint/config";

const noParentRelative = {
  group: ["..", "../**"],
  message:
    "Import across directories with the @/ alias (the src root); ../ is not allowed (ADR 0020).",
};

export default defineConfig([
  ...base,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
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
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.{ts,mjs}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noParentRelative] }],
    },
  },
  {
    files: ["src/modules/**/*.controller.ts", "src/modules/**/*.route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noParentRelative,
            {
              regex: "(^|/)database(/|$)",
              message:
                "Controllers and routes go through the service layer, not the database.",
            },
            {
              regex: "(^|/)models/|\\.model(\\.js)?$",
              message:
                "Controllers and routes go through the service layer, not table files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/**/controllers/*.controller.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noParentRelative,
            {
              regex: "(^|/)database(/|$)",
              message:
                "Controllers and routes go through the service layer, not the database.",
            },
            {
              regex: "(^|/)models/|\\.model(\\.js)?$",
              message:
                "Controllers and routes go through the service layer, not table files.",
            },
            {
              regex: "(^|/)infrastructure(/|$)",
              message:
                "Controllers go through the service layer, not infrastructure (Stripe, Redis, events, storage, video).",
            },
            {
              regex: "(^|/)config/env(\\.js)?$",
              message:
                "Controllers read no environment values; the service that needs one imports it.",
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
      "src/modules/freelancer/services/freelancer.agency-identity.service.ts",
      "src/config/**/*.ts",
      "src/infrastructure/**/*.ts",
      "src/shared/**/*.ts",
      "src/middleware/**/*.ts",
      "src/bootstrap/**/*.ts",
      "src/database/database.types.ts",
      "src/routes/**/*.ts",
      "src/types/**/*.ts",
      "src/*.ts",
      "src/modules/auth/middleware/auth.middleware.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
]);
