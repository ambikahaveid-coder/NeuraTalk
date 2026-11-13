import { COMPANY } from "./site-facts";

/** Written from the product's actual change history — only shipped features. */
const RELEASES = [
  {
    title: "Group links, broadcast lists, wallpapers, screen share and UPI payments",
    date: "14 November 2026",
    highlights: [
      "Group invite links and QR codes: admins can reset or turn off the link; someone an admin removed can't rejoin through it",
      "Broadcast lists: one message to up to 256 people, each as a normal chat from you; only people who have messaged you or saved your number receive it",
      "Chat wallpapers for all chats or one chat, the same on your phone and on the web",
      "Share your screen in a call, from the app or a computer browser",
      "Businesses can ask for payment in the chat: the customer pays straight to the business's UPI ID and taps \"I've paid\"; NeuraTalk never holds the money",
      "Business API: list menus, contact cards, mark as read, and UPI payment requests",
    ],
  },
  {
    title: "NeuraTalk partners",
    date: "13 November 2026",
    highlights: [
      "Partners can sell NeuraTalk Business under their own name, logo and colour, with their own sign-in page",
      "Partner panel: create businesses, give them credit and plans, confirm their payments, pause a business, add staff",
      "Partners buy wholesale credit from NeuraTalk; every rupee given to a business comes out of what the partner paid",
      "A partner's businesses see \"Managed by\" the partner, pay the partner, and get the partner's support contact",
    ],
  },
  {
    title: "Business bots, product cards and paying for credit",
    date: "13 November 2026",
    highlights: [
      "Auto-reply bot for businesses: a word like \"price\" or a button tap gets an instant answer, with buttons, a form or product cards",
      "Product cards: businesses send products with photo and today's price; customers add them to an order with one tap",
      "Businesses can buy wallet credit and monthly plans from the app or dashboard by UPI or bank transfer; NeuraTalk confirms each payment",
      "Wallet & plan screen: balance, plan minutes and end date, prices, and a statement of what was spent",
      "One-line Send API for business software, with an API key",
      "NeuraTalk can pause a business's bots or API sending if customers are harmed; the business sees the reason",
    ],
  },
  {
    title: "Free calls, data in India",
    date: "1 November 2026",
    highlights: [
      "Chats and voice, video and group calls without translation are now free",
      "AI translation: 5 free minutes for every new account, then a plan; calls still connect when minutes run out",
      "All your data is now stored in India (AWS Mumbai), with encrypted backups",
      "Faster call translation, served from Microsoft Azure in India",
      "Business accounts: balance is added only after payment is received",
    ],
  },
  {
    title: "NeuraTalk Business",
    date: "24 October 2026",
    highlights: [
      "New NeuraTalk Business app: create your business in the app, with profile, logo, catalog, greeting and away messages, quick replies, labels, chat link and QR code, and statistics",
      "Business chats now appear in your Chats list with the business name, logo and verified tick — never just a number",
      "Business info page in every business chat, with Block and Receive offers",
      "The verified tick is now given only after the NeuraTalk team checks a business",
      "Every business message template is reviewed by NeuraTalk before it can be sent; offers can't be sent as updates",
    ],
  },
  {
    title: "Stay signed in, and easier photos",
    date: "23 October 2026",
    highlights: [
      "The app stays signed in, even when it opens without internet",
      "Calls ring when the app is closed, and answering from the lock screen connects",
      "Double-tap or pinch to zoom photos, swipe down to close; tap a profile photo to open it",
      "Today / Yesterday dividers in chats, and names from your phone's contacts in the chat list",
      "NeuraTalk can learn your voice from your first half-minute of speech in a call, if you allow it",
    ],
  },
  {
    title: "Your own voice, in every call",
    date: "20 October 2026",
    highlights: [
      "Record your voice in the app (three short passages); translations are then spoken in your voice",
      "Each speaker's language is detected from their voice",
      "Background noise is removed from your microphone",
      "Until your voice is ready, people hear your original voice with translated captions — never a robot voice",
    ],
  },
  {
    title: "Group calls, files and a new look",
    date: "7 October 2026",
    highlights: [
      "Group voice and video calls with translation; same-language calls connect directly",
      "Photos, videos, documents and location in chats, with voice-message transcripts",
      "Light and dark themes across the app and website",
      "Sign-in codes stay inside the app",
    ],
  },
  {
    title: "Translated captions and reliable sign-in",
    date: "25 September 2026",
    highlights: [
      "Live translated captions during calls",
      "Contacts matched by number, however they are saved in your phone",
      "Better translation of short and mixed-language messages",
      "Every new account gets 15 free translated call minutes",
    ],
  },
];

export default function ReleaseNotesPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Release Notes</h1>
          <p className="text-muted-foreground">What's new in NeuraTalk</p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-8">
          {RELEASES.map((release) => (
            <div key={release.date} className="bg-card border rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-xl font-bold">{release.title}</h2>
                <span className="text-sm text-muted-foreground">{release.date}</span>
              </div>
              <ul className="space-y-2">
                {release.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5 flex-shrink-0">•</span>
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="bg-card border rounded-xl p-6 text-center">
            <h3 className="font-bold mb-2">Questions about an update?</h3>
            <p className="text-sm text-muted-foreground mb-4">Write to us and we'll help.</p>
            <a href={`mailto:${COMPANY.email}?subject=NeuraTalk%20update`} className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
              Email {COMPANY.email}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
