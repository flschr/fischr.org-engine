const fs = require("fs");
const path = require("path");

fs.rmSync(path.join(process.cwd(), "_site"), {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100
});
