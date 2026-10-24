import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeCheck, Ban, FileLock2, KeyRound, Lock, MicOff, ShieldCheck, UserRound } from "lucide-react";
import { COMPANY, PROCESSORS, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

const PRACTICES = [
  { icon: Lock, title: "Encrypted in transit", desc: "Calls, messages and files travel over encrypted connections (TLS, and SRTP for call media). Calls are not end-to-end encrypted, because translation needs our servers to process speech." },
  { icon: MicOff, title: "No call recordings", desc: `Call audio is never stored. The translated text of a call stays in the caller's history for ${CALL_TEXT_RETENTION_DAYS} days and is then deleted automatically.` },
  { icon: FileLock2, title: "Private files", desc: "Photos, videos and documents sent in a chat can only be opened by the people in that conversation, with their own signed-in session." },
  { icon: UserRound, title: "Your voice is yours", desc: "A cloned voice speaks only its owner's own words. Learning a voice from calls needs the owner's permission, and the voice can be deleted at any time." },
  { icon: KeyRound, title: "Login codes protected", desc: "Codes businesses send are stored encrypted, shown only to the customer, and erased as soon as they are used or expire." },
  { icon: BadgeCheck, title: "Businesses are checked", desc: "The verified tick is given only after the NeuraTalk team checks a business, and every message template is reviewed before it can be sent." },
  { icon: Ban, title: "You can always say no", desc: "Block any person or business, switch off offers from a business, and delete your account and data from the app." },
  { icon: ShieldCheck, title: "Least access", desc: "Only staff who need production access have it, sign-ins are session-based and expire, and administrator actions are logged." },
];

export default function TrustCenterPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-4">Trust Center</h1>
          <p className="text-lg text-muted-foreground">How NeuraTalk protects your calls, messages and voice — stated plainly, without badges we haven't earned.</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PRACTICES.map((p) => (
            <Card key={p.title} className="h-full"><CardContent className="p-6">
              <p.icon className="w-8 h-8 text-primary mb-3" />
              <h3 className="font-semibold mb-2">{p.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
            </CardContent></Card>
          ))}
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>Where your data is processed</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Provider</th><th className="border p-2 text-left">What for</th><th className="border p-2 text-left">Where</th></tr></thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name}><td className="border p-2">{p.name}</td><td className="border p-2">{p.purpose}</td><td className="border p-2">{p.location}</td></tr>
              ))}
            </tbody>
          </table>

          <h2>Compliance</h2>
          <p>
            We follow India's Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and its rules. We have not
            completed SOC 2 or ISO 27001 audits; when we do, the reports will be listed here. Businesses that need a data processing agreement
            can request one — see our <Link href="/dpa">Data Processing Agreement</Link>.
          </p>

          <h2>Report a security issue</h2>
          <p>
            If you find a vulnerability, please email {COMPANY.email} with "Security" in the subject and give us a reasonable time to fix it
            before making it public. We will not take action against good-faith research that avoids harming users or their data.
          </p>

          <h2>Related</h2>
          <p>
            <Link href="/privacy">Privacy Policy</Link> · <Link href="/data-retention">Data Retention</Link> ·{" "}
            <Link href="/business-messaging-policy">Business Messaging Policy</Link> · <Link href="/report-abuse">Report Abuse</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
