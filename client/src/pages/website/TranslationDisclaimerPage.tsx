export default function TranslationDisclaimerPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Voice Translation Disclaimer</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Important information about the accuracy and limitations of NeuraTalk's AI translation services
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-lg mb-8">
            <h3 className="mt-0 text-amber-600 dark:text-amber-400">Important Notice</h3>
            <p className="mb-0">
              NeuraTalk's AI voice translation is designed to assist communication — not to replace
              certified human interpreters. For medical, legal, financial, or safety-critical
              communications, always use qualified professional interpreters.
            </p>
          </div>

          <h2>1. Nature of AI Translation</h2>
          <p>
            NeuraTalk uses large language models and speech recognition systems to provide real-time
            voice translation. AI translation is:
          </p>
          <ul>
            <li><strong>Probabilistic:</strong> The AI predicts the most likely translation, which may not always be correct.</li>
            <li><strong>Context-limited:</strong> Short utterances, idioms, cultural references, and technical terminology may be mistranslated.</li>
            <li><strong>Not certified:</strong> AI translations are not produced by licensed translators or interpreters and carry no legal certification.</li>
          </ul>

          <h2>2. Known Limitations</h2>

          <h3>2.1 Language Pairs</h3>
          <p>Translation quality varies significantly by language pair. Higher accuracy is generally achieved for:</p>
          <ul>
            <li>Major global languages (English, Spanish, French, German, Mandarin, Hindi)</li>
            <li>Languages with large training datasets</li>
          </ul>
          <p>Lower accuracy should be expected for:</p>
          <ul>
            <li>Regional dialects (e.g., Bhojpuri, Tulu, Konkani)</li>
            <li>Low-resource languages with limited training data</li>
            <li>Code-switching (mixing two languages in one sentence)</li>
          </ul>

          <h3>2.2 Audio Quality Factors</h3>
          <p>Translation accuracy is directly affected by:</p>
          <ul>
            <li>Background noise and ambient sound</li>
            <li>Microphone quality and distance from speaker</li>
            <li>Speaker accent, speech rate, and clarity</li>
            <li>Network latency and packet loss during calls</li>
          </ul>

          <h3>2.3 Domain-Specific Terminology</h3>
          <p>The following domains should not rely on AI translation without expert review:</p>
          <ul>
            <li><strong>Medical:</strong> Drug names, dosages, diagnoses, surgical instructions</li>
            <li><strong>Legal:</strong> Contract terms, court proceedings, rights advisories</li>
            <li><strong>Financial:</strong> Investment advice, regulatory disclosures</li>
            <li><strong>Safety-critical:</strong> Emergency instructions, aviation, maritime</li>
          </ul>

          <h2>3. Real-Time Processing</h2>
          <p>
            Voice translation introduces a short processing delay (typically 0.3–2 seconds depending
            on network conditions). This is inherent to AI-based real-time translation and cannot be
            fully eliminated. Users should allow natural pauses to improve translation accuracy.
          </p>

          <h2>4. No Warranty of Accuracy</h2>
          <p>
            NeuraTalk provides voice translation "as is" without any warranty of accuracy, completeness,
            or fitness for a particular purpose. We do not guarantee that translations will be free from
            errors, omissions, or misinterpretations.
          </p>

          <h2>5. Liability Limitation</h2>
          <p>
            Mindwhile IT Solutions Pvt Ltd shall not be liable for any loss, damage, or consequence
            arising from reliance on AI-generated translations. Users assume full responsibility for
            verifying the accuracy of translations in critical or high-stakes contexts.
          </p>

          <h2>6. Language Support</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Tier</th>
                <th className="border p-2 text-left">Languages</th>
                <th className="border p-2 text-left">Expected Accuracy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Tier 1 (High)</td>
                <td className="border p-2">English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Spanish, French, German, Mandarin, Arabic</td>
                <td className="border p-2">85–95%</td>
              </tr>
              <tr>
                <td className="border p-2">Tier 2 (Moderate)</td>
                <td className="border p-2">Gujarati, Punjabi, Odia, Urdu, Assamese, Portuguese, Italian, Japanese, Korean, Russian</td>
                <td className="border p-2">70–85%</td>
              </tr>
              <tr>
                <td className="border p-2">Tier 3 (Beta)</td>
                <td className="border p-2">Regional dialects, low-resource languages</td>
                <td className="border p-2">50–70% (not recommended for critical use)</td>
              </tr>
            </tbody>
          </table>
          <p className="text-sm text-muted-foreground">
            * Accuracy percentages are approximate and based on clear audio in controlled conditions. Real-world accuracy may be lower.
          </p>

          <h2>7. Feedback &amp; Improvement</h2>
          <p>
            Translation errors can be reported via the in-call feedback button (thumbs down icon) or by
            emailing ai-feedback@neuratalk.in. User feedback helps improve our models for future users.
            Reported audio segments are reviewed anonymously and not linked to your identity without consent.
          </p>

          <h2>8. Professional Interpreter Referral</h2>
          <p>
            For situations requiring certified interpretation, we recommend:
          </p>
          <ul>
            <li>India: AIIC-certified interpreters (aiic.net)</li>
            <li>Medical: Qualified medical interpreters per hospital protocols</li>
            <li>Legal: Court-certified interpreters appointed by judicial authority</li>
          </ul>

          <h2>9. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Translation Feedback:</strong> ai-feedback@neuratalk.in</p>
            <p><strong>Support:</strong> support@neuratalk.in</p>
          </div>
        </div>
      </section>
    </div>
  );
}
