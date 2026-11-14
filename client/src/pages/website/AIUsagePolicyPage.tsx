import { Link } from "wouter";
import { COMPANY, POLICIES_UPDATED, LANGUAGE_SUMMARY, FREE_AI_MINUTES } from "./site-facts";

export default function AIUsagePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">AI Usage Policy</h1>
          <p className="text-muted-foreground">Last updated: {POLICIES_UPDATED}</p>
          <p className="text-sm text-muted-foreground mt-2">Where NeuraTalk uses AI, its limits, and the rules for using it</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Where we use AI</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Feature</th><th className="border p-2 text-left">What the AI does</th><th className="border p-2 text-left">Provider</th></tr></thead>
            <tbody>
              <tr><td className="border p-2">Calls</td><td className="border p-2">Recognises speech and its language, translates it, and speaks it in the speaker's cloned voice or shows captions</td><td className="border p-2">Microsoft Azure in India (speech and translation), ElevenLabs (your voice); OpenAI and Deepgram only as a backup when Azure is unavailable</td></tr>
              <tr><td className="border p-2">Chats</td><td className="border p-2">Translates messages, and transcribes voice messages</td><td className="border p-2">OpenAI; Sarvam AI and Microsoft Azure as backups</td></tr>
              <tr><td className="border p-2">Your voice</td><td className="border p-2">Creates a cloned voice from your own recordings or, with your permission, your speech in calls</td><td className="border p-2">ElevenLabs</td></tr>
              <tr><td className="border p-2">NEURA AI (in-app)</td><td className="border p-2">Answers your questions and helps write messages</td><td className="border p-2">OpenAI</td></tr>
              <tr><td className="border p-2">Your AI assistant</td><td className="border p-2">If you turn it on, answers chats and calls for you while you're busy, and writes you a summary</td><td className="border p-2">OpenAI (thinking), Microsoft Azure (listening and speaking), ElevenLabs (your voice, if you choose it)</td></tr>
              <tr><td className="border p-2">Business AI receptionist</td><td className="border p-2">Answers a business's customers from that business's own catalog, hours and notes; takes requests; hands over to a person</td><td className="border p-2">The same as your AI assistant</td></tr>
            </tbody>
          </table>
          <p>Languages: {LANGUAGE_SUMMARY}. Quality is not the same in every language: we test Indian languages and English most, and
            some languages still make more mistakes than others.</p>
          <p>AI translation is a paid feature: every new personal account gets {FREE_AI_MINUTES} free AI minutes to try it. Calls and chats
            without translation are free.</p>

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

          <h2>3a. AI assistants that answer for you</h2>
          <ul>
            <li><strong>Always honest about being AI.</strong> Every assistant and AI receptionist introduces itself as an AI assistant at the start of a
              chat or call. This can't be switched off, even when it speaks in the owner's own voice.</li>
            <li><strong>It answers only from what it was given.</strong> A personal assistant takes messages and follows its owner's instructions; a
              receptionist answers only from its business's information and says when it doesn't know.</li>
            <li><strong>It never commits on anyone's behalf.</strong> It doesn't confirm orders, bookings, prices or payments — it passes requests to a
              person, who confirms them.</li>
            <li><strong>People can always reach a person.</strong> Ask for one and a business's receptionist hands the chat over; when the owner writes
              or joins a call, the assistant steps aside.</li>
            <li><strong>Short and capped.</strong> Calls answered by an assistant end after at most 3 minutes.</li>
            <li>The owner of an assistant is responsible for its instructions. NeuraTalk can pause an assistant that is misused.</li>
          </ul>

          <h2>4. Not allowed</h2>
          <ul>
            <li>Cloning, recording or imitating anyone else's voice.</li>
            <li>Using translation or the assistant to deceive, defraud, harass or impersonate.</li>
            <li>Trying to make the assistant produce illegal or harmful content.</li>
            <li>Instructing an AI assistant or receptionist to hide that it is AI, to pressure people, to collect OTPs, PINs or card details, or to
              make promises a person won't keep.</li>
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
