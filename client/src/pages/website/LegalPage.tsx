import type { ReactNode } from "react";
import { Link } from "wouter";
import { COMPANY } from "./site-facts";

/** Shared frame for policy pages: title band, readable column, contact footer. */
export function LegalPage({ title, updated, audience, children }: { title: string; updated: string; audience?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">{title}</h1>
          <p className="text-muted-foreground">Last updated: {updated}</p>
          {audience ? <p className="text-sm text-muted-foreground mt-2">{audience}</p> : null}
        </div>
      </section>
      <section className="py-12 sm:py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert break-words">
          {children}
          <hr />
          <p className="text-sm">
            Questions about this policy: {COMPANY.legalName}, {COMPANY.address}. Email{" "}
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> · Phone <a href={COMPANY.phoneHref}>{COMPANY.phone}</a>. See also our{" "}
            <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
