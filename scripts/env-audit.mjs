import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const scanRoots = ["server", "client", "shared", "mobile", "script", "scripts"];
const envReferenceRegexes = [
  /process\.env\.([A-Z0-9_]+)/g,
  /process\.env\[['"]([A-Z0-9_]+)['"]\]/g,
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git", ".tmp"].includes(entry.name)) {
        continue;
      }
      files.push(...await walk(fullPath));
      continue;
    }

    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectEnvRefs(source) {
  const refs = new Set();
  for (const regex of envReferenceRegexes) {
    for (const match of source.matchAll(regex)) {
      refs.add(match[1]);
    }
  }
  return refs;
}

function parseExampleKeys(source) {
  return new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.split("=")[0]?.trim())
      .filter(Boolean),
  );
}

async function main() {
  const files = (
    await Promise.all(scanRoots.map((dir) => walk(path.join(repoRoot, dir))))
  ).flat();

  const references = new Map();
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    const refs = collectEnvRefs(source);
    for (const ref of refs) {
      if (!references.has(ref)) {
        references.set(ref, []);
      }
      references.get(ref).push(path.relative(repoRoot, filePath));
    }
  }

  const examplePath = path.join(repoRoot, ".env.example");
  const exampleSource = await fs.readFile(examplePath, "utf8");
  const exampleKeys = parseExampleKeys(exampleSource);

  const missingFromExample = [...references.keys()].filter((key) => !exampleKeys.has(key)).sort();
  const report = {
    scannedFiles: files.length,
    referencedEnvVarCount: references.size,
    missingFromExample,
    references: Object.fromEntries(
      [...references.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value.sort()]),
    ),
  };

  const outputPath = path.join(repoRoot, "tmp", "env-audit-report.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");

  if (missingFromExample.length > 0) {
    console.error(`Missing vars in .env.example: ${missingFromExample.join(", ")}`);
    console.error(`Detailed report: ${outputPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Environment audit passed. Detailed report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
