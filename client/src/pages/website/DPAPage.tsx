import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import {
  COMPANY, PROCESSORS, POLICIES_UPDATED,
  BACKUP_POINT_IN_TIME_DAYS, BACKUP_DAILY_DAYS, BACKUP_MONTHLY_DAYS,
} from "./site-facts";

const SUBPROCESSORS = [...PROCESSORS, { name: "Razorpay", purpose: "Payment processing (when online payments are switched on)", location: "India" }];

type Block = { p: string } | { list: string[] } | { table: [string, string][] };
type Section = { title: string; blocks: Block[] };

/**
 * One text for the page and the download, so they can't disagree. Every
 * security statement here is something NeuraTalk actually does today;
 * nothing is promised that isn't in place.
 */
const SECTIONS: Section[] = [
  { title: "1. Parties", blocks: [
    { p: "This Data Processing Agreement (\"DPA\") is between:" },
    { list: [
      "\"Customer\": the business signing this DPA, which is the Data Fiduciary for its customers' personal data; and",
      `"NeuraTalk": ${COMPANY.legalName} (CIN ${COMPANY.cin}), ${COMPANY.address}, which processes that data on the Customer's behalf as its Data Processor.`,
    ] },
  ] },
  { title: "2. Definitions", blocks: [
    { list: [
      "\"Personal Data\", \"Data Principal\", \"Data Fiduciary\", \"Data Processor\" and \"Personal Data Breach\" have the meanings in the Digital Personal Data Protection Act, 2023 (\"DPDP Act\").",
      "\"Applicable Law\": the DPDP Act, the Digital Personal Data Protection Rules, 2025, the Information Technology Act, 2000 and rules under it.",
      "\"Sub-processor\": a provider NeuraTalk uses to process Personal Data under this DPA.",
    ] },
  ] },
  { title: "3. What is processed, and why", blocks: [
    { p: "Data Principals: the Customer's own customers who chat with it on NeuraTalk, and the Customer's team members." },
    { p: "Personal Data: names, phone numbers and other contact details the Customer adds; conversations, files, orders and form answers exchanged with the Customer; consent and opt-out records; call metadata and, if the Customer uses business calls, call text; team members' account details." },
    { p: "Purposes: delivering the Customer's conversations, updates, login codes and campaigns; translating them when AI translation is used; business calls; billing; keeping the service secure. Call audio is processed in memory to translate it and is not stored." },
  ] },
  { title: "4. NeuraTalk's obligations", blocks: [
    { list: [
      "Process Personal Data only to provide the Services and on the Customer's documented instructions (its settings in the NeuraTalk Business app and dashboard count as instructions).",
      "Bind everyone with access to Personal Data to confidentiality, and limit production access to staff who need it.",
      "Use the security measures in section 5.",
      "Help the Customer answer Data Principals' requests and meet its breach-notification duties.",
      "Not sell the Personal Data and not use it to train AI models.",
      "Delete or return the Personal Data when the agreement ends (section 10).",
    ] },
  ] },
  { title: "5. Security measures in place", blocks: [
    { table: [
      ["Data location", "Database, files and backups are stored in India (AWS, Mumbai)."],
      ["Encryption", "TLS for all traffic to the apps, the website and the API; the database is reached over TLS with certificate checks. Database, files and backups are encrypted at rest (AES-256)."],
      ["Network", "The database accepts connections only from NeuraTalk's own application servers; it is not open to the internet."],
      ["Access", "Role-based access for business teams (owner, admins, agents) and for NeuraTalk staff; administrator actions are logged. Login codes sent by businesses are stored encrypted and erased once used."],
      ["Isolation", "Each business can reach only its own customers, chats, catalog, templates, forms and orders; this is enforced on every request and tested by reading and changing another business's data, which is refused."],
      ["Backups", `Point-in-time backups for ${BACKUP_POINT_IN_TIME_DAYS} days, daily copies for ${BACKUP_DAILY_DAYS} days and monthly copies for ${BACKUP_MONTHLY_DAYS} days, encrypted and kept in India.`],
      ["Hosting", "Physical security of the data centres is provided by Amazon Web Services."],
    ] },
    { p: "NeuraTalk does not yet hold SOC 2 or ISO 27001 reports. It will answer a reasonable security questionnaire on request." },
  ] },
  { title: "6. Sub-processors", blocks: [
    { p: "The Customer authorises these Sub-processors. Each processes only what its task needs, under terms that limit its use to providing its service:" },
    { table: SUBPROCESSORS.map((s) => [s.name, `${s.purpose} — ${s.location}`] as [string, string]) },
    { p: "NeuraTalk will give 30 days' notice before adding a Sub-processor. The Customer may object within 14 days; if the objection can't be resolved, the Customer may end the affected Services and get a refund of prepaid, unused balance for them." },
  ] },
  { title: "7. Transfers outside India", blocks: [
    { p: "Stored data stays in India. Some processing happens abroad for the moment it is needed — chat translation (OpenAI, United States), voices (ElevenLabs, United States / European Union), and backup speech recognition or call translation when the India service is unavailable (Deepgram and OpenAI, United States). These transfers are allowed under section 16 of the DPDP Act, as the Government of India has not restricted these countries. If it does, NeuraTalk will stop transfers there." },
  ] },
  { title: "8. Personal Data Breach", blocks: [
    { list: [
      "NeuraTalk will tell the Customer without delay, and in any case within 48 hours of becoming aware of a breach affecting the Customer's Personal Data.",
      "It will give what it knows of the nature, extent, likely impact and remedial steps, and update the Customer as it learns more, so the Customer can inform the Data Protection Board and affected Data Principals as the DPDP Rules, 2025 require.",
      "It will keep a record of every breach.",
    ] },
  ] },
  { title: "9. Data Principals' rights", blocks: [
    { p: "NeuraTalk will help the Customer, within 10 working days of a request, to give Data Principals access to their data, correct it, erase it, and handle grievances and nominations under the DPDP Act. Customers themselves can stop a business's offers (STOP or block) and delete their own chats in the app." },
  ] },
  { title: "10. End of the agreement", blocks: [
    { list: [
      "Within 30 days, NeuraTalk deletes the Customer's Personal Data, or returns it first if the Customer asks.",
      `Copies in backups expire on their normal cycle (at most ${BACKUP_MONTHLY_DAYS} days) and are not restored.`,
      "Records the law requires us to keep (such as invoices) are kept only for that purpose.",
      "NeuraTalk confirms the deletion in writing on request.",
    ] },
  ] },
  { title: "11. Audits", blocks: [
    { p: "Once a year, or after a breach, the Customer may audit NeuraTalk's compliance with this DPA on 30 days' written notice, during working hours and at its own cost, unless the audit finds a material breach. NeuraTalk may first offer written answers and evidence instead." },
  ] },
  { title: "12. Liability and law", blocks: [
    { p: "Liability follows the main agreement (the NeuraTalk Business Terms or a signed contract). This DPA is governed by the laws of India; disputes follow the main agreement." },
  ] },
];

