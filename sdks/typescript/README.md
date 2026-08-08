# @neuratalk/sdk

Official JavaScript/TypeScript SDK for the NeuraTalk API. Ships as a single dual ESM/CJS package — this covers both the "JavaScript SDK" and "TypeScript SDK" deliverables, since a modern TS-authored package compiled to plain JS with `.d.ts` types *is* the JS SDK, not a separate one.

## Install

```bash
npm install @neuratalk/sdk
```

## Authenticate

```ts
import { NeuraTalkClient } from "@neuratalk/sdk";

const client = new NeuraTalkClient(); // unauthenticated, for login/OTP endpoints

// Password login
const { token } = await client.login("myusername", "mypassword");

// Or OTP login (auto-registers new users)
await client.requestOtp("+919876543210", "mobile");
const { token: otpToken } = await client.verifyOtp("+919876543210", "mobile", "123456");

const authed = client.withToken(token);
```

## Make a call

```ts
const session = await authed.createCall({
  calleeIdentifier: "+919876543210",
  callType: "voice",
  myLanguage: "en",
  theirLanguage: "es",
});

// session.livekitUrl / session.livekitToken — hand these to a LiveKit client SDK
```

## Search and export transcripts

```ts
const page = await authed.searchTranscripts("invoice", { limit: 20 });
for (const segment of page.results) {
  console.log(segment.originalText, "->", segment.translatedText);
}

const pdfBytes = await authed.exportTranscript(session.callId, "pdf");
```

## Verify a webhook

```ts
import { verifyWebhookSignature } from "@neuratalk/sdk";

app.post("/webhooks/neuratalk", express.raw({ type: "*/*" }), (req, res) => {
  const valid = verifyWebhookSignature(req.body, req.header("X-NeuraTalk-Signature") ?? "", process.env.WEBHOOK_SECRET!);
  if (!valid) return res.status(401).end();
  // ... handle event
  res.status(200).end();
});
```

## Error handling

Every non-2xx response throws `NeuraTalkApiError` with `.status` and `.body` (the parsed JSON error payload — shape varies by module, see the OpenAPI spec's per-endpoint error schemas). Network failures throw `NeuraTalkNetworkError`.

```ts
import { NeuraTalkApiError } from "@neuratalk/sdk";

try {
  await authed.createCall({ calleeIdentifier: "+91...", callType: "voice" });
} catch (e) {
  if (e instanceof NeuraTalkApiError && e.status === 402) {
    console.log("Insufficient balance");
  }
  throw e;
}
```

## Retries

Network errors and `429`/`500`/`502`/`503`/`504` responses are retried automatically with exponential backoff (respecting a `Retry-After` header when present). Configure via `maxRetries`/`retryBaseDelayMs` in the constructor. Disable by setting `maxRetries: 0`.

## Versioning

There is currently no URL-based API versioning on the NeuraTalk server (all routes are flat `/api/...`) — this SDK is versioned at the package level instead. A breaking server change will ship as a new SDK major version.

## Building from source

```bash
npm install
npm run build   # emits dist/esm (ESM + .d.ts) and dist/cjs (CommonJS)
npm run typecheck
```
