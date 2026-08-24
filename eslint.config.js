const globals = require("globals");

// Die Geschwister-Skripte, die vor dem Admin-Bündel geladen werden. Sie gelten für das gebaute
// Bündel wie für die Quellmodule — beide sehen denselben Code, also brauchen beide dieselbe
// Liste. Einmal benannt, damit die zwei Blöcke nicht auseinanderlaufen.
const adminGeschwister = {
  RWIcons: "readonly",
  RWGpxService: "readonly",
  RWGithubService: "readonly",
  RWContentService: "readonly",
  RWMarkdownMedia: "readonly",
  RWSearchText: "readonly",
  RWEditorRecovery: "readonly",
  RWMediaService: "readonly",
  RWPublishService: "readonly",
  RWPublishStatus: "readonly",
  RWSocialConfig: "readonly",
  RWDraftRepository: "readonly",
  RWSourcePages: "readonly",
  RWAdmonitions: "readonly",
  RWPublishPlan: "readonly"
};

// Focused lint for the hand-written admin app. The goal is to catch the class
// of bug that `node --check` misses — undeclared identifiers (no-undef) — so a
// typo like a missing function parameter can't ship a runtime crash.
module.exports = [
  {
    // Das gebaute Bündel steht ausdrücklich dabei: es trägt den gesamten handgeschriebenen
    // Admin-Code aus admin-src/, und ein Glob, das es nicht trifft, prüft ihn nie.
    files: ["blog/admin/*.js", "blog/admin/vendor/app/admin.js", "blog/assets/js/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly",
        ...adminGeschwister
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
    // Die handgeschriebenen Admin-Module. Das gebaute Bündel steht oben und fängt vieles ab,
    // aber erst hier sieht der Linter die Quelle so, wie sie geschrieben wurde — mit ihren
    // Importen. Ein Import, den niemand mehr benutzt, verschwindet im Bündel spurlos.
    files: ["blog/admin/admin-src/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...adminGeschwister }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
    }
  },
  {
    // Der Worker: die Veröffentlichung als Zustandsmaschine und ihr Buch.
    //
    // Diese Zeilen fehlten, während worker/*.js längst im Lint-Befehl stand. Flat Config wendet
    // auf eine Datei, die kein Block trifft, schlicht keine Regel an — der Aufruf lief also
    // durch und prüfte nichts. Ein undefinierter Bezeichner mitten im Publish-Pfad wäre
    // fehlerfrei durchgegangen. tests/workflow-validation.test.js hält das jetzt fest.
    files: ["worker/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
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
