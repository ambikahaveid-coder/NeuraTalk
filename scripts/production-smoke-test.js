/**
 * Neura-Talk Production Smoke Test
 * Verifies core B2B/B2C API health before any deployment.
 */
import http from "node:http";

const endpoints = [
  "/api/health",
  "/readyz",
  "/api/docs",
  "/api/rtc/status",
];

console.log("Starting Senior Dev Smoke Test...");

for (const endpoint of endpoints) {
  const options = {
    hostname: "localhost",
    port: 5000,
    path: endpoint,
    method: "GET",
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200 || res.statusCode === 301) {
      console.log(`${endpoint} is healthy (${res.statusCode})`);
      return;
    }

    console.error(`${endpoint} FAILED with status ${res.statusCode}`);
    process.exit(1);
  });

  req.on("error", (error) => {
    console.error(`Error reaching ${endpoint}: ${error.message}`);
    process.exit(1);
  });

  req.end();
}
