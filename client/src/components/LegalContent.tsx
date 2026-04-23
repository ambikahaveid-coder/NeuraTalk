import React from 'react';

interface LegalProps {
  documentType: 'privacy' | 'terms' | 'dpa';
}

export const LegalContent: React.FC<LegalProps> = ({ documentType }) => {
  const content = {
    privacy: {
      title: "Privacy Policy",
      body: "Neura-Talk (Mindwhile IT Solutions Pvt Ltd) processes data per the India DPDP Act 2023 and GDPR. We collect identifiers solely for authentication. Voice data is processed in memory and NOT stored unless explicitly enabled by BOTH parties."
    },
    terms: {
      title: "Terms of Service",
      body: "Neura-Talk is a communication enhancement layer. We do not provide PSTN services directly. Recording requires Two-Party Consent in many jurisdictions. Users are responsible for ensuring all participants have consented."
    },
    dpa: {
      title: "Data Processing Agreement",
      body: "For B2B customers, Neura-Talk acts as a Data Processor. We commit to AES-256 encryption at rest, TLS 1.3 in-transit, and 24-hour breach notification to the client."
    }
  };

  const doc = content[documentType];

  return (
    <div className="p-6 bg-white shadow rounded-lg max-w-3xl mx-auto my-10 font-sans">
      <h1 className="text-3xl font-bold mb-4 border-b pb-2 text-indigo-900">{doc.title}</h1>
      <p className="text-gray-700 leading-relaxed whitespace-pre-line text-lg">
        {doc.body}
      </p>
      <div className="mt-8 text-sm text-gray-500 border-t pt-4 italic">
        Last Updated: April 2, 2026 | Mindwhile IT Solutions Pvt Ltd | Mangalagiri, AP
      </div>
    </div>
  );
};