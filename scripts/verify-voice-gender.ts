/**
 * Validates server/voice-gender.ts against real neural speech: synthesizes a
 * sentence with every male and female Azure voice the call pipeline uses,
 * feeds the PCM through VoiceGenderEstimator in 20 ms frames exactly like
 * translator-bot does, and reports any misclassification.
 *
 *   npx tsx scripts/verify-voice-gender.ts
 * Needs AZURE_SPEECH_KEY (and optionally AZURE_SPEECH_REGION) in the env/.env.
 */
import "dotenv/config";
import { VoiceGenderEstimator } from "../server/voice-gender";

const VOICES: Record<string, { male: string; female: string; text: string }> = {
  en: { male: "en-IN-PrabhatNeural", female: "en-IN-NeerjaNeural", text: "Hello, how are you doing today? I will call you back in the evening." },
  hi: { male: "hi-IN-MadhurNeural", female: "hi-IN-SwaraNeural", text: "नमस्ते, आप कैसे हैं? मैं शाम को आपको वापस फ़ोन करूँगा।" },
  te: { male: "te-IN-MohanNeural", female: "te-IN-ShrutiNeural", text: "నమస్కారం, మీరు ఎలా ఉన్నారు? నేను సాయంత్రం మీకు మళ్ళీ ఫోన్ చేస్తాను." },
  ta: { male: "ta-IN-ValluvarNeural", female: "ta-IN-PallaviNeural", text: "வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்? நான் மாலையில் உங்களை அழைக்கிறேன்." },
  kn: { male: "kn-IN-GaganNeural", female: "kn-IN-SapnaNeural", text: "ನಮಸ್ಕಾರ, ನೀವು ಹೇಗಿದ್ದೀರಿ? ನಾನು ಸಂಜೆ ನಿಮಗೆ ಮತ್ತೆ ಕರೆ ಮಾಡುತ್ತೇನೆ." },
  ml: { male: "ml-IN-MidhunNeural", female: "ml-IN-SobhanaNeural", text: "നമസ്കാരം, സുഖമാണോ? ഞാൻ വൈകുന്നേരം നിങ്ങളെ വിളിക്കാം." },
  mr: { male: "mr-IN-ManoharNeural", female: "mr-IN-AarohiNeural", text: "नमस्कार, तुम्ही कसे आहात? मी संध्याकाळी तुम्हाला परत फोन करेन." },
  bn: { male: "bn-IN-BashkarNeural", female: "bn-IN-TanishaaNeural", text: "নমস্কার, আপনি কেমন আছেন? আমি সন্ধ্যায় আপনাকে আবার ফোন করব।" },
  gu: { male: "gu-IN-NiranjanNeural", female: "gu-IN-DhwaniNeural", text: "નમસ્તે, તમે કેમ છો? હું સાંજે તમને ફરી ફોન કરીશ." },
  es: { male: "es-ES-AlvaroNeural", female: "es-ES-ElviraNeural", text: "Hola, ¿cómo estás hoy? Te llamaré por la tarde." },
  fr: { male: "fr-FR-HenriNeural", female: "fr-FR-DeniseNeural", text: "Bonjour, comment allez-vous aujourd'hui? Je vous rappellerai ce soir." },
  de: { male: "de-DE-ConradNeural", female: "de-DE-KatjaNeural", text: "Hallo, wie geht es Ihnen heute? Ich rufe Sie am Abend zurück." },
};

async function synth(voice: string, locale: string, text: string): Promise<Int16Array> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || "centralindia";
  if (!key) throw new Error("AZURE_SPEECH_KEY not set");
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${text}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
      "User-Agent": "NeuraTalk/verify-voice-gender",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`${voice}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

/** Run the estimator on the first `ms` of audio, as a short first utterance would. */
function classify(pcm: Int16Array, ms: number): string {
  const est = new VoiceGenderEstimator();
  const limit = Math.min(pcm.length, Math.round((16 * ms)));
  for (let i = 0; i + 320 <= limit; i += 320) est.push(pcm.subarray(i, i + 320));
  return est.resolve("female");
}

async function main() {
  let failures = 0;
  let total = 0;
  for (const [lang, v] of Object.entries(VOICES)) {
    const locale = v.male.split("-").slice(0, 2).join("-");
    for (const expected of ["male", "female"] as const) {
      const pcm = await synth(v[expected], locale, v.text);
      for (const ms of [1500, 4000]) {
        total++;
        const got = classify(pcm, ms);
        const ok = got === expected;
        if (!ok) failures++;
        console.log(`${ok ? "PASS" : "FAIL"}  ${lang}  ${expected.padEnd(6)} first ${ms}ms -> ${got}  (${v[expected]})`);
      }
    }
  }
  console.log(`\n${total - failures}/${total} correct`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(2);
});
