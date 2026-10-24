import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED, LANGUAGE_SUMMARY } from "./site-facts";

export default function AIUsagePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">AI Usage Policy</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">Where NeuraTalk uses AI, its limits, and the rules for using it</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Where we use AI</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Feature</th><th className="border p-2 text-left">What the AI does</th><th className="border p-2 text-left">Provider</th></tr></thead>
            <tbody>
              <tr><td className="border p-2">Calls</td><td className="border p-2">Recognises speech and its language, translates it, and speaks it in the speaker's cloned voice or shows captions</td><td className="border p-2">Microsoft Azure, OpenAI, ElevenLabs</td></tr>
              <tr><td className="border p-2">Chats</td><td className="border p-2">Translates messages, and transcribes voice messages</td><td className="border p-2">OpenAI, Microsoft Azure</td></tr>
              <tr><td className="border p-2">Your voice</td><td className="border p-2">Creates a cloned voice from your own recordings or, with your permission, your speech in calls</td><td className="border p-2">ElevenLabs</td></tr>
              <tr><td className="border p-2">Assistant</td><td className="border p-2">Answers questions and helps write messages</td><td className="border p-2">OpenAI</td></tr>
            </tbody>
          </table>
          <p>Languages: {LANGUAGE_SUMMARY}.</p>

          <h2>2. Limits you should know</h2>
          <ul>
            <li>AI translation and speech recognition make mistakes — with names, numbers, accents, mixed languages and noise. Check anything important.</li>
            <li>A translated sentence in your cloned voice is still a machine's translation, not your exact words.</li>
            <li>The assistant can be wrong or out of date. It is not a doctor, lawyer or financial adviser.</li>
            <li>Do not use NeuraTalk translation for emergencies, medical consent, legal proceedings or anything safety-critical. See the <Link href="/translation-disclaimer">Translation Disclaimer</Link>.</li>
          </ul>

          <h2>3. Your voice, your choice</h2>
          <ul>
            <li>A cloned voice can be created only of yourself, and speaks only your own translated words in your own calls.</li>
            <li>Learning your voice from calls happens only if you switch it on, and you can switch it off at any time.</li>
            <li>You can delete your voice whenever you like; it is deleted at our provider too.</li>
          </ul>

          <h2>4. Not allowed</h2>
          <ul>
            <li>Cloning, recording or imitating anyone else's voice.</li>
            <li>Using translation or the assistant to deceive, defraud, harass or impersonate.</li>
            <li>Trying to make the assistant produce illegal or harmful content.</li>
          </ul>

          <h2>5. Your data and AI training</h2>
          <p>
            We send our providers only what each feature needs. We do not use your calls, messages or voice to train our own AI models. Our
            providers process data under their business terms for the services we use.
          </p>

          <h2>6. People stay in charge</h2>
          <p>
            Business message templates are reviewed by people on the NeuraTalk team, and so is the verified tick. You can always see the original
            of a translated message, switch translation off for a chat, or use captions instead of translated speech.
          </p>

          <h2>7. Questions or problems</h2>
          <p>Report a harmful AI result or misuse to {COMPANY.email} or at <Link href="/report-abuse">Report Abuse</Link>.</p>
        </div>
      </section>
    </div>
  );
}
