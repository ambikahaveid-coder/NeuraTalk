import { Link } from "wouter";
import { COMPANY, LEGAL_UPDATED, CALL_TEXT_RETENTION_DAYS } from "./site-facts";

export default function RecordingConsentPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="py-16 px-4 bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">Recording and Call Text</h1>
          <p className="text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
          <h2>NeuraTalk does not record calls</h2>
          <p>
            The audio of NeuraTalk calls is never recorded or stored. To translate, speech is sent to our providers as it is spoken, turned into
            text, translated and spoken in the listener's language, and then discarded.
          </p>

          <h2>What is kept: the text of the call</h2>
          <p>
            The recognised text of what was said and its translation are kept in the call history of the people on the call for{" "}
            {CALL_TEXT_RETENTION_DAYS} days, so you can look back at what was understood. After that they are deleted automatically.
          </p>

          <h2>Your voice</h2>
          <p>
            If you allow NeuraTalk to learn your voice from a call, about 15 seconds of your own speech are used to create your cloned voice.
            The other person's speech is never used, and the audio used for learning is not kept once your voice is created.
          </p>

          <h2>Recording with other apps</h2>
          <p>
            If you record a NeuraTalk call with another app or device, you are responsible for telling everyone on the call and getting the
            consent the law requires. Secretly recording someone may be unlawful.
          </p>

          <h2>Questions</h2>
          <p>Write to {COMPANY.email}. See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/data-retention">Data Retention</Link>.</p>
        </div>
      </section>
    </div>
  );
}
