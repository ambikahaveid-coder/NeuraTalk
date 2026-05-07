import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

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
    },
  });

  const size = (statSync("dist/index.cjs").size / 1024 / 1024).toFixed(1);
  console.log(`\n  dist/index.cjs  ${size}mb\n`);
  console.log("Done");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
