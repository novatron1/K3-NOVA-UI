const globals = require("globals");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefresh = require("eslint-plugin-react-refresh").default;
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["dist/", "coverage/", "playwright-report/", "test-results/", "node_modules/"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
