export default function AIUsagePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">AI Usage Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Governing all AI-powered features on the NeuraTalk platform
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Introduction</h2>
          <p>
            NeuraTalk integrates artificial intelligence across multiple features including real-time voice
            translation, speech-to-text transcription, voice cloning, AI personas, sentiment analysis, and
            agent assist. This policy explains how AI is used, its limitations, and user responsibilities
            when using AI-powered features.
          </p>

          <h2>2. AI Features &amp; Capabilities</h2>

          <h3>2.1 Real-Time Voice Translation</h3>
          <ul>
            <li>Translates spoken language in real time across 50+ language pairs.</li>
            <li>Audio is processed in-memory and immediately discarded after the call ends.</li>
            <li>Translation accuracy varies by language pair, speaker clarity, and ambient noise.</li>
            <li><strong>Limitation:</strong> AI translation may contain errors. Do not rely on it for medical, legal, or safety-critical communications without human verification.</li>
          </ul>

          <h3>2.2 Speech-to-Text (Transcription)</h3>
          <ul>
            <li>Converts voice calls to text using AI models (OpenAI Whisper and Azure Cognitive Services).</li>
            <li>Transcripts are only generated when the feature is explicitly enabled by an admin or user.</li>
            <li>Transcripts may contain errors, especially for accented speech, technical jargon, or background noise.</li>
            <li>Transcripts are stored for 90 days by default and can be deleted at any time.</li>
          </ul>

          <h3>2.3 Voice Cloning &amp; AI Personas</h3>
          <ul>
            <li>Allows creation of a personalised AI voice model from submitted voice samples.</li>
            <li>Requires explicit informed consent before voice data collection begins.</li>
            <li>Cloned voice output is marked as AI-generated in system metadata.</li>
            <li>Voice clones may only be used for the account holder's own communication purposes.</li>
          </ul>

          <h3>2.4 Sentiment Analysis</h3>
          <ul>
            <li>Analyses call tone and emotional indicators to provide customer service insights.</li>
            <li>Results are processed in-memory; no audio is stored for sentiment analysis.</li>
            <li>Sentiment data informs agent dashboards and is not used for automated decisions affecting users.</li>
          </ul>

          <h3>2.5 Agent Assist</h3>
          <ul>
            <li>Provides real-time AI suggestions to human agents during live calls.</li>
            <li>Suggestions are advisory only and do not automatically control the call.</li>
            <li>A human agent is always in control and responsible for the conversation outcome.</li>
          </ul>

          <h3>2.6 AI Chat &amp; Assistant</h3>
          <ul>
            <li>Powered by large language models for natural language understanding.</li>
            <li>Responses are AI-generated and may not always be accurate or complete.</li>
            <li>Do not input personal, confidential, or sensitive information into the AI chat without understanding it is processed by underlying AI providers.</li>
          </ul>

          <h2>3. Acceptable Use of AI Features</h2>
          <p>You may use AI features for:</p>
          <ul>
            <li>Legitimate business communication across language barriers</li>
            <li>Customer service automation and agent support</li>
            <li>Personal productivity and communication tools</li>
            <li>Internal team collaboration and meeting transcription</li>
          </ul>

          <h2>4. Prohibited Uses</h2>
          <p>You may NOT use AI features to:</p>
          <ul>
            <li><strong>Impersonate:</strong> Use voice cloning to impersonate another person without their explicit consent</li>
            <li><strong>Deceive:</strong> Use AI-generated voice or content to deceive, defraud, or manipulate</li>
            <li><strong>Harass:</strong> Use AI features to harass, threaten, or abuse others</li>
            <li><strong>Generate harmful content:</strong> Produce content that is illegal, defamatory, discriminatory, or violates third-party rights</li>
            <li><strong>Circumvent legal obligations:</strong> Use AI features to evade regulatory, compliance, or legal requirements</li>
            <li><strong>Surveillance:</strong> Record or transcribe calls without participant consent where required by law</li>
            <li><strong>Biometric fraud:</strong> Use voice biometrics to unlawfully authenticate as another person</li>
          </ul>

          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg my-4">
            <p className="font-semibold text-red-600 dark:text-red-400">Enforcement:</p>
            <p>Violations of this policy may result in immediate account suspension, permanent ban, and referral to relevant law enforcement authorities.</p>
          </div>

          <h2>5. AI Accuracy &amp; Limitations</h2>
          <p>
            AI systems are probabilistic and may produce incorrect results. NeuraTalk makes no warranty
            that AI outputs are accurate, complete, or appropriate for any particular purpose. Users are
            responsible for:
          </p>
          <ul>
            <li>Reviewing AI-generated content before relying on it</li>
            <li>Maintaining human oversight for consequential decisions</li>
            <li>Not using AI outputs as a substitute for professional advice (medical, legal, financial)</li>
          </ul>

          <h2>6. Data Used to Train AI Models</h2>
          <p>
            NeuraTalk does <strong>not</strong> use your call audio, transcripts, or translations to train
            third-party AI models without your explicit opt-in consent. Voice samples submitted for voice
            cloning are used solely to create your personalised voice model and are not shared with AI
            providers for general model training.
          </p>

          <h2>7. Human Oversight</h2>
          <p>
            NeuraTalk maintains human oversight of all AI systems. No AI feature on our platform makes
            autonomous decisions that materially affect user rights or have significant consequences without
            the ability for human review and intervention.
          </p>

          <h2>8. AI Feature Consent</h2>
          <p>
            Before enabling any AI feature that processes biometric or sensitive data (voice cloning,
            transcription, sentiment analysis), you will be presented with a clear consent screen explaining
            what data is collected, how it is used, and how to withdraw consent. Consent is freely given
            and can be withdrawn at any time through Settings → Privacy.
          </p>

          <h2>9. Third-Party AI Providers</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Provider</th>
                <th className="border p-2 text-left">Used For</th>
                <th className="border p-2 text-left">Data Sent</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">OpenAI</td>
                <td className="border p-2">Translation, transcription, agent assist</td>
                <td className="border p-2">Audio/text segments (ephemeral, not stored by OpenAI per API terms)</td>
              </tr>
              <tr>
                <td className="border p-2">Azure Cognitive Services</td>
                <td className="border p-2">Fallback transcription (STT)</td>
                <td className="border p-2">Audio segments (subject to Azure DPA)</td>
              </tr>
              <tr>
                <td className="border p-2">Google Cloud Translation</td>
                <td className="border p-2">Fallback text translation</td>
                <td className="border p-2">Text only (subject to Google Cloud DPA)</td>
              </tr>
            </tbody>
          </table>

          <h2>10. Reporting AI Misuse</h2>
          <p>
            If you believe AI features on NeuraTalk are being misused or causing harm, report it to:
            <strong> trust@neuratalk.in</strong> or use the <a href="/report-abuse">Report Abuse</a> form.
          </p>

          <h2>11. Policy Updates</h2>
          <p>
            As AI capabilities evolve, we will update this policy to reflect new features and responsibilities.
            Material changes will be communicated with 30 days' notice.
          </p>

          <h2>12. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>AI Ethics &amp; Safety:</strong> trust@neuratalk.in</p>
            <p><strong>DPO:</strong> dpo@neuratalk.in</p>
            <p><strong>General:</strong> support@neuratalk.in</p>
          </div>
        </div>
      </section>
    </div>
  );
}
