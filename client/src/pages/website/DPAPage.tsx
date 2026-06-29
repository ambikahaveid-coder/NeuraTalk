import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";

export default function DPAPage() {
  const handleDownload = () => {
    const dpaContent = generateDPAText();
    const blob = new Blob([dpaContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NeuraTalk-DPA-v2.0-Template.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Data Processing Agreement</h1>
          <p className="text-muted-foreground">GDPR & DPDP Act Compliant</p>
          <p className="text-sm text-muted-foreground mt-2">
            Standard Contractual Clauses for B2B Enterprise Customers
          </p>
          <div className="mt-6">
            <Button onClick={handleDownload} size="lg" data-testid="button-download-dpa">
              <Download className="w-4 h-4 mr-2" />
              Download DPA Template
            </Button>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <div className="bg-muted p-4 rounded-lg mb-8 flex items-start gap-3">
            <FileText className="w-6 h-6 mt-1 flex-shrink-0" />
            <div>
              <p className="font-semibold mb-1">For Enterprise Customers</p>
              <p className="text-sm">
                This Data Processing Agreement (DPA) is designed for B2B enterprise customers 
                who need contractual assurances regarding data protection. Download the template 
                and contact legal@neuratalk.in to execute a signed copy.
              </p>
            </div>
          </div>

          <h2>DATA PROCESSING AGREEMENT</h2>
          <p className="text-sm text-muted-foreground">Version 2.0 - February 2026</p>

          <h3>1. PARTIES</h3>
          <p>This Data Processing Agreement ("DPA") is entered into between:</p>
          <ul>
            <li><strong>"Controller" / "Customer":</strong> The entity signing this DPA</li>
            <li><strong>"Processor" / "NeuraTalk":</strong> Mindwhile IT Solutions Pvt Ltd</li>
          </ul>

          <h3>2. DEFINITIONS</h3>
          <ul>
            <li><strong>"Personal Data"</strong>: Any information relating to an identified or identifiable natural person</li>
            <li><strong>"Processing"</strong>: Any operation performed on Personal Data</li>
            <li><strong>"Data Subject"</strong>: The individual whose Personal Data is processed</li>
            <li><strong>"Sub-processor"</strong>: Any third party engaged by Processor to process Personal Data</li>
            <li><strong>"Applicable Laws"</strong>: GDPR, India DPDP Act, and other relevant data protection laws</li>
          </ul>

          <h3>3. SCOPE AND PURPOSE</h3>
          <p>
            This DPA applies to the Processing of Personal Data by NeuraTalk on behalf of Customer 
            in connection with the provision of voice AI translation and communication services 
            ("Services") under the main service agreement.
          </p>
          <p><strong>Categories of Data Subjects:</strong></p>
          <ul>
            <li>Customer's employees and authorized users</li>
            <li>End users of Customer's products/services</li>
            <li>Customer's business contacts</li>
          </ul>
          <p><strong>Types of Personal Data:</strong></p>
          <ul>
            <li>Contact information (name, email, phone)</li>
            <li>Account credentials (encrypted)</li>
            <li>Usage data and call metadata</li>
            <li>Voice samples (when training feature enabled)</li>
            <li>Voice identity and cloning data (when enabled)</li>
            <li>Meeting metadata and recordings (when enabled)</li>
          </ul>
          <p><strong>Processing Activities:</strong></p>
          <ul>
            <li>Account authentication and management</li>
            <li>Real-time voice translation (in-memory, not stored)</li>
            <li>Voice identity training and cloning</li>
            <li>Meeting hosting and screen sharing facilitation</li>
            <li>Service analytics and improvement</li>
            <li>Billing and invoicing</li>
          </ul>

          <h3>4. PROCESSOR OBLIGATIONS</h3>
          <p>NeuraTalk agrees to:</p>
          <ol>
            <li>Process Personal Data only on documented instructions from Customer</li>
            <li>Ensure persons authorized to process Personal Data are bound by confidentiality</li>
            <li>Implement appropriate technical and organizational security measures</li>
            <li>Assist Customer in responding to Data Subject requests</li>
            <li>Assist Customer in ensuring compliance with security and breach notification obligations</li>
            <li>Delete or return Personal Data upon termination as requested</li>
            <li>Make available all information necessary to demonstrate compliance</li>
            <li>Allow and contribute to audits conducted by Customer or their auditor</li>
          </ol>

          <h3>5. SECURITY MEASURES</h3>
          <p>NeuraTalk implements the following security measures:</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Category</th>
                <th className="border p-2 text-left">Measures</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">Encryption</td>
                <td className="border p-2">TLS 1.3 in transit, AES-256 at rest</td>
              </tr>
              <tr>
                <td className="border p-2">Access Control</td>
                <td className="border p-2">Role-based access, MFA for admin accounts</td>
              </tr>
              <tr>
                <td className="border p-2">Network Security</td>
                <td className="border p-2">Firewalls, intrusion detection, DDoS protection</td>
              </tr>
              <tr>
                <td className="border p-2">Monitoring</td>
                <td className="border p-2">24/7 logging, anomaly detection, SIEM</td>
              </tr>
              <tr>
                <td className="border p-2">Physical Security</td>
                <td className="border p-2">Secure data centers with biometric access</td>
              </tr>
              <tr>
                <td className="border p-2">Personnel</td>
                <td className="border p-2">Background checks, security training, NDAs</td>
              </tr>
              <tr>
                <td className="border p-2">Incident Response</td>
                <td className="border p-2">Documented procedures, 72-hour notification</td>
              </tr>
            </tbody>
          </table>

          <h3>6. SUB-PROCESSORS</h3>
          <p>Customer authorizes NeuraTalk to engage the following sub-processors:</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Sub-processor</th>
                <th className="border p-2 text-left">Purpose</th>
                <th className="border p-2 text-left">Location</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2">OpenAI</td>
                <td className="border p-2">AI translation processing</td>
                <td className="border p-2">USA</td>
              </tr>
              <tr>
                <td className="border p-2">Razorpay</td>
                <td className="border p-2">Payment processing</td>
                <td className="border p-2">India</td>
              </tr>
            </tbody>
          </table>
          <p>
            NeuraTalk will notify Customer at least 30 days before engaging new sub-processors. 
            Customer may object to new sub-processors within 14 days.
          </p>

          <h3>7. INTERNATIONAL DATA TRANSFERS</h3>
          <p>
            For transfers outside India/EEA, NeuraTalk ensures appropriate safeguards:
          </p>
          <ul>
            <li>Standard Contractual Clauses (SCCs) as approved by the European Commission</li>
            <li>Compliance with India DPDP Act cross-border transfer requirements</li>
            <li>Additional measures as required by Schrems II decision</li>
          </ul>

          <h3>8. DATA BREACH NOTIFICATION</h3>
          <p>
            In case of a Personal Data breach, NeuraTalk will:
          </p>
          <ul>
            <li>Notify Customer without undue delay (within 48 hours of becoming aware)</li>
            <li>Provide details of the breach, likely consequences, and remedial measures</li>
            <li>Cooperate with Customer's investigation and notification obligations</li>
            <li>Document all breaches including facts, effects, and remedial actions</li>
          </ul>

          <h3>9. DATA SUBJECT RIGHTS</h3>
          <p>
            NeuraTalk will assist Customer in responding to Data Subject requests for:
          </p>
          <ul>
            <li>Access to Personal Data</li>
            <li>Rectification of inaccurate data</li>
            <li>Erasure ("right to be forgotten")</li>
            <li>Restriction of processing</li>
            <li>Data portability</li>
            <li>Objection to processing</li>
          </ul>
          <p>
            Response time: Within 10 business days of receiving Customer's request.
          </p>

          <h3>10. AUDIT RIGHTS</h3>
          <p>
            Customer has the right to audit NeuraTalk's compliance with this DPA:
          </p>
          <ul>
            <li>Upon 30 days' written notice</li>
            <li>During normal business hours</li>
            <li>At Customer's expense (unless audit reveals material non-compliance)</li>
            <li>Limited to once per year unless there is a suspected breach</li>
          </ul>
          <p>
            Alternatively, NeuraTalk may provide:
          </p>
          <ul>
            <li>SOC 2 Type II report (when available)</li>
            <li>ISO 27001 certification (when available)</li>
            <li>Completed security questionnaire</li>
          </ul>

          <h3>11. TERM AND TERMINATION</h3>
          <p>
            This DPA remains in effect for the duration of the main service agreement. 
            Upon termination, NeuraTalk will:
          </p>
          <ul>
            <li>Return or delete all Personal Data within 30 days</li>
            <li>Provide certification of deletion upon request</li>
            <li>Retain data only as required by law</li>
          </ul>

          <h3>12. LIABILITY</h3>
          <p>
            Each party's liability under this DPA is subject to the limitations in the main 
            service agreement. NeuraTalk shall be liable for damages caused by processing 
            that violates this DPA or Applicable Laws.
          </p>

          <h3>13. GOVERNING LAW</h3>
          <p>
            This DPA is governed by the same law as the main service agreement. 
            For EU data, GDPR provisions shall apply. For Indian data, DPDP Act provisions shall apply.
          </p>

          <h3>SIGNATURES</h3>
          <div className="bg-muted p-4 rounded-lg mt-4">
            <p><strong>For Customer:</strong></p>
            <p>Name: _______________________</p>
            <p>Title: _______________________</p>
            <p>Date: _______________________</p>
            <p>Signature: _______________________</p>
            <br />
            <p><strong>For NeuraTalk (Mindwhile IT Solutions Pvt Ltd):</strong></p>
            <p>Name: _______________________</p>
            <p>Title: _______________________</p>
            <p>Date: _______________________</p>
            <p>Signature: _______________________</p>
          </div>

          <h3>ANNEX A: STANDARD CONTRACTUAL CLAUSES</h3>
          <p>
            For transfers to third countries, the EU Standard Contractual Clauses 
            (Commission Decision 2021/914) are incorporated by reference and available 
            upon request.
          </p>

          <div className="mt-8 text-center">
            <Button onClick={handleDownload} data-testid="button-download-dpa-bottom">
              <Download className="w-4 h-4 mr-2" />
              Download DPA Template
            </Button>
            <p className="text-sm text-muted-foreground mt-4">
              For executed copies, contact: legal@neuratalk.in
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function generateDPAText(): string {
  return `DATA PROCESSING AGREEMENT
NeuraTalk - Mindwhile IT Solutions Pvt Ltd
Version 2.0 - February 2026

================================================================================

1. PARTIES

This Data Processing Agreement ("DPA") is entered into between:

- "Controller" / "Customer": The entity signing this DPA
- "Processor" / "NeuraTalk": Mindwhile IT Solutions Pvt Ltd

================================================================================

2. DEFINITIONS

- "Personal Data": Any information relating to an identified or identifiable natural person
- "Processing": Any operation performed on Personal Data
- "Data Subject": The individual whose Personal Data is processed
- "Sub-processor": Any third party engaged by Processor to process Personal Data
- "Applicable Laws": GDPR, India DPDP Act, and other relevant data protection laws

================================================================================

3. SCOPE AND PURPOSE

This DPA applies to the Processing of Personal Data by NeuraTalk on behalf of Customer 
in connection with the provision of voice AI translation and communication services 
("Services") under the main service agreement.

Categories of Data Subjects:
- Customer's employees and authorized users
- End users of Customer's products/services
- Customer's business contacts

Types of Personal Data:
- Contact information (name, email, phone)
- Account credentials (encrypted)
- Usage data and call metadata
- Voice samples (when training feature enabled)
- Voice identity and cloning data (when enabled)
- Meeting metadata and recordings (when enabled)

Processing Activities:
- Account authentication and management
- Real-time voice translation (in-memory, not stored)
- Voice identity training and cloning
- Meeting hosting and screen sharing facilitation
- Service analytics and improvement
- Billing and invoicing

================================================================================

4. PROCESSOR OBLIGATIONS

NeuraTalk agrees to:

1. Process Personal Data only on documented instructions from Customer
2. Ensure persons authorized to process Personal Data are bound by confidentiality
3. Implement appropriate technical and organizational security measures
4. Assist Customer in responding to Data Subject requests
5. Assist Customer in ensuring compliance with security and breach notification obligations
6. Delete or return Personal Data upon termination as requested
7. Make available all information necessary to demonstrate compliance
8. Allow and contribute to audits conducted by Customer or their auditor

================================================================================

5. SECURITY MEASURES

NeuraTalk implements the following security measures:

| Category          | Measures                                          |
|-------------------|---------------------------------------------------|
| Encryption        | TLS 1.3 in transit, AES-256 at rest               |
| Access Control    | Role-based access, MFA for admin accounts         |
| Network Security  | Firewalls, intrusion detection, DDoS protection   |
| Monitoring        | 24/7 logging, anomaly detection, SIEM             |
| Physical Security | Secure data centers with biometric access         |
| Personnel         | Background checks, security training, NDAs        |
| Incident Response | Documented procedures, 72-hour notification       |

================================================================================

6. SUB-PROCESSORS

Customer authorizes NeuraTalk to engage the following sub-processors:

| Sub-processor | Purpose                  | Location |
|---------------|--------------------------|----------|
| OpenAI        | AI translation processing| USA      |
| Razorpay      | Payment processing       | India    |

NeuraTalk will notify Customer at least 30 days before engaging new sub-processors.
Customer may object to new sub-processors within 14 days.

================================================================================

7. INTERNATIONAL DATA TRANSFERS

For transfers outside India/EEA, NeuraTalk ensures appropriate safeguards:
- Standard Contractual Clauses (SCCs) as approved by the European Commission
- Compliance with India DPDP Act cross-border transfer requirements
- Additional measures as required by Schrems II decision

================================================================================

8. DATA BREACH NOTIFICATION

In case of a Personal Data breach, NeuraTalk will:
- Notify Customer without undue delay (within 48 hours of becoming aware)
- Provide details of the breach, likely consequences, and remedial measures
- Cooperate with Customer's investigation and notification obligations
- Document all breaches including facts, effects, and remedial actions

================================================================================

9. DATA SUBJECT RIGHTS

NeuraTalk will assist Customer in responding to Data Subject requests for:
- Access to Personal Data
- Rectification of inaccurate data
- Erasure ("right to be forgotten")
- Restriction of processing
- Data portability
- Objection to processing

Response time: Within 10 business days of receiving Customer's request.

================================================================================

10. AUDIT RIGHTS

Customer has the right to audit NeuraTalk's compliance with this DPA:
- Upon 30 days' written notice
- During normal business hours
- At Customer's expense (unless audit reveals material non-compliance)
- Limited to once per year unless there is a suspected breach

================================================================================

11. TERM AND TERMINATION

This DPA remains in effect for the duration of the main service agreement.
Upon termination, NeuraTalk will:
- Return or delete all Personal Data within 30 days
- Provide certification of deletion upon request
- Retain data only as required by law

================================================================================

SIGNATURES

For Customer:
Name: _______________________
Title: _______________________
Date: _______________________
Signature: _______________________


For NeuraTalk (Mindwhile IT Solutions Pvt Ltd):
Name: _______________________
Title: _______________________
Date: _______________________
Signature: _______________________

================================================================================

For executed copies, contact: legal@neuratalk.in

================================================================================
`;
}