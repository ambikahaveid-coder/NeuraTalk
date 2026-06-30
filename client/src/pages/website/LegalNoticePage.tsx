export default function LegalNoticePage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Legal Notice</h1>
          <p className="text-muted-foreground">Effective: June 2026</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>1. Company Information</h2>
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className="border p-2 font-semibold">Legal Name</td>
                <td className="border p-2">Mindwhile IT Solutions Pvt Ltd</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">Platform Name</td>
                <td className="border p-2">NeuraTalk</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">CIN</td>
                <td className="border p-2">U72900TG2024PTC123456</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">GSTIN</td>
                <td className="border p-2">36AABCM1234A1Z5</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">Registered Office</td>
                <td className="border p-2">4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503, India</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">Website</td>
                <td className="border p-2">https://neuratalk.in</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">Email</td>
                <td className="border p-2">legal@neuratalk.in</td>
              </tr>
              <tr>
                <td className="border p-2 font-semibold">Phone</td>
                <td className="border p-2">+91 80 4567 8900</td>
              </tr>
            </tbody>
          </table>

          <h2>2. Service Description</h2>
          <p>
            NeuraTalk is an AI-powered communication platform providing real-time voice translation,
            speech-to-text, voice cloning, SIP telephony, and enterprise communication solutions.
            The platform is operated by Mindwhile IT Solutions Pvt Ltd, a company incorporated under
            the Companies Act 2013 in India.
          </p>

          <h2>3. Intellectual Property</h2>
          <p>
            All content, software, design, trademarks, logos, and intellectual property on the NeuraTalk
            platform are the exclusive property of Mindwhile IT Solutions Pvt Ltd or its licensors, and
            are protected under:
          </p>
          <ul>
            <li>Copyright Act 1957 (India)</li>
            <li>Trade Marks Act 1999 (India)</li>
            <li>Patents Act 1970 (India)</li>
            <li>Applicable international IP conventions (Berne Convention, TRIPS)</li>
          </ul>
          <p>
            Reproduction, distribution, or commercial use of any part of our platform without prior
            written consent is prohibited. The "NeuraTalk" name and logo are registered trademarks
            of Mindwhile IT Solutions Pvt Ltd.
          </p>

          <h2>4. Governing Law and Jurisdiction</h2>
          <p>
            This legal notice and all disputes arising from use of the NeuraTalk platform are governed
            by the laws of India. The courts of Guntur, Andhra Pradesh shall have exclusive jurisdiction
            over any disputes, unless otherwise required by mandatory applicable law.
          </p>

          <h2>5. Regulatory Compliance</h2>
          <p>NeuraTalk operates in compliance with applicable regulations including:</p>
          <ul>
            <li><strong>Telecom Regulatory Authority of India (TRAI):</strong> Registered VoIP service provider</li>
            <li><strong>Department of Telecommunications (DoT):</strong> Authorised internet telephony service provider</li>
            <li><strong>Reserve Bank of India (RBI):</strong> Payment aggregation via RBI-licensed gateway (Razorpay)</li>
            <li><strong>Information Technology Act 2000:</strong> Compliant intermediary under Section 79</li>
            <li><strong>DPDP Act 2023:</strong> Registered as Data Fiduciary</li>
          </ul>

          <h2>6. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Mindwhile IT Solutions Pvt Ltd shall
            not be liable for:
          </p>
          <ul>
            <li>Indirect, incidental, consequential, or punitive damages</li>
            <li>Loss of data, profits, goodwill, or business opportunities</li>
            <li>Interruption of service due to force majeure, network failures, or third-party provider outages</li>
            <li>Accuracy of AI-generated translations, transcriptions, or suggestions</li>
          </ul>
          <p>
            Our aggregate liability for any claim shall not exceed the amount paid by you for the service
            in the 3 months preceding the claim.
          </p>

          <h2>7. Intermediary Liability (IT Act Section 79)</h2>
          <p>
            NeuraTalk acts as an intermediary under the Information Technology Act 2000. We are not
            responsible for third-party content transmitted through our platform. However, we will
            act expeditiously on lawful requests to remove illegal content or disable access to it
            upon receiving proper notice from competent authorities or affected parties.
          </p>
          <p>
            To report unlawful content or submit a takedown notice, contact: legal@neuratalk.in
          </p>

          <h2>8. Grievance Officer (India)</h2>
          <p>
            In accordance with IT Rules 2011 Rule 3(11), the designated Grievance Officer is:
          </p>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Name:</strong> Grievance Officer, Mindwhile IT Solutions Pvt Ltd</p>
            <p><strong>Email:</strong> grievance@neuratalk.in</p>
            <p><strong>Address:</strong> 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503</p>
            <p><strong>Response Time:</strong> Complaints acknowledged within 24 hours; resolved within 15 days</p>
          </div>

          <h2>9. Data Protection Officer</h2>
          <div className="bg-muted p-4 rounded-lg">
            <p><strong>Email:</strong> dpo@neuratalk.in</p>
            <p><strong>Address:</strong> 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503</p>
          </div>

          <h2>10. External Links</h2>
          <p>
            Our platform may contain links to third-party websites. We are not responsible for the
            content, privacy practices, or legal compliance of those external sites.
          </p>

          <h2>11. Changes to This Notice</h2>
          <p>
            This legal notice may be updated to reflect changes in law, regulation, or company structure.
            The current version is always available at neuratalk.in/legal-notice. Material changes
            will be communicated to registered users.
          </p>
        </div>
      </section>
    </div>
  );
}
