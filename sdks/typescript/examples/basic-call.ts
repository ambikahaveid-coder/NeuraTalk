/**
 * Sample app: OTP login, place a call, poll for completion, fetch and
 * export the transcript. Run with: npx tsx examples/basic-call.ts
 * (requires NEURATALK_IDENTIFIER / NEURATALK_OTP env vars for a real run).
 */
import { NeuraTalkClient, NeuraTalkApiError } from "../src/index.js";

async function main() {
  const client = new NeuraTalkClient({ baseUrl: process.env.NEURATALK_BASE_URL });

  const identifier = process.env.NEURATALK_IDENTIFIER;
  const otp = process.env.NEURATALK_OTP;
  if (!identifier || !otp) {
    console.log("Set NEURATALK_IDENTIFIER and NEURATALK_OTP to run this example against a real server.");
    return;
  }

  const { token } = await client.verifyOtp(identifier, "mobile", otp);
  const authed = client.withToken(token);

  try {
    const session = await authed.createCall({
      calleeIdentifier: "+919876543210",
      callType: "voice",
      myLanguage: "en",
      theirLanguage: "hi",
    });
    console.log("Call created:", session.callId);

    // In a real app, connect to session.livekitUrl with a LiveKit client SDK here.

    const transcript = await authed.getTranscript(session.callId);
    console.log(`Transcript has ${transcript.length} segments`);

    const pdf = await authed.exportTranscript(session.callId, "pdf");
    console.log(`Exported PDF: ${pdf.byteLength} bytes`);
  } catch (e) {
    if (e instanceof NeuraTalkApiError) {
      console.error(`API error ${e.status}:`, e.message);
    } else {
      throw e;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
