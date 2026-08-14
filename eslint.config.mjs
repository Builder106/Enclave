import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  globalIgnores([
    "node_modules/**",
    ".output/**",
    ".vinxi/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "*.config.*",
  ]),
  ...typescriptEslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  prettierConfig,
]);

export default eslintConfig;