function renderBlock(block: Block, i: number) {
  if ("p" in block) return <p key={i}>{block.p}</p>;
  if ("list" in block) return <ul key={i}>{block.list.map((item) => <li key={item}>{item}</li>)}</ul>;
  return (
    <table key={i} className="w-full border-collapse text-sm">
      <tbody>{block.table.map(([a, b]) => <tr key={a}><td className="border p-2 font-medium">{a}</td><td className="border p-2">{b}</td></tr>)}</tbody>
    </table>
  );
}

function generateDPAText(): string {
  const line = "=".repeat(80);
  const body = SECTIONS.map((s) => [
    s.title.toUpperCase(),
    "",
    ...s.blocks.map((b) => ("p" in b ? b.p : "list" in b ? b.list.map((x) => `- ${x}`).join("\n") : b.table.map(([a, c]) => `- ${a}: ${c}`).join("\n"))),
  ].join("\n\n")).join(`\n\n${line}\n\n`);
  const signature = ["For the Customer:", "For NeuraTalk (" + COMPANY.legalName + "):"].map((who) =>
    `${who}\nName: ____________________\nTitle: ____________________\nDate: ____________________\nSignature: ____________________`).join("\n\n");
  return `DATA PROCESSING AGREEMENT\nNeuraTalk — ${COMPANY.legalName}\nVersion 3.0 — ${POLICIES_UPDATED}\n\n${line}\n\n${body}\n\n${line}\n\nSIGNATURES\n\n${signature}\n\nFor a signed copy: ${COMPANY.email}\n`;
}

export default function DPAPage() {
  const handleDownload = () => {
    const blob = new Blob([generateDPAText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "NeuraTalk-DPA-v3.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Data Processing Agreement</h1>
          <p className="text-muted-foreground">Under India's Digital Personal Data Protection Act, 2023 · Version 3.0 · {POLICIES_UPDATED}</p>
          <div className="mt-6">
            <Button onClick={handleDownload} size="lg" data-testid="button-download-dpa">
              <Download className="w-4 h-4 mr-2" />
              Download DPA
            </Button>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <div className="bg-muted p-4 rounded-lg mb-8 flex items-start gap-3 not-prose">
            <FileText className="w-6 h-6 mt-1 flex-shrink-0" />
            <p className="text-sm">
              For businesses on NeuraTalk. It applies automatically with the NeuraTalk Business Terms; if you need a signed copy, write to {COMPANY.email}.
            </p>
          </div>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3>{section.title}</h3>
              {section.blocks.map(renderBlock)}
            </div>
          ))}
          <div className="mt-8 text-center not-prose">
            <Button onClick={handleDownload} data-testid="button-download-dpa-bottom">
              <Download className="w-4 h-4 mr-2" />
              Download DPA
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
