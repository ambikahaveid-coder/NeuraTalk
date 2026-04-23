/**
 * Neura-Talk Production Smoke Test
 * Verifies core B2B/B2C API health before any deployment.
 */
const http = require('http');

const endpoints = [
  '/api/health',
  '/readyz',
  '/api/docs',
  '/api/rtc/status'
];

console.log("🧪 Starting Senior Dev Smoke Test...");

endpoints.forEach(path => {
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: path,
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200 || res.statusCode === 301) {
      console.log(`✅ ${path} is healthy (${res.statusCode})`);
    } else {
      console.error(`❌ ${path} FAILED with status ${res.statusCode}`);
      process.exit(1);
    }
  });

  req.on('error', (e) => {
    console.error(`❌ Error reaching ${path}: ${e.message}`);
    process.exit(1);
  });
  req.end();
});