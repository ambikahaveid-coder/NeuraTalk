import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function resolveBuildIdentity() {
  // Best-effort: a shallow/archive checkout (some CI/build environments) may
  // not have git history available, so this must never fail the build.
  // S3-sourced builds (e.g. CodeBuild without .git) supply GIT_COMMIT_SHA
  // explicitly since git rev-parse has nothing to read from in that context.
  let commitSha = "unknown";
  if (process.env.GIT_COMMIT_SHA) {
    commitSha = process.env.GIT_COMMIT_SHA;
  } else {
    try {
      commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      // no .git available in this build context -- leave as "unknown" rather than fail the build
    }
  }
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync("package.json", "utf8")).version || "unknown";
  } catch {
    // ignore
  }
  return { commitSha, buildTimestamp: new Date().toISOString(), version };
}

const externalPackages = [
  "@sentry/node",
  "@sentry/profiling-node",
  "@sentry-internal/node-cpu-profiler",
  "@livekit/rtc-node",
  "@livekit/rtc-ffi-bindings",
  "@neondatabase/serverless",
  "bcryptjs",
  "connect-pg-simple",
  "cors",
  "crypto",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "express-rate-limit",
  "firebase-admin",
  "helmet",
  "ioredis-mock",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "razorpay",
  "twilio",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function build() {
  console.log("building client...");
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      BROWSERSLIST_IGNORE_OLD_DATA: "1",
    },
  });

  console.log("building server...");
  const { commitSha, buildTimestamp, version } = resolveBuildIdentity();
  console.log(`  build identity: commit=${commitSha} version=${version} time=${buildTimestamp}`);
  await esbuild.build({
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
    platform: "node",
    format: "cjs",
    bundle: true,
    minify: false,
    sourcemap: false,
    external: externalPackages,
    loader: {
      ".ts": "ts",
    },
    logLevel: "warning",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.BUILD_COMMIT_SHA": JSON.stringify(commitSha),
      "process.env.BUILD_TIMESTAMP": JSON.stringify(buildTimestamp),
      "process.env.BUILD_VERSION": JSON.stringify(version),
    },
  });

  const size = (statSync("dist/index.cjs").size / 1024 / 1024).toFixed(1);
  console.log(`\n  dist/index.cjs  ${size}mb\n`);
  console.log("Done");
}

export { resolveBuildIdentity };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
