export default function RecordingConsentPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Recording Consent Policy</h1>
          <p className="text-muted-foreground">Last updated: June 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Compliant with Indian Telegraph Act, IT Act 2000, DPDP Act 2023, and international wiretapping laws
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Overview</h2>
          <p>
            NeuraTalk respects the privacy rights of all call participants. Call recording is subject to
            legal consent requirements that vary by jurisdiction. This policy explains our consent framework
            for call recording, transcription, and related features.
          </p>

          <h2>2. Legal Consent Requirements</h2>

          <h3>2.1 India</h3>
          <p>
            Under the Indian Telegraph Act 1885 and IT Act 2000, recording a private communication
            without all parties' consent may be unlawful. NeuraTalk implements a consent-first model:
          </p>
          <ul>
            <li>Call recording requires at least one party (the initiating party) to enable recording consciously.</li>
            <li>All participants receive an audible notification ("This call may be recorded for quality and training purposes") when recording is active.</li>
            <li>Participants who do not consent may disconnect without penalty.</li>
          </ul>

          <h3>2.2 United States</h3>
          <p>
            US federal law (18 U.S.C. § 2511) and state laws vary between one-party and all-party consent.
            If any participant is in a US all-party consent state (e.g., California, Florida), all parties
            must consent before recording. NeuraTalk displays a consent notification to all parties and
            logs consent timestamps for compliance.
          </p>

          <h3>2.3 European Union</h3>
          <p>
            Under GDPR, recording constitutes processing of personal data and requires a lawful basis
            (typically explicit consent). All EU participants must be notified before recording begins.
          </p>

          <h3>2.4 Other Jurisdictions</h3>
          <p>
            Enterprise administrators are responsible for ensuring their use of recording features complies
            with local laws in the jurisdictions where their calls occur. NeuraTalk provides geo-based
            compliance warnings where supported.
          </p>

          <h2>3. How Recording Works on NeuraTalk</h2>

          <h3>3.1 Initiating a Recording</h3>
          <ol>
            <li>Only account owners, company admins, or agents with recording permission can enable recording.</li>
            <li>When recording is enabled, an in-call notification is displayed to all participants.</li>
            <li>An audible beep or announcement is played at the start of recording.</li>
            <li>The recording indicator remains visible throughout the call.</li>
          </ol>

          <h3>3.2 Participant Rights</h3>
          <ul>
            <li>Any participant may request to stop the recording by informing the host.</li>
            <li>Participants may choose to disconnect from a recorded call.</li>
            <li>For enterprise calls, organisations are responsible for obtaining participant consent per their jurisdiction's laws.</li>
          </ul>

          <h3>3.3 Automatic Recording (Enterprise)</h3>
          <p>
            Enterprise plans may configure automatic recording for compliance or QA purposes. When
            automatic recording is enabled:
          </p>
          <ul>
            <li>All inbound and outbound calls are recorded.</li>
            <li>NeuraTalk provides a customisable pre-call announcement script.</li>
            <li>Recordings are stored in the organisation's secure vault with access controls.</li>
            <li>Organisations must configure consent announcements in the Kamailio/IVR settings.</li>
          </ul>

          <h2>4. Storage &amp; Security of Recordings</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Aspect</th>
                <th className="border p-2 text-left">Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Storage location</td>
                <td className="border p-2">India-based servers (primary); EU mirrors for GDPR accounts</td>
              </tr>
              <tr>
                <td className="border p-2">Encryption at rest</td>
                <td className="border p-2">AES-256</td>
              </tr>
              <tr>
                <td className="border p-2">Encryption in transit</td>
                <td className="border p-2">TLS 1.3</td>
              </tr>
              <tr>
                <td className="border p-2">Access controls</td>
                <td className="border p-2">Role-based; recordings accessible only to authorised users</td>
              </tr>
              <tr>
                <td className="border p-2">Default retention</td>
                <td className="border p-2">90 days</td>
              </tr>
              <tr>
                <td className="border p-2">Custom retention (enterprise)</td>
                <td className="border p-2">Configurable from 7 days to 7 years</td>
              </tr>
            </tbody>
          </table>

          <h2>5. Transcription Consent</h2>
          <p>
            Transcription of recorded calls follows the same consent requirements as recording. Additionally:
          </p>
          <ul>
            <li>Transcripts are generated only when the transcript feature is explicitly enabled.</li>
            <li>AI transcription providers process audio ephemerally per their API terms.</li>
            <li>Transcripts are stored with the same access controls as recordings.</li>
            <li>Transcript participants can request deletion of their transcript segments via privacy@neuratalk.in.</li>
          </ul>

          <h2>6. User Responsibilities</h2>
          <p>By enabling the recording feature, you agree to:</p>
          <ul>
            <li>Obtain all legally required consents in your jurisdiction before recording.</li>
            <li>Not record calls for unlawful surveillance, harassment, or blackmail.</li>
            <li>Not share recordings in ways that violate participants' privacy rights.</li>
            <li>Comply with any local laws governing call recording and storage.</li>
            <li>Delete recordings when no longer needed for the stated purpose.</li>
          </ul>

          <h2>7. Withdrawing Consent / Requesting Deletion</h2>
          <p>
            If you are a call participant (not the account holder) who wishes to request deletion of
            a recording in which you appeared, email privacy@neuratalk.in with:
          </p>
          <ul>
            <li>Your name and phone number</li>
            <li>The approximate date and time of the call</li>
            <li>The organisation's name (if known)</li>
          </ul>
          <p>We will forward the request to the account holder and, where legally required, process deletion within 30 days.</p>

          <h2>8. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Privacy Inquiries:</strong> privacy@neuratalk.in</p>
            <p><strong>Enterprise Recording Config:</strong> enterprise@neuratalk.in</p>
            <p><strong>DPO:</strong> dpo@neuratalk.in</p>
          </div>
        </div>
      </section>
    </div>
  );
}
