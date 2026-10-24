import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED } from "./site-facts";

/** The storage the website really uses (see client/src: use-auth, theme-toggle, CookieConsent, sidebar). */
const ITEMS: [string, string, string, string][] = [
  ["neuratalk_auth", "Local storage", "Keeps you signed in on this browser", "Until you log out"],
  ["theme", "Local storage", "Remembers light or dark mode", "Until you clear it"],
  ["neuratalk_cookie_consent, neuratalk_cookie_preferences", "Local storage", "Remembers your choice in the cookie banner", "Until you clear it"],
  ["accessibility_prefs", "Local storage", "Remembers accessibility settings", "Until you clear it"],
  ["pwa-install-dismissed", "Local storage", "Remembers that you closed the install prompt", "Until you clear it"],
  ["neuratalk_return_to, neuratalk_signup_flow", "Session storage", "Brings you back to the page you were on after signing in", "Until you close the tab"],
  ["sidebar_state", "Cookie", "Remembers whether the dashboard sidebar is open", "7 days"],
];

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Cookie Policy</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>The short version</h2>
          <p>
            The NeuraTalk website uses only what it needs to work: keeping you signed in and remembering your settings. We do not use advertising
            or tracking cookies, and we do not let third parties track you on our site.
          </p>

          <h2>What we store in your browser</h2>
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border p-2 text-left">Name</th><th className="border p-2 text-left">Type</th><th className="border p-2 text-left">Purpose</th><th className="border p-2 text-left">How long</th></tr></thead>
            <tbody>
              {ITEMS.map(([name, type, purpose, how]) => (
                <tr key={name}><td className="border p-2"><code>{name}</code></td><td className="border p-2">{type}</td><td className="border p-2">{purpose}</td><td className="border p-2">{how}</td></tr>
              ))}
            </tbody>
          </table>
          <p>
            These are strictly necessary for the website to work or to remember choices you made, so they don't need separate consent. If we ever
            add analytics or anything optional, we will ask first and update this page.
          </p>

          <h2>Managing them</h2>
          <p>
            You can clear them at any time in your browser's settings (site data). Clearing <code>neuratalk_auth</code> signs you out. The NeuraTalk
            mobile apps don't use browser cookies.
          </p>

          <h2>Contact</h2>
          <p>Questions: {COMPANY.email}. See also our <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </div>
  );
}
