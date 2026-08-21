const globals = require("globals");

// Focused lint for the hand-written admin app. The goal is to catch the class
// of bug that `node --check` misses — undeclared identifiers (no-undef) — so a
// typo like a missing function parameter can't ship a runtime crash.
module.exports = [
  {
    files: ["blog/admin/*.js", "blog/assets/js/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly",
        // Provided by sibling admin scripts loaded before admin.js.
        RWIcons: "readonly",
        RWGpxService: "readonly",
        RWGithubService: "readonly",
        RWContentService: "readonly",
        RWMarkdownMedia: "readonly",
        RWEditorRecovery: "readonly",
        RWMediaService: "readonly",
        RWPublishService: "readonly",
        RWPublishStatus: "readonly",
        RWSocialConfig: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["scripts/**/*.js", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: globals.node
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
    }
  }
];
