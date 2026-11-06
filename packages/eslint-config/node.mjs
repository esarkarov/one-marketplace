import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...tseslint.configs.recommended,
  prettier,
  globalIgnores(["dist/**", "build/**", "coverage/**"]),
]);
