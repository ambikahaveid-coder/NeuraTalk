export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: February 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Compliant with GDPR (EU), India DPDP Act 2023, and international data protection standards
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Introduction</h2>
          <p>
            NeuraTalk, operated by Mindwhile IT Solutions Pvt Ltd ("we", "our", "us", "Data Fiduciary") 
            respects your privacy and is committed to protecting your personal data. This privacy policy 
            explains how we collect, use, store, and safeguard your information when you use our voice 
            AI communication services.
          </p>
          <p>
            This policy is prepared in accordance with:
          </p>
          <ul>
            <li><strong>India:</strong> Digital Personal Data Protection Act, 2023 (DPDP Act) and DPDP Rules 2025</li>
            <li><strong>European Union:</strong> General Data Protection Regulation (GDPR)</li>
            <li><strong>India IT Act:</strong> Information Technology Act, 2000 and IT Rules, 2011</li>
            <li><strong>International:</strong> ISO 27001 security standards</li>
          </ul>

          <h2>2. Data Controller / Data Fiduciary</h2>
          <p>
            <strong>Mindwhile IT Solutions Pvt Ltd</strong><br />
            Registered Address: 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503<br />
            Data Protection Officer: dpo@neuratalk.in<br />
            Grievance Officer: grievance@neuratalk.in
          </p>

          <h2>3. Information We Collect</h2>
          
          <h3>3.1 Account Information (Collected with Consent)</h3>
          <ul>
            <li>Name, email address, and phone number (for account creation and OTP verification)</li>
            <li>Company name and business details (for business accounts)</li>
            <li>Preferred language settings and communication preferences</li>
            <li>Country and region information for service optimization</li>
          </ul>

          <h3>3.2 Usage Information (Collected for Service Provision)</h3>
          <ul>
            <li>Call duration and timestamps (metadata only, not call content)</li>
            <li>Feature usage patterns and preferences</li>
            <li>Device type, browser information, and IP address</li>
            <li>Credit usage and transaction history</li>
          </ul>

          <h3>3.3 Voice Data (Collected with Explicit Consent)</h3>
          <ul>
            <li>Voice samples for personalized voice model training (only with explicit opt-in consent)</li>
            <li>Call recordings (only when explicitly enabled by you, with participant notification)</li>
          </ul>

          <h3>3.4 Voice Cloning and Identity Data</h3>
          <ul>
            <li>Voice identity profiles created through our voice training feature</li>
            <li>Voice biometric data used for speaker recognition and personalization</li>
            <li>Cloned voice models generated from your submitted voice samples</li>
            <li>Voice identity data is stored encrypted and accessible only by you unless explicitly shared</li>
            <li>You may delete your voice identity profile at any time through Settings</li>
          </ul>

          <h3>3.5 Meetings and Screen Sharing Data</h3>
          <ul>
            <li>Meeting metadata: scheduled times, participants, duration, and meeting links</li>
            <li>Screen sharing content is transmitted in real-time and not stored on our servers</li>
            <li>Meeting recordings (only when recording is explicitly enabled by the meeting host)</li>
            <li>Meeting chat messages sent during active sessions</li>
            <li>External platform handoff data (e.g., when redirecting to Google Meet, Zoom, or Teams)</li>
          </ul>
          
          <div className="bg-primary/10 p-4 rounded-lg my-4">
            <p className="font-semibold">Important - Data Minimization Principle:</p>
            <p>
              We do NOT record or store call content by default. Real-time translation happens 
              in-memory and is immediately discarded after processing. We never store call 
              audio unless you explicitly enable recording with informed consent. Screen sharing 
              streams are transmitted peer-to-peer and are not stored or monitored by NeuraTalk.
            </p>
          </div>

          <h2>4. Legal Basis for Processing (GDPR Article 6 / DPDP Section 4)</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Purpose</th>
                <th className="border p-2 text-left">Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Account creation & authentication</td>
                <td className="border p-2">Contract performance / Consent</td>
              </tr>
              <tr>
                <td className="border p-2">Providing translation services</td>
                <td className="border p-2">Contract performance</td>
              </tr>
              <tr>
                <td className="border p-2">Billing & payments</td>
                <td className="border p-2">Contract performance / Legal obligation</td>
              </tr>
              <tr>
                <td className="border p-2">Voice model training & cloning</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Voice identity biometrics</td>
                <td className="border p-2">Explicit consent</td>
              </tr>
              <tr>
                <td className="border p-2">Meeting scheduling & hosting</td>
                <td className="border p-2">Contract performance</td>
              </tr>
              <tr>
                <td className="border p-2">Service improvement</td>
                <td className="border p-2">Legitimate interest / Consent</td>
              </tr>
              <tr>
                <td className="border p-2">Marketing communications</td>
                <td className="border p-2">Consent (opt-in)</td>
              </tr>
              <tr>
                <td className="border p-2">Legal compliance</td>
                <td className="border p-2">Legal obligation</td>
              </tr>
            </tbody>
          </table>

          <h2>5. How We Use Your Information</h2>
          <ul>
            <li>To provide and maintain our voice AI translation services</li>
            <li>To process your account registration and OTP authentication</li>
            <li>To manage your credits, subscriptions, and billing</li>
            <li>To improve our translation accuracy and service quality</li>
            <li>To create and manage voice identity profiles when you opt in</li>
            <li>To facilitate meetings, screen sharing, and collaborative sessions</li>
            <li>To send important service notifications and security alerts</li>
            <li>To provide customer support and respond to inquiries</li>
            <li>To comply with legal obligations and regulatory requirements</li>
            <li>To detect and prevent fraud, abuse, and security threats</li>
          </ul>

          <h2>6. Data Storage and Security</h2>
          <p>
            Core account and application data is stored on secure infrastructure we control.
            To deliver realtime calling, translation, and phone-bridge features, NeuraTalk may
            use vetted provider infrastructure as part of the live service path. We apply access
            controls, encryption, and operational safeguards across both our systems and those
            integrated service layers.
          </p>
          
          <h3>6.1 Security Measures</h3>
          <ul>
            <li><strong>Encryption:</strong> TLS 1.3 in transit, AES-256 at rest</li>
            <li><strong>Access Controls:</strong> Role-based access with MFA for admin users</li>
            <li><strong>Monitoring:</strong> 24/7 security monitoring and intrusion detection</li>
            <li><strong>Audits:</strong> Regular security assessments and penetration testing</li>
            <li><strong>Incident Response:</strong> Documented breach notification procedures</li>
          </ul>

          <h3>6.2 Data Location</h3>
          <p>
            Primary data storage is in India. For users in the European Economic Area (EEA), 
            we ensure appropriate safeguards for any data transfers outside the EEA, including 
            Standard Contractual Clauses (SCCs) where applicable.
          </p>

          <h2>7. Your Rights (GDPR Articles 15-22 / DPDP Section 11-14)</h2>
          <p>You have the following rights regarding your personal data:</p>
          
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Right</th>
                <th className="border p-2 text-left">Description</th>
                <th className="border p-2 text-left">How to Exercise</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2"><strong>Access</strong></td>
                <td className="border p-2">Request a copy of your personal data</td>
                <td className="border p-2">Dashboard &rarr; Settings &rarr; Export Data</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Correction</strong></td>
                <td className="border p-2">Request correction of inaccurate data</td>
                <td className="border p-2">Dashboard &rarr; Profile &rarr; Edit</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Erasure</strong></td>
                <td className="border p-2">Request deletion of your personal data</td>
                <td className="border p-2">Dashboard &rarr; Settings &rarr; Delete Account</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Portability</strong></td>
                <td className="border p-2">Receive data in machine-readable format</td>
                <td className="border p-2">Dashboard &rarr; Settings &rarr; Export Data (JSON)</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Restrict Processing</strong></td>
                <td className="border p-2">Limit how we process your data</td>
                <td className="border p-2">Email: privacy@neuratalk.in</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Object</strong></td>
                <td className="border p-2">Object to certain processing activities</td>
                <td className="border p-2">Email: privacy@neuratalk.in</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Withdraw Consent</strong></td>
                <td className="border p-2">Withdraw consent at any time</td>
                <td className="border p-2">Dashboard &rarr; Privacy &rarr; Manage Consents</td>
              </tr>
              <tr>
                <td className="border p-2"><strong>Nominate</strong></td>
                <td className="border p-2">Nominate someone to exercise rights on your behalf</td>
                <td className="border p-2">Email: privacy@neuratalk.in</td>
              </tr>
            </tbody>
          </table>
          
          <p className="mt-4">
            <strong>Response Time:</strong> We will respond to all data subject requests within 
            30 days (GDPR) or 90 days (DPDP Act). Complex requests may require an extension 
            with prior notice.
          </p>

          <h2>8. Data Retention</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Data Type</th>
                <th className="border p-2 text-left">Retention Period</th>
                <th className="border p-2 text-left">Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Account data</td>
                <td className="border p-2">While account is active + 1 year</td>
                <td className="border p-2">DPDP Act requirement</td>
              </tr>
              <tr>
                <td className="border p-2">Usage logs</td>
                <td className="border p-2">90 days</td>
                <td className="border p-2">Service improvement</td>
              </tr>
              <tr>
                <td className="border p-2">Transaction records</td>
                <td className="border p-2">7 years</td>
                <td className="border p-2">Tax/legal compliance</td>
              </tr>
              <tr>
                <td className="border p-2">Voice samples & identity</td>
                <td className="border p-2">Until deletion request or account closure</td>
                <td className="border p-2">Consent-based</td>
              </tr>
              <tr>
                <td className="border p-2">Cloned voice models</td>
                <td className="border p-2">Until deletion request or account closure</td>
                <td className="border p-2">Consent-based</td>
              </tr>
              <tr>
                <td className="border p-2">Meeting recordings</td>
                <td className="border p-2">90 days or until manually deleted</td>
                <td className="border p-2">Consent-based</td>
              </tr>
              <tr>
                <td className="border p-2">Audit logs</td>
                <td className="border p-2">3 years</td>
                <td className="border p-2">Security/compliance</td>
              </tr>
            </tbody>
          </table>

          <h2>9. Third-Party Sharing</h2>
          <p>
            <strong>We do NOT sell your personal data.</strong> We may share information with:
          </p>
          <ul>
            <li><strong>Payment Processors:</strong> Razorpay (PCI-DSS compliant) for secure transactions</li>
            <li><strong>AI Providers:</strong> OpenAI for translation services (data processed, not stored)</li>
            <li><strong>Legal Authorities:</strong> When required by law or court order</li>
            <li><strong>Service Providers:</strong> Under strict Data Processing Agreements (DPAs)</li>
          </ul>
          <p>
            All third-party processors are bound by contractual obligations to protect your data 
            and process it only as instructed.
          </p>

          <h2>10. International Data Transfers</h2>
          <p>
            When we transfer personal data outside India or the EEA, we ensure appropriate 
            safeguards are in place:
          </p>
          <ul>
            <li>Standard Contractual Clauses (SCCs) approved by the European Commission</li>
            <li>Adequacy decisions where applicable</li>
            <li>Compliance with DPDP Act cross-border transfer requirements</li>
            <li>Data localization for specific categories as mandated by RBI (payment data)</li>
          </ul>

          <h2>11. Cookies and Tracking</h2>
          <p>
            We use cookies and similar technologies for:
          </p>
          <ul>
            <li><strong>Essential Cookies:</strong> Required for authentication and security</li>
            <li><strong>Functional Cookies:</strong> Remember your preferences (with consent)</li>
            <li><strong>Analytics Cookies:</strong> Understand usage patterns (with consent)</li>
          </ul>
          <p>
            You can manage cookie preferences through our Cookie Settings panel or your browser settings.
          </p>

          <h2>12. Children's Privacy</h2>
          <p>
            Our services are intended for users aged 18 and above. For users under 18, we require 
            verifiable parental consent as mandated by the DPDP Act. We do not knowingly collect 
            data from children under 13 without parental consent.
          </p>

          <h2>13. Data Breach Notification</h2>
          <p>
            In the event of a personal data breach:
          </p>
          <ul>
            <li>We will notify the Data Protection Board of India promptly</li>
            <li>We will notify affected individuals in plain language within 72 hours (GDPR) or as required by DPDP</li>
            <li>Notifications will include the nature of the breach, potential consequences, and remedial actions</li>
          </ul>

          <h2>14. Automated Decision-Making</h2>
          <p>
            We use AI-powered translation and emotion detection. These systems:
          </p>
          <ul>
            <li>Do not make decisions that significantly affect your legal rights</li>
            <li>Are subject to human oversight for quality assurance</li>
            <li>Can be reviewed upon request</li>
          </ul>

          <h2>15. Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. Significant changes will be 
            communicated via email and in-app notification at least 30 days before taking effect. 
            Continued use of our services after changes indicates acceptance of the updated policy.
          </p>

          <h2>16. Contact Us</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Data Protection Officer:</strong> dpo@neuratalk.in</p>
            <p><strong>Privacy Inquiries:</strong> privacy@neuratalk.in</p>
            <p><strong>Grievance Officer (India):</strong> grievance@neuratalk.in</p>
            <p><strong>Address:</strong> Mindwhile It Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503</p>
            <p className="mt-2">
              <strong>Response Time:</strong> We aim to respond to all privacy inquiries within 30 days.
            </p>
          </div>

          <h2>17. Complaints</h2>
          <p>
            If you are not satisfied with our response, you have the right to lodge a complaint with:
          </p>
          <ul>
            <li><strong>India:</strong> Data Protection Board of India (once operational)</li>
            <li><strong>EU:</strong> Your local Data Protection Authority</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
