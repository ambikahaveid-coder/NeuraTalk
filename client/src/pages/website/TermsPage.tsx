export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Terms and Conditions</h1>
          <p className="text-muted-foreground">Last updated: February 2026</p>
          <p className="text-sm text-muted-foreground mt-2">
            Enterprise Agreement for NeuraTalk Services
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using NeuraTalk services ("Services"), you ("User", "Customer", "you") 
            agree to be bound by these Terms and Conditions ("Agreement"). If you are entering into 
            this Agreement on behalf of a company or other legal entity, you represent that you have 
            the authority to bind such entity to these terms.
          </p>
          <p>
            If you disagree with any part of these terms, you may not use our Services.
          </p>

          <h2>2. Definitions</h2>
          <ul>
            <li><strong>"NeuraTalk"</strong> refers to Mindwhile IT Solutions Pvt Ltd, the provider of the Services</li>
            <li><strong>"Services"</strong> means all voice AI, translation, and communication services provided</li>
            <li><strong>"User Data"</strong> means any data, content, or information submitted by you</li>
            <li><strong>"Confidential Information"</strong> means non-public information disclosed by either party</li>
            <li><strong>"Enterprise Account"</strong> means a B2B organization account with multiple users</li>
            <li><strong>"SLA"</strong> means Service Level Agreement as defined in Section 15</li>
          </ul>

          <h2>3. Description of Services</h2>
          <p>
            NeuraTalk provides voice AI communication services including:
          </p>
          <ul>
            <li>Real-time voice translation during calls (40+ languages)</li>
            <li>Multilingual video conferencing with emotion preservation</li>
            <li>AI voice assistant with emotional intelligence</li>
            <li>Voice identity training, cloning, and personalization</li>
            <li>Meetings hub with scheduling and screen sharing</li>
            <li>Enterprise API access for integration</li>
            <li>B2B multi-tenant platform with role-based access</li>
          </ul>
          <p>
            We are a communication enhancement service operating on self-hosted infrastructure. 
            We work alongside your existing phone carrier - we do not replace your phone service 
            or assign phone numbers.
          </p>

          <h2>4. Account Registration</h2>
          <h3>4.1 Individual Accounts</h3>
          <ul>
            <li>You must provide accurate and complete information during registration</li>
            <li>You are responsible for maintaining the security of your account credentials</li>
            <li>You must be at least 18 years old to use our Services</li>
            <li>One account per person unless specifically authorized</li>
          </ul>

          <h3>4.2 Enterprise Accounts</h3>
          <ul>
            <li>Must be registered by authorized company representatives</li>
            <li>Company Admin is responsible for all users under the organization</li>
            <li>Company is liable for all usage by its employees/agents</li>
            <li>Must provide valid business registration details</li>
          </ul>

          <h2>5. Subscription Plans, Payments, and Billing</h2>
          
          <h3>5.1 Consumer (B2C) Subscription Plans</h3>
          <p>All prices are in United States Dollars (USD):</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Plan</th>
                <th className="border p-2 text-left">Price (USD)</th>
                <th className="border p-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Free Trial</td>
                <td className="border p-2">$0.00</td>
                <td className="border p-2">Limited minutes, basic features</td>
              </tr>
              <tr>
                <td className="border p-2">Weekly</td>
                <td className="border p-2">$4.99/week</td>
                <td className="border p-2">Full access, standard minutes</td>
              </tr>
              <tr>
                <td className="border p-2">Monthly</td>
                <td className="border p-2">$14.99/month</td>
                <td className="border p-2">Full access, extended minutes</td>
              </tr>
              <tr>
                <td className="border p-2">Quarterly</td>
                <td className="border p-2">$34.99/quarter</td>
                <td className="border p-2">Full access, priority support</td>
              </tr>
              <tr>
                <td className="border p-2">Yearly</td>
                <td className="border p-2">$99.99/year</td>
                <td className="border p-2">Full access, premium support, best value</td>
              </tr>
            </tbody>
          </table>

          <h3>5.2 Enterprise (B2B) Credit System</h3>
          <ul>
            <li>Credits are required to use translation and calling features</li>
            <li>1 credit approximates 1 minute of translated call time</li>
            <li>Free credits are provided to new organizations (amount varies by plan)</li>
            <li>Credits are non-transferable between organizations</li>
            <li>Unused credits do not expire while account remains active</li>
            <li>Enterprise credit packages are available in bulk at volume discounts</li>
          </ul>

          <h3>5.3 Billing Terms</h3>
          <ul>
            <li>All prices are listed in United States Dollars (USD)</li>
            <li>Payments are processed through Razorpay (PCI-DSS Level 1 compliant)</li>
            <li>Enterprise customers may request invoicing with NET-30 payment terms</li>
            <li>Applicable sales tax or VAT will be added based on your jurisdiction</li>
            <li>Subscription renewals are automatic unless cancelled before the renewal date</li>
            <li>Price changes will be communicated at least 30 days in advance</li>
          </ul>

          <h3>5.4 Refund Policy</h3>
          <ul>
            <li>Unused credits: Refundable within 30 days of purchase</li>
            <li>Subscription fees: Pro-rated refund for unused period</li>
            <li>Enterprise contracts: As per individual agreement terms</li>
            <li>No refunds for consumed credits or completed services</li>
          </ul>

          <h2>6. Acceptable Use Policy</h2>
          <p>You agree NOT to:</p>
          <ul>
            <li>Use the Services for illegal activities or to violate any laws</li>
            <li>Attempt to intercept, record, or monitor calls without consent</li>
            <li>Impersonate others or provide false identity information</li>
            <li>Use the Services for harassment, spam, fraud, or phishing</li>
            <li>Attempt to reverse-engineer, decompile, or extract our technology</li>
            <li>Resell or redistribute our Services without written authorization</li>
            <li>Violate any telecommunications regulations in your jurisdiction</li>
            <li>Transmit malware, viruses, or malicious code</li>
            <li>Exceed rate limits or abuse API access</li>
            <li>Use the Services to develop competing products</li>
          </ul>

          <h2>7. Fair Usage Policy</h2>
          <p>To ensure quality service for all users:</p>
          <ul>
            <li><strong>Individual accounts:</strong> Up to 1,000 minutes/month of translated calls</li>
            <li><strong>Business accounts:</strong> Usage as per your subscribed plan limits</li>
            <li><strong>Enterprise accounts:</strong> Custom limits as per contract</li>
            <li>We may throttle or suspend accounts showing unusual or abusive patterns</li>
            <li>Commercial reselling requires an enterprise reseller agreement</li>
          </ul>

          <h2>8. Data Protection and Privacy</h2>
          <p>
            Your use of the Services is also governed by our <a href="/privacy">Privacy Policy</a>, 
            which is incorporated into these Terms by reference. Key points:
          </p>
          <ul>
            <li>We comply with GDPR, India DPDP Act, and applicable data protection laws</li>
            <li>We do not sell your personal data</li>
            <li>Call content is not stored unless you explicitly enable recording</li>
            <li>Enterprise customers may request a Data Processing Agreement (DPA)</li>
          </ul>

          <h2>9. Confidentiality</h2>
          <p>
            Both parties agree to protect Confidential Information disclosed during the relationship:
          </p>
          <ul>
            <li>Use Confidential Information only for purposes of this Agreement</li>
            <li>Protect it with at least the same care as their own confidential information</li>
            <li>Not disclose to third parties without prior written consent</li>
            <li>This obligation survives termination for 3 years</li>
          </ul>
          <p>
            Exceptions: Information that is publicly available, independently developed, 
            or required to be disclosed by law.
          </p>

          <h2>10. Intellectual Property</h2>
          <h3>10.1 NeuraTalk IP</h3>
          <ul>
            <li>NeuraTalk technology, algorithms, branding, and content are our intellectual property</li>
            <li>You receive a limited, non-exclusive license to use the Services</li>
            <li>No rights are granted except as expressly stated in this Agreement</li>
          </ul>

          <h3>10.2 Your Content</h3>
          <ul>
            <li>You retain ownership of your voice samples, data, and content</li>
            <li>You grant us a license to process your audio for translation purposes only</li>
            <li>This license is limited to providing the Services and does not extend to other uses</li>
          </ul>

          <h2>11. Service Availability and Support</h2>
          <h3>11.1 Availability</h3>
          <ul>
            <li>We target 99.9% uptime (see SLA in Section 15 for guarantees)</li>
            <li>Planned maintenance will be announced at least 48 hours in advance</li>
            <li>Emergency maintenance may be performed without notice</li>
          </ul>

          <h3>11.2 Support</h3>
          <ul>
            <li><strong>Standard:</strong> Email support with 48-hour response time</li>
            <li><strong>Business:</strong> Priority support with 24-hour response time</li>
            <li><strong>Enterprise:</strong> Dedicated support with 4-hour response time</li>
          </ul>

          <h2>12. Warranties and Disclaimers</h2>
          <h3>12.1 Our Warranties</h3>
          <p>We warrant that:</p>
          <ul>
            <li>The Services will perform substantially as described in documentation</li>
            <li>We will use commercially reasonable efforts to maintain service availability</li>
            <li>We have the right to provide the Services</li>
          </ul>

          <h3>12.2 Disclaimers</h3>
          <p>
            EXCEPT AS EXPRESSLY STATED, THE SERVICES ARE PROVIDED "AS IS" WITHOUT WARRANTIES 
            OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS 
            FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
          </p>
          <ul>
            <li>Translation accuracy may vary by language, accent, and context</li>
            <li>Service quality depends on your internet connection and carrier network</li>
            <li>We do not guarantee real-time translation for all language pairs</li>
          </ul>

          <h2>13. Limitation of Liability</h2>
          <p>To the maximum extent permitted by applicable law:</p>
          <ul>
            <li><strong>No Indirect Damages:</strong> Neither party is liable for indirect, 
                incidental, consequential, special, or punitive damages</li>
            <li><strong>Cap on Liability:</strong> Our total liability is limited to the greater of 
                (a) the amount you paid us in the last 12 months, or (b) $500 USD</li>
            <li><strong>Translation Errors:</strong> We are not liable for miscommunications 
                arising from translation inaccuracies</li>
            <li><strong>Third-Party Issues:</strong> We are not liable for issues caused by 
                your carrier, ISP, or third-party services</li>
          </ul>
          <p>
            These limitations do not apply to breaches of confidentiality, IP infringement, 
            gross negligence, or willful misconduct.
          </p>

          <h2>14. Indemnification</h2>
          <p>
            You agree to indemnify and hold NeuraTalk harmless from any claims, damages, 
            or expenses arising from:
          </p>
          <ul>
            <li>Your violation of these Terms</li>
            <li>Your use of the Services in violation of applicable laws</li>
            <li>Your infringement of third-party rights</li>
            <li>Content you transmit through the Services</li>
          </ul>

          <h2>15. Service Level Agreement (SLA)</h2>
          <p>For Enterprise customers with active contracts:</p>
          
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Uptime Commitment</th>
                <th className="border p-2 text-left">Service Credit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">99.9% - 99.5%</td>
                <td className="border p-2">10% of monthly fee</td>
              </tr>
              <tr>
                <td className="border p-2">99.5% - 99.0%</td>
                <td className="border p-2">25% of monthly fee</td>
              </tr>
              <tr>
                <td className="border p-2">Below 99.0%</td>
                <td className="border p-2">50% of monthly fee</td>
              </tr>
            </tbody>
          </table>
          
          <p className="mt-4">
            SLA credits must be claimed within 30 days of the incident. Credits are applied 
            to future invoices and do not result in cash refunds.
          </p>

          <h2>16. Account Termination</h2>
          <h3>16.1 Termination by You</h3>
          <ul>
            <li>You may close your account at any time through Settings</li>
            <li>Unused credits may be refunded as per our Refund Policy</li>
            <li>Enterprise contracts: As per individual agreement terms</li>
          </ul>

          <h3>16.2 Termination by Us</h3>
          <p>We may suspend or terminate your account if:</p>
          <ul>
            <li>You violate these Terms or Acceptable Use Policy</li>
            <li>Your payment method fails repeatedly (after 14-day grace period)</li>
            <li>We detect fraudulent or abusive behavior</li>
            <li>Required by law or regulatory order</li>
          </ul>

          <h3>16.3 Effect of Termination</h3>
          <ul>
            <li>Access to Services will be immediately suspended</li>
            <li>Your data will be retained for 30 days, then deleted</li>
            <li>You may request data export before termination</li>
            <li>Sections on Confidentiality, IP, Limitation of Liability survive</li>
          </ul>

          <h2>17. Force Majeure</h2>
          <p>
            Neither party is liable for failure to perform due to causes beyond reasonable 
            control, including natural disasters, war, terrorism, pandemics, government actions, 
            or internet/telecommunications outages.
          </p>

          <h2>18. Changes to Terms</h2>
          <p>
            We may modify these Terms with at least 30 days' notice for material changes. 
            Notice will be provided via email and in-app notification. Continued use after 
            changes indicates acceptance. If you disagree, you may terminate your account.
          </p>

          <h2>19. Governing Law and Dispute Resolution</h2>
          <h3>19.1 Governing Law</h3>
          <p>
            These Terms are governed by the laws of India. For EU users, this does not 
            affect mandatory consumer protection laws of your country.
          </p>

          <h3>19.2 Dispute Resolution</h3>
          <ul>
            <li><strong>Informal Resolution:</strong> Parties agree to attempt good-faith 
                negotiation for 30 days before legal action</li>
            <li><strong>Arbitration:</strong> Disputes shall be resolved by binding arbitration 
                under the Arbitration and Conciliation Act, 1996</li>
            <li><strong>Venue:</strong> Guntur, Andhra Pradesh, India</li>
            <li><strong>Language:</strong> English</li>
          </ul>

          <h2>20. Miscellaneous</h2>
          <ul>
            <li><strong>Entire Agreement:</strong> These Terms, Privacy Policy, and any 
                Enterprise Agreement constitute the complete agreement</li>
            <li><strong>Severability:</strong> If any provision is invalid, the remainder 
                remains in effect</li>
            <li><strong>Waiver:</strong> Failure to enforce any right does not waive future 
                enforcement</li>
            <li><strong>Assignment:</strong> You may not assign this Agreement without consent; 
                we may assign to an affiliate or successor</li>
            <li><strong>Notices:</strong> We may send notices via email or in-app notification</li>
          </ul>

          <h2>21. Contact</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Legal Inquiries:</strong> legal@neuratalk.com</p>
            <p><strong>Support:</strong> support@neuratalk.com</p>
            <p><strong>Address:</strong> Mindwhile It Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503</p>
            <p><strong>Company Registration:</strong> [Registration Number]</p>
          </div>
        </div>
      </section>
    </div>
  );
}