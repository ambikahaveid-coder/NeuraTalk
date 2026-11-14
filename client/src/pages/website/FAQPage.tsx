import { Link } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Mail } from "lucide-react";
import { COMPANY, LANGUAGE_SUMMARY, CALL_TEXT_RETENTION_DAYS, FREE_AI_MINUTES } from "./site-facts";
import { PageHero } from "./site-ui";

type Faq = { id: string; q: string; a: React.ReactNode };

const GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: "Getting started",
    items: [
      { id: "what-is", q: "What is NeuraTalk?", a: "A messaging and calling app where language stops being a problem. Chat, call, share and pay like you would on any messaging app — and when the other person speaks a different language, NeuraTalk translates while you type or talk. You use your language; they use theirs." },
      { id: "start", q: "How do I get started?", a: `Download NeuraTalk, sign up with your mobile number, enter the code we send, and pick the language you speak. That's it. Chats and calls without translation are free, and new accounts get ${FREE_AI_MINUTES} free AI translation minutes to try translation. No card needed.` },
      { id: "other-person", q: "Does the other person need NeuraTalk?", a: "Yes, for chats and calls both people need NeuraTalk (the app or neuratalk.in on a computer). Calls to ordinary phone numbers aren't available for personal accounts. Businesses can reach customers who don't have NeuraTalk yet with one SMS that links to their message, once SMS is switched on for them." },
      { id: "languages", q: "Which languages does it speak?", a: `${LANGUAGE_SUMMARY} — any pair, in either direction. Mixed speech like Tenglish or Hinglish usually works; names, numbers and very mixed sentences are where mistakes are most likely.` },
    ],
  },
  {
    title: "Calls",
    items: [
      { id: "settings", q: "Do I have to choose a language before calling?", a: "You can choose a language before the call. Automatic detection is available for supported languages; detection quality depends on speech and the connection." },
      { id: "own-voice", q: "Will they hear a robot voice?", a: "No. Allow NeuraTalk to learn your voice (one tap, nothing to record) and it learns it from the first 15 seconds you speak in a call; the audio itself is not kept. You can also read three short passages in Settings → Your voice. After that, the other person hears your translated words in your own voice. Until then, the other person hears your original voice and sees translated captions — we never use a robot voice." },
      { id: "captions", q: "Do I need to read anything on screen?", a: "You can choose translated captions or translated speech in call settings. If the other person hasn't recorded their voice yet, captions turn on automatically and you still hear their original voice." },
      { id: "delay", q: "How long is the delay?", a: "Delay varies with language pair, network, microphone and provider. The live call pipeline processes speech, translation and audio as they become available." },
      { id: "noise", q: "What if I'm somewhere noisy?", a: "Noise processing may help. Recognition can still be affected by background noise, device quality and language coverage." },
      { id: "video-calls", q: "Does it work in video calls?", a: "Yes. Video calls are translated the same way as voice calls." },
      { id: "group-calls", q: "Can I call more than one person?", a: "Yes. Group voice and video calls are translated for everyone. People who share a language hear each other directly." },
      { id: "screen-share", q: "Can I share my screen in a call?", a: "Yes, in one-to-one calls. In the app, tap the screen icon at the top of the call; Android asks your permission every time. On a computer, use the share button in the call. The other person sees everything on your screen, including notifications, so stop sharing before you open anything private." },
      { id: "free-calls", q: "Are calls free?", a: "Calls between two people who speak the same language, or who choose not to translate, are free — voice, video and group. Translation uses AI minutes. If your minutes run out, the call still connects without translation." },
    ],
  },
  {
    title: "Chats and groups",
    items: [
      { id: "chat", q: "Are chats translated too?", a: "Yes. Write in your language; the other person reads it in theirs. Tap a message to see the original, or switch translation off for a chat. You can send photos, videos, documents, voice messages, locations, polls, stickers and contact cards, and use view once, disappearing messages and chat lock." },
      { id: "group-link", q: "How do I invite people to a group with a link?", a: "Group admins can open Group info → Invite via link to share a link or QR code. Anyone with NeuraTalk who opens it can join. You can reset the link (the old one stops working) or turn it off at any time. Someone an admin removed can't rejoin through the link." },
      { id: "broadcast", q: "What is a broadcast list?", a: "One message to many people at once (up to 256), each receiving it as a normal chat from you; replies come only to you. To stop spam, it reaches only people who have messaged you or saved your number. Find it in the Chats menu → Broadcast lists." },
      { id: "wallpaper", q: "Can I change the chat background?", a: "Yes. Choose a wallpaper or colour for all chats (Chats menu → Wallpaper) or for one chat (chat menu → Wallpaper). It's the same on your phone and on NeuraTalk for your computer." },
      { id: "private-chat", q: "What is a Private chat?", a: "A one-to-one chat (🔒 in the chat menu) that is encrypted on your phone so that only you and the other person can read it — not NeuraTalk. Because our servers can't read it, it isn't translated. It works on your phones only, not on the web, and a new phone can't read older private messages. Compare the security code with the other person to be sure nobody is in the middle." },
    ],
  },
  {
    title: "Your AI assistant",
    items: [
      { id: "assistant", q: "What does the AI assistant do?", a: "When you're busy, it answers your chats and calls for you. It always says it's your AI assistant, asks what it's about and whether it's urgent, and leaves you a short summary in \"Messages taken\" with a notification. When you write in the chat yourself, it steps back." },
      { id: "assistant-calls", q: "How does it answer calls?", a: "If you don't pick up within the ring time you set (20 seconds by default), or straight away while you're marked busy, it answers. You can also tap \"Let my assistant answer\" when a call comes in. It keeps calls short (up to 3 minutes) and hangs up once it has the message. If you join the call, it steps aside." },
      { id: "assistant-voice", q: "Whose voice does it use?", a: "Your choice: an AI voice, or your own voice if you've recorded it. Either way it first says it is an AI assistant, so nobody is misled." },
      { id: "assistant-cost", q: "What does it cost?", a: "7 days free, then ₹99 for 30 days: unlimited chat replies and 60 call minutes. It doesn't renew by itself — pay again when you want another 30 days. Turn it on in Settings → My AI assistant." },
    ],
  },
  {
    title: "Payments",
    items: [
      { id: "pay-friend", q: "Can I send money to a friend in a chat?", a: "Yes. In a chat, use the menu → Pay (UPI) to open your UPI app with their UPI ID, or Request money to send them a request. Each person adds their own UPI ID once. The money goes bank to bank through your UPI app — NeuraTalk never holds it." },
      { id: "pay-business", q: "How do I pay a business in a chat?", a: "A business can send you a payment request with the amount. Tap Pay with UPI app (or scan the QR on a computer), then tap \"I've paid\". The business confirms once the money reaches them." },
      { id: "pay-safety", q: "How do I stay safe with payments?", a: "Never share your UPI PIN or OTP in any chat — nobody genuine will ask for it, including NeuraTalk. To receive money you never need to enter your PIN. Check your bank app before treating a payment as received, and report anyone who pressures you." },
    ],
  },
  {
    title: "Businesses",
    items: [
      { id: "web", q: "Can I use NeuraTalk on my computer?", a: <>Yes. Open <Link href="/link-device" className="underline underline-offset-2">neuratalk.in/link-device</Link> on the computer, then on your phone go to More → Linked devices → Link a device and scan the code. Logging out on the computer signs out only that computer; your phone stays signed in. A computer you haven't used for 14 days is signed out automatically.</> },
      { id: "businesses", q: "Can I message shops and companies?", a: <>Yes. Businesses on NeuraTalk appear in your Chats list with their name and logo. A blue tick means NeuraTalk has checked the business. You can block any business, or switch off its offers and still get order updates and codes. Businesses can learn more on the <Link href="/business" className="underline underline-offset-2">NeuraTalk Business</Link> page.</> },
      { id: "business-sees", q: "What does a business see about me?", a: "Your name, profile photo and number, and the messages you send it — never your other chats." },
      { id: "business-bot", q: "Why did a business answer me instantly?", a: "Businesses can use an auto-reply bot (for words like \"price\" or button taps) or an AI receptionist that answers from the business's own catalog, hours and notes. Both are marked as automatic, and a person from the business can step in any time — ask for one and the AI hands you over." },
      { id: "sponsored", q: "What does \"Sponsored\" mean?", a: "A business paid to show a short ad in Business messages. NeuraTalk reviews every ad before it shows. Tapping it opens a chat with the business; the business pays for that, not you. Ads never appear inside your personal chats." },
      { id: "sms-link", q: "I got an SMS saying a business messaged me on NeuraTalk. Is it real?", a: "Businesses can send one SMS with a neuratalk.in/m/… link when you don't have NeuraTalk yet. The link only shows their message; it never asks for a PIN, OTP or payment. If an SMS asks for those, it isn't from us — don't reply." },
      { id: "business-pay", q: "I run a business. How do I pay?", a: <>In the NeuraTalk Business app (Tools → Wallet &amp; plan) or the business dashboard, choose a plan or credit, pay by UPI or bank transfer, and send the payment reference. NeuraTalk checks it and then adds the credit or starts the plan, usually within a working day. See the <Link href="/business-terms" className="underline underline-offset-2">Business Terms</Link>.</> },
    ],
  },
  {
    title: "Account and billing",
    items: [
      { id: "pricing", q: "How much does it cost?", a: <>Chats and calls without translation are free. AI translation uses minutes from your plan, which you can see in the app; the AI assistant is ₹99 for 30 days after a free week. Current prices are on the <Link href="/pricing" className="underline underline-offset-2">pricing page</Link>. Nothing renews automatically.</> },
      { id: "refunds", q: "Can I get a refund?", a: <>Yes, in the cases described in our <Link href="/refund-policy" className="underline underline-offset-2">refund policy</Link>.</> },
    ],
  },
  {
    title: "Privacy and your voice",
    items: [
      { id: "privacy", q: "Are my calls recorded?", a: `No. Call audio is never stored. The translated text of a call is kept in your call history for ${CALL_TEXT_RETENTION_DAYS} days, then deleted. Speech passes through our cloud providers (Microsoft Azure, OpenAI, ElevenLabs) only to be translated and spoken.` },
      { id: "voice-training", q: "What happens to my voice recording?", a: "It is used only to speak your own words in your own calls, never anyone else's. You can switch your voice off or delete it any time from Settings → Your voice." },
      { id: "security", q: "Are calls and chats encrypted?", a: <>Everything is encrypted while it travels and while it's stored. Calls and normal chats are not end-to-end encrypted, because translation needs our servers to process the speech or text — we tell you this plainly so you can choose what to share where. For something only the two of you should read, use a Private chat. Details are in the <Link href="/trust" className="underline underline-offset-2">Trust Center</Link> and <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.</> },
      { id: "assistant-privacy", q: "Who sees what I tell someone's AI assistant?", a: "The person (or business) whose assistant it is — it's kept for them in \"Messages taken\", like a message you left. The AI provider processes it only to reply, and it isn't used to train AI models." },
      { id: "new-sign-in", q: "How do I know if someone else signed in to my account?", a: "When a browser or computer signs in to your account, your phone gets a notification with the device and time. You can see every signed-in device in More → Linked devices and sign any of them out." },
      { id: "delete-account", q: "How do I delete my account?", a: "In the app: More → Privacy → Delete my account. Your number, name, photo and voice are removed and you are signed out everywhere. You can also download your data there first." },
    ],
  },
];

const slug = (t: string) => t.toLowerCase().replace(/[^a-z]+/g, "-");

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHero eyebrow="Help" title="Questions and answers" body="Straight answers about calls, chats, payments, your AI assistant, businesses and your data." />

      <section className="px-4 py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[220px_1fr]">
          <nav className="hidden lg:block" aria-label="Topics">
            <div className="sticky top-24 space-y-1">
              {GROUPS.map((g) => (
                <a key={g.title} href={`#${slug(g.title)}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{g.title}</a>
              ))}
            </div>
          </nav>
          <div className="space-y-14">
            {GROUPS.map((group) => (
              <div key={group.title} id={slug(group.title)} className="scroll-mt-24">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{group.title}</h2>
                <Accordion type="single" collapsible className="mt-4 w-full">
                  {group.items.map((item) => (
                    <AccordionItem key={item.id} value={item.id}>
                      <AccordionTrigger className="py-5 text-left text-base font-medium sm:text-lg">{item.q}</AccordionTrigger>
                      <AccordionContent className="pb-5 text-base leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}

            <div className="rounded-3xl border bg-muted/40 p-8 sm:p-10">
              <h2 className="text-2xl font-semibold">Still have a question?</h2>
              <p className="mt-2 text-muted-foreground">Write to us and we'll get back to you.</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a href={`mailto:${COMPANY.email}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"><Mail className="h-4 w-4" />Email support</a>
                <Link href="/help" className="inline-flex h-11 items-center justify-center rounded-full border bg-background px-6 hover:bg-muted">Help Center</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
