const fs = require("node:fs");
const path = require("node:path");

const runtimeDir = path.resolve(__dirname, "../../.tmp/smoke");

fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(
  path.join(runtimeDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2),
);
