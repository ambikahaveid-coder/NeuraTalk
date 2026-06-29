import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Frequently Asked Questions</h1>
          <p className="text-xl text-muted-foreground">
            Find answers to common questions about NeuraTalk
          </p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto space-y-8">
          <div>
            <Badge className="mb-4">General</Badge>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="what-is">
                <AccordionTrigger>What is NeuraTalk?</AccordionTrigger>
                <AccordionContent>
                  NeuraTalk is a voice AI platform that enables real-time multilingual communication. 
                  You can make calls, join video meetings, and chat with AI - all with live translation 
                  between languages like Telugu, Tamil, Kannada, Hindi, and English.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="how-works">
                <AccordionTrigger>How does the translation work?</AccordionTrigger>
                <AccordionContent>
                  When you speak, our AI listens, translates, and speaks in the other person's language - 
                  all in real-time. The translation preserves your tone and emotion, so the other person 
                  hears not just your words, but how you feel.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="languages">
                <AccordionTrigger>Which languages are supported?</AccordionTrigger>
                <AccordionContent>
                  Currently we support Telugu, Tamil, Kannada, Hindi, and English. We also understand 
                  mixed language (like Tenglish or Hinglish) - so you can speak naturally without 
                  worrying about switching languages mid-sentence.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="phone-number">
                <AccordionTrigger>Do I need a new phone number?</AccordionTrigger>
                <AccordionContent>
                  No. NeuraTalk works with your existing phone number and carrier. We enhance your calls, 
                  we don't replace your phone service. Your phone bill still comes from your regular carrier.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div>
            <Badge className="mb-4">Using NeuraTalk</Badge>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="start">
                <AccordionTrigger>How do I get started?</AccordionTrigger>
                <AccordionContent>
                  Sign up with your email or phone number, verify with OTP, and you're ready. 
                  New users get free credits to try all features. No credit card required.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="credits">
                <AccordionTrigger>What are credits and how do they work?</AccordionTrigger>
                <AccordionContent>
                  Credits are used for calls and translations. 1 credit = approximately 1 minute of 
                  translated call time. You can see your balance in the dashboard and buy more credits 
                  when needed. We'll warn you when credits are low.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="other-person">
                <AccordionTrigger>Does the other person need the app?</AccordionTrigger>
                <AccordionContent>
                  No! That's the beauty of NeuraTalk. You use the app, but the person you're calling 
                  just receives a normal phone call. They hear the translated version of what you say 
                  in their language.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="video-calls">
                <AccordionTrigger>Can I use this for video calls?</AccordionTrigger>
                <AccordionContent>
                  Face-to-face multilingual sessions are the primary supported path today. Some
                  meeting-room style audio/video experiences may depend on your deployment and
                  enabled transport stack, so we recommend face-to-face sessions for the most
                  reliable real-time translation experience.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div>
            <Badge className="mb-4">Billing & Credits</Badge>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="pricing">
                <AccordionTrigger>How much does NeuraTalk cost?</AccordionTrigger>
                <AccordionContent>
                  We offer flexible pricing. Individual users can buy credit packs starting from 
                  small amounts. Businesses get volume discounts and monthly plans. 
                  Check our pricing page for current rates.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="free-trial">
                <AccordionTrigger>Is there a free trial?</AccordionTrigger>
                <AccordionContent>
                  Yes! Every new user gets free credits to try the service. For businesses, 
                  we offer extended trial periods. Contact sales for enterprise trials.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="refunds">
                <AccordionTrigger>Can I get a refund?</AccordionTrigger>
                <AccordionContent>
                  Unused credits can be refunded within 30 days of purchase. 
                  Contact support with your account details for refund requests.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="payment-methods">
                <AccordionTrigger>What payment methods do you accept?</AccordionTrigger>
                <AccordionContent>
                  We accept credit/debit cards, UPI, net banking, and popular wallets through 
                  our secure payment partners. All transactions are encrypted and secure.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div>
            <Badge className="mb-4">Privacy & Security</Badge>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="privacy">
                <AccordionTrigger>Are my calls recorded?</AccordionTrigger>
                <AccordionContent>
                  By default, NO. We do not record your calls. If you enable recording for a meeting, 
                  all participants are notified. You have full control over recording settings.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="data">
                <AccordionTrigger>Where is my data stored?</AccordionTrigger>
                <AccordionContent>
                  Core application data is stored on secure infrastructure we control. For live
                  calling, translation, and phone-bridge delivery we may use vetted provider
                  infrastructure as part of the service path, with access controls and encryption
                  applied throughout.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="voice-training">
                <AccordionTrigger>What about voice training data?</AccordionTrigger>
                <AccordionContent>
                  Voice samples for training your personalized voice model are stored encrypted 
                  and only used with your explicit consent. You can delete your voice data anytime 
                  from settings.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="security">
                <AccordionTrigger>How secure is NeuraTalk?</AccordionTrigger>
                <AccordionContent>
                  We use industry-standard encryption for communications and enforce access
                  controls across our stack. NeuraTalk combines infrastructure we control with
                  vetted calling and AI providers where needed, and we follow Indian IT Act
                  guidelines and broader security best practices.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mt-16 p-8 rounded-2xl bg-primary/5 border border-primary/10 text-center">
          <h2 className="text-2xl font-bold mb-4">Still have questions?</h2>
          <p className="text-muted-foreground mb-6">
            Our support team is available 24/7 to help you with any technical or billing issues.
          </p>
          <Button className="gap-2" onClick={() => window.location.href = 'mailto:support@neuratalk.in'}>
            <Mail className="w-4 h-4" />
            Contact Support
          </Button>
        </div>
      </section>
    </div>
  );
}
