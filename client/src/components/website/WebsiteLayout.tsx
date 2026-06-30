import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Phone, Globe, Mail, MapPin, Linkedin, Twitter, Youtube, ArrowRight, Building2, Users, Shield, FileText } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import AIChatbot from "./AIChatbot";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/demo", label: "Demo" },
  { href: "/products", label: "Products" },
  { href: "/solutions", label: "Solutions" },
  { href: "/faq", label: "FAQ" },
  { href: "/sdk-docs", label: "API Docs" },
  { href: "/contact", label: "Contact" },
];

const footerLinks = {
  product: [
    { href: "/products", label: "Features" },
    { href: "/solutions", label: "Solutions" },
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
    { href: "/dpa", label: "Data Processing Agreement" },
    { href: "/cookie-policy", label: "Cookie Policy" },
    { href: "/ai-usage-policy", label: "AI Usage Policy" },
    { href: "/recording-consent", label: "Recording Consent" },
    { href: "/translation-disclaimer", label: "Translation Disclaimer" },
    { href: "/refund-policy", label: "Refund Policy" },
    { href: "/cancellation-policy", label: "Cancellation Policy" },
    { href: "/data-retention", label: "Data Retention" },
    { href: "/data-export", label: "Data Export" },
    { href: "/account-deletion", label: "Account Deletion" },
    { href: "/legal-notice", label: "Legal Notice" },
  ],
  resources: [
    { href: "/help", label: "Help Center" },
    { href: "/demo", label: "Watch Demo" },
    { href: "/contact", label: "Support" },
    { href: "/report-abuse", label: "Report Abuse" },
    { href: "/contact", label: "Enterprise Sales" },
  ],
};

interface WebsiteLayoutProps {
  children: React.ReactNode;
}

export default function WebsiteLayout({ children }: WebsiteLayoutProps) {
  const [location] = useLocation();
  const [language, setLanguage] = useState("en");
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <Phone className="w-6 h-6 text-primary" />
              <span className="font-bold text-xl">NeuraTalk</span>
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
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[100px] h-8" data-testid="select-language">
                <Globe className="w-4 h-4 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="te">తెలుగు</SelectItem>
                <SelectItem value="ta">தமிழ்</SelectItem>
                <SelectItem value="kn">ಕನ್ನಡ</SelectItem>
                <SelectItem value="hi">हिंदी</SelectItem>
              </SelectContent>
            </Select>

            <ThemeToggle />

            <Link href="/demo" className="hidden md:block">
              <Button variant="outline" size="sm" data-testid="button-request-demo">
                Watch Demo
              </Button>
            </Link>

            <Link href="/login" className="hidden sm:block">
              <Button size="sm" data-testid="button-login-header">
                Login
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
                  <Link href="/demo">
                    <Button variant="outline" className="w-full">Watch Demo</Button>
                  </Link>
                  <Link href="/login">
                    <Button className="w-full">Login</Button>
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

      <footer className="bg-muted/50 border-t">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <Phone className="w-5 h-5 text-primary" />
                <span className="font-bold">NeuraTalk</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Breaking language barriers with AI-powered voice translation for enterprises worldwide.
              </p>
              <div className="flex gap-3">
                <a href="https://linkedin.com/company/neuratalk" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                  <Linkedin className="w-5 h-5" />
                </a>
                <a href="https://twitter.com/neuratalk_in" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                  <Twitter className="w-5 h-5" />
                </a>
                <a href="https://youtube.com/@neuratalk" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                  <Youtube className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" /> Product
              </h4>
              <ul className="space-y-2">
                {footerLinks.product.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href}>
                      <span className="text-sm text-muted-foreground hover:text-primary cursor-pointer">
                        {link.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Company
              </h4>
              <ul className="space-y-2">
                {footerLinks.company.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href}>
                      <span className="text-sm text-muted-foreground hover:text-primary cursor-pointer">
                        {link.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Legal
              </h4>
              <ul className="space-y-2">
                {footerLinks.legal.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href}>
                      <span className="text-sm text-muted-foreground hover:text-primary cursor-pointer">
                        {link.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <Users className="w-4 h-4" /> Get Started
              </h4>
              <ul className="space-y-2">
                {footerLinks.resources.map((link, idx) => (
                  <li key={link.href + link.label + idx}>
                    <Link href={link.href}>
                      <span className="text-sm text-muted-foreground hover:text-primary cursor-pointer flex items-center gap-1">
                        {link.label} <ArrowRight className="w-3 h-3" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t mt-8 pt-8">
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="flex flex-col gap-2">
                <h5 className="font-medium text-sm">Contact Information</h5>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="w-4 h-4" />
                  <span>support@neuratalk.in</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="w-4 h-4" />
                  <span>+91 80 4567 8900</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4 mt-0.5" />
                  <span>Mindwhile It Solutions Pvt Ltd<br/>4th Floor, Mayuri Tech Park<br/>Mangalagiri, Guntur, AP 522503</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h5 className="font-medium text-sm">Compliance & Certifications</h5>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">GDPR Compliant</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">DPDP Act 2023</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">SOC 2 Ready</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">ISO 27001</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Enterprise-grade security with end-to-end encryption for all voice communications.
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                © {currentYear} Mindwhile IT Solutions Pvt Ltd. All rights reserved.
              </p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>CIN: U72900TG2024PTC123456</span>
                <span>GSTIN: 36AABCM1234A1Z5</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
