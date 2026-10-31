import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Phone, Mail, MapPin, Linkedin, Twitter, Youtube, Building2 } from "lucide-react";
import { ThemeToggle, usePublicTheme } from "@/components/theme-toggle";
import AIChatbot from "./AIChatbot";
import { LogoWithIcon } from "@/components/Logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "How it works" },
  { href: "/products", label: "Products" },
  { href: "/business", label: "Business" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

const footerLinks = {
  product: [
    { href: "/products", label: "Features" },
    { href: "/business", label: "NeuraTalk Business" },
    { href: "/solutions", label: "Solutions" },
    { href: "/pricing", label: "Pricing" },
    { href: "/sdk-docs", label: "API Documentation" },
    { href: "/faq", label: "FAQ" },
    { href: "/release-notes", label: "Release Notes" },
  ],
  company: [
    { href: "/about", label: "About Us" },
    { href: "/contact", label: "Contact" },
    { href: "/trust", label: "Trust Center" },
    { href: "/status", label: "Platform Status" },
    { href: "/investor/login", label: "Investor Relations" },
  ],
  legal: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms of Service" },
    { href: "/community-guidelines", label: "Community Guidelines" },
    { href: "/age-policy", label: "Age Policy" },
    { href: "/voice-policy", label: "Voice and Consent Policy" },
    { href: "/business-terms", label: "Business Terms" },
    { href: "/business-messaging-policy", label: "Business Messaging Policy" },
    { href: "/commerce-policy", label: "Commerce Policy" },
    { href: "/verified-badge-policy", label: "Verified Business Badge" },
    { href: "/dpa", label: "Data Processing Agreement" },
    { href: "/cookie-policy", label: "Cookie Policy" },
    { href: "/ai-usage-policy", label: "AI Usage Policy" },
    { href: "/recording-consent", label: "Recording and Call Text" },
    { href: "/translation-disclaimer", label: "Translation Disclaimer" },
    { href: "/refund-policy", label: "Refund Policy" },
    { href: "/cancellation-policy", label: "Cancellation Policy" },
    { href: "/data-retention", label: "Data Retention" },
    { href: "/data-export", label: "Download Your Data" },
    { href: "/account-deletion", label: "Account Deletion" },
    { href: "/legal-notice", label: "Legal Notice" },
    { href: "/law-enforcement", label: "Law Enforcement Guidelines" },
    { href: "/security", label: "Security" },
    { href: "/grievance", label: "Grievance Redressal" },
  ],
  resources: [
    { href: "/help", label: "Help Center" },
    { href: "/demo", label: "How a call works" },
    { href: "/contact", label: "Support" },
    { href: "/report-abuse", label: "Report Abuse" },
    { href: "/business", label: "For Businesses" },
  ],
};

interface WebsiteLayoutProps {
  children: React.ReactNode;
}

export default function WebsiteLayout({ children }: WebsiteLayoutProps) {
  usePublicTheme();
  const [location] = useLocation();
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <LogoWithIcon size="md" />
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <span className={`text-sm hover:text-primary transition-colors cursor-pointer ${
                  location === link.href ? "text-primary font-medium" : "text-muted-foreground"
                }`}>
                  {link.label}
                </span>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="rounded-full" data-testid="button-login-header">
                Log in
              </Button>
            </Link>

            <Link href="/login" className="hidden md:block">
              <Button size="sm" className="rounded-full px-4" data-testid="button-start-header">
                Start free
              </Button>
            </Link>

            <Sheet>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <nav className="flex flex-col gap-4 mt-8">
                  {navLinks.map((link) => (
                    <Link key={link.href} href={link.href}>
                      <span className="text-lg hover:text-primary cursor-pointer">
                        {link.label}
                      </span>
                    </Link>
                  ))}
                  <div className="border-t pt-4 mt-2">
                    <Link href="/investor/login">
                      <span className="text-lg hover:text-primary cursor-pointer flex items-center gap-2">
                        <Building2 className="w-4 h-4" /> Investor Relations
                      </span>
                    </Link>
                  </div>
                  <Link href="/login">
                    <Button className="w-full">Start free</Button>
                  </Link>
                  <Link href="/login">
                    <Button variant="outline" className="w-full">Log in</Button>
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <AIChatbot />

      <footer className="border-t bg-background">
        <div className="max-w-6xl mx-auto px-4 pt-16 pb-10">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <LogoWithIcon size="sm" />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
                Calls, chats and business messages translated into your language, in your own voice.
              </p>
              <div className="mt-5 flex gap-4">
                <a href="https://linkedin.com/company/neuratalk" target="_blank" rel="noopener noreferrer" aria-label="NeuraTalk on LinkedIn" className="text-muted-foreground hover:text-foreground"><Linkedin className="w-5 h-5" /></a>
                <a href="https://twitter.com/neuratalk_in" target="_blank" rel="noopener noreferrer" aria-label="NeuraTalk on X" className="text-muted-foreground hover:text-foreground"><Twitter className="w-5 h-5" /></a>
                <a href="https://youtube.com/@neuratalk" target="_blank" rel="noopener noreferrer" aria-label="NeuraTalk on YouTube" className="text-muted-foreground hover:text-foreground"><Youtube className="w-5 h-5" /></a>
              </div>
            </div>
            {([["Product", footerLinks.product], ["Company", footerLinks.company], ["Help", footerLinks.resources]] as const).map(([title, links]) => (
              <div key={title}>
                <h4 className="text-sm font-semibold">{title}</h4>
                <ul className="mt-4 space-y-2.5">
                  {links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 border-t pt-8">
            <h4 className="text-sm font-semibold">Policies</h4>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-12 grid gap-6 border-t pt-8 text-sm text-muted-foreground md:grid-cols-3">
            <div className="space-y-1.5">
              <a href="mailto:support@mindwhile.com" className="flex items-center gap-2 hover:text-foreground"><Mail className="w-4 h-4" />support@mindwhile.com</a>
              <a href="tel:+918143752025" className="flex items-center gap-2 hover:text-foreground"><Phone className="w-4 h-4" />+91 81437 52025</a>
            </div>
            <p className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /><span>Mindwhile IT Solutions Pvt Ltd, 4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, AP 522503</span></p>
            <p>Calls and messages are encrypted in transit. We follow India's DPDP Act 2023.</p>
          </div>

          <div className="mt-8 flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
            <p>© {currentYear} Mindwhile IT Solutions Pvt Ltd. All rights reserved.</p>
            <p>CIN: U72900AP2022PTC122855</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
